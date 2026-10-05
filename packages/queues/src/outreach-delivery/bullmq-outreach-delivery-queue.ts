import { Queue } from 'bullmq';
import {
  type OutreachDeliveryJobPayload,
  type OutreachDeliveryQueue,
  type OutreachDeliveryQueueEnqueueResult
} from '@leadmate/core';
import { createRedisConnection, REDIS_PREFIX } from '../config/redis.js';

export const OUTREACH_DELIVERY_QUEUE_NAME = 'outreach-delivery';

export function createOutreachDeliveryQueue(): Queue<OutreachDeliveryJobPayload> {
  const connection = createRedisConnection({ name: 'outreach-delivery-queue' });

  return new Queue<OutreachDeliveryJobPayload>(OUTREACH_DELIVERY_QUEUE_NAME, {
    connection,
    prefix: REDIS_PREFIX,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 1000 }
    }
  });
}

/**
 * Concrete BullMQ implementation of the OutreachDeliveryQueue interface.
 *
 * Provides production Redis-backed job enqueueing for OutreachDeliveryService.
 */
export class BullMQOutreachDeliveryQueue implements OutreachDeliveryQueue {
  private readonly queue: Queue<OutreachDeliveryJobPayload>;

  constructor(queue?: Queue<OutreachDeliveryJobPayload>) {
    this.queue = queue ?? createOutreachDeliveryQueue();
  }

  public async enqueue(
    payload: OutreachDeliveryJobPayload
  ): Promise<OutreachDeliveryQueueEnqueueResult> {
    const job = await this.queue.add(
      'OUTREACH_DELIVERY_DISPATCH',
      {
        deliveryId: payload.deliveryId
      },
      {
        jobId: payload.deliveryId
      }
    );

    return { jobId: job.id ?? payload.deliveryId };
  }

  public async close(): Promise<void> {
    await this.queue.close();
  }
}

/**
 * Convenience helper to enqueue an outreach delivery into BullMQ.
 */
export async function enqueueOutreachDeliveryJob(
  deliveryId: string,
  queueInstance?: Queue<OutreachDeliveryJobPayload>
): Promise<string> {
  const queue = queueInstance ?? createOutreachDeliveryQueue();
  const job = await queue.add(
    'OUTREACH_DELIVERY_DISPATCH',
    {
      deliveryId
    },
    {
      jobId: deliveryId
    }
  );

  return job.id ?? deliveryId;
}
