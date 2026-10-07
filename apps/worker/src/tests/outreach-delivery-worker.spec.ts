import { describe, it, expect, vi } from 'vitest';
import type { Job } from 'bullmq';
import {
  createOutreachDeliveryProcessor,
  DelayedError
} from '../workers/outreach-delivery.worker.js';
import {
  WorkerDeliveryExecutor,
  OutreachRequestedRaceError,
  OutreachDeliveryProviderError,
  OutreachProviderErrorCode
} from '@leadmate/core';
import {
  OutreachDeliveryStatus
} from '@leadmate/shared';

describe('M6 Step 7: Outreach Delivery Worker Adapter Contract Verification', () => {
  it('1. Handles REQUESTED race by calling moveToDelayed with valid lock token and throwing DelayedError', async () => {
    const mockExecutor = {
      executeDelivery: vi.fn().mockRejectedValue(
        new OutreachRequestedRaceError('Delivery is in REQUESTED status')
      )
    };

    const mockMoveToDelayed = vi.fn().mockResolvedValue(undefined);
    const mockJob = {
      id: 'job-req-race-1',
      data: { deliveryId: 'del-race-1' },
      attemptsMade: 0,
      moveToDelayed: mockMoveToDelayed
    } as unknown as Job<any, any>;

    const lockToken = 'worker-lock-token-uuid-1234';
    const processor = createOutreachDeliveryProcessor(
      mockExecutor as unknown as WorkerDeliveryExecutor
    );

    const nowBefore = Date.now();
    let thrownError: unknown = null;
    try {
      await processor(mockJob, lockToken);
    } catch (err) {
      thrownError = err;
    }

    // 1. Must catch OutreachRequestedRaceError and throw DelayedError
    expect(thrownError).toBeInstanceOf(DelayedError);
    expect((thrownError as Error).name).toBe('DelayedError');
    expect(thrownError).not.toBeInstanceOf(OutreachRequestedRaceError);

    // 2. moveToDelayed called exactly once
    expect(mockMoveToDelayed).toHaveBeenCalledTimes(1);

    // 3. Delay timestamp is scheduled ~1000ms from now
    const [scheduledTime, passedToken] = mockMoveToDelayed.mock.calls[0];
    expect(scheduledTime).toBeGreaterThanOrEqual(nowBefore + 900);
    expect(scheduledTime).toBeLessThanOrEqual(nowBefore + 2000);

    // 4. Correct active worker lock token passed (not fake '0')
    expect(passedToken).toBe(lockToken);

    // 5. Executor was called for deliveryId
    expect(mockExecutor.executeDelivery).toHaveBeenCalledWith('del-race-1');
  });

  it('2. Normal success path resolves without calling moveToDelayed or throwing DelayedError', async () => {
    const successResult = {
      deliveryId: 'del-success-1',
      status: OutreachDeliveryStatus.SENT,
      ok: true,
      skipped: false,
      ambiguous: false
    };

    const mockExecutor = {
      executeDelivery: vi.fn().mockResolvedValue(successResult)
    };

    const mockMoveToDelayed = vi.fn().mockResolvedValue(undefined);
    const mockJob = {
      id: 'job-success-1',
      data: { deliveryId: 'del-success-1' },
      attemptsMade: 0,
      moveToDelayed: mockMoveToDelayed
    } as unknown as Job<any, any>;

    const lockToken = 'worker-lock-token-uuid-5678';
    const processor = createOutreachDeliveryProcessor(
      mockExecutor as unknown as WorkerDeliveryExecutor
    );

    const result = await processor(mockJob, lockToken);

    expect(result).toEqual(successResult);
    expect(mockMoveToDelayed).not.toHaveBeenCalled();
    expect(mockExecutor.executeDelivery).toHaveBeenCalledWith('del-success-1');
  });

  it('3. Ordinary retryable provider error propagates directly to BullMQ and is NOT converted to DelayedError', async () => {
    const providerTimeoutError = new OutreachDeliveryProviderError({
      code: OutreachProviderErrorCode.PROVIDER_TIMEOUT,
      safeMessage: 'Provider gateway timed out after 10000ms'
    });

    const mockExecutor = {
      executeDelivery: vi.fn().mockRejectedValue(providerTimeoutError)
    };

    const mockMoveToDelayed = vi.fn().mockResolvedValue(undefined);
    const mockJob = {
      id: 'job-timeout-1',
      data: { deliveryId: 'del-timeout-1' },
      attemptsMade: 1,
      moveToDelayed: mockMoveToDelayed
    } as unknown as Job<any, any>;

    const lockToken = 'worker-lock-token-uuid-9999';
    const processor = createOutreachDeliveryProcessor(
      mockExecutor as unknown as WorkerDeliveryExecutor
    );

    let thrownError: unknown = null;
    try {
      await processor(mockJob, lockToken);
    } catch (err) {
      thrownError = err;
    }

    // Must propagate the original provider error for normal BullMQ retry handling
    expect(thrownError).toBe(providerTimeoutError);
    expect(thrownError).not.toBeInstanceOf(DelayedError);
    expect(mockMoveToDelayed).not.toHaveBeenCalled();
  });

  it('4. Enforces fail-closed lock token safety: throws error if lock token is missing during REQUESTED delay', async () => {
    const mockExecutor = {
      executeDelivery: vi.fn().mockRejectedValue(
        new OutreachRequestedRaceError('Delivery is in REQUESTED status')
      )
    };

    const mockMoveToDelayed = vi.fn().mockResolvedValue(undefined);
    const mockJob = {
      id: 'job-no-token-1',
      data: { deliveryId: 'del-no-token-1' },
      attemptsMade: 0,
      moveToDelayed: mockMoveToDelayed
    } as unknown as Job<any, any>;

    const processor = createOutreachDeliveryProcessor(
      mockExecutor as unknown as WorkerDeliveryExecutor
    );

    // Call without token (undefined)
    await expect(processor(mockJob, undefined)).rejects.toThrow(
      'Active job lock token is required to safely move job to delayed synchronization'
    );

    // moveToDelayed must NOT have been called with fake or missing token
    expect(mockMoveToDelayed).not.toHaveBeenCalled();
  });

  it('5. Rejects job payload missing deliveryId', async () => {
    const mockExecutor = {
      executeDelivery: vi.fn()
    };

    const mockJob = {
      id: 'job-invalid-1',
      data: {},
      attemptsMade: 0
    } as unknown as Job<any, any>;

    const processor = createOutreachDeliveryProcessor(
      mockExecutor as unknown as WorkerDeliveryExecutor
    );

    await expect(processor(mockJob, 'some-token')).rejects.toThrow(
      'Invalid job payload: deliveryId is required'
    );

    expect(mockExecutor.executeDelivery).not.toHaveBeenCalled();
  });
});
