// /api/debug.js
import { createClient } from 'redis';
import crypto from 'crypto';

const REDIS_URL = process.env.REDIS_URL;
const ADMIN_HASH = process.env.ADMIN_PASSWORD_HASH;

// 环境变量检查（不阻止启动，只打印警告）
if (!REDIS_URL) console.error('缺少 REDIS_URL 环境变量');
if (!ADMIN_HASH) console.error('缺少 ADMIN_PASSWORD_HASH 环境变量');

const redis = createClient({ url: REDIS_URL });
redis.on('error', (err) => console.error('Redis Error:', err));

const STORAGE_KEY = 'player_shop_items';
const TOKEN_EXPIRY = 3600;
const tokenStore = new Map();

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(pwd).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 环境变量缺失直接报错
  if (!REDIS_URL || !ADMIN_HASH) {
    return res.status(500).json({ error: '服务器配置缺失：请设置 REDIS_URL 和 ADMIN_PASSWORD_HASH' });
  }

  const path = req.url.replace(/^\/api\/debug/, '').split('?')[0];

  try {
    await redis.connect();

    // ----- 登录 -----
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

    // ----- 验证 token -----
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
    session.expiry = Date.now() + TOKEN_EXPIRY * 1000;

    // ----- GET /items -----
    if (req.method === 'GET' && path === '/items') {
      const raw = await redis.get(STORAGE_KEY);
      const items = raw ? JSON.parse(raw) : [];
      await redis.quit();
      return res.status(200).json({ items });
    }

    // ----- PUT /items/:id -----
    if (req.method === 'PUT' && path.startsWith('/items/')) {
      const id = path.split('/')[2];
      if (!id) {
        await redis.quit();
        return res.status(400).json({ error: '缺少ID' });
      }
      const { name, price, qty, seller, icon } = req.body;
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
      items[index].name = name.trim();
      items[index].price = parseInt(price);
      items[index].qty = parseInt(qty);
      items[index].seller = seller.trim();
      if (icon) items[index].icon = icon.trim();
      await redis.set(STORAGE_KEY, JSON.stringify(items));
      await redis.quit();
      return res.status(200).json({ items });
    }

    // ----- DELETE /items/:id -----
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
    res.status(500).json({ error: '服务器错误: ' + err.message });
  }
}
