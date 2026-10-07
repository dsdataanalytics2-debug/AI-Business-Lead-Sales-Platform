import { describe, it, expect, beforeEach } from 'vitest';
import {
  Role,
  OutreachChannel,
  OutreachDeliveryStatus,
  OutreachErrorCode
} from '@leadmate/shared';
import {
  OutreachDeliveryService,
  OutreachServiceError,
  InMemoryOutreachDeliveryQueue
} from '../index.js';

interface InMemoryDbState {
  leads: any[];
  deliveries: any[];
  auditLogs: any[];
}

function createMockPrismaClient(state: InMemoryDbState) {
  return {
    lead: {
      findUnique: async ({ where }: { where: { id_organizationId: { id: string; organizationId: string } } }) => {
        const found = state.leads.find(
          (l) =>
            l.id === where.id_organizationId.id &&
            l.organizationId === where.id_organizationId.organizationId
        );
        return found ? JSON.parse(JSON.stringify(found)) : null;
      }
    },
    outreachDelivery: {
      findFirst: async ({ where }: { where: any }) => {
        const found = state.deliveries.find(
          (d) =>
            d.id === where.id &&
            d.leadId === where.leadId &&
            d.organizationId === where.organizationId
        );
        return found ? JSON.parse(JSON.stringify(found)) : null;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const found = state.deliveries.find((d) => d.id === where.id);
        return found ? JSON.parse(JSON.stringify(found)) : null;
      },
      updateMany: async ({ where, data }: { where: any; data: any }) => {
        let count = 0;
        for (let i = 0; i < state.deliveries.length; i++) {
          const d = state.deliveries[i];
          if (where.id && d.id !== where.id) continue;
          if (where.organizationId && d.organizationId !== where.organizationId) continue;
          if (where.leadId && d.leadId !== where.leadId) continue;
          if (where.status?.in && !where.status.in.includes(d.status)) continue;
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

describe('M6 Step 7: OutreachDeliveryService Cancellation Spec Suite', () => {
  const orgId = 'org-cancel-001';
  const leadId = 'lead-cancel-001';
  const deliveryId = 'del-cancel-001';
  const managerId = 'mgr-001';
  const execId = 'exec-001';

  let dbState: InMemoryDbState;
  let mockPrisma: any;
  let mockQueue: InMemoryOutreachDeliveryQueue;
  let service: OutreachDeliveryService;
  let fixedClock: Date;

  beforeEach(() => {
    fixedClock = new Date('2026-10-06T15:00:00.000Z');

    dbState = {
      leads: [
        {
          id: leadId,
          organizationId: orgId,
          companyName: 'Beximco Pharma'
        }
      ],
      deliveries: [
        {
          id: deliveryId,
          organizationId: orgId,
          leadId,
          draftId: 'draft-001',
          requestedByUserId: execId,
          channel: OutreachChannel.WHATSAPP,
          status: OutreachDeliveryStatus.QUEUED,
          recipientNormalized: '+8801700000001',
          snapshotContent: 'Hello',
          attemptCount: 0,
          idempotencyKey: 'idemp-cancel-01',
          requestFingerprint: 'dummy-fp',
          createdAt: new Date('2026-10-06T14:50:00.000Z'),
          updatedAt: new Date('2026-10-06T14:50:00.000Z')
        }
      ],
      auditLogs: []
    };

    mockPrisma = createMockPrismaClient(dbState);
    mockQueue = new InMemoryOutreachDeliveryQueue();
    // Simulate job present in queue
    mockQueue.jobs.push({ jobId: deliveryId, payload: { deliveryId } });

    service = new OutreachDeliveryService({
      prisma: mockPrisma,
      queue: mockQueue,
      clock: () => fixedClock
    });
  });

  it('1. RBAC: Sales Executive or Viewer lacks OUTREACH_MANAGE and receives 403 FORBIDDEN', async () => {
    await expect(
      service.cancelDelivery({
        organizationId: orgId,
        authenticatedUserId: execId,
        authenticatedUserRole: Role.SALES_EXECUTIVE,
        leadId,
        deliveryId
      })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN'
    });

    await expect(
      service.cancelDelivery({
        organizationId: orgId,
        authenticatedUserId: 'viewer-001',
        authenticatedUserRole: Role.VIEWER,
        leadId,
        deliveryId
      })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN'
    });
  });

  it('2. Returns 404 NOT_FOUND if lead does not exist in tenant', async () => {
    await expect(
      service.cancelDelivery({
        organizationId: orgId,
        authenticatedUserId: managerId,
        authenticatedUserRole: Role.SALES_MANAGER,
        leadId: 'non-existent-lead',
        deliveryId
      })
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Lead not found in organization'
    });
  });

  it('3. Returns 404 NOT_FOUND if delivery does not exist for lead/tenant', async () => {
    await expect(
      service.cancelDelivery({
        organizationId: orgId,
        authenticatedUserId: managerId,
        authenticatedUserRole: Role.SALES_MANAGER,
        leadId,
        deliveryId: 'non-existent-delivery'
      })
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Outreach delivery not found'
    });
  });

  it('4. Successfully cancels delivery in QUEUED status: marks CANCELLED, removes from queue, writes audit log', async () => {
    const summary = await service.cancelDelivery({
      organizationId: orgId,
      authenticatedUserId: managerId,
      authenticatedUserRole: Role.SALES_MANAGER,
      leadId,
      deliveryId
    });

    expect(summary.status).toBe(OutreachDeliveryStatus.CANCELLED);
    expect(summary.cancelledAt).toBe(fixedClock.toISOString());

    const persisted = dbState.deliveries.find((d) => d.id === deliveryId);
    expect(persisted.status).toBe(OutreachDeliveryStatus.CANCELLED);
    expect(persisted.cancelledAt).toEqual(fixedClock);

    // Verified removed from queue
    expect(mockQueue.jobs.find((j) => j.jobId === deliveryId)).toBeUndefined();

    // Verified audit log
    const audit = dbState.auditLogs.find((l) => l.action === 'lead.outreach_cancelled');
    expect(audit).toBeDefined();
    expect(audit.userId).toBe(managerId);
    expect(audit.entityId).toBe(deliveryId);
    expect(audit.after.status).toBe(OutreachDeliveryStatus.CANCELLED);
  });

  it('5. Successfully cancels delivery in REQUESTED status', async () => {
    dbState.deliveries[0].status = OutreachDeliveryStatus.REQUESTED;

    const summary = await service.cancelDelivery({
      organizationId: orgId,
      authenticatedUserId: managerId,
      authenticatedUserRole: Role.SUPER_ADMIN,
      leadId,
      deliveryId
    });

    expect(summary.status).toBe(OutreachDeliveryStatus.CANCELLED);
    expect(dbState.deliveries[0].status).toBe(OutreachDeliveryStatus.CANCELLED);
  });

  it('6. Idempotent: repeat cancellation of already CANCELLED delivery returns summary without error', async () => {
    dbState.deliveries[0].status = OutreachDeliveryStatus.CANCELLED;
    dbState.deliveries[0].cancelledAt = fixedClock;

    const summary = await service.cancelDelivery({
      organizationId: orgId,
      authenticatedUserId: managerId,
      authenticatedUserRole: Role.ADMIN,
      leadId,
      deliveryId
    });

    expect(summary.status).toBe(OutreachDeliveryStatus.CANCELLED);
    expect(summary.cancelledAt).toBe(fixedClock.toISOString());
    // Does not write duplicate audit log
    expect(dbState.auditLogs.length).toBe(0);
  });

  it('7. Rejects in-flight delivery (PROCESSING) with 409 OUTREACH_DELIVERY_IN_FLIGHT', async () => {
    dbState.deliveries[0].status = OutreachDeliveryStatus.PROCESSING;

    await expect(
      service.cancelDelivery({
        organizationId: orgId,
        authenticatedUserId: managerId,
        authenticatedUserRole: Role.SALES_MANAGER,
        leadId,
        deliveryId
      })
    ).rejects.toMatchObject({
      code: OutreachErrorCode.OUTREACH_DELIVERY_IN_FLIGHT,
      statusCode: 409
    });
  });

  it('8. Rejects already SENT, DELIVERED, or FAILED delivery with 409 OUTREACH_DELIVERY_IN_FLIGHT', async () => {
    for (const inFlightStatus of [
      OutreachDeliveryStatus.SENT,
      OutreachDeliveryStatus.DELIVERED,
      OutreachDeliveryStatus.FAILED
    ]) {
      dbState.deliveries[0].status = inFlightStatus;

      await expect(
        service.cancelDelivery({
          organizationId: orgId,
          authenticatedUserId: managerId,
          authenticatedUserRole: Role.SALES_MANAGER,
          leadId,
          deliveryId
        })
      ).rejects.toMatchObject({
        code: OutreachErrorCode.OUTREACH_DELIVERY_IN_FLIGHT,
        statusCode: 409
      });
    }
  });

  it('9. Queue removal failure is best-effort: delivery remains CANCELLED and returns success', async () => {
    // Inject failure into queue.removeJob
    mockQueue.removeJob = async () => {
      throw new Error('Redis connection down during job removal');
    };

    const summary = await service.cancelDelivery({
      organizationId: orgId,
      authenticatedUserId: managerId,
      authenticatedUserRole: Role.SALES_MANAGER,
      leadId,
      deliveryId
    });

    expect(summary.status).toBe(OutreachDeliveryStatus.CANCELLED);
    expect(summary.cancelledAt).toBe(fixedClock.toISOString());

    const persisted = dbState.deliveries.find((d) => d.id === deliveryId);
    expect(persisted.status).toBe(OutreachDeliveryStatus.CANCELLED);
    expect(persisted.cancelledAt).toEqual(fixedClock);

    // Audit log still recorded
    const audit = dbState.auditLogs.find((l) => l.action === 'lead.outreach_cancelled');
    expect(audit).toBeDefined();
  });

  it('10. Claim-wins race: worker claims QUEUED -> PROCESSING right before cancel update -> cancel receives 409 OUTREACH_DELIVERY_IN_FLIGHT', async () => {
    // Simulate race where worker claims PROCESSING while cancel is executing updateMany
    // Mock updateMany to simulate update count 0 because status is already PROCESSING
    const origUpdateMany = mockPrisma.outreachDelivery.updateMany;
    mockPrisma.outreachDelivery.updateMany = async () => {
      // Simulate that the worker updated it to PROCESSING concurrently
      dbState.deliveries[0].status = OutreachDeliveryStatus.PROCESSING;
      return { count: 0 };
    };

    await expect(
      service.cancelDelivery({
        organizationId: orgId,
        authenticatedUserId: managerId,
        authenticatedUserRole: Role.SALES_MANAGER,
        leadId,
        deliveryId
      })
    ).rejects.toMatchObject({
      code: OutreachErrorCode.OUTREACH_DELIVERY_IN_FLIGHT,
      statusCode: 409
    });

    mockPrisma.outreachDelivery.updateMany = origUpdateMany;
  });

  it('11. Cancel-wins race: cancel claims QUEUED -> CANCELLED first -> repeat cancel is idempotent no-op', async () => {
    // 1st cancel wins
    await service.cancelDelivery({
      organizationId: orgId,
      authenticatedUserId: managerId,
      authenticatedUserRole: Role.ADMIN,
      leadId,
      deliveryId
    });

    expect(dbState.deliveries[0].status).toBe(OutreachDeliveryStatus.CANCELLED);

    // 2nd cancel sees CANCELLED
    const repeatSummary = await service.cancelDelivery({
      organizationId: orgId,
      authenticatedUserId: managerId,
      authenticatedUserRole: Role.ADMIN,
      leadId,
      deliveryId
    });

    expect(repeatSummary.status).toBe(OutreachDeliveryStatus.CANCELLED);
  });
});
