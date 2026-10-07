import { describe, it, expect, beforeEach } from 'vitest';
import {
  OutreachChannel,
  OutreachDeliveryStatus,
  OutreachErrorCode
} from '@leadmate/shared';
import {
  OutreachWebhookEventProcessor,
  type NormalizedOutreachWebhookEvent
} from '../index.js';

interface InMemoryDbState {
  deliveries: any[];
  webhookEvents: any[];
  auditLogs: any[];
}

function createMockPrismaClient(state: InMemoryDbState) {
  return {
    outreachWebhookEvent: {
      findUnique: async ({ where }: { where: { providerName_eventId: { providerName: string; eventId: string } } }) => {
        const found = state.webhookEvents.find(
          (e) =>
            e.providerName === where.providerName_eventId.providerName &&
            e.eventId === where.providerName_eventId.eventId
        );
        return found ? JSON.parse(JSON.stringify(found)) : null;
      },
      create: async ({ data }: { data: any }) => {
        const event = {
          id: `wh-${state.webhookEvents.length + 1}`,
          organizationId: data.organizationId ?? null,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        state.webhookEvents.push(event);
        return JSON.parse(JSON.stringify(event));
      }
    },
    outreachDelivery: {
      findFirst: async ({ where }: { where: any }) => {
        const found = state.deliveries.find(
          (d) =>
            d.providerName === where.providerName &&
            d.providerMessageId === where.providerMessageId
        );
        return found ? JSON.parse(JSON.stringify(found)) : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: any }) => {
        const idx = state.deliveries.findIndex((d) => d.id === where.id);
        if (idx === -1) throw new Error('Delivery not found');
        state.deliveries[idx] = {
          ...state.deliveries[idx],
          ...data,
          updatedAt: new Date()
        };
        return JSON.parse(JSON.stringify(state.deliveries[idx]));
      }
    },
    auditLog: {
      create: async ({ data }: { data: any }) => {
        const log = {
          id: `audit-${state.auditLogs.length + 1}`,
          ...data,
          createdAt: new Date()
        };
        state.auditLogs.push(log);
        return log;
      }
    }
  } as any;
}

