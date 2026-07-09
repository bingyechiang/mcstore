// /api/admin.js
import { createClient } from 'redis';
import crypto from 'crypto';

const redis = createClient({
  url: process.env.REDIS_URL
});
redis.on('error', (err) => console.error('Redis Error:', err));

const STORAGE_KEY = 'player_shop_items';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'dev-secret-change-me';

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
}

// 校验管理员密钥（从请求头获取）
function isAdmin(req) {
  const key = req.headers['x-admin-key'] || req.query?.key || '';
  return key === ADMIN_SECRET;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 所有请求必须携带管理员密钥
  if (!isAdmin(req)) {
    return res.status(401).json({ error: '管理密钥无效' });
  }

  try {
    await redis.connect();

    // ========== GET：获取所有商品 ==========
    if (req.method === 'GET') {
      const raw = await redis.get(STORAGE_KEY);
      const items = raw ? JSON.parse(raw) : [];
      await redis.quit();
      return res.status(200).json({ items, count: items.length });
    }

    // ========== PUT：编辑商品 ==========
    if (req.method === 'PUT') {
      const { id, name, price, qty, icon } = req.body;
      if (!id) {
        await redis.quit();
        return res.status(400).json({ error: '缺少商品ID' });
      }

      const raw = await redis.get(STORAGE_KEY);
      const items = raw ? JSON.parse(raw) : [];
      const index = items.findIndex(i => i.id === id);
      if (index === -1) {
        await redis.quit();
        return res.status(404).json({ error: '商品不存在' });
      }

      // 更新字段（只更新传了的）
      if (name !== undefined) items[index].name = name.trim();
      if (price !== undefined) items[index].price = parseInt(price);
      if (qty !== undefined) items[index].qty = parseInt(qty);
      if (icon !== undefined) items[index].icon = icon;

      await redis.set(STORAGE_KEY, JSON.stringify(items));
      await redis.quit();
      return res.status(200).json({ success: true, item: items[index] });
    }

    // ========== DELETE：删除商品 ==========
    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) {
        await redis.quit();
        return res.status(400).json({ error: '缺少商品ID' });
      }

      const raw = await redis.get(STORAGE_KEY);
      const items = raw ? JSON.parse(raw) : [];
      const index = items.findIndex(i => i.id === id);
      if (index === -1) {
        await redis.quit();
        return res.status(404).json({ error: '商品不存在' });
      }

      const removed = items.splice(index, 1)[0];
      await redis.set(STORAGE_KEY, JSON.stringify(items));
      await redis.quit();
      return res.status(200).json({ success: true, removed });
    }

    await redis.quit();
    res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('Admin API Error:', err);
    try { await redis.quit(); } catch (_) {}
    res.status(500).json({ error: '服务器内部错误: ' + err.message });
  }
}
