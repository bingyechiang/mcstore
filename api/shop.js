// /api/shop.js
import { createClient } from '@vercel/redis';

const redis = createClient({
  url: process.env.REDIS_URL
});

const STORAGE_KEY = 'player_shop_items';

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = getIP(req);
  const now = Date.now();

  // 限流（IP分钟级：15次/分钟）
  if (!global.rateLimit) global.rateLimit = new Map();
  const minKey = `min:${ip}`;
  const minData = global.rateLimit.get(minKey);
  if (minData && (now - minData.start) < 60000) {
    if (minData.count >= 15) {
      return res.status(429).json({ error: '手速太快了（15次/分钟），歇会儿再来' });
    }
    minData.count += 1;
  } else {
    global.rateLimit.set(minKey, { count: 1, start: now });
  }

  // 限流（IP天级：500次/天）
  const dayKey = `day:${ip}`;
  const dayData = global.rateLimit.get(dayKey);
  if (dayData && (now - dayData.start) < 86400000) {
    if (dayData.count >= 500) {
      return res.status(429).json({ error: '今日访问已达上限（500次），明天再来逛吧' });
    }
    dayData.count += 1;
  } else {
    global.rateLimit.set(dayKey, { count: 1, start: now });
  }

  try {
    if (req.method === 'GET') {
      const raw = await redis.get(STORAGE_KEY);
      const items = raw ? JSON.parse(raw) : [];
      return res.status(200).json({ items });
    }

    if (req.method === 'POST') {
      const { name, price, qty, seller, icon } = req.body;

      if (!name || name.trim().length < 2) {
        return res.status(400).json({ error: '商品名至少写俩字吧' });
      }
      if (!price || parseInt(price) < 1) {
        return res.status(400).json({ error: '单价至少 1 个泥土' });
      }
      if (!qty || parseInt(qty) < 1) {
        return res.status(400).json({ error: '数量至少 1 个' });
      }
      if (!seller || seller.trim().length < 1) {
        return res.status(400).json({ error: '填个游戏ID，别害羞' });
      }

      const cleanName = name.trim();
      const cleanSeller = seller.trim();
      const cleanPrice = parseInt(price);
      const cleanQty = parseInt(qty);

      const raw = await redis.get(STORAGE_KEY);
      const items = raw ? JSON.parse(raw) : [];

      const exists = items.find(i => i.name === cleanName && i.seller === cleanSeller);
      if (exists) {
        return res.status(400).json({ error: '你已经挂过这个了，别刷屏' });
      }

      const today = new Date().toISOString().split('T')[0];
      const sellerDailyKey = `seller:${cleanSeller}:${today}`;
      if (!global.sellerDaily) global.sellerDaily = new Map();
      const sellerCount = global.sellerDaily.get(sellerDailyKey) || 0;
      if (sellerCount >= 50) {
        return res.status(429).json({ error: '今天已发 50 件，你是要开店吗？歇歇吧' });
      }

      const rawSize = new Blob([JSON.stringify(items)]).size;
      if (rawSize > 25 * 1024 * 1024) {
        return res.status(507).json({ error: '集市货架快满了（>25MB），联系服主清理' });
      }

      const newItem = {
        id: Date.now() + Math.random().toString(36).substring(2, 8),
        name: cleanName,
        price: cleanPrice,
        qty: cleanQty,
        seller: cleanSeller,
        icon: icon || '/img/dirt.png',
        createdAt: Date.now()
      };
      items.unshift(newItem);
      await redis.set(STORAGE_KEY, JSON.stringify(items));
      global.sellerDaily.set(sellerDailyKey, sellerCount + 1);

      return res.status(200).json({ items });
    }

    res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({ error: '服务器内部错误: ' + err.message });
  }
}
