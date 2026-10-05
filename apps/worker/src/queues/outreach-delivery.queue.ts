export {
  OUTREACH_DELIVERY_QUEUE_NAME,
  createOutreachDeliveryQueue,
  enqueueOutreachDeliveryJob,
  BullMQOutreachDeliveryQueue
} from '@leadmate/queues';

import { createOutreachDeliveryQueue } from '@leadmate/queues';

export interface OutreachDeliveryJobData {
  deliveryId: string;
}

export const outreachDeliveryQueue = createOutreachDeliveryQueue();
