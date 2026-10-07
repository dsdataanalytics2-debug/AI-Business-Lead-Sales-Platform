import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import prisma, {
  Role,
  SalesAssistantDraftType,
  SalesAssistantLanguage,
  SalesAssistantTone,
  SalesAssistantDraftStatus,
  OutreachChannel,
  OutreachDeliveryStatus
} from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import { ErrorCodes, OutreachErrorCode } from '@leadmate/shared';
import { app } from '../app.js';
import { hashPassword, hashSessionToken } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';
import { outreachService } from '../services/outreach.service.js';

describe('M6 Step 7: Outreach Delivery Cancellation API & Route Isolation Test Suite', () => {
  const ORG_A_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  let adminAId: string;
  let adminACookie: string;

  let salesManagerAId: string;
  let salesManagerACookie: string;

  let execAId: string;
  let execACookie: string;

  let viewerAId: string;
  let viewerACookie: string;

  let testLeadAId: string;
  let testDraftAId: string;
  let testDeliveryAId: string;

  async function createSessionCookie(userId: string, rawToken: string): Promise<string> {
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.session.upsert({
      where: { tokenHash },
      update: {
        userId,
        expiresAt
      },
      create: {
        userId,
        tokenHash,
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        expiresAt
      }
    });

    return `${SESSION_COOKIE_NAME}=${rawToken}`;
  }

  async function cleanupDatabase() {
    await ensureTestDatabase(prisma);
    await prisma.outreachWebhookEvent.deleteMany({
      where: { organizationId: ORG_A_ID }
    });
    await prisma.outreachDelivery.deleteMany({
      where: { organizationId: ORG_A_ID }
    });
    await prisma.salesAssistantDraft.deleteMany({
      where: { organizationId: ORG_A_ID }
    });
    await prisma.leadContact.deleteMany({
      where: { lead: { organizationId: ORG_A_ID } }
    });
    await prisma.lead.deleteMany({
      where: { organizationId: ORG_A_ID }
    });
    await prisma.session.deleteMany({
      where: { user: { organizationId: ORG_A_ID } }
    });
    await prisma.auditLog.deleteMany({
      where: { organizationId: ORG_A_ID }
    });
    await prisma.user.deleteMany({
      where: { organizationId: ORG_A_ID }
    });
    await prisma.organization.deleteMany({
      where: { id: ORG_A_ID }
    });
  }

  beforeAll(async () => {
    await cleanupDatabase();

    // Create Org A
    await prisma.organization.create({
      data: {
        id: ORG_A_ID,
        name: 'Cancellation Org A'
      }
    });

    // Create Users in Org A
    const passwordHash = await hashPassword('TestPassword123!');

    const admin = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'admin.cancel@test.com',
        name: 'Admin A',
        passwordHash,
        role: Role.ADMIN,
        isActive: true
      }
    });
    adminAId = admin.id;
    adminACookie = await createSessionCookie(adminAId, 'token-admin-a-cancel');

    const manager = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'manager.cancel@test.com',
        name: 'Manager A',
        passwordHash,
        role: Role.SALES_MANAGER,
        isActive: true
      }
    });
    salesManagerAId = manager.id;
    salesManagerACookie = await createSessionCookie(salesManagerAId, 'token-mgr-a-cancel');

    const exec = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'exec.cancel@test.com',
        name: 'Exec A',
        passwordHash,
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });
    execAId = exec.id;
    execACookie = await createSessionCookie(execAId, 'token-exec-a-cancel');

    const viewer = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'viewer.cancel@test.com',
        name: 'Viewer A',
        passwordHash,
        role: Role.VIEWER,
        isActive: true
      }
    });
    viewerAId = viewer.id;
    viewerACookie = await createSessionCookie(viewerAId, 'token-viewer-a-cancel');

    // Create Lead in Org A
    const lead = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Cancellation Test Lead',
        normalizedName: 'cancellation test lead',
        category: 'Retail',
        city: 'Dhaka',
        primarySource: 'MANUAL',
        assignedUserId: execAId
      }
    });
    testLeadAId = lead.id;

    // Create Approved Draft
    const draft = await prisma.salesAssistantDraft.create({
      data: {
        organizationId: ORG_A_ID,
        leadId: testLeadAId,
        createdByUserId: execAId,
        type: SalesAssistantDraftType.WHATSAPP,
        language: SalesAssistantLanguage.BANGLA,
        tone: SalesAssistantTone.PERSUASIVE,
        status: SalesAssistantDraftStatus.APPROVED,
        content: 'Valid approved content',
        approvedAt: new Date(),
        approvedByUserId: adminAId
      }
    });
    testDraftAId = draft.id;
  });

  afterAll(async () => {
    await cleanupDatabase();
  });

  beforeEach(async () => {
    await prisma.outreachWebhookEvent.deleteMany({
      where: { organizationId: ORG_A_ID }
    });
    await prisma.outreachDelivery.deleteMany({
      where: { organizationId: ORG_A_ID }
    });

    // Create a fresh QUEUED delivery for testLeadAId
    const delivery = await prisma.outreachDelivery.create({
      data: {
        organizationId: ORG_A_ID,
        leadId: testLeadAId,
        draftId: testDraftAId,
        requestedByUserId: execAId,
        channel: OutreachChannel.WHATSAPP,
        status: OutreachDeliveryStatus.QUEUED,
        recipientNormalized: '+8801700000001',
        snapshotContent: 'Valid approved content',
        approvedDraftSnapshotHash: 'dummy-hash-for-test-321',
        idempotencyKey: 'idemp-cancel-api-01',
        requestFingerprint: 'dummy-fingerprint'
      }
    });
    testDeliveryAId = delivery.id;
  });

  describe('Part 1: Delivery Cancellation API (POST /api/v1/leads/:id/outreach/deliveries/:deliveryId/cancel)', () => {
    it('1. Returns 401 UNAUTHENTICATED when no session is provided', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/outreach/deliveries/${testDeliveryAId}/cancel`)
        .send();

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    });

    it('2. Returns 403 FORBIDDEN when user lacks OUTREACH_MANAGE (Viewer or Sales Executive)', async () => {
      const execRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/outreach/deliveries/${testDeliveryAId}/cancel`)
        .set('Cookie', execACookie)
        .send();

      expect(execRes.status).toBe(403);
      expect(execRes.body.error.code).toBe(ErrorCodes.FORBIDDEN);

      const viewerRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/outreach/deliveries/${testDeliveryAId}/cancel`)
        .set('Cookie', viewerACookie)
        .send();

      expect(viewerRes.status).toBe(403);
      expect(viewerRes.body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('3. Returns 200 and cancels delivery when user has OUTREACH_MANAGE (Sales Manager / Admin)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/outreach/deliveries/${testDeliveryAId}/cancel`)
        .set('Cookie', salesManagerACookie)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(OutreachDeliveryStatus.CANCELLED);
      expect(res.body.data.cancelledAt).toBeDefined();

      const updated = await prisma.outreachDelivery.findUnique({
        where: { id: testDeliveryAId }
      });
      expect(updated?.status).toBe(OutreachDeliveryStatus.CANCELLED);
    });

    it('4. Returns 409 OUTREACH_DELIVERY_IN_FLIGHT when delivery is already in PROCESSING', async () => {
      await prisma.outreachDelivery.update({
        where: { id: testDeliveryAId },
        data: { status: OutreachDeliveryStatus.PROCESSING }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/outreach/deliveries/${testDeliveryAId}/cancel`)
        .set('Cookie', adminACookie)
        .send();

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(OutreachErrorCode.OUTREACH_DELIVERY_IN_FLIGHT);
    });

    it('5. Idempotent repeat: returns 200 if delivery was already CANCELLED', async () => {
      await prisma.outreachDelivery.update({
        where: { id: testDeliveryAId },
        data: { status: OutreachDeliveryStatus.CANCELLED, cancelledAt: new Date() }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/outreach/deliveries/${testDeliveryAId}/cancel`)
        .set('Cookie', adminACookie)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(OutreachDeliveryStatus.CANCELLED);
    });

    it('6. Best-effort queue cleanup: returns 200 and leaves CANCELLED intact if queue removal throws', async () => {
      // Mock queue removal failure
      outreachService.setQueue({
        enqueue: async () => ({ jobId: 'mock-job' }),
        removeJob: async () => {
          throw new Error('Redis connection drop during queue cleanup');
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/outreach/deliveries/${testDeliveryAId}/cancel`)
        .set('Cookie', salesManagerACookie)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(OutreachDeliveryStatus.CANCELLED);
      expect(res.body.data.cancelledAt).toBeDefined();

      const updated = await prisma.outreachDelivery.findUnique({
        where: { id: testDeliveryAId }
      });
      expect(updated?.status).toBe(OutreachDeliveryStatus.CANCELLED);
      expect(updated?.cancelledAt).toBeDefined();
    });
  });

  describe('Part 2: Route Isolation Check (Proving NO public generic webhook route exists in Step 7)', () => {
    it('proves that POST /api/v1/outreach/webhooks/:provider is NOT registered in Step 7 (returns 404)', async () => {
      const res = await request(app)
        .post('/api/v1/outreach/webhooks/whatsapp')
        .send({
          eventId: 'evt-test-123',
          providerMessageId: 'prov-msg-123',
          eventType: 'DELIVERED'
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('proves that any POST /api/v1/outreach/* endpoint returns 404 (normalized processor is internal domain logic)', async () => {
      const res = await request(app)
        .post('/api/v1/outreach/webhooks')
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
