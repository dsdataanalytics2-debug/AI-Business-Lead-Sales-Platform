import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './middleware/logger.js';
import prisma from '@leadmate/db';
import { closeRedisClient } from './lib/redis.js';

const server = app.listen(env.PORT, () => {
  logger.info(`LeadMate API server listening on http://localhost:${env.PORT} in ${env.NODE_ENV} mode`);
});

let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully...`);

  // Hard timeout guard: Force exit if cleanup takes longer than 10 seconds
  const timeoutTimer = setTimeout(() => {
    logger.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);

  try {
    // 1. Close HTTP server so new incoming connections are rejected
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    logger.info('HTTP server closed.');

    // 2. Disconnect Prisma PostgreSQL connection pool
    await prisma.$disconnect();
    logger.info('Prisma connection pool disconnected.');

    // 3. Close API-owned shared Redis client
    await closeRedisClient();
    logger.info('API Redis client disconnected.');

    clearTimeout(timeoutTimer);
    logger.info('Graceful shutdown completed.');
    process.exit(0);
  } catch (err: any) {
    logger.error(`Error during graceful shutdown: ${err?.message || err}`);
    clearTimeout(timeoutTimer);
    process.exit(1);
  }
};

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM').catch(() => process.exit(1));
});
process.on('SIGINT', () => {
  gracefulShutdown('SIGINT').catch(() => process.exit(1));
});
