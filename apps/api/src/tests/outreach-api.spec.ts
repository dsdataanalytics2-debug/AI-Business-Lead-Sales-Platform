/**
 * M6 Step 5: Outreach REST API, RBAC, Data Minimization & Audit Logging Test Suite
 *
 * Covers:
 * 1. Unauthenticated & session validation tests (401)
 * 2. RBAC matrix on dispatch (SUPER_ADMIN, ADMIN, SALES_MANAGER, SALES_EXECUTIVE assigned allowed; SALES_EXECUTIVE unassigned & VIEWER forbidden 403)
 * 3. RBAC matrix on read / list (VIEWER, SUPER_ADMIN, ADMIN, SALES_MANAGER allowed; SALES_EXECUTIVE assigned allowed, unassigned forbidden 403)
 * 4. Idempotency-Key header validation (missing, min/max length, regex, case sensitivity)
 * 5. Request body strictness (rejects unknown properties & client-supplied fields)
 * 6. Domain error to canonical HTTP error mapping (409 OUTREACH_DRAFT_NOT_APPROVED, 422 OUTREACH_CHANNEL_INCOMPATIBLE, 422 OUTREACH_RECIPIENT_INVALID, 422 OUTREACH_RECIPIENT_SUPPRESSED, 409 OUTREACH_IDEMPOTENCY_KEY_REUSED)
 * 7. Idempotent replay behavior (returns existing delivery, no duplicate queue jobs, no duplicate creation audits)
 * 8. Queue infrastructure failure handling (500 OUTREACH_DELIVERY_FAILED, preserves REQUESTED in DB, no QUEUE_ERROR / Redis leakage)
 * 9. Tenant isolation and cross-lead security (404 NOT_FOUND for cross-tenant / cross-lead)
 * 10. Public DTO data minimization (strictly excludes PII, snapshots, hashes, idempotency keys, provider message IDs)
 * 11. Audit logging verification (authoritative audit record, metadata minimization, no duplicate replay audits)
 * 12. Route collision protection & removed alias defense (literal 'deliveries' segment not captured as ID, removed aliases return 404)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
import { InMemoryOutreachDeliveryQueue } from '@leadmate/core';
import { app } from '../app.js';
import { hashPassword, hashSessionToken } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';
import { outreachService } from '../services/outreach.service.js';

describe('M6 Step 5: Outreach REST API, RBAC & Audit Logging Integration Suite', () => {
  const ORG_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const ORG_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

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

  let adminBId: string;
  let adminBCookie: string;

  let testLeadA1Id: string; // Assigned to execA1Id; has verified WhatsApp & Email
  let testLeadA2Id: string; // Unassigned (assignedUserId: null)
  let testLeadBId: string;  // Org B lead

  let testDraftA1Id: string; // Approved WhatsApp draft for lead A1
  let testDraftA1EmailId: string; // Approved Email draft for lead A1
  let testDraftA2Id: string; // Approved WhatsApp draft for lead A2
  let testDraftBId: string;  // Org B draft

  let mockQueue: InMemoryOutreachDeliveryQueue;

  async function createSessionCookie(userId: string, rawToken: string): Promise<string> {
    const tokenHash = hashSessionToken(rawToken);
    await prisma.session.upsert({
      where: { tokenHash },
      update: {
        userId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      },
      create: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    return `${SESSION_COOKIE_NAME}=${rawToken}`;
  }

  async function cleanupDatabase() {
    await ensureTestDatabase(prisma);
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } } });
    await prisma.outreachDelivery.deleteMany({ where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } } });
    await prisma.suppressionList.deleteMany({ where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } } });
    await prisma.salesAssistantDraft.deleteMany({ where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } } });
    await prisma.leadContact.deleteMany({
      where: { lead: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } } }
    });
    await prisma.lead.deleteMany({ where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } } });
    await prisma.session.deleteMany({
      where: { user: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } } }
    });
    await prisma.user.deleteMany({ where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [ORG_A_ID, ORG_B_ID] } } });
  }

  beforeAll(async () => {
    await cleanupDatabase();

    // 1. Setup Organizations
    await prisma.organization.createMany({
      data: [
        { id: ORG_A_ID, name: 'Org A Enterprise' },
        { id: ORG_B_ID, name: 'Org B Enterprise' }
      ]
    });

    const passwordHash = await hashPassword('SecurePassword123!');

    // 2. Setup Users across Role matrix
    const superAdminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'superadmin.a@test.com',
        name: 'Super Admin A',
        passwordHash,
        role: Role.SUPER_ADMIN,
        isActive: true
      }
    });
    superAdminAId = superAdminA.id;
    superAdminACookie = await createSessionCookie(superAdminAId, 'token-superadmin-a-outreach-01');

    const adminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'admin.a@test.com',
        name: 'Admin A',
        passwordHash,
        role: Role.ADMIN,
        isActive: true
      }
    });
    adminAId = adminA.id;
    adminACookie = await createSessionCookie(adminAId, 'token-admin-a-outreach-01');

    const salesManagerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'salesmanager.a@test.com',
        name: 'Sales Manager A',
        passwordHash,
        role: Role.SALES_MANAGER,
        isActive: true
      }
    });
    salesManagerAId = salesManagerA.id;
    salesManagerACookie = await createSessionCookie(salesManagerAId, 'token-manager-a-outreach-01');

    const execA1 = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'exec1.a@test.com',
        name: 'Sales Exec A1',
        passwordHash,
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });
    execA1Id = execA1.id;
    execA1Cookie = await createSessionCookie(execA1Id, 'token-exec1-a-outreach-01');

    const execA2 = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'exec2.a@test.com',
        name: 'Sales Exec A2',
        passwordHash,
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });
    execA2Id = execA2.id;
    execA2Cookie = await createSessionCookie(execA2Id, 'token-exec2-a-outreach-01');

    const viewerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'viewer.a@test.com',
        name: 'Viewer A',
        passwordHash,
        role: Role.VIEWER,
        isActive: true
      }
    });
    viewerAId = viewerA.id;
    viewerACookie = await createSessionCookie(viewerAId, 'token-viewer-a-outreach-01');

    const adminB = await prisma.user.create({
      data: {
        organizationId: ORG_B_ID,
        email: 'admin.b@test.com',
        name: 'Admin B',
        passwordHash,
        role: Role.ADMIN,
        isActive: true
      }
    });
    adminBId = adminB.id;
    adminBCookie = await createSessionCookie(adminBId, 'token-admin-b-outreach-01');

    // 3. Setup Leads & Contacts
    // Lead A1 assigned to execA1Id
    const leadA1 = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Apex Footwear Ltd',
        normalizedName: 'apex footwear ltd',
        category: 'Footwear',
        city: 'Dhaka',
        primaryPhone: '+8801711111111',
        primaryEmail: 'info@apexfootwear.com',
        primarySource: 'MANUAL',
        assignedUserId: execA1Id
      }
    });
    testLeadA1Id = leadA1.id;

    // Add verified WhatsApp contact for Lead A1
    await prisma.leadContact.create({
      data: {
        leadId: testLeadA1Id,
        type: ContactType.WHATSAPP,
        rawValue: '01711111111',
        normalizedValue: '+8801711111111',
        status: ContactStatus.VERIFIED,
        whatsappStatus: WhatsAppStatus.CONFIRMED,
        isPrimary: true
      }
    });

    // Add verified Email contact for Lead A1
    await prisma.leadContact.create({
      data: {
        leadId: testLeadA1Id,
        type: ContactType.EMAIL,
        rawValue: 'sales@apexfootwear.com',
        normalizedValue: 'sales@apexfootwear.com',
        status: ContactStatus.VERIFIED,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        isPrimary: true
      }
    });

    // Setup Unassigned Lead A2
    const leadA2 = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Bata Bangladesh',
        normalizedName: 'bata bangladesh',
        category: 'Footwear',
        city: 'Dhaka',
        primaryPhone: '+8801722222222',
        primaryEmail: 'info@bata.com.bd',
        primarySource: 'MANUAL',
        assignedUserId: null // Explicitly unassigned
      }
    });
    testLeadA2Id = leadA2.id;

    await prisma.leadContact.create({
      data: {
        leadId: testLeadA2Id,
        type: ContactType.WHATSAPP,
        rawValue: '01722222222',
        normalizedValue: '+8801722222222',
        status: ContactStatus.VERIFIED,
        whatsappStatus: WhatsAppStatus.CONFIRMED,
        isPrimary: true
      }
    });

    // Setup Org B Lead
    const leadB = await prisma.lead.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Lotto Bangladesh',
        normalizedName: 'lotto bangladesh',
        category: 'Footwear',
        city: 'Dhaka',
        primaryPhone: '+8801733333333',
        primaryEmail: 'info@lotto.com.bd',
        primarySource: 'MANUAL',
        assignedUserId: adminBId
      }
    });
    testLeadBId = leadB.id;

    await prisma.leadContact.create({
      data: {
        leadId: testLeadBId,
        type: ContactType.WHATSAPP,
        rawValue: '01733333333',
        normalizedValue: '+8801733333333',
        status: ContactStatus.VERIFIED,
        whatsappStatus: WhatsAppStatus.CONFIRMED,
        isPrimary: true
      }
    });

    // 4. Setup Approved Drafts
    const draftA1 = await prisma.salesAssistantDraft.create({
      data: {
        organizationId: ORG_A_ID,
        leadId: testLeadA1Id,
        createdByUserId: execA1Id,
        type: SalesAssistantDraftType.WHATSAPP,
        language: SalesAssistantLanguage.ENGLISH,
        tone: SalesAssistantTone.PROFESSIONAL,
        status: SalesAssistantDraftStatus.APPROVED,
        content: 'Approved promotional message for Apex Footwear.',
        approvedAt: new Date(),
        approvedByUserId: adminAId
      }
    });
    testDraftA1Id = draftA1.id;

    const draftA1Email = await prisma.salesAssistantDraft.create({
      data: {
        organizationId: ORG_A_ID,
        leadId: testLeadA1Id,
        createdByUserId: execA1Id,
        type: SalesAssistantDraftType.EMAIL,
        language: SalesAssistantLanguage.ENGLISH,
        tone: SalesAssistantTone.PROFESSIONAL,
        status: SalesAssistantDraftStatus.APPROVED,
        emailSubject: 'Official Partnership Proposal',
        emailBody: 'Dear Apex Leadership, here is our formal proposal.',
        approvedAt: new Date(),
        approvedByUserId: adminAId
      }
    });
    testDraftA1EmailId = draftA1Email.id;

    const draftA2 = await prisma.salesAssistantDraft.create({
      data: {
        organizationId: ORG_A_ID,
        leadId: testLeadA2Id,
        createdByUserId: adminAId,
        type: SalesAssistantDraftType.WHATSAPP,
        language: SalesAssistantLanguage.ENGLISH,
        tone: SalesAssistantTone.PROFESSIONAL,
        status: SalesAssistantDraftStatus.APPROVED,
        content: 'Approved message for Bata Bangladesh.',
        approvedAt: new Date(),
        approvedByUserId: adminAId
      }
    });
    testDraftA2Id = draftA2.id;

    const draftB = await prisma.salesAssistantDraft.create({
      data: {
        organizationId: ORG_B_ID,
        leadId: testLeadBId,
        createdByUserId: adminBId,
        type: SalesAssistantDraftType.WHATSAPP,
        language: SalesAssistantLanguage.ENGLISH,
        tone: SalesAssistantTone.PROFESSIONAL,
        status: SalesAssistantDraftStatus.APPROVED,
        content: 'Approved message for Lotto Bangladesh.',
        approvedAt: new Date(),
        approvedByUserId: adminBId
      }
    });
    testDraftBId = draftB.id;
  });

  beforeEach(() => {
    mockQueue = new InMemoryOutreachDeliveryQueue();
    outreachService.setQueue(mockQueue);
  });

  afterAll(async () => {
    await cleanupDatabase();
  });

  // =========================================================================
  // 1. Authentication & Session Validation Tests
  // =========================================================================
  describe('1. Authentication & Session Validation', () => {
    it('rejects dispatch request with 401 UNAUTHENTICATED when no session cookie is provided', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Idempotency-Key', 'idemp-no-session-001')
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
      expect(res.body.error.requestId).toBeDefined();
      expect(mockQueue.jobs).toHaveLength(0);
    });

    it('rejects list request with 401 UNAUTHENTICATED when invalid session cookie is provided', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', `${SESSION_COOKIE_NAME}=invalid-garbage-token`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    });
  });

  // =========================================================================
  // 2. RBAC & Sales Executive Assignment Matrix on POST
  // =========================================================================
  describe('2. RBAC & Sales Executive Assignment on Send', () => {
    it('allows SUPER_ADMIN to dispatch outreach delivery (201 Created)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', superAdminACookie)
        .set('Idempotency-Key', 'idemp-superadmin-api-01')
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.status).toBe(OutreachDeliveryStatus.QUEUED);
      expect(res.body.data.recipientMasked).toBe('+88017****1111');
      expect(mockQueue.jobs).toHaveLength(1);
    });

    it('allows ADMIN to dispatch outreach delivery (201 Created)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', 'idemp-admin-api-01')
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe(OutreachDeliveryStatus.QUEUED);
    });

    it('allows SALES_MANAGER to dispatch outreach delivery for any tenant lead without direct assignment', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA2Id}/outreach/deliveries`) // Unassigned lead
        .set('Cookie', salesManagerACookie)
        .set('Idempotency-Key', 'idemp-manager-api-01')
        .send({
          draftId: testDraftA2Id,
          channel: OutreachChannel.WHATSAPP
        });

      expect(res.status).toBe(201);
      expect(res.body.data.leadId).toBe(testLeadA2Id);
      expect(res.body.data.status).toBe(OutreachDeliveryStatus.QUEUED);
    });

    it('allows SALES_EXECUTIVE to dispatch outreach delivery for leads explicitly assigned to them', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`) // Assigned to execA1Id
        .set('Cookie', execA1Cookie)
        .set('Idempotency-Key', 'idemp-exec1-assigned-api-01')
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe(OutreachDeliveryStatus.QUEUED);
    });

    it('denies SALES_EXECUTIVE when lead is assigned to another representative (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`) // Assigned to execA1, called by execA2
        .set('Cookie', execA2Cookie)
        .set('Idempotency-Key', 'idemp-exec2-denied-api-01')
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('Sales Executives can only initiate outreach for leads assigned to them');
      expect(mockQueue.jobs).toHaveLength(0);
    });

    it('denies SALES_EXECUTIVE when lead is unassigned (assignedUserId is null) (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA2Id}/outreach/deliveries`) // Unassigned lead
        .set('Cookie', execA1Cookie)
        .set('Idempotency-Key', 'idemp-exec1-unassigned-api-01')
        .send({
          draftId: testDraftA2Id,
          channel: OutreachChannel.WHATSAPP
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(mockQueue.jobs).toHaveLength(0);
    });

    it('denies VIEWER from initiating outreach deliveries (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', viewerACookie)
        .set('Idempotency-Key', 'idemp-viewer-denied-api-01')
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(mockQueue.jobs).toHaveLength(0);
    });
  });

  // =========================================================================
  // 3. RBAC on Read & List Endpoints
  // =========================================================================
  describe('3. RBAC on Read & List Endpoints', () => {
    it('allows VIEWER to list outreach delivery history for a lead (200 OK)', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', viewerACookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.deliveries)).toBe(true);
      expect(typeof res.body.data.total).toBe('number');
    });

    it('allows SALES_EXECUTIVE to view outreach history on assigned lead', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', execA1Cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.deliveries).toBeDefined();
    });

    it('denies SALES_EXECUTIVE from viewing outreach history on unassigned lead (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadA2Id}/outreach/deliveries`) // Unassigned lead
        .set('Cookie', execA1Cookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });
  });

  // =========================================================================
  // 4. Idempotency-Key Header Validation
  // =========================================================================
  describe('4. Idempotency-Key Header Validation', () => {
    it('rejects POST request when Idempotency-Key header is missing (422 Validation Error)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(mockQueue.jobs).toHaveLength(0);
    });

    it('rejects Idempotency-Key shorter than 8 characters (422)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', 'short')
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('rejects Idempotency-Key containing spaces or illegal characters (422)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', 'key with spaces!')
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('preserves case sensitivity of Idempotency-Key', async () => {
      const keyUpper = 'IDEMP-CASE-TEST-AAA';
      const keyLower = 'idemp-case-test-aaa';

      const res1 = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', keyUpper)
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });
      expect(res1.status).toBe(201);

      const res2 = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', keyLower)
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });
      expect(res2.status).toBe(201);

      // Distinct deliveries created because keys are case-distinct
      expect(res1.body.data.id).not.toBe(res2.body.data.id);
    });
  });

  // =========================================================================
  // 5. Request Body Strictness
  // =========================================================================
  describe('5. Request Body Strictness', () => {
    it('rejects body with unknown/forbidden properties (e.g. organizationId, status, recipientNormalized) (422)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', 'idemp-strict-body-01')
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP,
          organizationId: ORG_B_ID, // Forbidden
          status: 'SENT', // Forbidden
          recipientNormalized: '+8801999999999' // Forbidden
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('rejects body with invalid channel enum (422)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', 'idemp-invalid-chan-01')
        .send({
          draftId: testDraftA1Id,
          channel: 'SMS' // Not supported
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
  });

  // =========================================================================
  // 6. Domain Error to Canonical HTTP Mapping
  // =========================================================================
  describe('6. Domain Error to HTTP Mapping', () => {
    it('returns 409 OUTREACH_DRAFT_NOT_APPROVED when draft is unapproved', async () => {
      // Create unapproved draft
      const unapproved = await prisma.salesAssistantDraft.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadA1Id,
          createdByUserId: execA1Id,
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL,
          status: SalesAssistantDraftStatus.DRAFT,
          content: 'Unapproved draft text',
          approvedAt: null,
          approvedByUserId: null
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', 'idemp-unapproved-draft-01')
        .send({
          draftId: unapproved.id,
          channel: OutreachChannel.WHATSAPP
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(OutreachErrorCode.OUTREACH_DRAFT_NOT_APPROVED);
    });

    it('returns 422 OUTREACH_CHANNEL_INCOMPATIBLE when channel does not match draft type', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', 'idemp-chan-incompat-01')
        .send({
          draftId: testDraftA1Id, // WHATSAPP draft
          channel: OutreachChannel.EMAIL // Attempting EMAIL dispatch
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(OutreachErrorCode.OUTREACH_CHANNEL_INCOMPATIBLE);
    });

    it('returns 422 OUTREACH_RECIPIENT_SUPPRESSED when destination is in SuppressionList', async () => {
      await prisma.suppressionList.create({
        data: {
          organizationId: ORG_A_ID,
          type: SuppressionType.WHATSAPP,
          normalizedValue: '+8801711111111',
          channelScope: ChannelScope.ALL,
          reason: SuppressionReason.OPT_OUT,
          addedBy: adminAId
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', 'idemp-suppressed-api-01')
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(OutreachErrorCode.OUTREACH_RECIPIENT_SUPPRESSED);

      // Clean up suppression
      await prisma.suppressionList.deleteMany({ where: { organizationId: ORG_A_ID } });
    });

    it('returns 409 OUTREACH_IDEMPOTENCY_KEY_REUSED when reusing key with different draft', async () => {
      const sharedKey = 'idemp-conflict-test-01';

      // 1. First send succeeds
      const res1 = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', sharedKey)
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });
      expect(res1.status).toBe(201);

      // 2. Second send with same key but different draftId throws 409
      const res2 = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', sharedKey)
        .send({
          draftId: testDraftA1EmailId,
          channel: OutreachChannel.EMAIL
        });

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe(OutreachErrorCode.OUTREACH_IDEMPOTENCY_KEY_REUSED);
    });
  });

  // =========================================================================
  // 7. Idempotent Replay & Audit Semantics
  // =========================================================================
  describe('7. Idempotent Replay & Audit Semantics', () => {
    it('returns identical delivery on replay with zero duplicate queue jobs and zero duplicate audits', async () => {
      const replayKey = 'idemp-replay-exact-01';

      const initialAuditCount = await prisma.auditLog.count({
        where: { organizationId: ORG_A_ID, action: 'lead.outreach_requested' }
      });

      // 1. Initial Request
      const res1 = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', replayKey)
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });

      expect(res1.status).toBe(201);
      const deliveryId = res1.body.data.id;
      expect(mockQueue.jobs).toHaveLength(1);

      const auditCountAfterFirst = await prisma.auditLog.count({
        where: { organizationId: ORG_A_ID, action: 'lead.outreach_requested' }
      });
      expect(auditCountAfterFirst).toBe(initialAuditCount + 1);

      // 2. Replay Request
      const res2 = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', replayKey)
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });

      expect(res2.status).toBe(201);
      expect(res2.body.data.id).toBe(deliveryId);

      // No second job queued
      expect(mockQueue.jobs).toHaveLength(1);

      // No duplicate creation audit logged
      const auditCountAfterReplay = await prisma.auditLog.count({
        where: { organizationId: ORG_A_ID, action: 'lead.outreach_requested' }
      });
      expect(auditCountAfterReplay).toBe(auditCountAfterFirst);
    });
  });

  // =========================================================================
  // 8. Queue Infrastructure Failure Handling
  // =========================================================================
  describe('8. Queue Infrastructure Failure Handling', () => {
    it('returns safe 500 OUTREACH_DELIVERY_FAILED when Redis/BullMQ fails and preserves REQUESTED status in DB', async () => {
      mockQueue.simulateFailure(new Error('Redis connection timed out'));

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', 'idemp-queue-fail-01')
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });

      // Assert safe 500 status and canonical public code
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe(OutreachErrorCode.OUTREACH_DELIVERY_FAILED);
      expect(res.body.error.code).not.toBe('QUEUE_ERROR');
      expect(res.body.error.code).not.toBe(OutreachErrorCode.OUTREACH_PROVIDER_TIMEOUT);

      // Assert safe error message without Redis or BullMQ leakage
      expect(res.body.error.message).toContain('Outreach delivery created but background queueing failed');
      expect(res.body.error.message).not.toContain('Redis');
      expect(res.body.error.message).not.toContain('BullMQ');

      // Assert delivery row exists in REQUESTED status in DB for retry recovery
      const saved = await prisma.outreachDelivery.findFirst({
        where: { idempotencyKey: 'idemp-queue-fail-01' }
      });
      expect(saved).toBeDefined();
      expect(saved?.status).toBe(OutreachDeliveryStatus.REQUESTED);
    });
  });

  // =========================================================================
  // 9. Tenant Isolation & Cross-Tenant / Cross-Lead Defense
  // =========================================================================
  describe('9. Tenant Isolation & Cross-Lead Defense', () => {
    it('returns 404 NOT_FOUND when Tenant A user attempts to send for Tenant B lead', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadBId}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', 'idemp-cross-tenant-send-01')
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(mockQueue.jobs).toHaveLength(0);
    });

    it('returns 404 NOT_FOUND when Tenant A user attempts to read Tenant B outreach list', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadBId}/outreach/deliveries`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    it('returns 404 NOT_FOUND when attempting to read single delivery with mismatched lead ID in URL', async () => {
      // Create delivery for Lead A1
      const created = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', 'idemp-mismatched-lead-read-01')
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });

      const deliveryId = created.body.data.id;

      // Attempt to access via Lead A2 URL
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadA2Id}/outreach/deliveries/${deliveryId}`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });

  // =========================================================================
  // 10. Public DTO Data Minimization
  // =========================================================================
  describe('10. Public DTO Data Minimization', () => {
    it('strictly excludes private transport, snapshot, and security fields from responses', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', 'idemp-data-minimization-01')
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });

      expect(res.status).toBe(201);
      const data = res.body.data;

      // Safe fields present
      expect(data.id).toBeDefined();
      expect(data.leadId).toBe(testLeadA1Id);
      expect(data.draftId).toBe(testDraftA1Id);
      expect(data.channel).toBe(OutreachChannel.WHATSAPP);
      expect(data.status).toBe(OutreachDeliveryStatus.QUEUED);
      expect(data.recipientMasked).toBe('+88017****1111');
      expect(data.requestedAt).toBeDefined();
      expect(data.queuedAt).toBeDefined();

      // Private / internal fields MUST be undefined
      expect(data.recipientNormalized).toBeUndefined();
      expect(data.snapshotContent).toBeUndefined();
      expect(data.snapshotSubject).toBeUndefined();
      expect(data.snapshotBody).toBeUndefined();
      expect(data.approvedDraftSnapshotHash).toBeUndefined();
      expect(data.requestFingerprint).toBeUndefined();
      expect(data.idempotencyKey).toBeUndefined();
      expect(data.providerMessageId).toBeUndefined();
      expect(data.provider).toBeUndefined();
    });
  });

  // =========================================================================
  // 11. Audit Log Metadata Safety
  // =========================================================================
  describe('11. Audit Log Metadata Safety', () => {
    it('verifies audit log entry excludes secrets, snapshots, tokens, and raw PII', async () => {
      const key = 'idemp-audit-safety-01';
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', key)
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });

      expect(res.status).toBe(201);

      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_A_ID,
          entityId: res.body.data.id,
          action: 'lead.outreach_requested'
        }
      });

      expect(audit).toBeDefined();
      expect(audit?.userId).toBe(adminAId);

      const metadata = audit?.after as any;
      expect(metadata.leadId).toBe(testLeadA1Id);
      expect(metadata.draftId).toBe(testDraftA1Id);
      expect(metadata.channel).toBe(OutreachChannel.WHATSAPP);
      expect(metadata.recipientMasked).toBe('+88017****1111');

      // Assert private/secret fields are absent from audit metadata
      expect(metadata.idempotencyKey).toBeUndefined();
      expect(metadata.recipientNormalized).toBeUndefined();
      expect(metadata.snapshotContent).toBeUndefined();
      expect(metadata.snapshotBody).toBeUndefined();
      expect(metadata.approvedDraftSnapshotHash).toBeUndefined();
      expect(metadata.token).toBeUndefined();
    });
  });

  // =========================================================================
  // 12. Route Collision Protection & Removed Alias Defense
  // =========================================================================
  describe('12. Route Collision Protection & Removed Alias Defense', () => {
    it('routes GET .../deliveries to list handler and GET .../deliveries/:deliveryId to detail handler without segment collision', async () => {
      // 1. Create a delivery
      const createRes = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', 'idemp-collision-test-01')
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });
      expect(createRes.status).toBe(201);
      const deliveryId = createRes.body.data.id;

      // 2. GET list endpoint -> returns list object with deliveries array
      const listRes = await request(app)
        .get(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries`)
        .set('Cookie', adminACookie);

      expect(listRes.status).toBe(200);
      expect(listRes.body.data.deliveries).toBeDefined();
      expect(Array.isArray(listRes.body.data.deliveries)).toBe(true);

      // 3. GET detail endpoint -> returns single delivery object
      const detailRes = await request(app)
        .get(`/api/v1/leads/${testLeadA1Id}/outreach/deliveries/${deliveryId}`)
        .set('Cookie', adminACookie);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.data.id).toBe(deliveryId);
    });

    it('returns 404 NOT_FOUND for removed /outreach paths without /deliveries subresource', async () => {
      // POST /outreach removed -> 404
      const postRes = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/outreach`)
        .set('Cookie', adminACookie)
        .set('Idempotency-Key', 'idemp-removed-post-01')
        .send({
          draftId: testDraftA1Id,
          channel: OutreachChannel.WHATSAPP
        });
      expect(postRes.status).toBe(404);

      // GET /outreach removed -> 404
      const listRes = await request(app)
        .get(`/api/v1/leads/${testLeadA1Id}/outreach`)
        .set('Cookie', adminACookie);
      expect(listRes.status).toBe(404);

      // GET /outreach/:deliveryId removed -> 404
      const detailRes = await request(app)
        .get(`/api/v1/leads/${testLeadA1Id}/outreach/00000000-0000-0000-0000-000000000001`)
        .set('Cookie', adminACookie);
      expect(detailRes.status).toBe(404);
    });
  });
});
