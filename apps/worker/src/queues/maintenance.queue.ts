import { Queue } from 'bullmq';
import { createRedisConnection, REDIS_PREFIX } from '../config/redis.js';

export const MAINTENANCE_QUEUE_NAME = 'maintenance';

export interface MaintenanceHealthJobData {
  type: 'HEALTH_CHECK';
  triggeredBy?: string;
  timestamp: string;
}

export interface MaintenanceHealthJobResult {
  ok: boolean;
  jobName: string;
  processedAt: string;
  db: string;
  workerPid: number;
}

export function createMaintenanceQueue(): Queue<MaintenanceHealthJobData, MaintenanceHealthJobResult> {
  const connection = createRedisConnection({ name: 'maintenance-queue' });

  return new Queue<MaintenanceHealthJobData, MaintenanceHealthJobResult>(MAINTENANCE_QUEUE_NAME, {
    connection,
    prefix: REDIS_PREFIX,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000
      },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 }
    }
  });
}

export const maintenanceQueue = createMaintenanceQueue();

export async function enqueueMaintenanceHealthJob(triggeredBy = 'system'): Promise<string> {
  const job = await maintenanceQueue.add(
    'MAINTENANCE_HEALTH_CHECK',
    {
      type: 'HEALTH_CHECK',
      triggeredBy,
      timestamp: new Date().toISOString()
    },
    {
      jobId: `health-${Date.now()}`
    }
  );

  return job.id!;
}
