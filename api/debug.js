// /api/debug.js
import { createClient } from 'redis';
import crypto from 'crypto';

const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', (err) => console.error('Redis Error:', err));

const STORAGE_KEY = 'player_shop_items';
const ADMIN_HASH = process.env.ADMIN_PASSWORD_HASH; // 你在环境变量里设置
const TOKEN_EXPIRY = 3600; // 1小时

// 内存存储token（简单，但Vercel冷启动会丢失，不影响）
const tokenStore = new Map();

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 解析路径
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace(/^\/api\/debug/, '');

  try {
    await redis.connect();

    // ===== 登录 =====
    if (req.method === 'POST' && path === '/login') {
      const { password } = req.body;
      if (!password) {
        await redis.quit();
        return res.status(400).json({ error: '密码不能空' });
      }
      const inputHash = hashPassword(password);
      if (inputHash !== ADMIN_HASH) {
        await redis.quit();
        return res.status(401).json({ error: '密码错误，滚' });
      }
      const token = generateToken();
      tokenStore.set(token, { expiry: Date.now() + TOKEN_EXPIRY * 1000 });
      await redis.quit();
      return res.status(200).json({ token });
    }

    // ===== 验证token（中间件） =====
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      await redis.quit();
      return res.status(401).json({ error: '未登录' });
    }
    const token = auth.split(' ')[1];
    const session = tokenStore.get(token);
    if (!session || session.expiry < Date.now()) {
      tokenStore.delete(token);
      await redis.quit();
      return res.status(401).json({ error: '登录已过期' });
    }
    // 续期
    session.expiry = Date.now() + TOKEN_EXPIRY * 1000;

    // ===== GET /items =====
    if (req.method === 'GET' && path === '/items') {
      const raw = await redis.get(STORAGE_KEY);
      const items = raw ? JSON.parse(raw) : [];
      await redis.quit();
      return res.status(200).json({ items });
    }

    // ===== PUT /items/:id =====
    if (req.method === 'PUT' && path.startsWith('/items/')) {
      const id = path.split('/')[2];
      if (!id) {
        await redis.quit();
        return res.status(400).json({ error: '缺少ID' });
      }
      const { name, price, qty, seller, icon } = req.body;
      // 基本校验
      if (!name || name.trim().length < 2) {
        await redis.quit();
        return res.status(400).json({ error: '商品名至少俩字' });
      }
      if (!price || parseInt(price) < 1) {
        await redis.quit();
        return res.status(400).json({ error: '单价至少1' });
      }
      if (!qty || parseInt(qty) < 1) {
        await redis.quit();
        return res.status(400).json({ error: '数量至少1' });
      }
      if (!seller || seller.trim().length < 1) {
        await redis.quit();
        return res.status(400).json({ error: '卖家不能空' });
      }

      const raw = await redis.get(STORAGE_KEY);
      const items = raw ? JSON.parse(raw) : [];
      const index = items.findIndex(i => i.id === id);
      if (index === -1) {
        await redis.quit();
        return res.status(404).json({ error: '商品不存在' });
      }
      // 更新字段（保留passwordHash不变）
      items[index].name = name.trim();
      items[index].price = parseInt(price);
      items[index].qty = parseInt(qty);
      items[index].seller = seller.trim();
      if (icon) items[index].icon = icon.trim();
      await redis.set(STORAGE_KEY, JSON.stringify(items));
      await redis.quit();
      return res.status(200).json({ items });
    }

    // ===== DELETE /items/:id =====
    if (req.method === 'DELETE' && path.startsWith('/items/')) {
      const id = path.split('/')[2];
      if (!id) {
        await redis.quit();
        return res.status(400).json({ error: '缺少ID' });
      }
      const raw = await redis.get(STORAGE_KEY);
      const items = raw ? JSON.parse(raw) : [];
      const newItems = items.filter(i => i.id !== id);
      if (newItems.length === items.length) {
        await redis.quit();
        return res.status(404).json({ error: '商品不存在' });
      }
      await redis.set(STORAGE_KEY, JSON.stringify(newItems));
      await redis.quit();
      return res.status(200).json({ items: newItems });
    }

    await redis.quit();
    res.status(404).json({ error: '接口不存在' });
  } catch (err) {
    console.error('Debug API Error:', err);
    try { await redis.quit(); } catch (_) {}
    res.status(500).json({ error: '服务器内部错误: ' + err.message });
  }
}
