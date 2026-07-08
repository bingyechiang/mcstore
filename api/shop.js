// /api/shop.js
// 纯内存存储（无需 Vercel KV，无需环境变量）
let items = []; // 内存数组

// 初始化种子数据（仅首次）
let seeded = false;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 首次调用时填充种子数据
  if (!seeded) {
    await seedData();
    seeded = true;
  }

  try {
    if (req.method === 'GET') {
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
      items.unshift(newItem);
      return res.status(200).json({ items });
    }

    res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({ error: '服务器内部错误: ' + err.message });
  }
}

// ===== 种子数据（从 CSV 加载或使用内置） =====
async function seedData() {
  try {
    // 尝试从 /csv/shopitem.csv 加载
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

    // 无数据则用内置样例
    if (rows.length === 0) {
      rows = [
        { '商品名': '泥土', '单价': '1', '剩余数量': '999', '卖家': '服主' },
        { '商品名': '钻石剑', '单价': '64', '剩余数量': '10', '卖家': '老六' }
      ];
    }

    items = rows.map(row => ({
      name: row['商品名']?.trim() || '未知',
      price: parseInt(row['单价']) || 1,
      qty: parseInt(row['剩余数量']) || 1,
      seller: row['卖家']?.trim() || '匿名',
      icon: '/img/dirt.png',
      createdAt: Date.now() + Math.random() * 1000
    }));
    console.log(`✅ 种子数据已加载 ${items.length} 件商品（内存存储，重启后丢失）`);
  } catch (err) {
    console.warn('种子数据生成失败，使用空列表', err);
    items = [];
  }
}