describe('M6 Step 7: OutreachWebhookEventProcessor Spec Suite', () => {
  const orgId = 'org-test-001';
  const leadId = 'lead-test-001';
  const draftId = 'draft-test-001';
  const userId = 'user-test-001';
  const deliveryId = 'del-test-001';
  const providerName = 'mock-meta-whatsapp';
  const providerMessageId = 'wamid-123456';

  let dbState: InMemoryDbState;
  let mockPrisma: any;
  let fixedClock: Date;

  beforeEach(() => {
    fixedClock = new Date('2026-10-06T14:00:00.000Z');

    dbState = {
      deliveries: [
        {
          id: deliveryId,
          organizationId: orgId,
          leadId,
          draftId,
          requestedByUserId: userId,
          channel: OutreachChannel.WHATSAPP,
          status: OutreachDeliveryStatus.SENT,
          providerName,
          providerMessageId,
          sentAt: new Date('2026-10-06T13:55:00.000Z')
        }
      ],
      webhookEvents: [],
      auditLogs: []
    };

    mockPrisma = createMockPrismaClient(dbState);
  });

  it('1. Replay deduplication: returns duplicate true and performs no state update on duplicate event', async () => {
    // Pre-seed already processed event
    dbState.webhookEvents.push({
      id: 'wh-existing',
      organizationId: orgId,
      providerName,
      eventId: 'evt-dup-1',
      providerMessageId,
      eventType: 'DELIVERED',
      processingStatus: 'PROCESSED'
    });

    const processor = new OutreachWebhookEventProcessor({
      prisma: mockPrisma,
      clock: () => fixedClock
    });

    const result = await processor.processEvent({
      providerName,
      eventId: 'evt-dup-1',
      providerMessageId,
      eventType: 'DELIVERED'
    });

    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(true);
    expect(dbState.auditLogs.length).toBe(0);
  });

  it('2. Unmatched delivery: records UNMATCHED event record safely and does not throw', async () => {
    const processor = new OutreachWebhookEventProcessor({
      prisma: mockPrisma,
      clock: () => fixedClock
    });

    const result = await processor.processEvent({
      providerName,
      eventId: 'evt-unknown-1',
      providerMessageId: 'non-existent-msg-id',
      eventType: 'DELIVERED'
    });

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(false);
    expect(result.duplicate).toBe(false);

    const savedEvent = dbState.webhookEvents.find((e) => e.eventId === 'evt-unknown-1');
    expect(savedEvent).toBeDefined();
    expect(savedEvent.processingStatus).toBe('UNMATCHED');
    expect(dbState.auditLogs.length).toBe(0);
  });

  it('3. Forward transition SENT -> DELIVERED: marks status DELIVERED and writes audit log', async () => {
    const processor = new OutreachWebhookEventProcessor({
      prisma: mockPrisma,
      clock: () => fixedClock
    });

    const eventTimestamp = new Date('2026-10-06T13:58:00.000Z');

    const result = await processor.processEvent({
      providerName,
      eventId: 'evt-del-1',
      providerMessageId,
      eventType: 'DELIVERED',
      timestamp: eventTimestamp
    });

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(true);
    expect(result.previousStatus).toBe(OutreachDeliveryStatus.SENT);
    expect(result.newStatus).toBe(OutreachDeliveryStatus.DELIVERED);

    const delivery = dbState.deliveries.find((d) => d.id === deliveryId);
    expect(delivery.status).toBe(OutreachDeliveryStatus.DELIVERED);
    expect(delivery.deliveredAt).toEqual(eventTimestamp);

    const audit = dbState.auditLogs.find((l) => l.action === 'lead.outreach_delivered');
    expect(audit).toBeDefined();
    expect(audit.entityId).toBe(deliveryId);
    expect(audit.after.status).toBe(OutreachDeliveryStatus.DELIVERED);

    const eventRecord = dbState.webhookEvents.find((e) => e.eventId === 'evt-del-1');
    expect(eventRecord).toBeDefined();
    expect(eventRecord.processingStatus).toBe('PROCESSED');
  });

  it('4. Forward transition SENT -> FAILED: marks status FAILED, stores error, and writes audit log', async () => {
    const processor = new OutreachWebhookEventProcessor({
      prisma: mockPrisma,
      clock: () => fixedClock
    });

    const eventTimestamp = new Date('2026-10-06T13:59:00.000Z');

    const result = await processor.processEvent({
      providerName,
      eventId: 'evt-fail-1',
      providerMessageId,
      eventType: 'FAILED',
      timestamp: eventTimestamp,
      safeErrorCode: OutreachErrorCode.OUTREACH_PROVIDER_UNAVAILABLE,
      safeErrorMessage: 'Handset unreachable'
    });

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(true);
    expect(result.newStatus).toBe(OutreachDeliveryStatus.FAILED);

    const delivery = dbState.deliveries.find((d) => d.id === deliveryId);
    expect(delivery.status).toBe(OutreachDeliveryStatus.FAILED);
    expect(delivery.failedAt).toEqual(eventTimestamp);
    expect(delivery.lastErrorCode).toBe(OutreachErrorCode.OUTREACH_PROVIDER_UNAVAILABLE);
    expect(delivery.safeLastErrorMessage).toBe('Handset unreachable');

    const audit = dbState.auditLogs.find((l) => l.action === 'lead.outreach_failed');
    expect(audit).toBeDefined();
    expect(audit.after.reason).toBe('WEBHOOK_FAILURE');
  });

  it('5. Late or reordered event: does not regress from terminal DELIVERED, FAILED, or CANCELLED', async () => {
    const processor = new OutreachWebhookEventProcessor({
      prisma: mockPrisma,
      clock: () => fixedClock
    });

    // Case A: Delivery is already DELIVERED, late FAILED event arrives
    dbState.deliveries[0].status = OutreachDeliveryStatus.DELIVERED;
    const resA = await processor.processEvent({
      providerName,
      eventId: 'evt-late-fail',
      providerMessageId,
      eventType: 'FAILED'
    });

    expect(resA.ok).toBe(true);
    expect(dbState.deliveries[0].status).toBe(OutreachDeliveryStatus.DELIVERED);
    expect(dbState.auditLogs.length).toBe(0);

    // Case B: Delivery was CANCELLED, late DELIVERED event arrives
    dbState.deliveries[0].status = OutreachDeliveryStatus.CANCELLED;
    const resB = await processor.processEvent({
      providerName,
      eventId: 'evt-late-del',
      providerMessageId,
      eventType: 'DELIVERED'
    });

    expect(resB.ok).toBe(true);
    expect(dbState.deliveries[0].status).toBe(OutreachDeliveryStatus.CANCELLED);
    expect(dbState.auditLogs.length).toBe(0);

    // Case C: Delivery was already FAILED, late DELIVERED event arrives
    dbState.deliveries[0].status = OutreachDeliveryStatus.FAILED;
    const resC = await processor.processEvent({
      providerName,
      eventId: 'evt-late-del-to-failed',
      providerMessageId,
      eventType: 'DELIVERED'
    });

    expect(resC.ok).toBe(true);
    expect(dbState.deliveries[0].status).toBe(OutreachDeliveryStatus.FAILED);
    expect(dbState.auditLogs.length).toBe(0);
  });

  it('6. Tenant Provenance (Matched Event): derives organizationId strictly from correlated OutreachDelivery, never trusting incoming event data', async () => {
    const processor = new OutreachWebhookEventProcessor({
      prisma: mockPrisma,
      clock: () => fixedClock
    });

    // Delivery belongs to orgId ('org-test-001')
    expect(dbState.deliveries[0].organizationId).toBe(orgId);

    // Incoming normalized event carries NO organizationId
    const incomingEvent: NormalizedOutreachWebhookEvent = {
      providerName,
      eventId: 'evt-provenance-matched-01',
      providerMessageId,
      eventType: 'DELIVERED',
      timestamp: fixedClock
    };

    // Ensure type does not even declare organizationId
    expect((incomingEvent as any).organizationId).toBeUndefined();

    const result = await processor.processEvent(incomingEvent);

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(true);

    // Persisted OutreachWebhookEvent record has organizationId set strictly from delivery.organizationId
    const savedEvent = dbState.webhookEvents.find(
      (e) => e.eventId === 'evt-provenance-matched-01'
    );
    expect(savedEvent).toBeDefined();
    expect(savedEvent.organizationId).toBe(orgId);
    expect(savedEvent.processingStatus).toBe('PROCESSED');

    // Audit log has organizationId set strictly from delivery.organizationId
    const audit = dbState.auditLogs.find((l) => l.action === 'lead.outreach_delivered');
    expect(audit).toBeDefined();
    expect(audit.organizationId).toBe(orgId);
  });

  it('7. Tenant Provenance (Unmatched Event): persists event with organizationId = null without inventing tenant context, performs 0 delivery mutations, 0 audit logs', async () => {
    const processor = new OutreachWebhookEventProcessor({
      prisma: mockPrisma,
      clock: () => fixedClock
    });

    const initialDeliveryCount = dbState.deliveries.length;
    const initialAuditCount = dbState.auditLogs.length;

    // Incoming normalized event for unknown provider message ID
    const incomingEvent: NormalizedOutreachWebhookEvent = {
      providerName: 'unknown-provider',
      eventId: 'evt-provenance-unmatched-01',
      providerMessageId: 'unknown-message-id-999',
      eventType: 'FAILED',
      safeErrorMessage: 'Downstream network timeout'
    };

    const result = await processor.processEvent(incomingEvent);

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(false);

    // Persisted OutreachWebhookEvent has organizationId = null
    const savedEvent = dbState.webhookEvents.find(
      (e) => e.eventId === 'evt-provenance-unmatched-01'
    );
    expect(savedEvent).toBeDefined();
    expect(savedEvent.organizationId).toBeNull();
    expect(savedEvent.processingStatus).toBe('UNMATCHED');

    // Verifies 0 delivery status mutations and 0 audit logs created
    expect(dbState.deliveries.length).toBe(initialDeliveryCount);
    expect(dbState.auditLogs.length).toBe(initialAuditCount);
  });
});
