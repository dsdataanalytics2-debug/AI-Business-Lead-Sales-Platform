import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../middleware/logger.js';

let sharedRedisClient: Redis | null = null;
let isConnecting = false;

/**
 * Returns a shared Redis client instance with offline queue disabled
 * and silent error suppression to allow seamless local in-memory fallback.
 */
export function getRedisClient(): Redis | null {
  if (sharedRedisClient) {
    return sharedRedisClient;
  }

  if (isConnecting) {
    return null;
  }

  try {
    isConnecting = true;
    sharedRedisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      retryStrategy: () => null,
      enableOfflineQueue: false
    });

    sharedRedisClient.on('error', (err) => {
      // Suppress unhandled reconnect noise to allow smooth fallback
      logger.debug(`[Redis] Connectivity event: ${err.message}`);
    });

    return sharedRedisClient;
  } catch (err: any) {
    logger.warn(`[Redis] Failed to initialize Redis client: ${err.message}`);
    sharedRedisClient = null;
    return null;
  } finally {
    isConnecting = false;
  }
}

/**
 * Gracefully closes the shared Redis client on server shutdown.
 */
export async function closeRedisClient(): Promise<void> {
  if (sharedRedisClient) {
    try {
      await sharedRedisClient.quit();
    } catch {
      sharedRedisClient.disconnect();
    } finally {
      sharedRedisClient = null;
    }
  }
}

/**
 * Distributed rate limiter with in-memory fallback.
 * Uses atomic Redis INCR + EXPIRE when Redis is connected;
 * seamlessly falls back to local in-memory Map on Redis outage.
 */
interface LocalRecord {
  count: number;
  resetTime: number;
}
const localFallbackMap = new Map<string, LocalRecord>();

export async function checkRateLimitDistributed(
  category: string,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const fullKey = `${env.REDIS_KEY_PREFIX}:ratelimit:${category}:${key}`;
  const now = Date.now();
  const redis = getRedisClient();

  if (redis && redis.status === 'ready') {
    try {
      const current = await redis.incr(fullKey);
      if (current === 1) {
        await redis.expire(fullKey, windowSeconds);
      }
      const ttl = await redis.ttl(fullKey);
      const effectiveTtl = ttl > 0 ? ttl : windowSeconds;
      const resetTime = now + effectiveTtl * 1000;

      if (current > limit) {
        return {
          allowed: false,
          remaining: 0,
          resetTime
        };
      }

      return {
        allowed: true,
        remaining: Math.max(0, limit - current),
        resetTime
      };
    } catch (err: any) {
      logger.debug(`[RateLimiter] Redis error, falling back to local memory: ${err.message}`);
      // Fall through to in-memory fallback below
    }
  }

  // Local in-memory fallback
  const record = localFallbackMap.get(fullKey);
  if (!record || now > record.resetTime) {
    const resetTime = now + windowSeconds * 1000;
    localFallbackMap.set(fullKey, { count: 1, resetTime });
    return {
      allowed: true,
      remaining: limit - 1,
      resetTime
    };
  }

  if (record.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: record.resetTime
    };
  }

  record.count += 1;
  return {
    allowed: true,
    remaining: limit - record.count,
    resetTime: record.resetTime
  };
}

/**
 * Resets local fallback state (useful for tests).
 */
export function resetLocalRateLimiterState(): void {
  localFallbackMap.clear();
}
