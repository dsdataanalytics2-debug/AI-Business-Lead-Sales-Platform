import { Request, Response } from 'express';
import prisma from '@leadmate/db';
import Redis from 'ioredis';
import { env } from '../config/env.js';

let redisClient: Redis | null = null;

function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      retryStrategy: () => null,
      enableOfflineQueue: false
    });
    redisClient.on('error', () => {
      // Suppress unhandled error events for health check probe
    });
  }
  return redisClient;
}

export async function healthCheck(_req: Request, res: Response): Promise<void> {
  let dbStatus = 'disconnected';
  let redisStatus = 'disconnected';

  // Check Database
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch {
    dbStatus = 'error';
  }

  // Check Redis
  try {
    const redis = getRedis();
    const ping = await redis.ping();
    redisStatus = ping === 'PONG' ? 'connected' : 'degraded';
  } catch {
    redisStatus = 'disconnected';
  }

  const isHealthy = dbStatus === 'connected';

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'degraded',
    uptime: process.uptime(),
    db: dbStatus,
    redis: redisStatus,
    timestamp: new Date().toISOString()
  });
}
