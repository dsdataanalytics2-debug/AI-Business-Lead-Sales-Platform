/**
 * M6 Step 8: Domain Race, Replay, Idempotency & Concurrency Hardening Test Suite
 *
 * Validates core outreach domain layer under extreme concurrency and race conditions:
 * - Duplicate worker job execution (atomic QUEUED -> PROCESSING claim)
 * - Accepted / persistence ambiguity reconciliation (zero duplicate physical sends)
 * - Provider timeout ambiguity & finite retry budget
 * - Retry exhaustion (attemptCount = 3 -> terminal FAILED)
 * - Non-retryable provider failure (one call -> terminal FAILED)
 * - Gate B suppression race (worker blocks suppressed destination; 0 provider sends)
 * - Recipient & Content immutability + SHA-256 snapshot tampering detection
 * - Cancellation races (cancel-before-claim, claim-before-cancel 409, concurrent cancellations)
 * - Best-effort queue cleanup failure resilience
 * - Webhook replay deduplication & concurrent terminal transition race (DELIVERED vs FAILED)
 * - Webhook out-of-order protection & unknown message handling
 * - Attempt count invariants and timestamp consistency
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Role,
  OutreachChannel,
  OutreachDeliveryStatus,
  OutreachErrorCode,
  SuppressionType,
  SuppressionReason,
  ChannelScope
} from '@leadmate/shared';
import {
  WorkerDeliveryExecutor,
  OutreachRequestedRaceError,
  computeApprovedDraftSnapshotHash,
  type OutreachProviderSendInput,
  type OutreachProviderSendResult,
  type OutreachDeliveryProvider,
  type OutreachDeliveryProviderRegistry,
  OutreachDeliveryProviderError,
  OutreachProviderErrorCode,
  OutreachDeliveryService,
  OutreachWebhookEventProcessor,
  type NormalizedOutreachWebhookEvent,
  InMemoryOutreachDeliveryQueue
} from '../index.js';

interface InMemoryDbState {
  leads: any[];
  drafts: any[];
  users: any[];
  deliveries: any[];
  suppressions: any[];
  auditLogs: any[];
  webhookEvents: any[];
}

function createMockPrismaClient(state: InMemoryDbState) {
  return {
    lead: {
      findUnique: async ({ where }: any) => {
        const id = where.id ?? where.id_organizationId?.id;
        const orgId = where.organizationId ?? where.id_organizationId?.organizationId;
        const found = state.leads.find((l) => l.id === id && (!orgId || l.organizationId === orgId));
        return found ? JSON.parse(JSON.stringify(found)) : null;
      }
    },
    salesAssistantDraft: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const found = state.drafts.find((d) => d.id === where.id);
        return found ? JSON.parse(JSON.stringify(found)) : null;
      }
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const found = state.users.find((u) => u.id === where.id);
        return found ? JSON.parse(JSON.stringify(found)) : null;
      }
    },
    suppressionList: {
      findFirst: async ({ where }: { where: any }) => {
        const matches = state.suppressions.filter((s) => {
          if (s.organizationId !== where.organizationId) return false;

          if (where.normalizedValue?.in) {
            if (!where.normalizedValue.in.includes(s.normalizedValue)) return false;
          } else if (where.normalizedValue && s.normalizedValue !== where.normalizedValue) {
            return false;
          }

          if (where.type?.in) {
            if (!where.type.in.includes(s.type)) return false;
          } else if (where.type && s.type !== where.type) {
            return false;
          }

          if (where.channelScope?.in) {
            if (!where.channelScope.in.includes(s.channelScope)) return false;
          } else if (where.channelScope && s.channelScope !== where.channelScope) {
            return false;
          }

          if (where.OR && s.expiresAt) {
            const now = where.OR[1]?.expiresAt?.gt;
            if (now && new Date(s.expiresAt) <= new Date(now)) {
              return false;
            }
          }

          return true;
        });

        return matches.length > 0 ? JSON.parse(JSON.stringify(matches[0])) : null;
      }
    },
    outreachDelivery: {
      findUnique: async ({ where, include }: any) => {
        const id = where.id ?? where.id_organizationId?.id;
        const orgId = where.organizationId ?? where.id_organizationId?.organizationId;
        const found = state.deliveries.find((d) => d.id === id && (!orgId || d.organizationId === orgId));
        if (!found) return null;
        const copy = JSON.parse(JSON.stringify(found));
        if (include?.lead) {
          copy.lead = state.leads.find((l) => l.id === copy.leadId);
        }
        if (include?.draft) {
          copy.draft = state.drafts.find((d) => d.id === copy.draftId);
        }
        if (include?.requestedByUser) {
          copy.requestedByUser = state.users.find((u) => u.id === copy.requestedByUserId);
        }
        return copy;
      },
      findFirst: async ({ where }: { where: any }) => {
        const found = state.deliveries.find((d) => {
          if (where.id && d.id !== where.id) return false;
          if (where.organizationId && d.organizationId !== where.organizationId) return false;
          if (where.idempotencyKey && d.idempotencyKey !== where.idempotencyKey) return false;
          if (where.providerName && d.providerName !== where.providerName) return false;
          if (where.providerMessageId && d.providerMessageId !== where.providerMessageId) return false;
          return true;
        });
        return found ? JSON.parse(JSON.stringify(found)) : null;
      },
      findMany: async ({ where, take }: { where: any; take?: number }) => {
        const matches = state.deliveries.filter((d) => {
          if (where.id && d.id !== where.id) return false;
          if (where.organizationId && d.organizationId !== where.organizationId) return false;
          if (where.idempotencyKey && d.idempotencyKey !== where.idempotencyKey) return false;
          if (where.providerName && d.providerName !== where.providerName) return false;
          if (where.providerMessageId && d.providerMessageId !== where.providerMessageId) return false;
          return true;
        });
        const results = typeof take === 'number' ? matches.slice(0, take) : matches;
        return JSON.parse(JSON.stringify(results));
      },
      update: async ({ where, data }: { where: { id: string }; data: any }) => {
        const idx = state.deliveries.findIndex((d) => d.id === where.id);
        if (idx === -1) throw new Error(`Delivery ${where.id} not found`);
        state.deliveries[idx] = { ...state.deliveries[idx], ...data, updatedAt: new Date() };
        return JSON.parse(JSON.stringify(state.deliveries[idx]));
      },
      updateMany: async ({ where, data }: { where: any; data: any }) => {
        let count = 0;
        for (let i = 0; i < state.deliveries.length; i++) {
          const d = state.deliveries[i];
          let match = true;
          if (where.id && d.id !== where.id) match = false;
          if (where.organizationId && d.organizationId !== where.organizationId) match = false;
          if (where.status) {
            if (where.status.in && !where.status.in.includes(d.status)) match = false;
            else if (typeof where.status === 'string' && d.status !== where.status) match = false;
          }
          if (match) {
            state.deliveries[i] = { ...state.deliveries[i], ...data, updatedAt: new Date() };
            count++;
          }
        }
        return { count };
      }
    },
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
        // Enforce providerName + eventId unique constraint
        const duplicate = state.webhookEvents.find(
          (e) => e.providerName === data.providerName && e.eventId === data.eventId
        );
        if (duplicate) {
          const p2002 = new Error('Unique constraint failed on the fields: (`provider_name`,`event_id`)');
          (p2002 as any).code = 'P2002';
          throw p2002;
        }
        const event = {
          id: `wh-${state.webhookEvents.length + 1}`,
          organizationId: data.organizationId ?? null,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        state.webhookEvents.push(event);
        return JSON.parse(JSON.stringify(event));
      },
      update: async ({ where, data }: { where: { id: string }; data: any }) => {
        const idx = state.webhookEvents.findIndex((e) => e.id === where.id);
        if (idx === -1) throw new Error('Webhook event not found');
        state.webhookEvents[idx] = {
          ...state.webhookEvents[idx],
          ...data,
          updatedAt: new Date()
        };
        return JSON.parse(JSON.stringify(state.webhookEvents[idx]));
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
        return JSON.parse(JSON.stringify(log));
      }
    }
  } as any;
}

describe('M6 Step 8: Domain Race, Replay, Idempotency & Concurrency Hardening', () => {
  let state: InMemoryDbState;
  let mockPrisma: any;
  let mockProvider: OutreachDeliveryProvider;
  let providerRegistry: OutreachDeliveryProviderRegistry;
  let executor: WorkerDeliveryExecutor;
  let webhookProcessor: OutreachWebhookEventProcessor;
  let sendSpy: ReturnType<typeof vi.fn>;

  const ORG_ID = 'org-race-hardening-888';
  const LEAD_ID = 'lead-race-hardening-111';
  const DRAFT_ID = 'draft-race-hardening-222';
  const USER_ID = 'user-race-hardening-333';
  const DELIVERY_ID = 'deliv-race-hardening-444';

  const defaultContent = 'Approved snapshot content for race test.';
  const defaultHash = computeApprovedDraftSnapshotHash({
    channel: OutreachChannel.WHATSAPP,
    content: defaultContent,
    subject: null,
    body: null
  });

  beforeEach(() => {
    state = {
      leads: [
        {
          id: LEAD_ID,
          organizationId: ORG_ID,
          name: 'Apex Superstores',
          primaryPhone: '+8801700000000',
          assignedUserId: USER_ID
        }
      ],
      drafts: [
        {
          id: DRAFT_ID,
          organizationId: ORG_ID,
          leadId: LEAD_ID,
          createdByUserId: USER_ID,
          type: 'WHATSAPP',
          content: defaultContent
        }
      ],
      users: [
        {
          id: USER_ID,
          organizationId: ORG_ID,
          name: 'Sales Rep',
          role: Role.SALES_EXECUTIVE
        }
      ],
      deliveries: [
        {
          id: DELIVERY_ID,
          organizationId: ORG_ID,
          leadId: LEAD_ID,
          draftId: DRAFT_ID,
          channel: OutreachChannel.WHATSAPP,
          status: OutreachDeliveryStatus.QUEUED,
          recipientNormalized: '+8801711223344',
          snapshotContent: defaultContent,
          snapshotSubject: null,
          snapshotBody: null,
          approvedDraftSnapshotHash: defaultHash,
          idempotencyKey: 'idem-race-key-001',
          requestFingerprint: 'fp-race-001',
          attemptCount: 0,
          providerName: null,
          providerMessageId: null,
          lastErrorCode: null,
          safeLastErrorMessage: null,
          requestedByUserId: USER_ID,
          requestedAt: new Date(),
          queuedAt: new Date(),
          sentAt: null,
          deliveredAt: null,
          failedAt: null,
          cancelledAt: null
        }
      ],
      suppressions: [],
      auditLogs: [],
      webhookEvents: []
    };

    mockPrisma = createMockPrismaClient(state);

    sendSpy = vi.fn().mockResolvedValue({
      providerName: 'MOCK_WHATSAPP',
      providerMessageId: 'prov-msg-race-999',
      acceptedAt: new Date()
    });

    mockProvider = {
      name: 'MOCK_WHATSAPP',
      channel: OutreachChannel.WHATSAPP,
      send: sendSpy
    };

    providerRegistry = {
      registerProvider: vi.fn(),
      getProvider: (channel: OutreachChannel) => {
        if (channel === OutreachChannel.WHATSAPP) return mockProvider;
        throw new Error(`No provider for channel ${channel}`);
      }
    };

    executor = new WorkerDeliveryExecutor({
      prisma: mockPrisma,
      providerRegistry,
      clock: () => new Date('2026-10-07T12:00:00Z')
    });

    webhookProcessor = new OutreachWebhookEventProcessor({
      prisma: mockPrisma,
      clock: () => new Date('2026-10-07T12:05:00Z')
    });
  });

  // =========================================================================
  // 13. DUPLICATE JOB DELIVERY EXECUTION
  // =========================================================================
  it('13. Duplicate job execution: atomic QUEUED -> PROCESSING claim ensures provider is called exactly once', async () => {
    // Run two worker executions concurrently for the same delivery
    const [result1, result2] = await Promise.all([
      executor.executeDelivery(DELIVERY_ID),
      executor.executeDelivery(DELIVERY_ID)
    ]);

    // One must succeed, the other must safely detect losing claim
    const successes = [result1, result2].filter((r) => r.ok && r.status === OutreachDeliveryStatus.SENT);
    expect(successes).toHaveLength(1);

    // Total physical sends to external provider must be exactly 1
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const delivery = state.deliveries[0];
    expect(delivery.status).toBe(OutreachDeliveryStatus.SENT);
    expect(delivery.attemptCount).toBe(1);
    expect(delivery.providerMessageId).toBe('prov-msg-race-999');
  });

  // =========================================================================
  // 14. ACCEPTED / PERSISTENCE AMBIGUITY
  // =========================================================================
  it('14. Accepted / persistence ambiguity: if provider accepted and providerMessageId is known, re-execution never physically resends', async () => {
    // Delivery was left in PROCESSING with providerMessageId already saved before a crash/failure
    state.deliveries[0].status = OutreachDeliveryStatus.PROCESSING;
    state.deliveries[0].providerName = 'MOCK_WHATSAPP';
    state.deliveries[0].providerMessageId = 'prov-msg-already-accepted-001';
    state.deliveries[0].attemptCount = 1;

    // Background worker re-executes the job
    const result = await executor.executeDelivery(DELIVERY_ID);

    // Must safely finish without re-calling provider.send
    expect(sendSpy).toHaveBeenCalledTimes(0);
    expect(result.ok).toBe(false);
    expect(result.ambiguous).toBe(true);
    expect(result.status).toBe(OutreachDeliveryStatus.PROCESSING);

    const delivery = state.deliveries[0];
    expect(delivery.status).toBe(OutreachDeliveryStatus.PROCESSING);
    expect(delivery.attemptCount).toBe(1); // Not incremented again
    expect(delivery.providerMessageId).toBe('prov-msg-already-accepted-001');
  });

  // =========================================================================
  // 15 & 16. RETRYABLE ERROR & FINITE RETRY BUDGET
  // =========================================================================
  it('15 & 16. Retryable provider errors: transitions back to QUEUED, preserves attempt count, and eventual success transitions to SENT', async () => {
    // First attempt fails retryably
    sendSpy.mockRejectedValueOnce(
      new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.PROVIDER_TIMEOUT,
        safeMessage: 'Upstream gateway timed out',
        retryable: true
      })
    );

    await expect(executor.executeDelivery(DELIVERY_ID)).rejects.toThrow();

    let delivery = state.deliveries[0];
    expect(delivery.status).toBe(OutreachDeliveryStatus.QUEUED);
    expect(delivery.attemptCount).toBe(1);
    expect(delivery.lastErrorCode).toBe(OutreachErrorCode.OUTREACH_PROVIDER_TIMEOUT);
    expect(delivery.failedAt).toBeNull(); // Must not set failedAt during retry

    // Second attempt succeeds
    sendSpy.mockResolvedValueOnce({
      providerMessageId: 'prov-msg-success-after-retry',
      acceptedAt: new Date()
    });

    const result2 = await executor.executeDelivery(DELIVERY_ID);
    expect(result2.ok).toBe(true);
    expect(result2.status).toBe(OutreachDeliveryStatus.SENT);

    delivery = state.deliveries[0];
    expect(delivery.status).toBe(OutreachDeliveryStatus.SENT);
    expect(delivery.attemptCount).toBe(2);
    expect(delivery.lastErrorCode).toBeNull(); // Transient error cleared on success
    expect(delivery.safeLastErrorMessage).toBeNull();
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  // =========================================================================
  // 17. RETRY EXHAUSTION
  // =========================================================================
  it('17. Retry exhaustion: 3 consecutive retryable failures reach attemptCount = 3 and mark terminal FAILED with no further sends', async () => {
    sendSpy.mockRejectedValue(
      new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.PROVIDER_RATE_LIMITED,
        safeMessage: 'Rate limit exceeded upstream',
        retryable: true
      })
    );

    // Attempt 1 -> QUEUED (throws for BullMQ backoff)
    await expect(executor.executeDelivery(DELIVERY_ID)).rejects.toThrow();
    expect(state.deliveries[0].status).toBe(OutreachDeliveryStatus.QUEUED);
    expect(state.deliveries[0].attemptCount).toBe(1);

    // Attempt 2 -> QUEUED (throws for BullMQ backoff)
    await expect(executor.executeDelivery(DELIVERY_ID)).rejects.toThrow();
    expect(state.deliveries[0].status).toBe(OutreachDeliveryStatus.QUEUED);
    expect(state.deliveries[0].attemptCount).toBe(2);

    // Attempt 3 -> Exhausted -> FAILED (returns terminal failure)
    const result3 = await executor.executeDelivery(DELIVERY_ID);
    expect(result3.ok).toBe(false);
    expect(result3.status).toBe(OutreachDeliveryStatus.FAILED);

    const delivery = state.deliveries[0];
    expect(delivery.status).toBe(OutreachDeliveryStatus.FAILED);
    expect(delivery.attemptCount).toBe(3);
    expect(delivery.failedAt).toBeDefined();
    expect(delivery.lastErrorCode).toBe(OutreachErrorCode.OUTREACH_PROVIDER_RATE_LIMITED);
    expect(sendSpy).toHaveBeenCalledTimes(3);

    // Attempt 4: If worker somehow runs again on terminal FAILED, it must safe no-op
    const result4 = await executor.executeDelivery(DELIVERY_ID);
    expect(result4.ok).toBe(true);
    expect(result4.status).toBe(OutreachDeliveryStatus.FAILED);
    expect(sendSpy).toHaveBeenCalledTimes(3); // Never calls provider a 4th time
  });

  // =========================================================================
  // 18. NONRETRYABLE FAILURE
  // =========================================================================
  it('18. Nonretryable provider failure: transitions immediately to terminal FAILED on first attempt with 0 retries', async () => {
    sendSpy.mockRejectedValueOnce(
      new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.RECIPIENT_REJECTED,
        safeMessage: 'Destination number is not registered on WhatsApp',
        retryable: false
      })
    );

    const result = await executor.executeDelivery(DELIVERY_ID);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(OutreachDeliveryStatus.FAILED);

    const delivery = state.deliveries[0];
    expect(delivery.status).toBe(OutreachDeliveryStatus.FAILED);
    expect(delivery.attemptCount).toBe(1);
    expect(delivery.failedAt).toBeDefined();
    expect(delivery.lastErrorCode).toBe(OutreachErrorCode.OUTREACH_RECIPIENT_REJECTED);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  // =========================================================================
  // 19 & 20. SUPPRESSION GATE B RACE
  // =========================================================================
  it('19 & 20. Suppression Gate B race: recipient suppressed between queueing and worker execution blocks dispatch before provider call', async () => {
    // Add recipient to suppression list before worker runs
    state.suppressions.push({
      id: 'sup-gate-b-01',
      organizationId: ORG_ID,
      type: SuppressionType.PHONE,
      normalizedValue: '+8801711223344',
      reason: SuppressionReason.DO_NOT_CONTACT,
      channelScope: ChannelScope.ALL,
      expiresAt: null
    });

    const result = await executor.executeDelivery(DELIVERY_ID);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(OutreachDeliveryStatus.FAILED);

    // Provider must NEVER be called
    expect(sendSpy).toHaveBeenCalledTimes(0);

    const delivery = state.deliveries[0];
    expect(delivery.status).toBe(OutreachDeliveryStatus.FAILED);
    expect(delivery.attemptCount).toBe(0); // Attempt budget untouched
    expect(delivery.lastErrorCode).toBe(OutreachErrorCode.OUTREACH_RECIPIENT_SUPPRESSED);
  });

  // =========================================================================
  // 25 & 26. RECIPIENT & CONTENT IMMUTABILITY
  // =========================================================================
  it('25. Recipient immutability: CRM lead contact changes do not affect delivery recipientNormalized snapshot', async () => {
    // Lead phone updated in CRM
    state.leads[0].primaryPhone = '+8801999999999';

    const result = await executor.executeDelivery(DELIVERY_ID);
    expect(result.ok).toBe(true);

    // Worker dispatches to the persisted snapshot
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0].recipientNormalized).toBe('+8801711223344');
  });

  it('26. Content immutability: draft updates do not alter delivery snapshot, and snapshot hash tampering fails closed', async () => {
    // Mutate draft in CRM
    state.drafts[0].content = 'Tampered content in CRM draft table!';

    // Execution must still use the persisted snapshotContent
    const result = await executor.executeDelivery(DELIVERY_ID);
    expect(result.ok).toBe(true);
    expect(sendSpy.mock.calls[0][0].content).toBe(defaultContent);

    // Reset for tampering test
    state.deliveries[0].status = OutreachDeliveryStatus.QUEUED;
    sendSpy.mockClear();

    // Now simulate direct database tampering with the delivery snapshot content without updating hash
    state.deliveries[0].snapshotContent = 'Tampered snapshot in delivery record!';

    const tamperedResult = await executor.executeDelivery(DELIVERY_ID);
    expect(tamperedResult.ok).toBe(false);
    expect(tamperedResult.status).toBe(OutreachDeliveryStatus.FAILED);

    // Provider call must be 0
    expect(sendSpy).toHaveBeenCalledTimes(0);
    expect(state.deliveries[0].status).toBe(OutreachDeliveryStatus.FAILED);
    expect(state.deliveries[0].lastErrorCode).toBe(OutreachErrorCode.OUTREACH_CONTENT_REJECTED);
  });

  // =========================================================================
  // 27, 28, 29, 30. CANCELLATION RACES
  // =========================================================================
  it('27. Cancel before queue claim: cancelled delivery causes stale worker execution to safely no-op', async () => {
    const queue = new InMemoryOutreachDeliveryQueue();
    queue.jobs.push({ jobId: DELIVERY_ID, payload: { deliveryId: DELIVERY_ID } });

    const service = new OutreachDeliveryService({
      prisma: mockPrisma,
      queue,
      clock: () => new Date('2026-10-07T12:01:00Z')
    });

    // 1. Cancel first
    const cancelResult = await service.cancelDelivery({
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      deliveryId: DELIVERY_ID,
      authenticatedUserId: USER_ID,
      authenticatedUserRole: Role.ADMIN
    });
    expect(cancelResult.status).toBe(OutreachDeliveryStatus.CANCELLED);
    expect(state.deliveries[0].status).toBe(OutreachDeliveryStatus.CANCELLED);
    expect(state.deliveries[0].cancelledAt).toBeDefined();

    // 2. Stale worker execution occurs later
    const workerResult = await executor.executeDelivery(DELIVERY_ID);
    expect(workerResult.ok).toBe(true);
    expect(workerResult.status).toBe(OutreachDeliveryStatus.CANCELLED);

    // External provider was never called
    expect(sendSpy).toHaveBeenCalledTimes(0);
  });

  it('28. Claim before cancel: in-flight delivery in PROCESSING cannot be cancelled (409 conflict)', async () => {
    const service = new OutreachDeliveryService({
      prisma: mockPrisma,
      queue: new InMemoryOutreachDeliveryQueue(),
      clock: () => new Date('2026-10-07T12:01:00Z')
    });

    // Worker claims delivery first: status becomes PROCESSING
    state.deliveries[0].status = OutreachDeliveryStatus.PROCESSING;
    state.deliveries[0].processingAt = new Date();

    // Attempt cancellation during in-flight send
    await expect(
      service.cancelDelivery({
        organizationId: ORG_ID,
        leadId: LEAD_ID,
        deliveryId: DELIVERY_ID,
        authenticatedUserId: USER_ID,
        authenticatedUserRole: Role.ADMIN
      })
    ).rejects.toThrow();

    // State remains in PROCESSING; no illegal rollback
    expect(state.deliveries[0].status).toBe(OutreachDeliveryStatus.PROCESSING);
  });

  it('29. Concurrent cancellations: multiple cancel requests result in exactly one authoritative transition and audit log', async () => {
    const queue = new InMemoryOutreachDeliveryQueue();
    const service = new OutreachDeliveryService({
      prisma: mockPrisma,
      queue,
      clock: () => new Date('2026-10-07T12:01:00Z')
    });

    const [c1, c2] = await Promise.all([
      service.cancelDelivery({
        organizationId: ORG_ID,
        leadId: LEAD_ID,
        deliveryId: DELIVERY_ID,
        authenticatedUserId: USER_ID,
        authenticatedUserRole: Role.ADMIN
      }),
      service.cancelDelivery({
        organizationId: ORG_ID,
        leadId: LEAD_ID,
        deliveryId: DELIVERY_ID,
        authenticatedUserId: USER_ID,
        authenticatedUserRole: Role.ADMIN
      })
    ]);

    expect(c1.status).toBe(OutreachDeliveryStatus.CANCELLED);
    expect(c2.status).toBe(OutreachDeliveryStatus.CANCELLED);

    // Audit logs for cancellation must be exactly 1
    const cancelAudits = state.auditLogs.filter((a) => a.action === 'lead.outreach_cancelled');
    expect(cancelAudits).toHaveLength(1);
  });

  it('30. Queue cleanup failure: queue.removeJob error does not prevent DB cancellation or leak queue internals', async () => {
    const queue = new InMemoryOutreachDeliveryQueue();
    vi.spyOn(queue, 'removeJob').mockRejectedValueOnce(new Error('Redis connection dropped'));

    const service = new OutreachDeliveryService({
      prisma: mockPrisma,
      queue,
      clock: () => new Date('2026-10-07T12:01:00Z')
    });

    const result = await service.cancelDelivery({
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      deliveryId: DELIVERY_ID,
      authenticatedUserId: USER_ID,
      authenticatedUserRole: Role.ADMIN
    });

    expect(result.status).toBe(OutreachDeliveryStatus.CANCELLED);
    expect(state.deliveries[0].status).toBe(OutreachDeliveryStatus.CANCELLED);
  });

  // =========================================================================
  // 31, 32, 33, 34. WEBHOOK RACES & REPLAYS
  // =========================================================================
  it('31. Webhook duplicate replay: same event processed repeatedly results in exactly one transition and audit log', async () => {
    state.deliveries[0].status = OutreachDeliveryStatus.SENT;
    state.deliveries[0].providerName = 'MOCK_WHATSAPP';
    state.deliveries[0].providerMessageId = 'prov-msg-wh-01';

    const event: NormalizedOutreachWebhookEvent = {
      providerName: 'MOCK_WHATSAPP',
      eventId: 'evt-unique-wh-001',
      providerMessageId: 'prov-msg-wh-01',
      eventType: 'DELIVERED',
      timestamp: new Date()
    };

    // First arrival
    const r1 = await webhookProcessor.processEvent(event);
    expect(r1.ok).toBe(true);
    expect(r1.duplicate).toBe(false);
    expect(r1.newStatus).toBe(OutreachDeliveryStatus.DELIVERED);

    // Second arrival (replay)
    const r2 = await webhookProcessor.processEvent(event);
    expect(r2.ok).toBe(true);
    expect(r2.duplicate).toBe(true);

    expect(state.webhookEvents).toHaveLength(1);
    const audits = state.auditLogs.filter((a) => a.action === 'lead.outreach_delivered');
    expect(audits).toHaveLength(1);
  });

  it('32. Webhook concurrent different events: DELIVERED and FAILED racing for same SENT delivery yields one terminal winner with zero oscillation', async () => {
    state.deliveries[0].status = OutreachDeliveryStatus.SENT;
    state.deliveries[0].providerName = 'MOCK_WHATSAPP';
    state.deliveries[0].providerMessageId = 'prov-msg-race-term';

    const eventDelivered: NormalizedOutreachWebhookEvent = {
      providerName: 'MOCK_WHATSAPP',
      eventId: 'evt-term-delivered',
      providerMessageId: 'prov-msg-race-term',
      eventType: 'DELIVERED',
      timestamp: new Date()
    };

    const eventFailed: NormalizedOutreachWebhookEvent = {
      providerName: 'MOCK_WHATSAPP',
      eventId: 'evt-term-failed',
      providerMessageId: 'prov-msg-race-term',
      eventType: 'FAILED',
      safeErrorCode: OutreachErrorCode.OUTREACH_DELIVERY_FAILED,
      timestamp: new Date()
    };

    const [rDelivered, rFailed] = await Promise.all([
      webhookProcessor.processEvent(eventDelivered),
      webhookProcessor.processEvent(eventFailed)
    ]);

    expect(rDelivered.ok).toBe(true);
    expect(rFailed.ok).toBe(true);

    // Exactly one transition must have matched SENT and succeeded
    const finalStatus = state.deliveries[0].status;
    expect([OutreachDeliveryStatus.DELIVERED, OutreachDeliveryStatus.FAILED]).toContain(finalStatus);

    // The other event must not have caused a state oscillation
    if (finalStatus === OutreachDeliveryStatus.DELIVERED) {
      expect(rDelivered.newStatus).toBe(OutreachDeliveryStatus.DELIVERED);
      expect(rFailed.newStatus).toBe(OutreachDeliveryStatus.SENT);
    } else {
      expect(rFailed.newStatus).toBe(OutreachDeliveryStatus.FAILED);
      expect(rDelivered.newStatus).toBe(OutreachDeliveryStatus.SENT);
    }
  });

  it('33. Webhook out-of-order: DELIVERED arriving when delivery is in PROCESSING is deferred as UNRESOLVED and reconciles upon replay after SENT', async () => {
    state.deliveries[0].status = OutreachDeliveryStatus.PROCESSING;
    state.deliveries[0].providerName = 'MOCK_WHATSAPP';
    state.deliveries[0].providerMessageId = 'prov-msg-out-of-order';

    const event: NormalizedOutreachWebhookEvent = {
      providerName: 'MOCK_WHATSAPP',
      eventId: 'evt-early-delivery',
      providerMessageId: 'prov-msg-out-of-order',
      eventType: 'DELIVERED',
      timestamp: new Date()
    };

    // 1. Arrival during PROCESSING: deferred
    const result = await webhookProcessor.processEvent(event);
    expect(result.ok).toBe(true);
    expect(result.newStatus).toBe(OutreachDeliveryStatus.PROCESSING); // Did not transition

    // Status remains PROCESSING, zero audit logs
    expect(state.deliveries[0].status).toBe(OutreachDeliveryStatus.PROCESSING);
    expect(state.auditLogs).toHaveLength(0);

    // Event stored with UNRESOLVED status and processedAt = null
    const eventRecord = state.webhookEvents.find((e) => e.eventId === 'evt-early-delivery');
    expect(eventRecord).toBeDefined();
    expect(eventRecord.processingStatus).toBe('UNRESOLVED');
    expect(eventRecord.processedAt).toBeNull();

    // 2. Delivery reaches SENT
    state.deliveries[0].status = OutreachDeliveryStatus.SENT;

    // 3. Replay of same event applies transition SENT -> DELIVERED
    const replayResult = await webhookProcessor.processEvent(event);
    expect(replayResult.ok).toBe(true);
    expect(replayResult.duplicate).toBe(false);
    expect(replayResult.previousStatus).toBe(OutreachDeliveryStatus.SENT);
    expect(replayResult.newStatus).toBe(OutreachDeliveryStatus.DELIVERED);
    expect(state.deliveries[0].status).toBe(OutreachDeliveryStatus.DELIVERED);
    expect(state.auditLogs).toHaveLength(1);
    const updatedRecord = state.webhookEvents.find((e) => e.eventId === 'evt-early-delivery');
    expect(updatedRecord.processingStatus).toBe('PROCESSED');
    expect(updatedRecord.processedAt).toBeDefined();

    // 4. Subsequent replay is duplicate no-op
    const dupResult = await webhookProcessor.processEvent(event);
    expect(dupResult.ok).toBe(true);
    expect(dupResult.duplicate).toBe(true);
    expect(state.auditLogs).toHaveLength(1);
  });

  it('33b. Webhook cross-tenant ambiguity: duplicate (providerName, providerMessageId) across Org A and Org B fails closed without mutating either delivery', async () => {
    const orgA = 'org-ambig-aaa';
    const orgB = 'org-ambig-bbb';
    const sharedMsgId = 'prov-msg-collision-dual';

    // Delivery 1 in Org A
    state.deliveries.push({
      id: 'del-ambig-a',
      organizationId: orgA,
      leadId: 'lead-a',
      draftId: 'draft-a',
      requestedByUserId: 'user-a',
      channel: OutreachChannel.WHATSAPP,
      status: OutreachDeliveryStatus.SENT,
      providerName: 'MOCK_WHATSAPP',
      providerMessageId: sharedMsgId
    });

    // Delivery 2 in Org B
    state.deliveries.push({
      id: 'del-ambig-b',
      organizationId: orgB,
      leadId: 'lead-b',
      draftId: 'draft-b',
      requestedByUserId: 'user-b',
      channel: OutreachChannel.WHATSAPP,
      status: OutreachDeliveryStatus.SENT,
      providerName: 'MOCK_WHATSAPP',
      providerMessageId: sharedMsgId
    });

    const event: NormalizedOutreachWebhookEvent = {
      providerName: 'MOCK_WHATSAPP',
      eventId: 'evt-ambig-dual',
      providerMessageId: sharedMsgId,
      eventType: 'DELIVERED',
      timestamp: new Date()
    };

    const result = await webhookProcessor.processEvent(event);
    expect(result.ok).toBe(false);
    expect(result.matched).toBe(false);
    expect(result.safeMessage).toBe('Ambiguous provider message correlation');

    // Neither delivery mutated
    const dA = state.deliveries.find((d) => d.id === 'del-ambig-a');
    const dB = state.deliveries.find((d) => d.id === 'del-ambig-b');
    expect(dA.status).toBe(OutreachDeliveryStatus.SENT);
    expect(dB.status).toBe(OutreachDeliveryStatus.SENT);
    expect(state.auditLogs).toHaveLength(0);

    // Stored with organizationId = null
    const storedEvent = state.webhookEvents.find((e) => e.eventId === 'evt-ambig-dual');
    expect(storedEvent).toBeDefined();
    expect(storedEvent.organizationId).toBeNull();
    expect(storedEvent.processingStatus).toBe('UNMATCHED');
  });

  it('34. Webhook unknown message: unmatched providerMessageId records UNMATCHED event with null org and zero delivery mutations', async () => {
    const event: NormalizedOutreachWebhookEvent = {
      providerName: 'MOCK_WHATSAPP',
      eventId: 'evt-unknown-msg',
      providerMessageId: 'prov-msg-does-not-exist',
      eventType: 'DELIVERED',
      timestamp: new Date()
    };

    const result = await webhookProcessor.processEvent(event);
    expect(result.ok).toBe(true);
    expect(result.matched).toBe(false);
    expect(result.deliveryId).toBeUndefined();

    // Event persisted as UNMATCHED with null organizationId
    expect(state.webhookEvents).toHaveLength(1);
    expect(state.webhookEvents[0].processingStatus).toBe('UNMATCHED');
    expect(state.webhookEvents[0].organizationId).toBeNull();
    expect(state.auditLogs).toHaveLength(0);
  });

  // =========================================================================
  // 61, 62, 63. INVARIANTS: TIMESTAMPS, LAST ERROR, ATTEMPT COUNT
  // =========================================================================
  it('61 & 62 & 63. Invariants: attemptCount matches provider invocations, timestamps are consistent, and errors clear on success', async () => {
    // 1. Initial state
    expect(state.deliveries[0].attemptCount).toBe(0);
    expect(state.deliveries[0].sentAt).toBeNull();
    expect(state.deliveries[0].failedAt).toBeNull();
    expect(state.deliveries[0].deliveredAt).toBeNull();
    expect(state.deliveries[0].cancelledAt).toBeNull();

    // 2. First attempt fails retryably
    sendSpy.mockRejectedValueOnce(
      new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.PROVIDER_UNAVAILABLE,
        safeMessage: 'Temporary 503',
        retryable: true
      })
    );
    await expect(executor.executeDelivery(DELIVERY_ID)).rejects.toThrow();

    expect(state.deliveries[0].attemptCount).toBe(1);
    expect(state.deliveries[0].status).toBe(OutreachDeliveryStatus.QUEUED);
    expect(state.deliveries[0].failedAt).toBeNull();
    expect(state.deliveries[0].lastErrorCode).toBe(OutreachErrorCode.OUTREACH_PROVIDER_UNAVAILABLE);

    // 3. Second attempt succeeds
    sendSpy.mockResolvedValueOnce({
      providerName: 'MOCK_WHATSAPP',
      providerMessageId: 'prov-inv-01',
      acceptedAt: new Date()
    });
    await executor.executeDelivery(DELIVERY_ID);

    expect(state.deliveries[0].attemptCount).toBe(2);
    expect(state.deliveries[0].status).toBe(OutreachDeliveryStatus.SENT);
    expect(state.deliveries[0].sentAt).toBeDefined();
    expect(state.deliveries[0].failedAt).toBeNull();
    expect(state.deliveries[0].lastErrorCode).toBeNull(); // Cleared
    expect(state.deliveries[0].safeLastErrorMessage).toBeNull();

    // 4. Webhook DELIVERED arrives
    await webhookProcessor.processEvent({
      providerName: 'MOCK_WHATSAPP',
      eventId: 'evt-inv-deliv',
      providerMessageId: 'prov-inv-01',
      eventType: 'DELIVERED',
      timestamp: new Date()
    });

    expect(state.deliveries[0].status).toBe(OutreachDeliveryStatus.DELIVERED);
    expect(state.deliveries[0].deliveredAt).toBeDefined();
    expect(state.deliveries[0].failedAt).toBeNull();
    expect(state.deliveries[0].lastErrorCode).toBeNull();

    // Total physical sends must equal attemptCount
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(state.deliveries[0].attemptCount).toBe(2);
  });
});
