// 使用 Vercel KV（需在项目设置中绑定）
import { kv } from '@vercel/kv';

const STORAGE_KEY = 'player_shop_items';
const SEED_KEY = 'shop_seeded';

export default async function handler(req, res) {
  // 允许跨域（本地开发）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // 初始化种子数据（如果未播种）
    const seeded = await kv.get(SEED_KEY);
    if (!seeded) {
      await seedData();
      await kv.set(SEED_KEY, 'true');
    }
    
    if (req.method === 'GET') {
      const items = await kv.get(STORAGE_KEY) || [];
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
        id: Date.now() + Math.random().toString(36).substr(2, 6),
        name: name.trim(),
        price: parseInt(price),
        qty: parseInt(qty),
        seller: seller.trim(),
        icon: icon || '/img/dirt.png',
        createdAt: Date.now()
      };
      
      const current = await kv.get(STORAGE_KEY) || [];
      current.unshift(newItem); // 最新在上
      await kv.set(STORAGE_KEY, current);
      return res.status(200).json({ items: current });
    }
    
    res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  }
}

// ===== 种子数据加载 =====
async function seedData() {
  try {
    // 尝试从 /csv/shopitem.csv 获取（部署后通过域名访问）
    // 注意：本地开发时可能无法访问，会回退到内置示例
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
    const csvUrl = `${baseUrl}/csv/shopitem.csv`;
    let csvText = '';
    try {
      const response = await fetch(csvUrl);
      if (response.ok) {
        csvText = await response.text();
      }
    } catch (_) {
      // 忽略
    }
    
    let rows = [];
    if (csvText) {
      // 简单解析 CSV（不使用 Papa，因为不保证有库）
      const lines = csvText.split('\n').filter(line => line.trim() !== '');
      const headers = lines[0].split(',').map(h => h.trim());
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim());
        if (cols.length < 4) continue;
        const row = {};
        headers.forEach((h, idx) => row[h] = cols[idx] || '');
        rows.push(row);
      }
    }
    
    // 若没有数据，使用内置示例
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
      icon: '/img/dirt.png', // 默认图标
      createdAt: Date.now() + Math.random() * 1000
    }));
    
    await kv.set(STORAGE_KEY, items);
    console.log(`种子数据已导入 ${items.length} 件商品`);
  } catch (err) {
    console.warn('种子数据导入失败，初始化空列表', err);
    await kv.set(STORAGE_KEY, []);
  }
}