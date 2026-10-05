import { describe, it, expect, vi } from 'vitest';
import {
  BullMQOutreachDeliveryQueue,
  enqueueOutreachDeliveryJob,
  OUTREACH_DELIVERY_QUEUE_NAME
} from '../index.js';

describe('BullMQOutreachDeliveryQueue', () => {
  it('exposes correct queue name', () => {
    expect(OUTREACH_DELIVERY_QUEUE_NAME).toBe('outreach-delivery');
  });

  it('enqueues job with exact deliveryId payload and deterministic jobId', async () => {
    const mockAdd = vi.fn().mockResolvedValue({ id: 'delivery-uuid-001' });
    const mockClose = vi.fn().mockResolvedValue(undefined);
    const mockQueue: any = {
      add: mockAdd,
      close: mockClose
    };

    const queueAdapter = new BullMQOutreachDeliveryQueue(mockQueue);
    const result = await queueAdapter.enqueue({ deliveryId: 'delivery-uuid-001' });

    expect(result).toEqual({ jobId: 'delivery-uuid-001' });
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledWith(
      'OUTREACH_DELIVERY_DISPATCH',
      { deliveryId: 'delivery-uuid-001' },
      { jobId: 'delivery-uuid-001' }
    );

    await queueAdapter.close();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('enqueueOutreachDeliveryJob convenience helper enqueues with deterministic jobId', async () => {
    const mockAdd = vi.fn().mockResolvedValue({ id: 'delivery-uuid-002' });
    const mockQueue: any = {
      add: mockAdd
    };

    const jobId = await enqueueOutreachDeliveryJob('delivery-uuid-002', mockQueue);

    expect(jobId).toBe('delivery-uuid-002');
    expect(mockAdd).toHaveBeenCalledWith(
      'OUTREACH_DELIVERY_DISPATCH',
      { deliveryId: 'delivery-uuid-002' },
      { jobId: 'delivery-uuid-002' }
    );
  });
});
