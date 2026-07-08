// /api/shop.js
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });
redis.connect().catch(() => {});

const STORAGE_KEY = 'player_shop_items';

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
}

async function checkRateLimit(redis, key, max, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSec;
  const multi = redis.multi();
  multi.zremrangebyscore(key, 0, windowStart);
  multi.zadd(key, now, now + Math.random().toString());
  multi.zcard(key);
  multi.expire(key, windowSec);
  const results = await multi.exec();
  const count = results[2][1];
  return count <= max;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const ip = getIP(req);
  const minKey = `ratelimit:min:${ip}`;
  const dayKey = `ratelimit:day:${ip}`;
  if (!await checkRateLimit(redis, minKey, 15, 60)) {
    return res.status(429).json({ error: '手速太快（15次/分钟）' });
  }
  if (!await checkRateLimit(redis, dayKey, 500, 86400)) {
    return res.status(429).json({ error: '今日访问已达上限（500次）' });
  }
  
  try {
    if (req.method === 'GET') {
      const { seller } = req.query;
      const raw = await redis.get(STORAGE_KEY);
      let items = raw ? JSON.parse(raw) : [];
      if (seller) {
        items = items.filter(item => item.seller === seller);
      }
      return res.status(200).json({ items });
    }
    
    if (req.method === 'POST') {
      const { name, price, qty, seller, icon } = req.body;
      if (!name || name.trim().length < 2) {
        return res.status(400).json({ error: '商品名至少写俩字' });
      }
      if (!price || parseInt(price) < 1) {
        return res.status(400).json({ error: '单价至少1个泥土' });
      }
      if (!qty || parseInt(qty) < 1) {
        return res.status(400).json({ error: '数量至少1个' });
      }
      if (!seller || seller.trim().length < 1) {
        return res.status(400).json({ error: '填个游戏ID' });
      }
      
      const cleanName = name.trim();
      const cleanSeller = seller.trim();
      const cleanPrice = parseInt(price);
      const cleanQty = parseInt(qty);
      
      const raw = await redis.get(STORAGE_KEY);
      const items = raw ? JSON.parse(raw) : [];
      
      const exists = items.find(i => i.name === cleanName && i.seller === cleanSeller);
      if (exists) {
        return res.status(400).json({ error: '你已经挂过这个了' });
      }
      
      const today = new Date().toISOString().split('T')[0];
      const sellerKey = `seller:${cleanSeller}:${today}`;
      const sellerCount = await redis.get(sellerKey) || 0;
      if (parseInt(sellerCount) >= 50) {
        return res.status(429).json({ error: '今天已发50件，歇歇吧' });
      }
      
      const rawSize = new Blob([JSON.stringify(items)]).size;
      if (rawSize > 25 * 1024 * 1024) {
        return res.status(507).json({ error: '集市货架快满了' });
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
      await redis.incr(sellerKey);
      await redis.expire(sellerKey, 86400);
      
      return res.status(200).json({ items });
    }
    
    // ========== DELETE 逻辑 ==========
    if (req.method === 'DELETE') {
      const id = req.body?.id || req.query?.id;
      let token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
      if (!token && req.body?.token) token = req.body.token;
      
      if (!id) {
        return res.status(400).json({ error: '缺少商品ID' });
      }
      if (!token) {
        return res.status(401).json({ error: '未登录，无法删除' });
      }
      
      const username = await redis.get(`token:${token}`);
      if (!username) {
        return res.status(401).json({ error: '登录已过期，请重新登录' });
      }
      
      const raw = await redis.get(STORAGE_KEY);
      let items = raw ? JSON.parse(raw) : [];
      const itemIndex = items.findIndex(item => item.id === id);
      if (itemIndex === -1) {
        return res.status(404).json({ error: '商品不存在' });
      }
      if (items[itemIndex].seller !== username) {
        return res.status(403).json({ error: '只能删除自己的商品' });
      }
      
      items.splice(itemIndex, 1);
      await redis.set(STORAGE_KEY, JSON.stringify(items));
      return res.status(200).json({ ok: true });
    }
    
    res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  }
}