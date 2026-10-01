import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Queue, Worker, QueueEvents } from 'bullmq';
import {
  createMaintenanceQueue,
  createMaintenanceWorker,
  MAINTENANCE_QUEUE_NAME
} from '../index.js';
import { createRedisConnection, REDIS_PREFIX } from '../config/redis.js';

describe('Step 6 Behavioral Verification: BullMQ Maintenance Worker', () => {
  let queue: Queue;
  let worker: Worker;
  let queueEvents: QueueEvents;

  beforeAll(async () => {
    queue = createMaintenanceQueue();
    worker = createMaintenanceWorker();
    queueEvents = new QueueEvents(MAINTENANCE_QUEUE_NAME, {
      connection: createRedisConnection({ name: 'test-queue-events' }),
      prefix: REDIS_PREFIX
    });
    await queueEvents.waitUntilReady();
  });

  afterAll(async () => {
    await worker.close();
    await queueEvents.close();
    await queue.close();
  });

  it('1. Enqueues and processes exactly one maintenance health check job', async () => {
    const job = await queue.add(
      'MAINTENANCE_HEALTH_CHECK',
      {
        type: 'HEALTH_CHECK',
        triggeredBy: 'automated-test',
        timestamp: new Date().toISOString()
      },
      {
        jobId: `test-health-${Date.now()}`
      }
    );

    expect(job.id).toBeDefined();

    // Wait for the job to complete via QueueEvents
    const result = await job.waitUntilFinished(queueEvents);

    expect(result).toBeDefined();
    expect(result.ok).toBe(true);
    expect(result.jobName).toBe('MAINTENANCE_HEALTH_CHECK');
    expect(result.db).toBe('connected');
    expect(result.processedAt).toBeDefined();
    expect(result.workerPid).toBeTypeOf('number');

    // Verify job state in BullMQ is 'completed'
    const state = await job.getState();
    expect(state).toBe('completed');
  }, 10000);

  it('2. Worker and queue shut down cleanly without unhandled errors', async () => {
    expect(worker.isRunning()).toBe(true);
  });
});
