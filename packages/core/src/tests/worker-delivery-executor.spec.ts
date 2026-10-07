import { describe, it, expect, beforeEach } from 'vitest';
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
  OutreachProviderErrorCode
} from '../index.js';

interface InMemoryDbState {
  leads: any[];
  drafts: any[];
  users: any[];
  deliveries: any[];
  suppressions: any[];
  auditLogs: any[];
}

function createMockPrismaClient(state: InMemoryDbState) {
  return {
    lead: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const found = state.leads.find((l) => l.id === where.id);
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
          }

          if (where.channelScope?.in) {
            if (!where.channelScope.in.includes(s.channelScope)) return false;
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
      findUnique: async ({ where, include }: { where: { id: string }; include?: any }) => {
        const found = state.deliveries.find((d) => d.id === where.id);
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
      update: async ({ where, data }: { where: { id: string }; data: any }) => {
        const idx = state.deliveries.findIndex((d) => d.id === where.id);
        if (idx === -1) throw new Error('Record to update not found');
        state.deliveries[idx] = {
          ...state.deliveries[idx],
          ...data,
          updatedAt: new Date()
        };
        return JSON.parse(JSON.stringify(state.deliveries[idx]));
      },
      updateMany: async ({ where, data }: { where: any; data: any }) => {
        let count = 0;
        for (let i = 0; i < state.deliveries.length; i++) {
          const d = state.deliveries[i];
          if (where.id && d.id !== where.id) continue;
          if (where.status && d.status !== where.status) continue;
          state.deliveries[i] = {
            ...d,
            ...data,
            updatedAt: new Date()
          };
          count++;
        }
        return { count };
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

class FakeProvider implements OutreachDeliveryProvider {
  public readonly name: string = 'mock-provider';
  public sendCount = 0;
  public lastInput?: OutreachProviderSendInput;
  public shouldFailWith?: Error;
  public result: OutreachProviderSendResult = {
    providerName: 'mock-provider',
    providerMessageId: 'prov-msg-123',
    acceptedAt: new Date('2026-10-06T12:00:00.000Z')
  };

  constructor(public readonly channel: OutreachChannel = OutreachChannel.WHATSAPP) {}

  async send(input: OutreachProviderSendInput): Promise<OutreachProviderSendResult> {
    this.sendCount++;
    this.lastInput = input;
    if (this.shouldFailWith) {
      throw this.shouldFailWith;
    }
    return this.result;
  }
}

describe('M6 Step 7: WorkerDeliveryExecutor Spec Suite', () => {
  const orgId = 'org-test-001';
  const leadId = 'lead-test-001';
  const draftId = 'draft-test-001';
  const userId = 'user-test-001';
  const deliveryId = 'del-test-001';

  let dbState: InMemoryDbState;
  let mockPrisma: any;
  let fakeWaProvider: FakeProvider;
  let fakeEmailProvider: FakeProvider;
  let fakeRegistry: OutreachDeliveryProviderRegistry;
  let fixedClock: Date;

  beforeEach(() => {
    fixedClock = new Date('2026-10-06T12:00:00.000Z');

    const validSnapshotContent = 'Hello from LeadMate WhatsApp';
    const validSnapshotHash = computeApprovedDraftSnapshotHash({
      channel: OutreachChannel.WHATSAPP,
      content: validSnapshotContent
    });

    dbState = {
      leads: [
        {
          id: leadId,
          organizationId: orgId,
          companyName: 'Apex Footwear'
        }
      ],
      drafts: [
        {
          id: draftId,
          organizationId: orgId,
          leadId,
          content: validSnapshotContent
        }
      ],
      users: [
        {
          id: userId,
          organizationId: orgId,
          email: 'rep@apex.com',
          role: Role.SALES_EXECUTIVE
        }
      ],
      deliveries: [
        {
          id: deliveryId,
          organizationId: orgId,
          leadId,
          draftId,
          requestedByUserId: userId,
          channel: OutreachChannel.WHATSAPP,
          status: OutreachDeliveryStatus.QUEUED,
          recipientNormalized: '+8801700000001',
          snapshotContent: validSnapshotContent,
          snapshotSubject: null,
          snapshotBody: null,
          approvedDraftSnapshotHash: validSnapshotHash,
          attemptCount: 0,
          idempotencyKey: 'test-idemp-001',
          requestFingerprint: 'dummy-fp'
        }
      ],
      suppressions: [],
      auditLogs: []
    };

    mockPrisma = createMockPrismaClient(dbState);
    fakeWaProvider = new FakeProvider(OutreachChannel.WHATSAPP);
    fakeEmailProvider = new FakeProvider(OutreachChannel.EMAIL);

    fakeRegistry = {
      getProvider: (ch: OutreachChannel) =>
        ch === OutreachChannel.WHATSAPP ? fakeWaProvider : fakeEmailProvider,
      registerProvider: () => {}
    };
  });

  it('1. Returns skipped if delivery record does not exist', async () => {
    const executor = new WorkerDeliveryExecutor({
      prisma: mockPrisma,
      providerRegistry: fakeRegistry,
      clock: () => fixedClock
    });

    const result = await executor.executeDelivery('non-existent-id');
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.status).toBe(OutreachDeliveryStatus.FAILED);
    expect(fakeWaProvider.sendCount).toBe(0);
  });

  it('2. Fails closed and records safe audit log on cross-tenant inconsistency', async () => {
    // Lead belongs to a foreign organization
    dbState.leads[0].organizationId = 'foreign-org-999';

    const executor = new WorkerDeliveryExecutor({
      prisma: mockPrisma,
      providerRegistry: fakeRegistry,
      clock: () => fixedClock
    });

    const result = await executor.executeDelivery(deliveryId);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(OutreachDeliveryStatus.FAILED);
    expect(result.errorCode).toBe(OutreachErrorCode.OUTREACH_DELIVERY_FAILED);
    expect(result.safeErrorMessage).toContain('Tenant relational integrity check failed');
    expect(fakeWaProvider.sendCount).toBe(0);

    // Verify DB updated to FAILED
    const persisted = dbState.deliveries.find((d) => d.id === deliveryId);
    expect(persisted.status).toBe(OutreachDeliveryStatus.FAILED);
  });

  it('3. Skips non-dispatchable states safely without re-invoking provider (CANCELLED, SENT, DELIVERED, FAILED)', async () => {
    const executor = new WorkerDeliveryExecutor({
      prisma: mockPrisma,
      providerRegistry: fakeRegistry,
      clock: () => fixedClock
    });

    for (const terminalStatus of [
      OutreachDeliveryStatus.CANCELLED,
      OutreachDeliveryStatus.SENT,
      OutreachDeliveryStatus.DELIVERED,
      OutreachDeliveryStatus.FAILED
    ]) {
      dbState.deliveries[0].status = terminalStatus;
      const result = await executor.executeDelivery(deliveryId);

      expect(result.ok).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.status).toBe(terminalStatus);
      expect(fakeWaProvider.sendCount).toBe(0);
    }
  });

  it('4. Handles pre-existing PROCESSING status as ambiguous (does not re-send)', async () => {
    dbState.deliveries[0].status = OutreachDeliveryStatus.PROCESSING;

    const executor = new WorkerDeliveryExecutor({
      prisma: mockPrisma,
      providerRegistry: fakeRegistry,
      clock: () => fixedClock
    });

    const result = await executor.executeDelivery(deliveryId);

    expect(result.ok).toBe(false);
    expect(result.ambiguous).toBe(true);
    expect(result.status).toBe(OutreachDeliveryStatus.PROCESSING);
    expect(fakeWaProvider.sendCount).toBe(0);
  });

  it('5. Throws OutreachRequestedRaceError if status is REQUESTED (requeue race guard)', async () => {
    dbState.deliveries[0].status = OutreachDeliveryStatus.REQUESTED;

    const executor = new WorkerDeliveryExecutor({
      prisma: mockPrisma,
      providerRegistry: fakeRegistry,
      clock: () => fixedClock
    });

    await expect(executor.executeDelivery(deliveryId)).rejects.toThrow(
      OutreachRequestedRaceError
    );
    expect(fakeWaProvider.sendCount).toBe(0);
  });

  it('6. Handles atomic claim race if QUEUED was already claimed by another worker', async () => {
    // Mock updateMany returning 0
    const originalUpdateMany = mockPrisma.outreachDelivery.updateMany;
    mockPrisma.outreachDelivery.updateMany = async () => ({ count: 0 });

    const executor = new WorkerDeliveryExecutor({
      prisma: mockPrisma,
      providerRegistry: fakeRegistry,
      clock: () => fixedClock
    });

    const result = await executor.executeDelivery(deliveryId);

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(fakeWaProvider.sendCount).toBe(0);
  });

  it('7. Gate B Suppression Check: fails closed if recipient suppressed before dispatch', async () => {
    dbState.suppressions.push({
      id: 'supp-gate-b-01',
      organizationId: orgId,
      normalizedValue: '+8801700000001',
      type: SuppressionType.WHATSAPP,
      channelScope: ChannelScope.ALL,
      reason: SuppressionReason.OPT_OUT,
      expiresAt: null
    });

    const executor = new WorkerDeliveryExecutor({
      prisma: mockPrisma,
      providerRegistry: fakeRegistry,
      clock: () => fixedClock
    });

    const result = await executor.executeDelivery(deliveryId);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(OutreachDeliveryStatus.FAILED);
    expect(result.errorCode).toBe(OutreachErrorCode.OUTREACH_RECIPIENT_SUPPRESSED);
    expect(fakeWaProvider.sendCount).toBe(0);

    const persisted = dbState.deliveries.find((d) => d.id === deliveryId);
    expect(persisted.status).toBe(OutreachDeliveryStatus.FAILED);
    expect(persisted.attemptCount).toBe(0); // Attempt count not incremented for suppression

    expect(dbState.auditLogs.some((l) => l.action === 'lead.outreach_failed')).toBe(true);
  });

  it('8. Draft Snapshot Hash Check: fails closed if content was tampered after approval', async () => {
    // Tamper with snapshotContent without recalculating hash
    dbState.deliveries[0].snapshotContent = 'Tampered content text';

    const executor = new WorkerDeliveryExecutor({
      prisma: mockPrisma,
      providerRegistry: fakeRegistry,
      clock: () => fixedClock
    });

    const result = await executor.executeDelivery(deliveryId);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(OutreachDeliveryStatus.FAILED);
    expect(result.errorCode).toBe(OutreachErrorCode.OUTREACH_CONTENT_REJECTED);
    expect(fakeWaProvider.sendCount).toBe(0);

    const persisted = dbState.deliveries.find((d) => d.id === deliveryId);
    expect(persisted.status).toBe(OutreachDeliveryStatus.FAILED);
    expect(persisted.attemptCount).toBe(0);
  });

  it('9. Happy path: physical send succeeds, status updated to SENT, audit log recorded', async () => {
    const executor = new WorkerDeliveryExecutor({
      prisma: mockPrisma,
      providerRegistry: fakeRegistry,
      clock: () => fixedClock
    });

    const result = await executor.executeDelivery(deliveryId);

    expect(result.ok).toBe(true);
    expect(result.status).toBe(OutreachDeliveryStatus.SENT);
    expect(result.providerMessageId).toBe('prov-msg-123');
    expect(fakeWaProvider.sendCount).toBe(1);

    const persisted = dbState.deliveries.find((d) => d.id === deliveryId);
    expect(persisted.status).toBe(OutreachDeliveryStatus.SENT);
    expect(persisted.attemptCount).toBe(1);
    expect(persisted.providerName).toBe('mock-provider');
    expect(persisted.providerMessageId).toBe('prov-msg-123');

    const sentAudit = dbState.auditLogs.find((l) => l.action === 'lead.outreach_sent');
    expect(sentAudit).toBeDefined();
    expect(sentAudit.after.status).toBe(OutreachDeliveryStatus.SENT);
    expect(sentAudit.after.attemptCount).toBe(1);
  });

  it('10. Retryable error with remaining attempts: reverts to QUEUED and rethrows for BullMQ backoff', async () => {
    const retryableErr = new OutreachDeliveryProviderError({
      providerName: 'mock-provider',
      code: OutreachProviderErrorCode.PROVIDER_RATE_LIMITED,
      retryable: true,
      safeMessage: 'Rate limit exceeded on provider gateway'
    });
    fakeWaProvider.shouldFailWith = retryableErr;

    const executor = new WorkerDeliveryExecutor({
      prisma: mockPrisma,
      providerRegistry: fakeRegistry,
      clock: () => fixedClock,
      maxAttempts: 3
    });

    // Should rethrow the provider error to trigger BullMQ retry
    await expect(executor.executeDelivery(deliveryId)).rejects.toThrow(retryableErr);

    expect(fakeWaProvider.sendCount).toBe(1);

    const persisted = dbState.deliveries.find((d) => d.id === deliveryId);
    expect(persisted.status).toBe(OutreachDeliveryStatus.QUEUED);
    expect(persisted.attemptCount).toBe(1);
    expect(persisted.lastErrorCode).toBe(OutreachErrorCode.OUTREACH_PROVIDER_RATE_LIMITED);
    expect(persisted.safeLastErrorMessage).toBe('Rate limit exceeded on provider gateway');
  });

  it('11. Non-retryable error: marks status FAILED, records audit log, does NOT throw', async () => {
    const nonRetryableErr = new OutreachDeliveryProviderError({
      providerName: 'mock-provider',
      code: OutreachProviderErrorCode.RECIPIENT_REJECTED,
      retryable: false,
      safeMessage: 'Destination phone number is not a valid WhatsApp user'
    });
    fakeWaProvider.shouldFailWith = nonRetryableErr;

    const executor = new WorkerDeliveryExecutor({
      prisma: mockPrisma,
      providerRegistry: fakeRegistry,
      clock: () => fixedClock,
      maxAttempts: 3
    });

    const result = await executor.executeDelivery(deliveryId);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(OutreachDeliveryStatus.FAILED);
    expect(result.errorCode).toBe(OutreachErrorCode.OUTREACH_RECIPIENT_REJECTED);
    expect(fakeWaProvider.sendCount).toBe(1);

    const persisted = dbState.deliveries.find((d) => d.id === deliveryId);
    expect(persisted.status).toBe(OutreachDeliveryStatus.FAILED);
    expect(persisted.attemptCount).toBe(1);

    const failAudit = dbState.auditLogs.find((l) => l.action === 'lead.outreach_failed');
    expect(failAudit).toBeDefined();
    expect(failAudit.after.status).toBe(OutreachDeliveryStatus.FAILED);
  });

  it('12. Retryable error when budget exhausted (attemptCount >= maxAttempts): marks FAILED, does NOT throw', async () => {
    // Current attemptCount is 2, next attempt will be 3, with maxAttempts = 3
    dbState.deliveries[0].attemptCount = 2;

    const retryableErr = new OutreachDeliveryProviderError({
      providerName: 'mock-provider',
      code: OutreachProviderErrorCode.PROVIDER_TIMEOUT,
      retryable: true,
      safeMessage: 'Gateway timeout'
    });
    fakeWaProvider.shouldFailWith = retryableErr;

    const executor = new WorkerDeliveryExecutor({
      prisma: mockPrisma,
      providerRegistry: fakeRegistry,
      clock: () => fixedClock,
      maxAttempts: 3
    });

    const result = await executor.executeDelivery(deliveryId);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(OutreachDeliveryStatus.FAILED);
    expect(result.errorCode).toBe(OutreachErrorCode.OUTREACH_PROVIDER_TIMEOUT);
    expect(fakeWaProvider.sendCount).toBe(1);

    const persisted = dbState.deliveries.find((d) => d.id === deliveryId);
    expect(persisted.status).toBe(OutreachDeliveryStatus.FAILED);
    expect(persisted.attemptCount).toBe(3);

    const failAudit = dbState.auditLogs.find((l) => l.action === 'lead.outreach_failed');
    expect(failAudit).toBeDefined();
  });

  it('13. Accepted-but-persistence ambiguity: provider send succeeds, DB update to SENT fails -> remains PROCESSING; rerun sees pre-existing PROCESSING, provider.send total calls === 1', async () => {
    // Initial state: QUEUED
    expect(dbState.deliveries[0].status).toBe(OutreachDeliveryStatus.QUEUED);
    expect(fakeWaProvider.sendCount).toBe(0);

    // Fault-inject mockPrisma.outreachDelivery.update:
    // 1st update is attemptCount increment (allow)
    // 2nd update is PROCESSING -> SENT (throw failure)
    const originalUpdate = mockPrisma.outreachDelivery.update;
    let updateCallCount = 0;
    mockPrisma.outreachDelivery.update = async (args: any) => {
      updateCallCount++;
      if (args.data?.status === OutreachDeliveryStatus.SENT) {
        throw new Error('Database connection dropped while persisting SENT state');
      }
      return originalUpdate(args);
    };

    const executor = new WorkerDeliveryExecutor({
      prisma: mockPrisma,
      providerRegistry: fakeRegistry,
      clock: () => fixedClock,
      maxAttempts: 3
    });

    // 1st execution:
    // - claims QUEUED -> PROCESSING
    // - provider.send() succeeds
    // - DB update to SENT throws
    await expect(executor.executeDelivery(deliveryId)).rejects.toThrow(
      'Database connection dropped while persisting SENT state'
    );

    // Provider was invoked exactly once
    expect(fakeWaProvider.sendCount).toBe(1);

    // DB state remained in PROCESSING (the claim succeeded, attemptCount was incremented to 1, but SENT was not persisted)
    const persistedAfterFirstRun = dbState.deliveries.find((d) => d.id === deliveryId);
    expect(persistedAfterFirstRun.status).toBe(OutreachDeliveryStatus.PROCESSING);
    expect(persistedAfterFirstRun.attemptCount).toBe(1);

    // Restore update function for second execution
    mockPrisma.outreachDelivery.update = originalUpdate;

    // 2nd execution of the SAME logical job:
    const secondResult = await executor.executeDelivery(deliveryId);

    // Verifications:
    // - Total provider.send() call count remains EXACTLY 1 (no duplicate send!)
    expect(fakeWaProvider.sendCount).toBe(1);

    // - Sees pre-existing PROCESSING and flags ambiguity
    expect(secondResult.ok).toBe(false);
    expect(secondResult.ambiguous).toBe(true);
    expect(secondResult.status).toBe(OutreachDeliveryStatus.PROCESSING);
    expect(secondResult.safeErrorMessage).toContain('already in PROCESSING status; awaiting reconciliation');

    // - DB status is NOT altered: not marked DELIVERED, not marked SENT, not falsely failed
    const persistedAfterSecondRun = dbState.deliveries.find((d) => d.id === deliveryId);
    expect(persistedAfterSecondRun.status).toBe(OutreachDeliveryStatus.PROCESSING);
    expect(persistedAfterSecondRun.attemptCount).toBe(1);
  });

  it('14. Prolonged REQUESTED enqueue race: multiple REQUESTED observations do not consume provider attempts or fail delivery, eventual QUEUED transition claims and sends exactly once', async () => {
    // Initial state: REQUESTED (simulating background job executing before API finishes updating REQUESTED -> QUEUED)
    dbState.deliveries[0].status = OutreachDeliveryStatus.REQUESTED;
    dbState.deliveries[0].attemptCount = 0;

    const executor = new WorkerDeliveryExecutor({
      prisma: mockPrisma,
      providerRegistry: fakeRegistry,
      clock: () => fixedClock,
      maxAttempts: 3
    });

    // 1st observation: still in REQUESTED status
    await expect(executor.executeDelivery(deliveryId)).rejects.toThrow(
      OutreachRequestedRaceError
    );
    expect(fakeWaProvider.sendCount).toBe(0);
    expect(dbState.deliveries[0].attemptCount).toBe(0);
    expect(dbState.deliveries[0].status).toBe(OutreachDeliveryStatus.REQUESTED);

    // 2nd observation: prolonged race, still in REQUESTED status
    await expect(executor.executeDelivery(deliveryId)).rejects.toThrow(
      OutreachRequestedRaceError
    );
    expect(fakeWaProvider.sendCount).toBe(0);
    expect(dbState.deliveries[0].attemptCount).toBe(0);
    expect(dbState.deliveries[0].status).toBe(OutreachDeliveryStatus.REQUESTED);

    // 3rd observation: prolonged race, still in REQUESTED status (would have exhausted 3 BullMQ attempts if consumed!)
    await expect(executor.executeDelivery(deliveryId)).rejects.toThrow(
      OutreachRequestedRaceError
    );
    expect(fakeWaProvider.sendCount).toBe(0);
    expect(dbState.deliveries[0].attemptCount).toBe(0);
    expect(dbState.deliveries[0].status).toBe(OutreachDeliveryStatus.REQUESTED);

    // 4th observation: still in REQUESTED status
    await expect(executor.executeDelivery(deliveryId)).rejects.toThrow(
      OutreachRequestedRaceError
    );
    expect(fakeWaProvider.sendCount).toBe(0);
    expect(dbState.deliveries[0].attemptCount).toBe(0);
    expect(dbState.deliveries[0].status).toBe(OutreachDeliveryStatus.REQUESTED);

    // API now successfully finishes updating REQUESTED -> QUEUED
    dbState.deliveries[0].status = OutreachDeliveryStatus.QUEUED;

    // Next worker execution occurs: claims QUEUED -> PROCESSING and executes physical dispatch
    const result = await executor.executeDelivery(deliveryId);

    // Verifications:
    // 1. Success result returned
    expect(result.ok).toBe(true);
    expect(result.status).toBe(OutreachDeliveryStatus.SENT);
    expect(result.providerMessageId).toBe('prov-msg-123');

    // 2. Physical transport was invoked exactly once across all executions
    expect(fakeWaProvider.sendCount).toBe(1);

    // 3. Persisted delivery reached SENT status with attemptCount incremented once
    const persisted = dbState.deliveries.find((d) => d.id === deliveryId);
    expect(persisted.status).toBe(OutreachDeliveryStatus.SENT);
    expect(persisted.attemptCount).toBe(1);
    expect(persisted.providerName).toBe('mock-provider');
    expect(persisted.providerMessageId).toBe('prov-msg-123');

    // 4. Delivery was never falsely marked FAILED and audit log was emitted once
    expect(dbState.auditLogs.some((l) => l.action === 'lead.outreach_failed')).toBe(false);
    const sentAudit = dbState.auditLogs.find((l) => l.action === 'lead.outreach_sent');
    expect(sentAudit).toBeDefined();
    expect(sentAudit.after.status).toBe(OutreachDeliveryStatus.SENT);
  });
});
