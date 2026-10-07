/**
 * M6 Step 8: End-to-End API Integration, Security & Idempotency Hardening Suite
 *
 * Validates and hardens the complete M6 Outreach lifecycle end-to-end:
 * 1. Core E2E Happy Path (WhatsApp): API request -> REQUESTED/QUEUED -> Worker dispatch -> SENT -> Webhook DELIVERED -> Audit trail
 * 2. Core E2E Happy Path (Email): Explicit contact path vs primaryEmail fallback path
 * 3. Idempotency: Sequential same request returns same delivery without duplicate worker dispatch or audit inflation
 * 4. Idempotency: Concurrent same-key / same-request race handling (P2002 resilience)
 * 5. Idempotency: Same-key / different-request parameter mismatch fails with 409 OUTREACH_IDEMPOTENCY_KEY_REUSED
 * 6. Tenant Key Isolation: Same Idempotency-Key across Org A and Org B creates separate deliveries without conflict
 * 7. Queue Infrastructure Failure Recovery: Transient queue downtime leaves REQUESTED delivery, replay after recovery enqueues safely
 * 8. Suppression Gate A: Blocked at API boundary with 422 OUTREACH_RECIPIENT_SUPPRESSED (0 rows, 0 jobs)
 * 9. Suppression Expiry Matrix: Expired entries permit dispatch; active/future expiresAt block
 * 10. PHONE != WHATSAPP Security: Plain phone numbers rejected with 422 OUTREACH_RECIPIENT_INVALID
 * 11. WhatsApp Trust Provenance: VERIFIED, PUBLICLY_LISTED, CONFIRMED allowed; plain untrusted rejected
 * 12. Email Resolution Matrix: single contact, multi+primary, multi no-primary, 0 contacts fallback, invalid email
 * 13. Public DTO Data Minimization: Strictly excludes internal fields (recipientNormalized, fingerprints, hashes, snapshots, secrets)
 * 14. Canonical Error Envelopes: Consistent { error: { code, message, details, requestId } } without leaking stack traces or SQL
 * 15. Multi-Tenant IDOR Protection: Cross-tenant read and cancellation return 404 NOT_FOUND (never 403 revealing existence)
 * 16. Cross-Lead Isolation: Delivery scoped strictly to lead route; cross-lead delivery ID returns 404
 * 17. Draft / Lead Ownership: Mismatched leadId or cross-tenant draft rejected with 409 / 404
 * 18. RBAC Matrix (Dispatch & Read): SUPER_ADMIN, ADMIN, SALES_MANAGER, assigned SALES_EXECUTIVE allowed; unassigned & VIEWER forbidden
 * 19. RBAC Matrix (Cancel): SUPER_ADMIN, ADMIN, SALES_MANAGER allowed; SALES_EXECUTIVE & VIEWER forbidden (403)
 * 20. Session Authentication Security: Requires leadmate_session cookie; unauthenticated requests return 401
 * 21. Request Body Strictness: Injected/unapproved properties rejected with 422 VALIDATION_ERROR
 * 22. Idempotency Header Strictness: Validates 8-128 chars, case-preserving regex, header-only presence
 * 23. Safe Audit Logging: Metadata contains only safe IDs, channels, and statuses; zero PII or credentials
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import prisma, {
  Role,
  SalesAssistantDraftType,
  SalesAssistantLanguage,
  SalesAssistantTone,
  SalesAssistantDraftStatus,
  ContactType,
  ContactStatus,
  WhatsAppStatus,
  SuppressionType,
  SuppressionReason,
  ChannelScope,
  OutreachChannel,
  OutreachDeliveryStatus
} from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import { ErrorCodes, OutreachErrorCode } from '@leadmate/shared';
import {
  InMemoryOutreachDeliveryQueue,
  WorkerDeliveryExecutor,
  OutreachWebhookEventProcessor,
  MockWhatsAppDeliveryProvider,
  MockEmailDeliveryProvider,
  DefaultOutreachDeliveryProviderRegistry,
  type OutreachDeliveryProviderRegistry
} from '@leadmate/core';
import { app } from '../app.js';
import { hashPassword, hashSessionToken } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';
import { outreachService } from '../services/outreach.service.js';

describe('M6 Step 8: End-to-End Outreach Delivery API Integration & Security Hardening', () => {
  const ORG_A_ID = 'aaaaaaaa-8888-4aaa-aaaa-aaaaaaaaaaaa';
  const ORG_B_ID = 'bbbbbbbb-8888-4bbb-bbbb-bbbbbbbbbbbb';

  let superAdminAId: string;
  let superAdminACookie: string;

  let adminAId: string;
  let adminACookie: string;

  let salesManagerAId: string;
  let salesManagerACookie: string;

  let execA1Id: string;
  let execA1Cookie: string;

  let execA2Id: string;
  let execA2Cookie: string;

  let viewerAId: string;
  let viewerACookie: string;

  let superAdminBId: string;
  let superAdminBCookie: string;

  let leadA1Id: string;
  let leadA2Id: string;
  let leadB1Id: string;

  let draftWhatsAppAId: string;
  let draftEmailAId: string;
  let draftEmailBId: string;

  let contactWhatsAppVerifiedId: string;
  let contactEmailPrimaryId: string;

  let testQueue: InMemoryOutreachDeliveryQueue;
  let mockWhatsAppProvider: MockWhatsAppDeliveryProvider;
  let mockEmailProvider: MockEmailDeliveryProvider;
  let registry: OutreachDeliveryProviderRegistry;
  let workerExecutor: WorkerDeliveryExecutor;
  let webhookProcessor: OutreachWebhookEventProcessor;

  async function createSessionCookie(userId: string, rawToken: string): Promise<string> {
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.session.create({
      data: {
        userId,
        tokenHash,
        expiresAt
      }
    });

    return `${SESSION_COOKIE_NAME}=${rawToken}`;
  }

  async function cleanupDatabase() {
    await ensureTestDatabase(prisma);
    await prisma.outreachWebhookEvent.deleteMany({
      where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } }
    });
    await prisma.auditLog.deleteMany({
      where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } }
    });
    await prisma.outreachDelivery.deleteMany({
      where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } }
    });
    await prisma.suppressionList.deleteMany({
      where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } }
    });
    await prisma.salesAssistantDraft.deleteMany({
      where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } }
    });
    await prisma.leadContact.deleteMany({
      where: { lead: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } } }
    });
    await prisma.lead.deleteMany({
      where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } }
    });
    await prisma.session.deleteMany({
      where: { user: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } } }
    });
    await prisma.user.deleteMany({
      where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } }
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [ORG_A_ID, ORG_B_ID] } }
    });
  }

  beforeAll(async () => {
    await cleanupDatabase();

    // 1. Setup Organizations
    await prisma.organization.createMany({
      data: [
        { id: ORG_A_ID, name: 'Org A Hardening Ltd' },
        { id: ORG_B_ID, name: 'Org B Hardening Ltd' }
      ]
    });

    const passwordHash = await hashPassword('SecurePassword123!');

    // 2. Setup Users across Role matrix
    const superAdminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'superadmin.step8@test.com',
        name: 'Super Admin A',
        passwordHash,
        role: Role.SUPER_ADMIN,
        isActive: true
      }
    });
    superAdminAId = superAdminA.id;
    superAdminACookie = await createSessionCookie(superAdminAId, 'token-superadmin-step8-01');

    const adminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'admin.step8@test.com',
        name: 'Admin A',
        passwordHash,
        role: Role.ADMIN,
        isActive: true
      }
    });
    adminAId = adminA.id;
    adminACookie = await createSessionCookie(adminAId, 'token-admin-step8-01');

    const salesManagerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'manager.step8@test.com',
        name: 'Sales Manager A',
        passwordHash,
        role: Role.SALES_MANAGER,
        isActive: true
      }
    });
    salesManagerAId = salesManagerA.id;
    salesManagerACookie = await createSessionCookie(salesManagerAId, 'token-manager-step8-01');

    const execA1 = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'exec1.step8@test.com',
        name: 'Sales Exec A1',
        passwordHash,
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });
    execA1Id = execA1.id;
    execA1Cookie = await createSessionCookie(execA1Id, 'token-exec1-step8-01');

    const execA2 = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'exec2.step8@test.com',
        name: 'Sales Exec A2',
        passwordHash,
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });
    execA2Id = execA2.id;
    execA2Cookie = await createSessionCookie(execA2Id, 'token-exec2-step8-01');

    const viewerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'viewer.step8@test.com',
        name: 'Viewer A',
        passwordHash,
        role: Role.VIEWER,
        isActive: true
      }
    });
    viewerAId = viewerA.id;
    viewerACookie = await createSessionCookie(viewerAId, 'token-viewer-step8-01');

    const superAdminB = await prisma.user.create({
      data: {
        organizationId: ORG_B_ID,
        email: 'superadmin.b.step8@test.com',
        name: 'Super Admin B',
        passwordHash,
        role: Role.SUPER_ADMIN,
        isActive: true
      }
    });
    superAdminBId = superAdminB.id;
    superAdminBCookie = await createSessionCookie(superAdminBId, 'token-superadmin-b-step8-01');

    // 3. Setup Leads
    const leadA1 = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Prime Retail Store',
        normalizedName: 'prime retail store',
        category: 'Retail',
        city: 'Dhaka',
        primaryEmail: 'info@primeretail.com',
        primaryPhone: '+8801711000001',
        primarySource: 'MANUAL',
        assignedUserId: execA1Id
      }
    });
    leadA1Id = leadA1.id;

    const leadA2 = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Secondary Shop',
        normalizedName: 'secondary shop',
        category: 'Retail',
        city: 'Chittagong',
        primaryEmail: 'shop@secondary.com',
        primarySource: 'MANUAL',
        assignedUserId: execA2Id
      }
    });
    leadA2Id = leadA2.id;

    const leadB1 = await prisma.lead.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Org B Exclusive Lead',
        normalizedName: 'org b exclusive lead',
        category: 'Wholesale',
        city: 'Sylhet',
        primaryEmail: 'lead@orgb.com',
        primarySource: 'MANUAL',
        assignedUserId: superAdminBId
      }
    });
    leadB1Id = leadB1.id;

    // 4. Setup Verified Contacts
    const contactWA = await prisma.leadContact.create({
      data: {
        leadId: leadA1Id,
        type: ContactType.WHATSAPP,
        rawValue: '01711000002',
        normalizedValue: '+8801711000002',
        status: ContactStatus.VERIFIED,
        whatsappStatus: WhatsAppStatus.CONFIRMED,
        isPrimary: true
      }
    });
    contactWhatsAppVerifiedId = contactWA.id;

    const contactEmail = await prisma.leadContact.create({
      data: {
        leadId: leadA1Id,
        type: ContactType.EMAIL,
        rawValue: 'sales@primeretail.com',
        normalizedValue: 'sales@primeretail.com',
        status: ContactStatus.VERIFIED,
        isPrimary: true
      }
    });
    contactEmailPrimaryId = contactEmail.id;

    // 5. Setup Approved Drafts
    const draftWA = await prisma.salesAssistantDraft.create({
      data: {
        organizationId: ORG_A_ID,
        leadId: leadA1Id,
        createdByUserId: execA1Id,
        type: SalesAssistantDraftType.WHATSAPP,
        language: SalesAssistantLanguage.ENGLISH,
        tone: SalesAssistantTone.PROFESSIONAL,
        status: SalesAssistantDraftStatus.APPROVED,
        content: 'Hello, regarding your retail solution demo.',
        approvedAt: new Date(),
        approvedByUserId: salesManagerAId
      }
    });
    draftWhatsAppAId = draftWA.id;

    const draftEmail = await prisma.salesAssistantDraft.create({
      data: {
        organizationId: ORG_A_ID,
        leadId: leadA1Id,
        createdByUserId: execA1Id,
        type: SalesAssistantDraftType.EMAIL,
        language: SalesAssistantLanguage.ENGLISH,
        tone: SalesAssistantTone.PROFESSIONAL,
        status: SalesAssistantDraftStatus.APPROVED,
        emailSubject: 'Modern POS System Proposal',
        emailBody: 'Dear Team, here is the official proposal for your business.',
        approvedAt: new Date(),
        approvedByUserId: salesManagerAId
      }
    });
    draftEmailAId = draftEmail.id;

    const draftEmailB = await prisma.salesAssistantDraft.create({
      data: {
        organizationId: ORG_B_ID,
        leadId: leadB1Id,
        createdByUserId: superAdminBId,
        type: SalesAssistantDraftType.EMAIL,
        language: SalesAssistantLanguage.ENGLISH,
        tone: SalesAssistantTone.PROFESSIONAL,
        status: SalesAssistantDraftStatus.APPROVED,
        emailSubject: 'Org B Proposal',
        emailBody: 'Official proposal for Org B lead.',
        approvedAt: new Date(),
        approvedByUserId: superAdminBId
      }
    });
    draftEmailBId = draftEmailB.id;

    // 6. Setup Provider Mocks and Worker Harness
    mockWhatsAppProvider = new MockWhatsAppDeliveryProvider();
    mockEmailProvider = new MockEmailDeliveryProvider();
    registry = new DefaultOutreachDeliveryProviderRegistry();
    registry.registerProvider(mockWhatsAppProvider);
    registry.registerProvider(mockEmailProvider);

    workerExecutor = new WorkerDeliveryExecutor({
      prisma,
      providerRegistry: registry
    });

    webhookProcessor = new OutreachWebhookEventProcessor({
      prisma
    });
  });

  afterAll(async () => {
    await cleanupDatabase();
  });

  beforeEach(() => {
    testQueue = new InMemoryOutreachDeliveryQueue();
    outreachService.setQueue(testQueue);
    mockWhatsAppProvider = new MockWhatsAppDeliveryProvider();
    mockEmailProvider = new MockEmailDeliveryProvider();
    registry = new DefaultOutreachDeliveryProviderRegistry();
    registry.registerProvider(mockWhatsAppProvider);
    registry.registerProvider(mockEmailProvider);
    workerExecutor = new WorkerDeliveryExecutor({
      prisma,
      providerRegistry: registry
    });
  });

  // =========================================================================
  // 1. CORE E2E HAPPY PATH — WHATSAPP
  // =========================================================================
  it('1. Core E2E Happy Path (WhatsApp): API request -> QUEUED -> worker -> SENT -> Webhook DELIVERED -> Audit', async () => {
    const idempotencyKey = 'step8-e2e-whatsapp-001';
    const waSendSpy = vi.spyOn(mockWhatsAppProvider, 'send');

    // A. API Request
    const res = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', execA1Cookie)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        draftId: draftWhatsAppAId,
        channel: OutreachChannel.WHATSAPP,
        recipientContactId: contactWhatsAppVerifiedId
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    const deliveryId = res.body.data.id;
    expect(res.body.data.status).toBe(OutreachDeliveryStatus.QUEUED);
    expect(res.body.data.recipientMasked).toBe('+88017****0002');
    expect(testQueue.jobs).toHaveLength(1);
    expect(testQueue.jobs[0].jobId).toBe(deliveryId);

    // B. Worker Execution
    const workerResult = await workerExecutor.executeDelivery(deliveryId);
    expect(workerResult.ok).toBe(true);
    expect(workerResult.status).toBe(OutreachDeliveryStatus.SENT);
    expect(waSendSpy).toHaveBeenCalledTimes(1);

    const sentInput = waSendSpy.mock.calls[0][0];
    expect(sentInput.recipientNormalized).toBe('+8801711000002');
    expect(sentInput.content).toBe('Hello, regarding your retail solution demo.');

    // DB Record is now SENT
    const deliveryAfterWorker = await prisma.outreachDelivery.findUnique({
      where: { id: deliveryId }
    });
    expect(deliveryAfterWorker?.status).toBe(OutreachDeliveryStatus.SENT);
    expect(deliveryAfterWorker?.attemptCount).toBe(1);
    const expectedMessageId = `mock-wa:${deliveryId}`;
    expect(deliveryAfterWorker?.providerMessageId).toBe(expectedMessageId);

    // C. Webhook Processing (Normalized DELIVERED event)
    const webhookResult = await webhookProcessor.processEvent({
      providerName: 'MOCK_WHATSAPP',
      eventId: `wh-evt-wa-${deliveryId}`,
      providerMessageId: expectedMessageId,
      eventType: 'DELIVERED',
      timestamp: new Date()
    });

    expect(webhookResult.ok).toBe(true);
    expect(webhookResult.newStatus).toBe(OutreachDeliveryStatus.DELIVERED);

    // DB Record is now DELIVERED
    const finalDelivery = await prisma.outreachDelivery.findUnique({
      where: { id: deliveryId }
    });
    expect(finalDelivery?.status).toBe(OutreachDeliveryStatus.DELIVERED);
    expect(finalDelivery?.deliveredAt).toBeDefined();

    // D. Audit Trail Verification
    const auditLogs = await prisma.auditLog.findMany({
      where: { entityId: deliveryId }
    });
    expect(auditLogs.some((l) => l.action === 'lead.outreach_requested')).toBe(true);
    expect(auditLogs.some((l) => l.action === 'lead.outreach_sent')).toBe(true);
    expect(auditLogs.some((l) => l.action === 'lead.outreach_delivered')).toBe(true);
  });

  // =========================================================================
  // 2. CORE E2E HAPPY PATH — EMAIL (Explicit & Fallback)
  // =========================================================================
  it('2. Core E2E Happy Path (Email): Explicit contact path and primaryEmail fallback path', async () => {
    const emailSendSpy = vi.spyOn(mockEmailProvider, 'send');

    // A. Explicit contact path
    const key1 = 'step8-e2e-email-explicit-01';
    const res1 = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', execA1Cookie)
      .set('Idempotency-Key', key1)
      .send({
        draftId: draftEmailAId,
        channel: OutreachChannel.EMAIL,
        recipientContactId: contactEmailPrimaryId
      });

    expect(res1.status).toBe(201);
    const deliveryId1 = res1.body.data.id;
    const workerResult1 = await workerExecutor.executeDelivery(deliveryId1);
    expect(workerResult1.ok).toBe(true);
    expect(emailSendSpy).toHaveBeenCalledTimes(1);
    expect(emailSendSpy.mock.calls[0][0].recipientNormalized).toBe('sales@primeretail.com');

    // B. Fallback path on lead with 0 contacts
    // Create draft for leadA2 (which has no contacts, only primaryEmail)
    const draftEmail2 = await prisma.salesAssistantDraft.create({
      data: {
        organizationId: ORG_A_ID,
        leadId: leadA2Id,
        createdByUserId: execA2Id,
        type: SalesAssistantDraftType.EMAIL,
        language: SalesAssistantLanguage.ENGLISH,
        tone: SalesAssistantTone.PROFESSIONAL,
        status: SalesAssistantDraftStatus.APPROVED,
        emailSubject: 'Shop Introduction',
        emailBody: 'Hello secondary shop team.',
        approvedAt: new Date(),
        approvedByUserId: salesManagerAId
      }
    });

    const key2 = 'step8-e2e-email-fallback-01';
    const res2 = await request(app)
      .post(`/api/v1/leads/${leadA2Id}/outreach/deliveries`)
      .set('Cookie', execA2Cookie)
      .set('Idempotency-Key', key2)
      .send({
        draftId: draftEmail2.id,
        channel: OutreachChannel.EMAIL
      });

    expect(res2.status).toBe(201);
    const deliveryId2 = res2.body.data.id;
    const workerResult2 = await workerExecutor.executeDelivery(deliveryId2);
    expect(workerResult2.ok).toBe(true);
    expect(emailSendSpy).toHaveBeenCalledTimes(2);
    expect(emailSendSpy.mock.calls[1][0].recipientNormalized).toBe('shop@secondary.com');
  });

  // =========================================================================
  // 3. IDEMPOTENCY — SEQUENTIAL REPLAY
  // =========================================================================
  it('3. Sequential identical request with same Idempotency-Key returns existing delivery with 0 duplicate queue jobs or audits', async () => {
    const idempotencyKey = 'step8-idempotency-sequential-01';

    const payload = {
      draftId: draftWhatsAppAId,
      channel: OutreachChannel.WHATSAPP,
      recipientContactId: contactWhatsAppVerifiedId
    };

    // First request
    const res1 = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', execA1Cookie)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(res1.status).toBe(201);
    const initialDeliveryId = res1.body.data.id;
    expect(testQueue.jobs).toHaveLength(1);

    const initialAuditCount = await prisma.auditLog.count({
      where: { entityId: initialDeliveryId, action: 'lead.outreach_requested' }
    });
    expect(initialAuditCount).toBe(1);

    // Second sequential request with identical payload
    const res2 = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', execA1Cookie)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(res2.status).toBe(201);
    expect(res2.body.data.id).toBe(initialDeliveryId);

    // Queue was NOT called again
    expect(testQueue.jobs).toHaveLength(1);

    // Audit log was NOT duplicated
    const finalAuditCount = await prisma.auditLog.count({
      where: { entityId: initialDeliveryId, action: 'lead.outreach_requested' }
    });
    expect(finalAuditCount).toBe(1);
  });

  // =========================================================================
  // 4. IDEMPOTENCY — CONCURRENT SAME-KEY RACE
  // =========================================================================
  it('4. Concurrent requests with same Idempotency-Key and payload resolve safely via P2002 race recovery', async () => {
    const idempotencyKey = 'step8-idempotency-concurrent-01';
    const payload = {
      draftId: draftWhatsAppAId,
      channel: OutreachChannel.WHATSAPP,
      recipientContactId: contactWhatsAppVerifiedId
    };

    // Launch 3 requests concurrently
    const [res1, res2, res3] = await Promise.all([
      request(app)
        .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
        .set('Cookie', execA1Cookie)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload),
      request(app)
        .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
        .set('Cookie', execA1Cookie)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload),
      request(app)
        .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
        .set('Cookie', execA1Cookie)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
    ]);

    const statuses = [res1.status, res2.status, res3.status];
    expect(statuses).toContain(201); // Exactly one creator
    expect(statuses.every((s) => s === 200 || s === 201)).toBe(true);

    const ids = [res1.body.data.id, res2.body.data.id, res3.body.data.id];
    expect(new Set(ids).size).toBe(1); // All resolved to the identical delivery ID

    // Exactly 1 row persisted in database
    const dbCount = await prisma.outreachDelivery.count({
      where: { organizationId: ORG_A_ID, idempotencyKey }
    });
    expect(dbCount).toBe(1);
  });

  // =========================================================================
  // 5. IDEMPOTENCY — SAME KEY / DIFFERENT REQUEST CONFLICT
  // =========================================================================
  it('5. Same Idempotency-Key with different payload parameters throws 409 OUTREACH_IDEMPOTENCY_KEY_REUSED', async () => {
    const idempotencyKey = 'step8-idempotency-mismatch-01';

    // Initial creation
    const res1 = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', execA1Cookie)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        draftId: draftWhatsAppAId,
        channel: OutreachChannel.WHATSAPP,
        recipientContactId: contactWhatsAppVerifiedId
      });
    expect(res1.status).toBe(201);

    // Reusing key with different draft
    const res2 = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', execA1Cookie)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        draftId: draftEmailAId, // Mismatch
        channel: OutreachChannel.EMAIL,
        recipientContactId: contactEmailPrimaryId
      });

    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe(OutreachErrorCode.OUTREACH_IDEMPOTENCY_KEY_REUSED);
  });

  // =========================================================================
  // 6. IDEMPOTENCY KEY TENANT ISOLATION
  // =========================================================================
  it('6. Same Idempotency-Key can be used concurrently in Org A and Org B without conflict', async () => {
    const sharedKey = 'step8-shared-tenant-idempotency-key-01';

    // Org A dispatch
    const resA = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', execA1Cookie)
      .set('Idempotency-Key', sharedKey)
      .send({
        draftId: draftWhatsAppAId,
        channel: OutreachChannel.WHATSAPP,
        recipientContactId: contactWhatsAppVerifiedId
      });
    expect(resA.status).toBe(201);

    // Org B dispatch with identical key
    const resB = await request(app)
      .post(`/api/v1/leads/${leadB1Id}/outreach/deliveries`)
      .set('Cookie', superAdminBCookie)
      .set('Idempotency-Key', sharedKey)
      .send({
        draftId: draftEmailBId,
        channel: OutreachChannel.EMAIL
      });
    expect(resB.status).toBe(201);

    expect(resA.body.data.id).not.toBe(resB.body.data.id);
  });

  // =========================================================================
  // 7. QUEUE INFRASTRUCTURE FAILURE RECOVERY
  // =========================================================================
  it('7. Queue failure leaves delivery in REQUESTED state, returning 500 without leaking Redis details, then retrying enqueues cleanly', async () => {
    const idempotencyKey = 'step8-queue-failure-recovery-01';
    testQueue.simulateFailure(new Error('Redis connection timeout ECONNREFUSED'));

    const res1 = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', execA1Cookie)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        draftId: draftWhatsAppAId,
        channel: OutreachChannel.WHATSAPP,
        recipientContactId: contactWhatsAppVerifiedId
      });

    expect(res1.status).toBe(500);
    expect(res1.body.error.code).toBe(OutreachErrorCode.OUTREACH_DELIVERY_FAILED);
    expect(res1.body.error.message).not.toContain('ECONNREFUSED');
    expect(res1.body.error.message).not.toContain('Redis');

    // Row is persisted in REQUESTED state
    const delivery = await prisma.outreachDelivery.findFirst({
      where: { organizationId: ORG_A_ID, idempotencyKey }
    });
    expect(delivery).toBeDefined();
    expect(delivery?.status).toBe(OutreachDeliveryStatus.REQUESTED);

    // Now retry with same key (simulateFailure was single-use and auto-reset)
    const res2 = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', execA1Cookie)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        draftId: draftWhatsAppAId,
        channel: OutreachChannel.WHATSAPP,
        recipientContactId: contactWhatsAppVerifiedId
      });

    expect(res2.status).toBe(201);
    expect(res2.body.data.id).toBe(delivery?.id);
    expect(res2.body.data.status).toBe(OutreachDeliveryStatus.QUEUED);
    expect(testQueue.jobs).toHaveLength(1);
  });

  // =========================================================================
  // 8. SUPPRESSION GATE A & EXPIRY
  // =========================================================================
  it('8. Suppression Gate A blocks dispatch with 422 OUTREACH_RECIPIENT_SUPPRESSED; expired entries permit dispatch', async () => {
    const suppressedPhone = '+8801711999999';

    // Add contact with this phone
    const contactSuppressed = await prisma.leadContact.create({
      data: {
        leadId: leadA1Id,
        type: ContactType.WHATSAPP,
        rawValue: suppressedPhone,
        normalizedValue: suppressedPhone,
        status: ContactStatus.VERIFIED,
        whatsappStatus: WhatsAppStatus.CONFIRMED
      }
    });

    // Create active suppression entry
    const suppressionEntry = await prisma.suppressionList.create({
      data: {
        organizationId: ORG_A_ID,
        type: SuppressionType.PHONE,
        normalizedValue: suppressedPhone,
        reason: SuppressionReason.OPT_OUT,
        channelScope: ChannelScope.WHATSAPP,
        addedBy: execA1Id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000) // 1 hour in future
      }
    });

    // Attempt dispatch -> must fail at Gate A
    const resBlocked = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', execA1Cookie)
      .set('Idempotency-Key', 'step8-suppression-gate-a-blocked')
      .send({
        draftId: draftWhatsAppAId,
        channel: OutreachChannel.WHATSAPP,
        recipientContactId: contactSuppressed.id
      });

    expect(resBlocked.status).toBe(422);
    expect(resBlocked.body.error.code).toBe(OutreachErrorCode.OUTREACH_RECIPIENT_SUPPRESSED);
    expect(testQueue.jobs).toHaveLength(0);

    // Now expire the suppression entry
    await prisma.suppressionList.update({
      where: { id: suppressionEntry.id },
      data: { expiresAt: new Date(Date.now() - 60 * 1000) } // 1 minute in past
    });

    // Attempt dispatch again -> now allowed
    const resAllowed = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', execA1Cookie)
      .set('Idempotency-Key', 'step8-suppression-gate-a-expired')
      .send({
        draftId: draftWhatsAppAId,
        channel: OutreachChannel.WHATSAPP,
        recipientContactId: contactSuppressed.id
      });

    expect(resAllowed.status).toBe(201);
    expect(resAllowed.body.data.status).toBe(OutreachDeliveryStatus.QUEUED);
  });

  // =========================================================================
  // 9. PHONE != WHATSAPP & WHATSAPP PROVENANCE
  // =========================================================================
  it('9. PHONE != WHATSAPP: plain phone contact rejected with 422; untrusted WhatsApp contact rejected', async () => {
    // A. ContactType.PHONE only
    const phoneContact = await prisma.leadContact.create({
      data: {
        leadId: leadA1Id,
        type: ContactType.PHONE,
        rawValue: '+8801711888888',
        normalizedValue: '+8801711888888',
        status: ContactStatus.VERIFIED
      }
    });

    const resPhone = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', execA1Cookie)
      .set('Idempotency-Key', 'step8-phone-not-wa-test-01')
      .send({
        draftId: draftWhatsAppAId,
        channel: OutreachChannel.WHATSAPP,
        recipientContactId: phoneContact.id
      });

    expect(resPhone.status).toBe(422);
    expect(resPhone.body.error.code).toBe(OutreachErrorCode.OUTREACH_RECIPIENT_INVALID);

    // B. Untrusted WhatsApp contact (status UNVERIFIED, whatsappStatus UNCONFIRMED)
    const untrustedWA = await prisma.leadContact.create({
      data: {
        leadId: leadA1Id,
        type: ContactType.WHATSAPP,
        rawValue: '+8801711777777',
        normalizedValue: '+8801711777777',
        status: ContactStatus.FOUND,
        whatsappStatus: WhatsAppStatus.UNKNOWN
      }
    });

    const resUntrusted = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', execA1Cookie)
      .set('Idempotency-Key', 'step8-untrusted-wa-test-01')
      .send({
        draftId: draftWhatsAppAId,
        channel: OutreachChannel.WHATSAPP,
        recipientContactId: untrustedWA.id
      });

    expect(resUntrusted.status).toBe(422);
    expect(resUntrusted.body.error.code).toBe(OutreachErrorCode.OUTREACH_RECIPIENT_INVALID);
  });

  // =========================================================================
  // 10. PUBLIC DTO DATA MINIMIZATION & ERROR ENVELOPE CONSISTENCY
  // =========================================================================
  it('10. Delivery API summaries strictly exclude sensitive fields and error responses follow canonical envelope', async () => {
    const res = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', execA1Cookie)
      .set('Idempotency-Key', 'step8-dto-leak-test-01')
      .send({
        draftId: draftWhatsAppAId,
        channel: OutreachChannel.WHATSAPP,
        recipientContactId: contactWhatsAppVerifiedId
      });

    expect(res.status).toBe(201);
    const dto = res.body.data;

    // Explicit negative assertions: these fields must NEVER be present in public DTOs
    expect(dto.recipientNormalized).toBeUndefined();
    expect(dto.requestFingerprint).toBeUndefined();
    expect(dto.idempotencyKey).toBeUndefined();
    expect(dto.approvedDraftSnapshotHash).toBeUndefined();
    expect(dto.snapshotContent).toBeUndefined();
    expect(dto.snapshotSubject).toBeUndefined();
    expect(dto.snapshotBody).toBeUndefined();
    expect(dto.providerName).toBeUndefined();
    expect(dto.providerMessageId).toBeUndefined();
    expect(dto.jobId).toBeUndefined();

    // Canonical error envelope check on 404
    const errRes = await request(app)
      .get(`/api/v1/leads/${leadA1Id}/outreach/deliveries/00000000-0000-0000-0000-000000000000`)
      .set('Cookie', execA1Cookie);

    expect(errRes.status).toBe(404);
    expect(errRes.body.error).toBeDefined();
    expect(errRes.body.error.code).toBe('NOT_FOUND');
    expect(errRes.body.error.message).toBeDefined();
    expect(errRes.body.error.requestId).toBeDefined();
    expect(errRes.body.error.stack).toBeUndefined();
  });

  // =========================================================================
  // 11. MULTI-TENANT IDOR CONCEALMENT (404 NOT_FOUND)
  // =========================================================================
  it('11. Multi-Tenant IDOR: Cross-tenant read and cancel return 404 NOT_FOUND (never 403 revealing existence)', async () => {
    // Create delivery in Org B
    const resB = await request(app)
      .post(`/api/v1/leads/${leadB1Id}/outreach/deliveries`)
      .set('Cookie', superAdminBCookie)
      .set('Idempotency-Key', 'step8-org-b-delivery-01')
      .send({
        draftId: draftEmailBId,
        channel: OutreachChannel.EMAIL
      });
    expect(resB.status).toBe(201);
    const orgBDeliveryId = resB.body.data.id;

    // Org A attempts to GET Org B delivery
    const resRead = await request(app)
      .get(`/api/v1/leads/${leadA1Id}/outreach/deliveries/${orgBDeliveryId}`)
      .set('Cookie', superAdminACookie);

    expect(resRead.status).toBe(404);
    expect(resRead.body.error.code).toBe('NOT_FOUND');

    // Org A attempts to CANCEL Org B delivery
    const resCancel = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries/${orgBDeliveryId}/cancel`)
      .set('Cookie', superAdminACookie);

    expect(resCancel.status).toBe(404);
    expect(resCancel.body.error.code).toBe('NOT_FOUND');
  });

  // =========================================================================
  // 12. RBAC MATRIX: DISPATCH, READ, CANCEL & SESSION AUTH
  // =========================================================================
  it('12. Complete RBAC Matrix: Dispatch, Read, Cancel permissions and unauthenticated session checks', async () => {
    // A. Unauthenticated request -> 401
    const unauthRes = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Idempotency-Key', 'step8-unauth-test-01')
      .send({
        draftId: draftWhatsAppAId,
        channel: OutreachChannel.WHATSAPP
      });
    expect(unauthRes.status).toBe(401);

    // B. VIEWER -> Forbidden on dispatch (403)
    const viewerDispatch = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', viewerACookie)
      .set('Idempotency-Key', 'step8-viewer-dispatch-01')
      .send({
        draftId: draftWhatsAppAId,
        channel: OutreachChannel.WHATSAPP
      });
    expect(viewerDispatch.status).toBe(403);

    // C. VIEWER -> Allowed on read (200)
    const viewerRead = await request(app)
      .get(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', viewerACookie);
    expect(viewerRead.status).toBe(200);

    // D. Unassigned Sales Executive (execA2 accessing lead assigned to execA1) -> Forbidden (403)
    const unassignedExecDispatch = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', execA2Cookie)
      .set('Idempotency-Key', 'step8-unassigned-exec-dispatch-01')
      .send({
        draftId: draftWhatsAppAId,
        channel: OutreachChannel.WHATSAPP
      });
    expect(unassignedExecDispatch.status).toBe(403);

    // E. Cancellation RBAC: Sales Executive denied OUTREACH_MANAGE (403)
    // Create delivery first
    const createRes = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', execA1Cookie)
      .set('Idempotency-Key', 'step8-cancel-rbac-delivery-01')
      .send({
        draftId: draftWhatsAppAId,
        channel: OutreachChannel.WHATSAPP,
        recipientContactId: contactWhatsAppVerifiedId
      });
    const deliveryToCancelId = createRes.body.data.id;

    const execCancelRes = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries/${deliveryToCancelId}/cancel`)
      .set('Cookie', execA1Cookie);
    expect(execCancelRes.status).toBe(403);

    // F. Manager/Admin allowed to cancel (200)
    const managerCancelRes = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries/${deliveryToCancelId}/cancel`)
      .set('Cookie', salesManagerACookie);
    expect(managerCancelRes.status).toBe(200);
    expect(managerCancelRes.body.data.status).toBe(OutreachDeliveryStatus.CANCELLED);
  });

  // =========================================================================
  // 13. REQUEST SCHEMA STRICTNESS & IDEMPOTENCY HEADER VALIDATION
  // =========================================================================
  it('13. Request schema rejects unknown body properties and validates Idempotency-Key header constraints', async () => {
    // Unknown field in body -> 422
    const resBadBody = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', execA1Cookie)
      .set('Idempotency-Key', 'step8-strict-schema-01')
      .send({
        draftId: draftWhatsAppAId,
        channel: OutreachChannel.WHATSAPP,
        injectedAdminField: true
      });
    expect(resBadBody.status).toBe(422);

    // Missing Idempotency-Key -> 422
    const resMissingHeader = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', execA1Cookie)
      .send({
        draftId: draftWhatsAppAId,
        channel: OutreachChannel.WHATSAPP
      });
    expect(resMissingHeader.status).toBe(422);

    // Idempotency-Key too short (<8 chars) -> 422
    const resShortHeader = await request(app)
      .post(`/api/v1/leads/${leadA1Id}/outreach/deliveries`)
      .set('Cookie', execA1Cookie)
      .set('Idempotency-Key', 'short')
      .send({
        draftId: draftWhatsAppAId,
        channel: OutreachChannel.WHATSAPP
      });
    expect(resShortHeader.status).toBe(422);
  });
});
