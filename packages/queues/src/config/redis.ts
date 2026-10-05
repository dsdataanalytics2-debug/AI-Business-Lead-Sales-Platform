import Redis from 'ioredis';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/0';
export const REDIS_PREFIX = process.env.REDIS_KEY_PREFIX || 'leadmate';

export function createRedisConnection(options?: { name?: string }): Redis {
  const connectionName = options?.name || 'bullmq-client';

  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => Math.min(times * 100, 3000),
    reconnectOnError: () => true
  });

  client.on('error', (err) => {
    if (process.env.NODE_ENV !== 'test') {
      console.error(`[Redis:${connectionName}] Connection error:`, err.message);
    }
  });

  return client;
}
