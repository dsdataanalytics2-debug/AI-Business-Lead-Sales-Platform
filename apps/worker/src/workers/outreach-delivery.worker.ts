import { Worker, Job, DelayedError } from 'bullmq';
import {
  OUTREACH_DELIVERY_QUEUE_NAME,
  BullMQOutreachDeliveryQueue
} from '@leadmate/queues';
import {
  WorkerDeliveryExecutor,
  OutreachRequestedRaceError,
  type WorkerDeliveryExecutionResult
} from '@leadmate/core';
import { createRedisConnection, REDIS_PREFIX } from '../config/redis.js';
import { logger } from '../config/logger.js';
import type { OutreachDeliveryJobData } from '../queues/outreach-delivery.queue.js';

export { DelayedError };

export interface OutreachDeliveryWorkerOptions {
  executor?: WorkerDeliveryExecutor;
  connection?: ReturnType<typeof createRedisConnection>;
  concurrency?: number;
}

export function createOutreachDeliveryProcessor(
  executor: WorkerDeliveryExecutor
) {
  return async (
    job: Job<OutreachDeliveryJobData, WorkerDeliveryExecutionResult>,
    token?: string
  ): Promise<WorkerDeliveryExecutionResult> => {
    const { deliveryId } = job.data;
    logger.info(
      { jobId: job.id, deliveryId, attempt: job.attemptsMade + 1 },
      'Processing outreach delivery job'
    );

    if (!deliveryId || typeof deliveryId !== 'string') {
      logger.error({ jobId: job.id }, 'Job payload missing valid deliveryId');
      throw new Error('Invalid job payload: deliveryId is required');
    }

    try {
      // Delegate to domain delivery executor
      const result = await executor.executeDelivery(deliveryId);

      logger.info(
        {
          jobId: job.id,
          deliveryId: result.deliveryId,
          status: result.status,
          ok: result.ok,
          skipped: result.skipped,
          ambiguous: result.ambiguous
        },
        'Outreach delivery job finished'
      );

      return result;
    } catch (err: unknown) {
      if (err instanceof OutreachRequestedRaceError) {
        logger.warn(
          { jobId: job.id, deliveryId },
          'Outreach delivery is still in REQUESTED status; delaying job without consuming transport attempt budget'
        );
        if (typeof job.moveToDelayed === 'function') {
          if (!token) {
            throw new Error(
              'Active job lock token is required to safely move job to delayed synchronization'
            );
          }
          await job.moveToDelayed(Date.now() + 1000, token);
          throw new DelayedError();
        }
      }
      throw err;
    }
  };
}

export function createOutreachDeliveryWorker(
  options: OutreachDeliveryWorkerOptions = {}
): Worker<OutreachDeliveryJobData, WorkerDeliveryExecutionResult> {
  const connection =
    options.connection ?? createRedisConnection({ name: 'outreach-delivery-worker' });
  const executor = options.executor ?? new WorkerDeliveryExecutor();
  const processor = createOutreachDeliveryProcessor(executor);

  const worker = new Worker<OutreachDeliveryJobData, WorkerDeliveryExecutionResult>(
    OUTREACH_DELIVERY_QUEUE_NAME,
    processor,
    {
      connection,
      prefix: REDIS_PREFIX,
      concurrency: options.concurrency ?? 5
    }
  );

  worker.on('completed', (job: Job) => {
    logger.info({ jobId: job.id, deliveryId: job.data.deliveryId }, 'Outreach delivery job completed');
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.warn(
      {
        jobId: job?.id,
        deliveryId: job?.data?.deliveryId,
        error: err.message,
        attemptsMade: job?.attemptsMade
      },
      'Outreach delivery job failed'
    );
  });

  worker.on('error', (err: Error) => {
    logger.error({ error: err.message }, 'Outreach delivery worker unexpected error');
  });

  return worker;
}

export const outreachDeliveryWorker = createOutreachDeliveryWorker();
