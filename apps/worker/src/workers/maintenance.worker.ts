import { Worker, Job } from 'bullmq';
import prisma from '@leadmate/db';
import {
  MAINTENANCE_QUEUE_NAME,
  MaintenanceHealthJobData,
  MaintenanceHealthJobResult
} from '../queues/maintenance.queue.js';
import { createRedisConnection, REDIS_PREFIX } from '../config/redis.js';
import { logger } from '../config/logger.js';

export function createMaintenanceWorker(): Worker<MaintenanceHealthJobData, MaintenanceHealthJobResult> {
  const connection = createRedisConnection({ name: 'maintenance-worker' });

  const worker = new Worker<MaintenanceHealthJobData, MaintenanceHealthJobResult>(
    MAINTENANCE_QUEUE_NAME,
    async (job: Job<MaintenanceHealthJobData, MaintenanceHealthJobResult>) => {
      logger.info({ jobId: job.id, jobName: job.name }, 'Processing maintenance job');

      if (job.name === 'MAINTENANCE_HEALTH_CHECK') {
        let dbStatus = 'disconnected';
        try {
          await prisma.$queryRaw`SELECT 1`;
          dbStatus = 'connected';
        } catch {
          dbStatus = 'error';
        }

        const result: MaintenanceHealthJobResult = {
          ok: true,
          jobName: job.name,
          processedAt: new Date().toISOString(),
          db: dbStatus,
          workerPid: process.pid
        };

        logger.info({ jobId: job.id, result }, 'Maintenance health check completed successfully');
        return result;
      }

      throw new Error(`Unknown job name: ${job.name}`);
    },
    {
      connection,
      prefix: REDIS_PREFIX,
      concurrency: 5
    }
  );

  worker.on('completed', (job: Job) => {
    logger.info({ jobId: job.id, name: job.name }, 'Job completed');
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error({ jobId: job?.id, name: job?.name, error: err.message }, 'Job failed');
  });

  worker.on('error', (err: Error) => {
    logger.error({ error: err.message }, 'Worker unexpected error');
  });

  return worker;
}

export const maintenanceWorker = createMaintenanceWorker();
