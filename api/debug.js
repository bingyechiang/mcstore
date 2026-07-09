// /api/debug.js
import { createClient } from 'redis';

const redis = createClient({
  url: process.env.REDIS_URL
});

export default async function handler(req, res) {
  // 仅允许 GET（调试用）
  if (req.method !== 'GET') {
    return res.status(405).json({ error: '只支持 GET' });
  }

  try {
    await redis.connect();

    // 1. 获取所有键
    const keys = await redis.keys('*');
    const keyData = {};

    // 2. 获取每个键的值类型和长度
    for (const key of keys) {
      const type = await redis.type(key);
      let valueLen = 0;
      if (type === 'string') {
        const val = await redis.get(key);
        valueLen = val ? Buffer.byteLength(val, 'utf8') : 0;
        // 如果是商品列表，尝试解析并统计数量
        if (key === 'player_shop_items') {
          try {
            const items = JSON.parse(val);
            keyData[key] = {
              type,
              length: valueLen,
              itemCount: items.length,
              preview: items.slice(0, 3).map(i => ({
                name: i.name,
                seller: i.seller,
                price: i.price,
                qty: i.qty,
                hasPassword: !!i.passwordHash
              }))
            };
            continue;
          } catch (_) {}
        }
        // 其他 string 键，截取前 100 字符预览
        keyData[key] = {
          type,
          length: valueLen,
          preview: val ? val.substring(0, 100) : ''
        };
      } else if (type === 'hash') {
        const fields = await redis.hLen(key);
        keyData[key] = { type, length: fields };
      } else {
        keyData[key] = { type, length: 0 };
      }
    }

    // 3. 获取 Redis 内存信息
    const info = await redis.info('memory');
    const usedMemory = info.match(/used_memory_human:([^\r\n]+)/)?.[1] || 'unknown';
    const usedMemoryRaw = info.match(/used_memory:(\d+)/)?.[1] || '0';

    await redis.quit();

    return res.status(200).json({
      totalKeys: keys.length,
      usedMemory: usedMemory.trim(),
      usedMemoryBytes: parseInt(usedMemoryRaw),
      keys: keyData
    });

  } catch (err) {
    console.error('Debug error:', err);
    try { await redis.quit(); } catch (_) {}
    return res.status(500).json({ error: '调试失败: ' + err.message });
  }
}
