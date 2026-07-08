// /api/shop.js
import { kv } from '@vercel/kv';

const STORAGE_KEY = 'player_shop_items';
const SEED_KEY = 'shop_seeded';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // 初始化种子（仅在第一次）
    const seeded = await kv.get(SEED_KEY);
    if (!seeded) {
      await seedData();
      await kv.set(SEED_KEY, 'true');
    }

    if (req.method === 'GET') {
      const data = await kv.get(STORAGE_KEY);
      const items = data ? JSON.parse(data) : [];
      return res.status(200).json({ items });
    }

    if (req.method === 'POST') {
      const { name, price, qty, seller, icon } = req.body;

      // 校验
      if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: '商品名不能为空' });
      }
      if (!price || isNaN(price) || parseInt(price) < 1) {
        return res.status(400).json({ error: '单价须为正整数' });
      }
      if (!qty || isNaN(qty) || parseInt(qty) < 1) {
        return res.status(400).json({ error: '数量须为正整数' });
      }
      if (!seller || typeof seller !== 'string' || seller.trim() === '') {
        return res.status(400).json({ error: '卖家名不能为空' });
      }

      const newItem = {
        id: Date.now() + Math.random().toString(36).substring(2, 8),
        name: name.trim(),
        price: parseInt(price),
        qty: parseInt(qty),
        seller: seller.trim(),
        icon: icon || '/img/dirt.png',
        createdAt: Date.now()
      };

      // 读取现有数据（字符串）
      const raw = await kv.get(STORAGE_KEY);
      const current = raw ? JSON.parse(raw) : [];
      current.unshift(newItem);
      // 存为字符串
      await kv.set(STORAGE_KEY, JSON.stringify(current));
      return res.status(200).json({ items: current });
    }

    res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({ error: '服务器内部错误: ' + err.message });
  }
}

// ===== 种子数据 =====
async function seedData() {
  try {
    // 尝试从 /csv/shopitem.csv 加载（生产环境需配置域名）
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
    let csvText = '';
    try {
      const resp = await fetch(`${baseUrl}/csv/shopitem.csv`);
      if (resp.ok) csvText = await resp.text();
    } catch (_) {}

    let rows = [];
    if (csvText) {
      const lines = csvText.split('\n').filter(line => line.trim() !== '');
      if (lines.length > 1) {
        const headers = lines[0].split(',').map(h => h.trim());
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map(c => c.trim());
          if (cols.length < 4) continue;
          const row = {};
          headers.forEach((h, idx) => row[h] = cols[idx] || '');
          rows.push(row);
        }
      }
    }

    // 如果无数据则用内置示例
    if (rows.length === 0) {
      rows = [
        { '商品名': '泥土', '单价': '1', '剩余数量': '999', '卖家': '服主' },
        { '商品名': '钻石剑', '单价': '64', '剩余数量': '10', '卖家': '老六' }
      ];
    }

    const items = rows.map(row => ({
      name: row['商品名']?.trim() || '未知',
      price: parseInt(row['单价']) || 1,
      qty: parseInt(row['剩余数量']) || 1,
      seller: row['卖家']?.trim() || '匿名',
      icon: '/img/dirt.png',
      createdAt: Date.now() + Math.random() * 1000
    }));

    await kv.set(STORAGE_KEY, JSON.stringify(items));
    console.log(`✅ 种子数据已导入 ${items.length} 件商品`);
  } catch (err) {
    console.warn('⚠️ 种子数据导入失败，初始化空列表', err);
    await kv.set(STORAGE_KEY, JSON.stringify([]));
  }
}
