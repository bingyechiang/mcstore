// /api/shop.js
import { createClient } from 'redis';

const redis = createClient({
  url: process.env.REDIS_URL
});
redis.on('error', (err) => console.error('Redis Error:', err));

const STORAGE_KEY = 'player_shop_items';
const FAIL_KEY = 'login_fail:';
const LOCK_KEY = 'login_lock:';

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
}

function getPasswordHash(password) {
  // 简单 SHA-256（浏览器端和 Node 端都能算，这里用 Node 内置）
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(password).digest('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = getIP(req);
  const now = Date.now();

  // ===== 全局限流（IP分钟级：15次/分） =====
  if (!global.rateLimit) global.rateLimit = new Map();
  const minKey = `min:${ip}`;
  const minData = global.rateLimit.get(minKey);
  if (minData && (now - minData.start) < 60000) {
    if (minData.count >= 15) {
      return res.status(429).json({ error: '手速太快，歇会儿再来' });
    }
    minData.count += 1;
  } else {
    global.rateLimit.set(minKey, { count: 1, start: now });
  }

  // ===== IP天级限流：500次/天 =====
  const dayKey = `day:${ip}`;
  const dayData = global.rateLimit.get(dayKey);
  if (dayData && (now - dayData.start) < 86400000) {
    if (dayData.count >= 500) {
      return res.status(429).json({ error: '今日访问已达上限，明天再来' });
    }
    dayData.count += 1;
  } else {
    global.rateLimit.set(dayKey, { count: 1, start: now });
  }

  try {
    await redis.connect();

    // ===== GET =====
    if (req.method === 'GET') {
      const raw = await redis.get(STORAGE_KEY);
      const items = raw ? JSON.parse(raw) : [];
      await redis.quit();
      return res.status(200).json({ items });
    }

    // ===== POST =====
    if (req.method === 'POST') {
      const { name, price, qty, seller, icon, password } = req.body;

      // --- 基础校验 ---
      if (!name || name.trim().length < 2) {
        await redis.quit();
        return res.status(400).json({ error: '商品名至少写俩字' });
      }
      if (!price || parseInt(price) < 1) {
        await redis.quit();
        return res.status(400).json({ error: '单价至少 1 个泥土' });
      }
      if (!qty || parseInt(qty) < 1) {
        await redis.quit();
        return res.status(400).json({ error: '数量至少 1 个' });
      }
      if (!seller || seller.trim().length < 1) {
        await redis.quit();
        return res.status(400).json({ error: '填个游戏ID' });
      }
      if (!password || password.trim().length < 4) {
        await redis.quit();
        return res.status(400).json({ error: '管理密码至少 4 位' });
      }

      const cleanName = name.trim();
      const cleanSeller = seller.trim();
      const cleanPrice = parseInt(price);
      const cleanQty = parseInt(qty);
      const cleanPassword = password.trim();
      const hash = getPasswordHash(cleanPassword);

      // --- 读取现有数据 ---
      const raw = await redis.get(STORAGE_KEY);
      const items = raw ? JSON.parse(raw) : [];

      // --- 检查该卖家是否已存在商品 ---
      const sellerItems = items.filter(i => i.seller === cleanSeller);

      if (sellerItems.length > 0) {
        // 已有商品 → 验证密码
        const storedHash = sellerItems[0].passwordHash;
        if (storedHash !== hash) {
          // ===== 密码错误 → IP 锁定计数 =====
          const failKey = `${FAIL_KEY}${ip}`;
          const failCount = await redis.get(failKey) || 0;
          const newFailCount = parseInt(failCount) + 1;
          await redis.set(failKey, newFailCount, { EX: 900 }); // 15分钟过期

          if (newFailCount >= 5) {
            await redis.set(`${LOCK_KEY}${ip}`, '1', { EX: 900 });
            await redis.quit();
            return res.status(403).json({ error: '密码错误次数过多，IP已被锁定15分钟' });
          }

          await redis.quit();
          return res.status(403).json({
            error: `密码错误（${newFailCount}/5），15分钟内错误5次将锁定IP`
          });
        }
      } else {
        // 新卖家 → 直接记录密码
        // （无需额外操作，下面保存时会带上 hash）
      }

      // --- 检查该IP是否被锁定 ---
      const locked = await redis.get(`${LOCK_KEY}${ip}`);
      if (locked) {
        await redis.quit();
        return res.status(403).json({ error: 'IP已被锁定，15分钟后再试' });
      }

      // --- 同卖家同商品名去重 ---
      const exists = items.find(i => i.name === cleanName && i.seller === cleanSeller);
      if (exists) {
        await redis.quit();
        return res.status(400).json({ error: '你已经挂过这个了，别刷屏' });
      }

      // --- 卖家日限流（50件/天） ---
      const today = new Date().toISOString().split('T')[0];
      const sellerDailyKey = `seller:${cleanSeller}:${today}`;
      if (!global.sellerDaily) global.sellerDaily = new Map();
      const sellerCount = global.sellerDaily.get(sellerDailyKey) || 0;
      if (sellerCount >= 50) {
        await redis.quit();
        return res.status(429).json({ error: '今天已发50件，你是要开店吗' });
      }

      // --- 存储阈值（25MB预警） ---
      const rawSize = Buffer.byteLength(JSON.stringify(items), 'utf8');
      if (rawSize > 25 * 1024 * 1024) {
        await redis.quit();
        return res.status(507).json({ error: '集市货架快满了（>25MB），联系服主清理' });
      }

      // --- 发布成功 ---
      const newItem = {
        id: Date.now() + Math.random().toString(36).substring(2, 8),
        name: cleanName,
        price: cleanPrice,
        qty: cleanQty,
        seller: cleanSeller,
        icon: icon || '/img/dirt.png',
        passwordHash: hash,
        createdAt: Date.now()
      };
      items.unshift(newItem);
      await redis.set(STORAGE_KEY, JSON.stringify(items));
      global.sellerDaily.set(sellerDailyKey, sellerCount + 1);

      // --- 清空该IP的密码失败计数（发布成功视为身份验证通过） ---
      await redis.del(`${FAIL_KEY}${ip}`);

      await redis.quit();
      return res.status(200).json({ items });
    }

    await redis.quit();
    res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('API Error:', err);
    try { await redis.quit(); } catch (_) {}
    res.status(500).json({ error: '服务器内部错误: ' + err.message });
  }
}
