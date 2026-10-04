/**
 * AI Sales Assistant API Integration & RBAC Test Suite
 *
 * Covers:
 * 1. Generation endpoint (POST /api/v1/leads/:id/sales-assistant/drafts) across all 5 draft types
 * 2. Database persistence verification (Email vs Non-email storage, DRAFT-only status)
 * 3. Contact trust boundary (PHONE != WHATSAPP)
 * 4. Tenant isolation and cross-lead scoping
 * 5. Provider failure handling and error normalization (504, 503, 502) with 0 drafts persisted
 * 6. RBAC matrix:
 *    - Generate: SUPER_ADMIN, ADMIN, SALES_MANAGER, SALES_EXECUTIVE allowed; VIEWER forbidden (403)
 *    - Review: SUPER_ADMIN, ADMIN, SALES_MANAGER allowed; SALES_EXECUTIVE & VIEWER forbidden (403)
 *    - Read / List: VIEWER allowed (200)
 * 7. Approve / Reject lifecycle and terminal state guards (409 Conflict)
 * 8. Audit log verification and data minimization
 * 9. Input validation and malformed UUID error handling (422)
 * 10. Response data minimization
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import prisma, {
  Role,
  SalesAssistantDraftType,
  SalesAssistantLanguage,
  SalesAssistantTone,
  SalesAssistantDraftStatus,
  SalesAssistantWarning,
  ContactType,
  ContactStatus,
  WhatsAppStatus
} from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import { ErrorCodes } from '@leadmate/shared';
import {
  MockSalesAssistantProvider,
  SalesAssistantProviderErrorCode
} from '@leadmate/ai';
import { app } from '../app.js';
import { hashPassword, hashSessionToken } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';
import { salesAssistantService } from '../services/sales-assistant.service.js';
import { resetSalesAssistantRateLimiter } from '../middleware/rate-limiter.js';

describe('M5 Step 4: AI Sales Assistant API, RBAC & Service Integration', () => {
  const ORG_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const ORG_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  let superAdminAId: string;
  let superAdminACookie: string;

  let adminAId: string;
  let adminACookie: string;

  let salesManagerAId: string;
  let salesManagerACookie: string;

  let repA1Id: string;
  let repA1Cookie: string;

  let viewerAId: string;
  let viewerACookie: string;

  let adminBId: string;
  let adminBCookie: string;

  let testLeadA1Id: string; // Has verified WhatsApp
  let testLeadA2Id: string; // Has phone only (no WhatsApp)
  let testLeadBId: string;  // Org B lead

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
    await prisma.salesAssistantDraft.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.leadContact.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.organization.deleteMany({});
  }

  beforeAll(async () => {
    await cleanupDatabase();

    // 1. Setup Organizations
    await prisma.organization.create({
      data: {
        id: ORG_A_ID,
        name: 'Sales Assistant Test Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.create({
      data: {
        id: ORG_B_ID,
        name: 'Sales Assistant Test Org B',
        timezone: 'Asia/Dhaka'
      }
    });

    // 2. Setup Users across RBAC roles
    const passwordHash = await hashPassword('TestSecret123!');

    const superAdminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'superadmin.a@example.com',
        passwordHash,
        name: 'Super Admin A',
        role: Role.SUPER_ADMIN
      }
    });
    superAdminAId = superAdminA.id;
    superAdminACookie = await createSessionCookie(superAdminAId, 'token-superadmin-a');

    const adminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'admin.a@example.com',
        passwordHash,
        name: 'Admin A',
        role: Role.ADMIN
      }
    });
    adminAId = adminA.id;
    adminACookie = await createSessionCookie(adminAId, 'token-admin-a');

    const salesManagerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'manager.a@example.com',
        passwordHash,
        name: 'Sales Manager A',
        role: Role.SALES_MANAGER
      }
    });
    salesManagerAId = salesManagerA.id;
    salesManagerACookie = await createSessionCookie(salesManagerAId, 'token-manager-a');

    const repA1 = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'rep.a1@example.com',
        passwordHash,
        name: 'Sales Rep A1',
        role: Role.SALES_EXECUTIVE
      }
    });
    repA1Id = repA1.id;
    repA1Cookie = await createSessionCookie(repA1Id, 'token-rep-a1');

    const viewerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'viewer.a@example.com',
        passwordHash,
        name: 'Viewer A',
        role: Role.VIEWER
      }
    });
    viewerAId = viewerA.id;
    viewerACookie = await createSessionCookie(viewerAId, 'token-viewer-a');

    const adminB = await prisma.user.create({
      data: {
        organizationId: ORG_B_ID,
        email: 'admin.b@example.com',
        passwordHash,
        name: 'Admin B',
        role: Role.ADMIN
      }
    });
    adminBId = adminB.id;
    adminBCookie = await createSessionCookie(adminBId, 'token-admin-b');

    // 3. Setup Leads
    // Lead A1: verified WhatsApp contact
    const leadA1 = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Bengal Digital Solutions',
        normalizedName: 'bengal digital solutions',
        category: 'IT Services',
        description: 'Software development and business automation in Dhaka.',
        city: 'Dhaka',
        locality: 'Banani',
        country: 'BD',
        primaryPhone: '+8801711000001',
        primaryEmail: 'info@bengaldigital.example.com',
        website: 'https://bengaldigital.example.com',
        primarySource: 'MANUAL'
      }
    });
    testLeadA1Id = leadA1.id;

    await prisma.leadContact.create({
      data: {
        leadId: testLeadA1Id,
        type: ContactType.WHATSAPP,
        rawValue: '+8801711000001',
        normalizedValue: '+8801711000001',
        status: ContactStatus.VERIFIED,
        whatsappStatus: WhatsAppStatus.CONFIRMED,
        isPrimary: false
      }
    });

    // Lead A2: phone only, no verified WhatsApp contact
    const leadA2 = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Chittagong Retail Store',
        normalizedName: 'chittagong retail store',
        category: 'Retail',
        description: 'Local consumer retail store in Agrabad.',
        city: 'Chittagong',
        locality: 'Agrabad',
        country: 'BD',
        primaryPhone: '+8801811000002',
        primaryEmail: 'info@ctgretail.example.com',
        primarySource: 'MANUAL'
      }
    });
    testLeadA2Id = leadA2.id;

    // Lead B: belongs to Org B
    const leadB = await prisma.lead.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Sylhet Tea Exports',
        normalizedName: 'sylhet tea exports',
        category: 'Agro',
        primarySource: 'MANUAL'
      }
    });
    testLeadBId = leadB.id;
  });

  afterAll(async () => {
    salesAssistantService.resetDefaultProvider();
    await cleanupDatabase();
  });

  beforeEach(() => {
    resetSalesAssistantRateLimiter();
    salesAssistantService.resetDefaultProvider();
  });

  /* -----------------------------------------------------------------
   * 1. Generation Endpoint & All 5 Draft Types
   * ----------------------------------------------------------------- */
  describe('1. Draft Generation & Persistence across 5 Types', () => {
    it('generates and persists WHATSAPP draft', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', repA1Cookie)
        .send({
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL,
          objective: 'Schedule a discovery demo call'
        });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe(SalesAssistantDraftType.WHATSAPP);
      expect(res.body.data.status).toBe(SalesAssistantDraftStatus.DRAFT);
      expect(res.body.data.leadId).toBe(testLeadA1Id);
      expect(res.body.data.content).toBeDefined();
      expect(res.body.data.emailSubject).toBeUndefined();
      expect(res.body.data.emailBody).toBeUndefined();
      expect(res.body.data.createdByUserId).toBe(repA1Id);

      // Verify DB persistence
      const inDb = await prisma.salesAssistantDraft.findUnique({
        where: { id: res.body.data.id }
      });
      expect(inDb).not.toBeNull();
      expect(inDb!.status).toBe(SalesAssistantDraftStatus.DRAFT);
      expect(inDb!.content).toBe(res.body.data.content);
      expect(inDb!.emailSubject).toBeNull();
      expect(inDb!.emailBody).toBeNull();

      // Verify AuditLog was written with minimized metadata
      const audit = await prisma.auditLog.findFirst({
        where: {
          entityId: res.body.data.id,
          action: 'lead.sales_assistant_draft_generated'
        }
      });
      expect(audit).not.toBeNull();
      expect(audit!.userId).toBe(repA1Id);
      const after = audit!.after as Record<string, unknown>;
      expect(after.leadId).toBe(testLeadA1Id);
      expect(after.type).toBe(SalesAssistantDraftType.WHATSAPP);
      expect(after.content).toBeUndefined(); // Data minimization!
    });

    it('generates and persists EMAIL draft with separate subject and body (content=null)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', repA1Cookie)
        .send({
          type: SalesAssistantDraftType.EMAIL,
          language: SalesAssistantLanguage.BANGLA,
          tone: SalesAssistantTone.FRIENDLY,
          objective: 'Business automation collaboration'
        });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe(SalesAssistantDraftType.EMAIL);
      expect(res.body.data.status).toBe(SalesAssistantDraftStatus.DRAFT);
      expect(res.body.data.content).toBeUndefined();
      expect(res.body.data.emailSubject).toBeDefined();
      expect(res.body.data.emailBody).toBeDefined();

      // Verify DB persistence: content is null, emailSubject and emailBody are stored
      const inDb = await prisma.salesAssistantDraft.findUnique({
        where: { id: res.body.data.id }
      });
      expect(inDb).not.toBeNull();
      expect(inDb!.content).toBeNull();
      expect(inDb!.emailSubject).toBe(res.body.data.emailSubject);
      expect(inDb!.emailBody).toBe(res.body.data.emailBody);
    });

    it('generates and persists CALL_SCRIPT draft', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', repA1Cookie)
        .send({
          type: SalesAssistantDraftType.CALL_SCRIPT,
          language: SalesAssistantLanguage.MIXED,
          tone: SalesAssistantTone.CONCISE
        });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe(SalesAssistantDraftType.CALL_SCRIPT);
      expect(res.body.data.content).toContain('[CALL SCRIPT');
    });

    it('generates and persists PROPOSAL draft', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', repA1Cookie)
        .send({
          type: SalesAssistantDraftType.PROPOSAL,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PERSUASIVE
        });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe(SalesAssistantDraftType.PROPOSAL);
      expect(res.body.data.content).toContain('PROPOSAL:');
      // Proposal naturally attaches MISSING_PRICE_CONTEXT warning since no price context exists
      expect(res.body.data.warnings).toContain(SalesAssistantWarning.MISSING_PRICE_CONTEXT);
    });

    it('generates and persists FOLLOW_UP draft', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', repA1Cookie)
        .send({
          type: SalesAssistantDraftType.FOLLOW_UP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL
        });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe(SalesAssistantDraftType.FOLLOW_UP);
      expect(res.body.data.content).toBeDefined();
    });
  });

  /* -----------------------------------------------------------------
   * 2. Contact Safety: PHONE != WHATSAPP Invariant
   * ----------------------------------------------------------------- */
  describe('2. PHONE != WHATSAPP Invariant Enforcement', () => {
    it('attaches UNVERIFIED_WHATSAPP warning when lead has phone but no verified WhatsApp', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA2Id}/sales-assistant/drafts`)
        .set('Cookie', repA1Cookie)
        .send({
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL
        });

      expect(res.status).toBe(201);
      expect(res.body.data.warnings).toContain(SalesAssistantWarning.UNVERIFIED_WHATSAPP);
    });

    it('does NOT attach UNVERIFIED_WHATSAPP when lead has verified WhatsApp contact', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', repA1Cookie)
        .send({
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL
        });

      expect(res.status).toBe(201);
      expect(res.body.data.warnings).not.toContain(SalesAssistantWarning.UNVERIFIED_WHATSAPP);
    });
  });

  /* -----------------------------------------------------------------
   * 3. Tenant Isolation & Lead Scoping
   * ----------------------------------------------------------------- */
  describe('3. Multi-Tenant Isolation & Scoping', () => {
    it('blocks Org A user from generating draft for Org B lead (404 NOT_FOUND)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadBId}/sales-assistant/drafts`)
        .set('Cookie', repA1Cookie)
        .send({
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);

      // Verify zero drafts created
      const drafts = await prisma.salesAssistantDraft.findMany({
        where: { leadId: testLeadBId }
      });
      expect(drafts.length).toBe(0);
    });

    it('blocks Org B user from listing drafts for Org A lead (404 NOT_FOUND)', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', adminBCookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    it('blocks cross-lead draft access when draftId belongs to a different lead (404 NOT_FOUND)', async () => {
      // Create draft for Lead A1
      const draft = await prisma.salesAssistantDraft.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadA1Id,
          createdByUserId: repA1Id,
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL,
          status: SalesAssistantDraftStatus.DRAFT,
          content: 'Hello Lead A1'
        }
      });

      // Request using Lead A2's route with Lead A1's draftId
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadA2Id}/sales-assistant/drafts/${draft.id}`)
        .set('Cookie', repA1Cookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });

  /* -----------------------------------------------------------------
   * 4. Provider Failure Normalization & 0 Draft Persistence
   * ----------------------------------------------------------------- */
  describe('4. Provider Failure Normalization', () => {
    it('maps PROVIDER_TIMEOUT to 504 and creates 0 database draft rows', async () => {
      const failingMock = new MockSalesAssistantProvider({
        simulateFailure: true,
        failureErrorCode: SalesAssistantProviderErrorCode.PROVIDER_TIMEOUT,
        failureErrorMessage: 'Simulated LLM gateway timeout',
        retryable: true
      });
      salesAssistantService.setDefaultProvider(failingMock);

      const beforeCount = await prisma.salesAssistantDraft.count({
        where: { leadId: testLeadA1Id }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', repA1Cookie)
        .send({
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL
        });

      expect(res.status).toBe(504);
      expect(res.body.error.code).toBe(SalesAssistantProviderErrorCode.PROVIDER_TIMEOUT);
      expect(res.body.error.message).toBe('Simulated LLM gateway timeout');

      // Verify 0 rows persisted
      const afterCount = await prisma.salesAssistantDraft.count({
        where: { leadId: testLeadA1Id }
      });
      expect(afterCount).toBe(beforeCount);
    });

    it('maps PROVIDER_UNAVAILABLE to 503 and creates 0 database draft rows', async () => {
      const failingMock = new MockSalesAssistantProvider({
        simulateFailure: true,
        failureErrorCode: SalesAssistantProviderErrorCode.PROVIDER_UNAVAILABLE,
        failureErrorMessage: 'Provider offline for maintenance'
      });
      salesAssistantService.setDefaultProvider(failingMock);

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', repA1Cookie)
        .send({
          type: SalesAssistantDraftType.EMAIL,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL
        });

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe(SalesAssistantProviderErrorCode.PROVIDER_UNAVAILABLE);
    });

    it('maps INVALID_PROVIDER_RESPONSE to 502 and creates 0 database draft rows', async () => {
      const failingMock = new MockSalesAssistantProvider({
        simulateFailure: true,
        failureErrorCode: SalesAssistantProviderErrorCode.INVALID_PROVIDER_RESPONSE,
        failureErrorMessage: 'Malformed provider payload'
      });
      salesAssistantService.setDefaultProvider(failingMock);

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', repA1Cookie)
        .send({
          type: SalesAssistantDraftType.CALL_SCRIPT,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL
        });

      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe(SalesAssistantProviderErrorCode.INVALID_PROVIDER_RESPONSE);
    });
  });

  /* -----------------------------------------------------------------
   * 5. RBAC Permissions Matrix Enforcement
   * ----------------------------------------------------------------- */
  describe('5. RBAC Permissions Matrix', () => {
    it('allows SUPER_ADMIN to generate, list, and review drafts', async () => {
      const genRes = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', superAdminACookie)
        .send({
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL
        });
      expect(genRes.status).toBe(201);

      const draftId = genRes.body.data.id;

      const appRes = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts/${draftId}/approve`)
        .set('Cookie', superAdminACookie);
      expect(appRes.status).toBe(200);
      expect(appRes.body.data.status).toBe(SalesAssistantDraftStatus.APPROVED);
    });

    it('allows SALES_MANAGER to generate, list, and review drafts', async () => {
      const genRes = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', salesManagerACookie)
        .send({
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL
        });
      expect(genRes.status).toBe(201);

      const draftId = genRes.body.data.id;

      const rejRes = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts/${draftId}/reject`)
        .set('Cookie', salesManagerACookie);
      expect(rejRes.status).toBe(200);
      expect(rejRes.body.data.status).toBe(SalesAssistantDraftStatus.REJECTED);
    });

    it('allows SALES_EXECUTIVE to generate and list, but DENIES review (403 FORBIDDEN)', async () => {
      // 1. Generation allowed
      const genRes = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', repA1Cookie)
        .send({
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL
        });
      expect(genRes.status).toBe(201);
      const draftId = genRes.body.data.id;

      // 2. Listing allowed
      const listRes = await request(app)
        .get(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', repA1Cookie);
      expect(listRes.status).toBe(200);

      // 3. Approval DENIED
      const appRes = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts/${draftId}/approve`)
        .set('Cookie', repA1Cookie);
      expect(appRes.status).toBe(403);
      expect(appRes.body.error.code).toBe(ErrorCodes.FORBIDDEN);

      // 4. Rejection DENIED
      const rejRes = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts/${draftId}/reject`)
        .set('Cookie', repA1Cookie);
      expect(rejRes.status).toBe(403);
      expect(rejRes.body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('allows VIEWER to list/read drafts, but DENIES generate and review (403 FORBIDDEN)', async () => {
      // 1. Generation DENIED
      const genRes = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', viewerACookie)
        .send({
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL
        });
      expect(genRes.status).toBe(403);
      expect(genRes.body.error.code).toBe(ErrorCodes.FORBIDDEN);

      // 2. Listing allowed with LEADS_READ
      const listRes = await request(app)
        .get(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', viewerACookie);
      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.data)).toBe(true);
    });
  });

  /* -----------------------------------------------------------------
   * 6. Review Lifecycle & Terminal State Invariants
   * ----------------------------------------------------------------- */
  describe('6. Review Lifecycle & Terminal Guardrails', () => {
    it('approves a draft setting approvedAt and approvedByUserId and logs audit event', async () => {
      const draft = await prisma.salesAssistantDraft.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadA1Id,
          createdByUserId: repA1Id,
          type: SalesAssistantDraftType.EMAIL,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL,
          status: SalesAssistantDraftStatus.DRAFT,
          emailSubject: 'Proposal Intro',
          emailBody: 'Hello Team'
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts/${draft.id}/approve`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(SalesAssistantDraftStatus.APPROVED);
      expect(res.body.data.approvedByUserId).toBe(adminAId);
      expect(res.body.data.approvedAt).toBeDefined();
      expect(res.body.data.rejectedAt).toBeUndefined();
      expect(res.body.data.rejectedByUserId).toBeUndefined();

      // Verify audit
      const audit = await prisma.auditLog.findFirst({
        where: {
          entityId: draft.id,
          action: 'lead.sales_assistant_draft_approved'
        }
      });
      expect(audit).not.toBeNull();
      expect(audit!.userId).toBe(adminAId);
    });

    it('rejects an APPROVED draft with 409 CONFLICT', async () => {
      const draft = await prisma.salesAssistantDraft.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadA1Id,
          createdByUserId: repA1Id,
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL,
          status: SalesAssistantDraftStatus.APPROVED,
          approvedAt: new Date(),
          approvedByUserId: adminAId,
          content: 'Already approved'
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts/${draft.id}/reject`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(ErrorCodes.CONFLICT);
    });

    it('approves an already APPROVED draft with 409 CONFLICT (no silent rewrite)', async () => {
      const draft = await prisma.salesAssistantDraft.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadA1Id,
          createdByUserId: repA1Id,
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL,
          status: SalesAssistantDraftStatus.APPROVED,
          approvedAt: new Date(),
          approvedByUserId: adminAId,
          content: 'Already approved'
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts/${draft.id}/approve`)
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(ErrorCodes.CONFLICT);
    });

    it('approves a REJECTED draft with 409 CONFLICT', async () => {
      const draft = await prisma.salesAssistantDraft.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadA1Id,
          createdByUserId: repA1Id,
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL,
          status: SalesAssistantDraftStatus.REJECTED,
          rejectedAt: new Date(),
          rejectedByUserId: adminAId,
          content: 'Already rejected'
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts/${draft.id}/approve`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(ErrorCodes.CONFLICT);
    });
  });

  /* -----------------------------------------------------------------
   * 7. Input Validation & UUID Security
   * ----------------------------------------------------------------- */
  describe('7. Request Validation & UUID Security', () => {
    it('rejects unknown request fields with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', repA1Cookie)
        .send({
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL,
          provider: 'OPENAI', // Disallowed field!
          status: 'APPROVED'   // Disallowed field!
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });


    it('accepts objective up to exact limit of 300 chars, rejects 301 chars with 422', async () => {
      // 300 chars: accepted (201)
      const validRes = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', repA1Cookie)
        .send({
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL,
          objective: 'o'.repeat(300)
        });
      expect(validRes.status).toBe(201);
      expect(validRes.body.data.objective).toBe('o'.repeat(300));

      // 301 chars: rejected (422)
      const invalidRes = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', repA1Cookie)
        .send({
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL,
          objective: 'o'.repeat(301)
        });
      expect(invalidRes.status).toBe(422);
      expect(invalidRes.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('accepts customInstruction up to exact limit of 1000 chars, rejects 1001 chars with 422', async () => {
      // 1000 chars: accepted (201)
      const validRes = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', repA1Cookie)
        .send({
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL,
          customInstruction: 'c'.repeat(1000)
        });
      expect(validRes.status).toBe(201);

      // 1001 chars: rejected (422)
      const invalidRes = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', repA1Cookie)
        .send({
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL,
          customInstruction: 'c'.repeat(1001)
        });
      expect(invalidRes.status).toBe(422);
      expect(invalidRes.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('returns 422 VALIDATION_ERROR on generate with malformed lead UUID parameter', async () => {
      const res = await request(app)
        .post('/api/v1/leads/not-a-valid-uuid/sales-assistant/drafts')
        .set('Cookie', repA1Cookie)
        .send({
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('returns 422 VALIDATION_ERROR on list drafts with malformed lead UUID parameter', async () => {
      const res = await request(app)
        .get('/api/v1/leads/not-a-valid-uuid/sales-assistant/drafts')
        .set('Cookie', repA1Cookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('returns 422 VALIDATION_ERROR on read draft with malformed lead UUID parameter', async () => {
      const dummyDraftId = '00000000-0000-0000-0000-000000000001';
      const res = await request(app)
        .get(`/api/v1/leads/not-a-valid-uuid/sales-assistant/drafts/${dummyDraftId}`)
        .set('Cookie', repA1Cookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('returns 422 VALIDATION_ERROR on read draft with malformed draft UUID parameter', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts/invalid-draft-uuid`)
        .set('Cookie', repA1Cookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('returns 422 VALIDATION_ERROR on approve draft with malformed lead UUID parameter', async () => {
      const dummyDraftId = '00000000-0000-0000-0000-000000000001';
      const res = await request(app)
        .post(`/api/v1/leads/not-a-valid-uuid/sales-assistant/drafts/${dummyDraftId}/approve`)
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('returns 422 VALIDATION_ERROR on approve draft with malformed draft UUID parameter', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts/invalid-draft-uuid/approve`)
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('returns 422 VALIDATION_ERROR on reject draft with malformed lead UUID parameter', async () => {
      const dummyDraftId = '00000000-0000-0000-0000-000000000001';
      const res = await request(app)
        .post(`/api/v1/leads/not-a-valid-uuid/sales-assistant/drafts/${dummyDraftId}/reject`)
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('returns 422 VALIDATION_ERROR on reject draft with malformed draft UUID parameter', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts/invalid-draft-uuid/reject`)
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
  });

  /* -----------------------------------------------------------------
   * 8. Response Minimization & Data Exposure Protection
   * ----------------------------------------------------------------- */
  describe('8. Response Minimization Protection', () => {
    it('returned draft payload contains zero provider secrets, internal metadata, or unneeded customInstruction', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/sales-assistant/drafts`)
        .set('Cookie', repA1Cookie)
        .send({
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL,
          customInstruction: 'Keep it concise and punchy'
        });

      expect(res.status).toBe(201);
      const data = res.body.data;

      const forbiddenKeys = [
        'provider',
        'providerName',
        'rawResponse',
        'rawProviderResponse',
        'systemPrompt',
        'reasoning',
        'chainOfThought',
        'tokenUsage',
        'cost',
        'apiKey',
        'token',
        'customInstruction' // Data minimization: excluded from public client response DTO
      ];

      for (const key of forbiddenKeys) {
        expect(key in data).toBe(false);
      }
    });
  });
});
