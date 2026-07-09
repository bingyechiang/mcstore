// /api/shop.js
import { createClient } from 'redis';
import crypto from 'crypto';

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
  return crypto.createHash('sha256').update(password).digest('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = getIP(req);
  const now = Date.now();

  // 全局限流（IP分钟级：15次/分）
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

  // IP天级限流：500次/天
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

    // ==================== GET ====================
    if (req.method === 'GET') {
      const raw = await redis.get(STORAGE_KEY);
      const items = raw ? JSON.parse(raw) : [];
      // 移除 passwordHash 字段
      const safeItems = items.map(({ passwordHash, ...rest }) => rest);
      await redis.quit();
      return res.status(200).json({ items: safeItems });
    }

    // ==================== POST ====================
    if (req.method === 'POST') {
      const { action, name, price, qty, seller, icon, password, id } = req.body;

      // ---------- 管理操作：查询我的商品 ----------
      if (action === 'manage') {
        const sellerName = seller?.trim();
        const pass = password?.trim();
        if (!sellerName || !pass || pass.length < 4) {
          await redis.quit();
          return res.status(400).json({ error: '卖家名和密码（≥4位）必填' });
        }
        const raw = await redis.get(STORAGE_KEY);
        const items = raw ? JSON.parse(raw) : [];
        const hash = getPasswordHash(pass);
        const sellerItems = items.filter(i => i.seller === sellerName);
        if (sellerItems.length === 0) {
          await redis.quit();
          return res.status(404).json({ error: '该卖家名下没有商品' });
        }
        const storedHash = sellerItems[0].passwordHash;
        if (storedHash !== hash) {
          const failKey = `${FAIL_KEY}${ip}`;
          const failCount = await redis.get(failKey) || 0;
          const newFailCount = parseInt(failCount) + 1;
          await redis.set(failKey, newFailCount, { EX: 900 });
          if (newFailCount >= 5) {
            await redis.set(`${LOCK_KEY}${ip}`, '1', { EX: 900 });
            await redis.quit();
            return res.status(403).json({ error: '密码错误次数过多，IP已锁定15分钟' });
          }
          await redis.quit();
          return res.status(403).json({ error: `密码错误（${newFailCount}/5）` });
        }
        // 返回该卖家的所有商品（同样移除哈希）
        const safeItems = sellerItems.map(({ passwordHash, ...rest }) => rest);
        await redis.quit();
        return res.status(200).json({ items: safeItems });
      }

      // ---------- 管理操作：删除商品 ----------
      if (action === 'delete') {
        const sellerName = seller?.trim();
        const pass = password?.trim();
        const itemId = id;
        if (!sellerName || !pass || pass.length < 4 || !itemId) {
          await redis.quit();
          return res.status(400).json({ error: '参数不完整' });
        }
        const raw = await redis.get(STORAGE_KEY);
        const items = raw ? JSON.parse(raw) : [];
        const itemIndex = items.findIndex(i => i.id === itemId);
        if (itemIndex === -1) {
          await redis.quit();
          return res.status(404).json({ error: '商品不存在' });
        }
        const item = items[itemIndex];
        if (item.seller !== sellerName) {
          await redis.quit();
          return res.status(403).json({ error: '无权操作' });
        }
        const hash = getPasswordHash(pass);
        if (item.passwordHash !== hash) {
          const failKey = `${FAIL_KEY}${ip}`;
          const failCount = await redis.get(failKey) || 0;
          const newFailCount = parseInt(failCount) + 1;
          await redis.set(failKey, newFailCount, { EX: 900 });
          if (newFailCount >= 5) {
            await redis.set(`${LOCK_KEY}${ip}`, '1', { EX: 900 });
            await redis.quit();
            return res.status(403).json({ error: '密码错误次数过多，IP已锁定15分钟' });
          }
          await redis.quit();
          return res.status(403).json({ error: `密码错误（${newFailCount}/5）` });
        }
        items.splice(itemIndex, 1);
        await redis.set(STORAGE_KEY, JSON.stringify(items));
        await redis.quit();
        return res.status(200).json({ success: true });
      }

      // ---------- 管理操作：更新商品（编辑） ----------
      if (action === 'update') {
        const sellerName = seller?.trim();
        const pass = password?.trim();
        const itemId = id;
        const newName = name?.trim();
        const newPrice = parseInt(price);
        const newQty = parseInt(qty);
        const newIcon = icon?.trim() || '/img/dirt.png';

        if (!sellerName || !pass || pass.length < 4 || !itemId || !newName || !newPrice || !newQty) {
          await redis.quit();
          return res.status(400).json({ error: '参数不完整' });
        }

        const raw = await redis.get(STORAGE_KEY);
        const items = raw ? JSON.parse(raw) : [];
        const index = items.findIndex(i => i.id === itemId);
        if (index === -1) {
          await redis.quit();
          return res.status(404).json({ error: '商品不存在' });
        }
        const item = items[index];
        if (item.seller !== sellerName) {
          await redis.quit();
          return res.status(403).json({ error: '无权操作' });
        }
        const hash = getPasswordHash(pass);
        if (item.passwordHash !== hash) {
          const failKey = `${FAIL_KEY}${ip}`;
          const failCount = await redis.get(failKey) || 0;
          const newFailCount = parseInt(failCount) + 1;
          await redis.set(failKey, newFailCount, { EX: 900 });
          if (newFailCount >= 5) {
            await redis.set(`${LOCK_KEY}${ip}`, '1', { EX: 900 });
            await redis.quit();
            return res.status(403).json({ error: '密码错误次数过多，IP已锁定15分钟' });
          }
          await redis.quit();
          return res.status(403).json({ error: `密码错误（${newFailCount}/5）` });
        }

        // 检查IP锁定
        const locked = await redis.get(`${LOCK_KEY}${ip}`);
        if (locked) {
          await redis.quit();
          return res.status(403).json({ error: 'IP已被锁定，15分钟后再试' });
        }

        // 每日发布+编辑总次数限制（共用50次）
        const today = new Date().toISOString().split('T')[0];
        const dailyKey = `seller:${sellerName}:${today}`;
        const dailyCount = parseInt(await redis.get(dailyKey) || '0');
        if (dailyCount >= 50) {
          await redis.quit();
          return res.status(429).json({ error: '今日发布+编辑已达50次，明天再来' });
        }

        // 更新字段
        items[index].name = newName;
        items[index].price = newPrice;
        items[index].qty = newQty;
        items[index].icon = newIcon;

        await redis.set(STORAGE_KEY, JSON.stringify(items));
        // 增加计数（一天后过期）
        await redis.incr(dailyKey);
        await redis.expire(dailyKey, 86400);

        // 返回更新后的商品（无哈希）
        const { passwordHash, ...safeItem } = items[index];
        await redis.quit();
        return res.status(200).json({ success: true, item: safeItem });
      }

      // ---------- 发布商品（正常流程） ----------
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

      const raw = await redis.get(STORAGE_KEY);
      const items = raw ? JSON.parse(raw) : [];

      // 检查该卖家是否已有商品
      const sellerItems = items.filter(i => i.seller === cleanSeller);
      if (sellerItems.length > 0) {
        const storedHash = sellerItems[0].passwordHash;
        if (storedHash !== hash) {
          const failKey = `${FAIL_KEY}${ip}`;
          const failCount = await redis.get(failKey) || 0;
          const newFailCount = parseInt(failCount) + 1;
          await redis.set(failKey, newFailCount, { EX: 900 });
          if (newFailCount >= 5) {
            await redis.set(`${LOCK_KEY}${ip}`, '1', { EX: 900 });
            await redis.quit();
            return res.status(403).json({ error: '密码错误次数过多，IP已锁定15分钟' });
          }
          await redis.quit();
          return res.status(403).json({ error: `密码错误（${newFailCount}/5）` });
        }
      }

      const locked = await redis.get(`${LOCK_KEY}${ip}`);
      if (locked) {
        await redis.quit();
        return res.status(403).json({ error: 'IP已被锁定，15分钟后再试' });
      }

      // 同卖家同商品名去重
      const exists = items.find(i => i.name === cleanName && i.seller === cleanSeller);
      if (exists) {
        await redis.quit();
        return res.status(400).json({ error: '你已经挂过这个了，别刷屏' });
      }

      // 每日发布+编辑总次数限制（共用50次）
      const today = new Date().toISOString().split('T')[0];
      const dailyKey = `seller:${cleanSeller}:${today}`;
      const dailyCount = parseInt(await redis.get(dailyKey) || '0');
      if (dailyCount >= 50) {
        await redis.quit();
        return res.status(429).json({ error: '今日发布+编辑已达50次，明天再来' });
      }

      // 存储阈值（25MB预警）
      const rawSize = Buffer.byteLength(JSON.stringify(items), 'utf8');
      if (rawSize > 25 * 1024 * 1024) {
        await redis.quit();
        return res.status(507).json({ error: '集市货架快满了（>25MB），联系服主清理' });
      }

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
      // 增加计数
      await redis.incr(dailyKey);
      await redis.expire(dailyKey, 86400);

      await redis.del(`${FAIL_KEY}${ip}`);

      // 返回时不包含哈希
      const { passwordHash, ...safeItem } = newItem;
      await redis.quit();
      return res.status(200).json({ items: [safeItem, ...items.slice(1).map(({ passwordHash, ...rest }) => rest)] });
    }

    await redis.quit();
    res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('API Error:', err);
    try { await redis.quit(); } catch (_) {}
    res.status(500).json({ error: '服务器内部错误: ' + err.message });
  }
}
