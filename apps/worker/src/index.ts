import Redis from 'ioredis';
import { REDIS_URL, REDIS_PREFIX } from './config/redis.js';
import { logger } from './config/logger.js';
import { maintenanceWorker, createMaintenanceWorker } from './workers/maintenance.worker.js';
import {
  maintenanceQueue,
  createMaintenanceQueue,
  MAINTENANCE_QUEUE_NAME,
  enqueueMaintenanceHealthJob
} from './queues/maintenance.queue.js';

import {
  outreachDeliveryQueue,
  createOutreachDeliveryQueue,
  OUTREACH_DELIVERY_QUEUE_NAME,
  enqueueOutreachDeliveryJob
} from './queues/outreach-delivery.queue.js';

export {
  createMaintenanceQueue,
  createMaintenanceWorker,
  MAINTENANCE_QUEUE_NAME,
  maintenanceWorker,
  maintenanceQueue,
  enqueueMaintenanceHealthJob,
  outreachDeliveryQueue,
  createOutreachDeliveryQueue,
  OUTREACH_DELIVERY_QUEUE_NAME,
  enqueueOutreachDeliveryJob
};

async function startWorker() {
  logger.info({ prefix: REDIS_PREFIX }, 'Starting LeadMate Worker service...');

  // Fail-fast check on startup for Redis connectivity
  const probe = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    connectTimeout: 5000,
    retryStrategy: () => null
  });

  try {
    const ping = await probe.ping();
    logger.info({ ping }, 'Redis connectivity verified at startup');
    await probe.quit();
  } catch (err) {
    logger.fatal({ error: (err as Error).message }, 'Fatal: Redis unreachable at worker startup. Exiting.');
    process.exit(1);
  }

  logger.info(
    { workerPid: process.pid, queues: ['maintenance'] },
    'LeadMate Worker is running and ready to process jobs'
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down worker gracefully...');
    try {
      await maintenanceWorker.close();
      await maintenanceQueue.close();
      logger.info('Worker and queues closed successfully.');
      process.exit(0);
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Error during worker shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Start worker only when executed directly as main script
const isMain = process.argv[1] && process.argv[1].endsWith('index.ts');
if (isMain) {
  startWorker().catch((err) => {
    logger.fatal({ error: err.message }, 'Failed to start LeadMate Worker');
    process.exit(1);
  });
}
