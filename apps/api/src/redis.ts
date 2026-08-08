import Redis from "ioredis";

function redisUrl() {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  const host = process.env.REDIS_HOST || "127.0.0.1";
  const port = process.env.REDIS_PORT || "6379";
  const pass = process.env.REDIS_PASSWORD;
  return pass ? `redis://:${pass}@${host}:${port}` : `redis://${host}:${port}`;
}

export const redis = new Redis(redisUrl(), { maxRetriesPerRequest: null, lazyConnect: true });
export const redisSub = new Redis(redisUrl(), { maxRetriesPerRequest: null, lazyConnect: true });

export const CHANNEL = "flare:room";
export const QUEUE = "flare:thumb:jobs";

export async function ensureRedis() {
  if (redis.status === "wait") await redis.connect();
  if (redisSub.status === "wait") await redisSub.connect();
}
