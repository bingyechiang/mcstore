// /api/shop.js
import { createClient } from "redis";

// ========== Redis 连接（单例，避免重复握手） ==========
const client = createClient({
  url: process.env.REDIS_URL
});
client.on("error", (err) => console.error("Redis Client Error:", err));

let connected = false;
async function getRedis() {
  if (!connected) {
    await client.connect();
    connected = true;
  }
  return client;
}

const STORAGE_KEY = "player_shop_items";

// ========== 工具函数 ==========
function getIP(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown";
}

// ========== 限流辅助函数（全部基于 Redis） ==========
async function checkRateLimit(redis, key, limit, windowSeconds) {
  const current = await redis.incr(key);
  if (current === 1) {
    // 首次访问，设置过期时间
    await redis.expire(key, windowSeconds);
  }
  if (current > limit) {
    return false;
  }
  return true;
}

// ========== 主 Handler ==========
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const ip = getIP(req);
  const redis = await getRedis();

  try {
    // ---- 1. IP 分钟限流：15 次 / 分钟 ----
    const minKey = `ratelimit:min:${ip}`;
    const minOk = await checkRateLimit(redis, minKey, 15, 60);
    if (!minOk) {
      return res.status(429).json({ error: "手速太快了（15次/分钟），歇会儿再来" });
    }

    // ---- 2. IP 天限流：500 次 / 天 ----
    const dayKey = `ratelimit:day:${ip}`;
    const dayOk = await checkRateLimit(redis, dayKey, 500, 86400);
    if (!dayOk) {
      return res.status(429).json({ error: "今日访问已达上限（500次），明天再来逛吧" });
    }

    // ---- GET：获取商品列表 ----
    if (req.method === "GET") {
      const raw = await redis.get(STORAGE_KEY);
      let items = [];
      if (raw) {
        try {
          items = JSON.parse(raw);
        } catch (_) {
          items = [];
        }
      }
      return res.status(200).json({ items });
    }

    // ---- POST：发布商品 ----
    if (req.method === "POST") {
      const { name, price, qty, seller, icon } = req.body;

      // 基础校验
      if (!name || name.trim().length < 2) {
        return res.status(400).json({ error: "商品名至少写俩字吧" });
      }
      if (!price || parseInt(price) < 1) {
        return res.status(400).json({ error: "单价至少 1 个泥土" });
      }
      if (!qty || parseInt(qty) < 1) {
        return res.status(400).json({ error: "数量至少 1 个" });
      }
      if (!seller || seller.trim().length < 1) {
        return res.status(400).json({ error: "填个游戏ID，别害羞" });
      }

      const cleanName = name.trim();
      const cleanSeller = seller.trim();
      const cleanPrice = parseInt(price);
      const cleanQty = parseInt(qty);

      // ---- 读取现有数据 ----
      const raw = await redis.get(STORAGE_KEY);
      let items = [];
      if (raw) {
        try {
          items = JSON.parse(raw);
        } catch (_) {
          items = [];
        }
      }

      // ---- 同卖家 + 同商品名 去重 ----
      const exists = items.find((i) => i.name === cleanName && i.seller === cleanSeller);
      if (exists) {
        return res.status(400).json({ error: "你已经挂过这个了，别刷屏" });
      }

      // ---- 卖家日限流：50 件 / 天（使用 Redis） ----
      const today = new Date().toISOString().split("T")[0];
      const sellerKey = `seller:${cleanSeller}:${today}`;
      const sellerOk = await checkRateLimit(redis, sellerKey, 50, 86400);
      if (!sellerOk) {
        return res.status(429).json({ error: "今天已发 50 件，你是要开店吗？歇歇吧" });
      }

      // ---- 存储阈值：25 MB 预警 ----
      const rawSize = Buffer.byteLength(JSON.stringify(items), "utf8");
      if (rawSize > 25 * 1024 * 1024) {
        return res.status(507).json({ error: "集市货架快满了（>25MB），联系服主清理" });
      }

      // ---- 写入新商品 ----
      const newItem = {
        id: Date.now() + Math.random().toString(36).substring(2, 8),
        name: cleanName,
        price: cleanPrice,
        qty: cleanQty,
        seller: cleanSeller,
        icon: icon || "/img/dirt.png",
        createdAt: Date.now(),
      };
      items.unshift(newItem);
      await redis.set(STORAGE_KEY, JSON.stringify(items));

      return res.status(200).json({ items });
    }

    res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    console.error("API Error:", err);
    res.status(500).json({ error: "服务器内部错误: " + err.message });
  }
}
