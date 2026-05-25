import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.warn("[Redis] REDIS_URL not set — cache operations will be no-ops");
}

const redis: Redis | null = REDIS_URL
  ? new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        const delay = Math.min(times * 200, 5000);
        console.warn(`[Redis] Reconnect attempt #${times}, delay ${delay}ms`);
        return delay;
      },
      lazyConnect: false,
    })
  : null;

if (redis) {
  redis.on("error", (err) => {
    console.error("[Redis] Connection error:", err.message);
  });

  redis.on("connect", () => {
    console.log("[Redis] Connected successfully");
  });
}

/**
 * Retrieve a cached value by key, parsed as JSON.
 * Returns null if key doesn't exist or Redis is unavailable.
 */
export async function getCache<T>(key: string): Promise<T | null> {
  if (!redis) return null;

  try {
    const raw = await redis.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error(`[Redis] getCache error for key "${key}":`, err);
    return null;
  }
}

/**
 * Set a cached value with a TTL in seconds.
 */
export async function setCache(
  key: string,
  data: unknown,
  ttlSeconds: number
): Promise<void> {
  if (!redis) return;

  try {
    const serialized = JSON.stringify(data);
    await redis.set(key, serialized, "EX", ttlSeconds);
  } catch (err) {
    console.error(`[Redis] setCache error for key "${key}":`, err);
  }
}

/**
 * Invalidate all keys matching a glob pattern.
 * Uses SCAN to avoid blocking Redis with KEYS on large datasets.
 */
export async function invalidatePattern(pattern: string): Promise<void> {
  if (!redis) return;

  try {
    let cursor = "0";
    let totalDeleted = 0;

    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        await redis.del(...keys);
        totalDeleted += keys.length;
      }
    } while (cursor !== "0");

    if (totalDeleted > 0) {
      console.log(
        `[Redis] Invalidated ${totalDeleted} keys matching "${pattern}"`
      );
    }
  } catch (err) {
    console.error(`[Redis] invalidatePattern error for "${pattern}":`, err);
  }
}

export { redis };
export default redis;
