/**
 * M6 Step 8: Worker Adapter Hardening & Integrity Test Suite
 *
 * Validates worker-level execution integrity, race handling, and boundary safety:
 * - REQUESTED worker race lifecycle: moveToDelayed -> DelayedError -> eventual success on QUEUED
 * - Stale / replayed job handling on terminal states (SENT, DELIVERED, FAILED, CANCELLED)
 * - Ambiguous in-flight PROCESSING replay handling (zero physical resends)
 * - Strict job payload validation ({ deliveryId } only; rejects missing or malformed inputs)
 * - Unknown deliveryId handling (safe classification without leakage)
 * - Tenant relational integrity fault injection (mismatched lead, draft, or user org -> fail closed)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import {
  createOutreachDeliveryProcessor,
  DelayedError
} from '../workers/outreach-delivery.worker.js';
import {
  WorkerDeliveryExecutor,
  OutreachRequestedRaceError,
  computeApprovedDraftSnapshotHash,
  type OutreachDeliveryProvider,
  type OutreachDeliveryProviderRegistry
} from '@leadmate/core';
import {
  Role,
  OutreachChannel,
  OutreachDeliveryStatus,
  OutreachErrorCode
} from '@leadmate/shared';

describe('M6 Step 8: Outreach Worker Adapter Hardening & Integrity', () => {
  const ORG_A_ID = 'org-step8-worker-aaa';
  const ORG_B_ID = 'org-step8-worker-bbb';
  const LEAD_ID = 'lead-step8-worker-111';
  const DRAFT_ID = 'draft-step8-worker-222';
  const USER_ID = 'user-step8-worker-333';
  const DELIVERY_ID = 'deliv-step8-worker-444';

  const defaultContent = 'Approved worker test content';
  const defaultHash = computeApprovedDraftSnapshotHash({
    channel: OutreachChannel.WHATSAPP,
    content: defaultContent,
    subject: null,
    body: null
  });

  let mockDbState: any;
  let mockPrisma: any;
  let sendSpy: ReturnType<typeof vi.fn>;
  let mockProvider: OutreachDeliveryProvider;
  let providerRegistry: OutreachDeliveryProviderRegistry;
  let executor: WorkerDeliveryExecutor;

  beforeEach(() => {
    mockDbState = {
      leads: [
        {
          id: LEAD_ID,
          organizationId: ORG_A_ID,
          name: 'Lead One',
          primaryPhone: '+8801700000000',
          assignedUserId: USER_ID
        }
      ],
      drafts: [
        {
          id: DRAFT_ID,
          organizationId: ORG_A_ID,
          leadId: LEAD_ID,
          createdByUserId: USER_ID,
          type: 'WHATSAPP',
          content: defaultContent
        }
      ],
      users: [
        {
          id: USER_ID,
          organizationId: ORG_A_ID,
          name: 'Agent A',
          role: Role.SALES_EXECUTIVE
        }
      ],
      deliveries: [
        {
          id: DELIVERY_ID,
          organizationId: ORG_A_ID,
          leadId: LEAD_ID,
          draftId: DRAFT_ID,
          channel: OutreachChannel.WHATSAPP,
          status: OutreachDeliveryStatus.QUEUED,
          recipientNormalized: '+8801711223344',
          snapshotContent: defaultContent,
          snapshotSubject: null,
          snapshotBody: null,
          approvedDraftSnapshotHash: defaultHash,
          idempotencyKey: 'idem-worker-001',
          requestFingerprint: 'fp-worker-001',
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
      auditLogs: []
    };

    mockPrisma = {
      lead: {
        findUnique: async ({ where }: any) => {
          const id = where.id ?? where.id_organizationId?.id;
          return mockDbState.leads.find((l: any) => l.id === id) ?? null;
        }
      },
      salesAssistantDraft: {
        findUnique: async ({ where }: any) => {
          const id = where.id ?? where.id_organizationId?.id;
          return mockDbState.drafts.find((d: any) => d.id === id) ?? null;
        }
      },
      user: {
        findUnique: async ({ where }: any) => {
          return mockDbState.users.find((u: any) => u.id === where.id) ?? null;
        }
      },
      suppressionList: {
        findFirst: async () => null
      },
      outreachDelivery: {
        findUnique: async ({ where, include }: any) => {
          const id = where.id ?? where.id_organizationId?.id;
          const found = mockDbState.deliveries.find((d: any) => d.id === id);
          if (!found) return null;
          const copy = { ...found };
          if (include?.lead) copy.lead = mockDbState.leads.find((l: any) => l.id === copy.leadId);
          if (include?.draft) copy.draft = mockDbState.drafts.find((d: any) => d.id === copy.draftId);
          if (include?.requestedByUser) copy.requestedByUser = mockDbState.users.find((u: any) => u.id === copy.requestedByUserId);
          return copy;
        },
        update: async ({ where, data }: any) => {
          const idx = mockDbState.deliveries.findIndex((d: any) => d.id === where.id);
          if (idx === -1) throw new Error('Not found');
          mockDbState.deliveries[idx] = { ...mockDbState.deliveries[idx], ...data };
          return mockDbState.deliveries[idx];
        },
        updateMany: async ({ where, data }: any) => {
          let count = 0;
          for (let i = 0; i < mockDbState.deliveries.length; i++) {
            const d = mockDbState.deliveries[i];
            if (where.id && d.id !== where.id) continue;
            if (where.status && d.status !== where.status) continue;
            mockDbState.deliveries[i] = { ...d, ...data };
            count++;
          }
          return { count };
        }
      },
      auditLog: {
        create: async ({ data }: any) => {
          mockDbState.auditLogs.push(data);
          return data;
        }
      }
    };

    sendSpy = vi.fn().mockResolvedValue({
      providerName: 'MOCK_WHATSAPP',
      providerMessageId: 'msg-worker-888',
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
        throw new Error(`Unsupported ${channel}`);
      }
    };

    executor = new WorkerDeliveryExecutor({
      prisma: mockPrisma,
      providerRegistry,
      clock: () => new Date('2026-10-07T12:00:00Z')
    });
  });

  // =========================================================================
  // 12. REQUESTED WORKER RACE LIFECYCLE
  // =========================================================================
  it('12. REQUESTED worker race: delays job via moveToDelayed with DelayedError, preserves attempt budget, then executes once QUEUED', async () => {
    // 1. Initial status in DB is REQUESTED
    mockDbState.deliveries[0].status = OutreachDeliveryStatus.REQUESTED;

    const mockMoveToDelayed = vi.fn().mockResolvedValue(undefined);
    const mockJob = {
      id: 'job-req-race-01',
      data: { deliveryId: DELIVERY_ID },
      attemptsMade: 0,
      moveToDelayed: mockMoveToDelayed
    } as unknown as Job<any, any>;

    const lockToken = 'lock-token-step8-111';
    const processor = createOutreachDeliveryProcessor(executor);

    // Initial execution triggers DelayedError
    await expect(processor(mockJob, lockToken)).rejects.toThrow(DelayedError);
    expect(mockMoveToDelayed).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledTimes(0);
    expect(mockDbState.deliveries[0].attemptCount).toBe(0);

    // 2. Database transition completes (REQUESTED -> QUEUED)
    mockDbState.deliveries[0].status = OutreachDeliveryStatus.QUEUED;

    // Delayed job wakes up and re-executes
    const result = await processor(mockJob, lockToken);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(OutreachDeliveryStatus.SENT);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(mockDbState.deliveries[0].attemptCount).toBe(1);
    expect(mockDbState.deliveries[0].status).toBe(OutreachDeliveryStatus.SENT);
  });

  // =========================================================================
  // 55. STALE / REPLAYED JOBS ON TERMINAL AND PROCESSING STATES
  // =========================================================================
  it('55. Stale / replayed BullMQ jobs safe no-op on SENT, DELIVERED, FAILED, and CANCELLED states with 0 provider sends', async () => {
    const processor = createOutreachDeliveryProcessor(executor);
    const mockJob = {
      id: 'job-stale-01',
      data: { deliveryId: DELIVERY_ID },
      attemptsMade: 1,
      moveToDelayed: vi.fn()
    } as unknown as Job<any, any>;

    const terminalStatuses = [
      OutreachDeliveryStatus.SENT,
      OutreachDeliveryStatus.DELIVERED,
      OutreachDeliveryStatus.FAILED,
      OutreachDeliveryStatus.CANCELLED
    ];

    for (const termStatus of terminalStatuses) {
      mockDbState.deliveries[0].status = termStatus;
      sendSpy.mockClear();

      const result = await processor(mockJob, 'lock-token-stale');
      expect(result.ok).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.status).toBe(termStatus);
      expect(sendSpy).toHaveBeenCalledTimes(0);
    }

    // PROCESSING ambiguity check
    mockDbState.deliveries[0].status = OutreachDeliveryStatus.PROCESSING;
    sendSpy.mockClear();

    const procResult = await processor(mockJob, 'lock-token-stale');
    expect(procResult.ok).toBe(false);
    expect(procResult.ambiguous).toBe(true);
    expect(procResult.status).toBe(OutreachDeliveryStatus.PROCESSING);
    expect(sendSpy).toHaveBeenCalledTimes(0);
  });

  // =========================================================================
  // 56. WORKER MALFORMED PAYLOAD VALIDATION
  // =========================================================================
  it('56. Worker strictly validates job payload: rejects missing deliveryId, non-string, or empty objects', async () => {
    const processor = createOutreachDeliveryProcessor(executor);

    // Empty object
    const emptyJob = { id: 'job-err-1', data: {} } as unknown as Job<any, any>;
    await expect(processor(emptyJob, 'token-1')).rejects.toThrow('Invalid job payload: deliveryId is required');

    // Non-string deliveryId
    const numericJob = { id: 'job-err-2', data: { deliveryId: 12345 } } as unknown as Job<any, any>;
    await expect(processor(numericJob, 'token-2')).rejects.toThrow('Invalid job payload: deliveryId is required');

    // Null data
    const nullJob = { id: 'job-err-3', data: null } as unknown as Job<any, any>;
    await expect(processor(nullJob, 'token-3')).rejects.toThrow();

    expect(sendSpy).toHaveBeenCalledTimes(0);
  });

  // =========================================================================
  // 57. WORKER UNKNOWN DELIVERY ID
  // =========================================================================
  it('57. Unknown deliveryId returns safe skipped failure classification without leaking internal details or calling provider', async () => {
    const processor = createOutreachDeliveryProcessor(executor);
    const unknownJob = {
      id: 'job-unknown-01',
      data: { deliveryId: '00000000-0000-0000-0000-000000000000' }
    } as unknown as Job<any, any>;

    const result = await processor(unknownJob, 'token-unknown');
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.status).toBe(OutreachDeliveryStatus.FAILED);
    expect(result.safeErrorMessage).toBe('Delivery record not found');
    expect(sendSpy).toHaveBeenCalledTimes(0);
  });

  // =========================================================================
  // 58. TENANT RELATIONAL CORRUPTION FAULT INJECTION
  // =========================================================================
  it('58. Fault injection: cross-tenant relational corruption (lead, draft, or user org mismatch) fails closed with zero provider calls', async () => {
    const processor = createOutreachDeliveryProcessor(executor);
    const mockJob = {
      id: 'job-corrupt-01',
      data: { deliveryId: DELIVERY_ID }
    } as unknown as Job<any, any>;

    // Case A: Lead belongs to Org B while Delivery is Org A
    mockDbState.leads[0].organizationId = ORG_B_ID;
    const resA = await processor(mockJob, 'token-corrupt-a');
    expect(resA.ok).toBe(false);
    expect(resA.status).toBe(OutreachDeliveryStatus.FAILED);
    expect(resA.errorCode).toBe(OutreachErrorCode.OUTREACH_DELIVERY_FAILED);
    expect(sendSpy).toHaveBeenCalledTimes(0);

    // Reset and Case B: Draft belongs to Org B while Delivery is Org A
    mockDbState.leads[0].organizationId = ORG_A_ID;
    mockDbState.deliveries[0].status = OutreachDeliveryStatus.QUEUED;
    mockDbState.drafts[0].organizationId = ORG_B_ID;

    const resB = await processor(mockJob, 'token-corrupt-b');
    expect(resB.ok).toBe(false);
    expect(resB.status).toBe(OutreachDeliveryStatus.FAILED);
    expect(sendSpy).toHaveBeenCalledTimes(0);

    // Reset and Case C: Requesting User belongs to Org B while Delivery is Org A
    mockDbState.drafts[0].organizationId = ORG_A_ID;
    mockDbState.deliveries[0].status = OutreachDeliveryStatus.QUEUED;
    mockDbState.users[0].organizationId = ORG_B_ID;

    const resC = await processor(mockJob, 'token-corrupt-c');
    expect(resC.ok).toBe(false);
    expect(resC.status).toBe(OutreachDeliveryStatus.FAILED);
    expect(sendSpy).toHaveBeenCalledTimes(0);
  });
});
