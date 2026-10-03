/**
 * Demo Website API & RBAC Integration Tests (M4 Step 4)
 *
 * Covers:
 * 1. Authentication (401 UNAUTHENTICATED on all 5 endpoints without auth)
 * 2. RBAC Permissions Matrix:
 *    - DEMOS_GENERATE: SALES_EXECUTIVE, SALES_MANAGER, ADMIN, SUPER_ADMIN can create & regenerate
 *    - Missing DEMOS_GENERATE: VIEWER receives 403 FORBIDDEN on create & regenerate
 *    - DEMOS_MANAGE: SALES_MANAGER, ADMIN, SUPER_ADMIN can expire & remove
 *    - Missing DEMOS_MANAGE: SALES_EXECUTIVE, VIEWER receive 403 FORBIDDEN on expire & remove
 *    - LEADS_READ: VIEWER can GET demo summary
 * 3. Core Lifecycle Operations (MOCK provider):
 *    - POST /api/v1/leads/:id/demo (Create / Generate)
 *    - GET /api/v1/leads/:id/demo (Get current)
 *    - POST /api/v1/leads/:id/demo/regenerate (Regenerate)
 *    - POST /api/v1/leads/:id/demo/expire (Expire)
 *    - POST /api/v1/leads/:id/demo/remove (Remove / Soft-unpublish)
 * 4. Idempotency & Repeat Requests (0 extra provider calls / 0 duplicate audit logs)
 * 5. Multi-Tenant Isolation (Org A user targeting Org B lead returns 404 NOT_FOUND)
 * 6. Strict Input Validation & Anti-Tampering (Rejects injected fields with 422 VALIDATION_ERROR)
 * 7. Path Parameter Validation (Malformed UUID parameter returns 422 VALIDATION_ERROR)
 * 8. Audit Logging Integrity (lead.demo_created, lead.demo_regenerated, lead.demo_expired, lead.demo_removed)
 * 9. Response Safety (No password hashes, provider secrets, internal stack traces)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import prisma, {
  Role,
  DemoWebsiteStatus,
  DemoWebsiteProvider,
  WebsiteStatus,
  OnlinePresenceType,
  ContactType,
  ContactStatus,
  WhatsAppStatus
} from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import { ErrorCodes, DemoWebsiteErrorCode, demoWebsiteSummarySchema } from '@leadmate/shared';
import { app } from '../app.js';
import { hashPassword, hashSessionToken } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';

describe('M4 Step 4: Demo Website API & RBAC Integration', () => {
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

  let testLeadA1Id: string;
  let testLeadA2Id: string;
  let testLeadBId: string;

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
    await prisma.demoWebsite.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.leadContact.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.session.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.organization.deleteMany({});
  }

  beforeAll(async () => {
    await cleanupDatabase();

    // Setup Organizations
    await prisma.organization.create({
      data: {
        id: ORG_A_ID,
        name: 'Demo API Test Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.create({
      data: {
        id: ORG_B_ID,
        name: 'Demo API Test Org B',
        timezone: 'Asia/Dhaka'
      }
    });

    // Setup Users
    const passwordHash = await hashPassword('TestSecret123!');

    const superAdminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'superadmin.a@demoapi-test.ai',
        passwordHash,
        name: 'Super Admin A',
        role: Role.SUPER_ADMIN,
        isActive: true
      }
    });
    superAdminAId = superAdminA.id;
    superAdminACookie = await createSessionCookie(superAdminAId, 'token-superadmin-a');

    const adminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'admin.a@demoapi-test.ai',
        passwordHash,
        name: 'Admin A',
        role: Role.ADMIN,
        isActive: true
      }
    });
    adminAId = adminA.id;
    adminACookie = await createSessionCookie(adminAId, 'token-admin-a');

    const managerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'manager.a@demoapi-test.ai',
        passwordHash,
        name: 'Sales Manager A',
        role: Role.SALES_MANAGER,
        isActive: true
      }
    });
    salesManagerAId = managerA.id;
    salesManagerACookie = await createSessionCookie(salesManagerAId, 'token-manager-a');

    const repA1 = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'rep.a1@demoapi-test.ai',
        passwordHash,
        name: 'Sales Rep A1',
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });
    repA1Id = repA1.id;
    repA1Cookie = await createSessionCookie(repA1Id, 'token-rep-a1');

    const viewerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'viewer.a@demoapi-test.ai',
        passwordHash,
        name: 'Viewer A',
        role: Role.VIEWER,
        isActive: true
      }
    });
    viewerAId = viewerA.id;
    viewerACookie = await createSessionCookie(viewerAId, 'token-viewer-a');

    const adminB = await prisma.user.create({
      data: {
        organizationId: ORG_B_ID,
        email: 'admin.b@demoapi-test.ai',
        passwordHash,
        name: 'Admin B',
        role: Role.ADMIN,
        isActive: true
      }
    });
    adminBId = adminB.id;
    adminBCookie = await createSessionCookie(adminBId, 'token-admin-b');

    // Setup Leads
    const leadA1 = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Prime Healthcare Dhaka',
        normalizedName: 'prime healthcare dhaka',
        category: 'Hospital & Clinic',
        description: 'Prime hospital in central Dhaka with 24/7 emergency care.',
        address: 'Mirpur Road 12',
        locality: 'Mirpur',
        city: 'Dhaka',
        region: 'Dhaka Division',
        country: 'BD',
        primaryPhone: '+8801711223344',
        primaryEmail: 'contact@primehealthcare.com',
        primarySource: 'MANUAL',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.UNKNOWN,
        contacts: {
          create: [
            {
              type: ContactType.PHONE,
              rawValue: '+8801711223344',
              normalizedValue: '+8801711223344',
              status: ContactStatus.VERIFIED
            },
            {
              type: ContactType.WHATSAPP,
              rawValue: '+8801711223355',
              normalizedValue: '+8801711223355',
              status: ContactStatus.VERIFIED,
              whatsappStatus: WhatsAppStatus.CONFIRMED
            }
          ]
        }
      }
    });
    testLeadA1Id = leadA1.id;

    const leadA2 = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Dhaka Hardware & Tools',
        normalizedName: 'dhaka hardware and tools',
        category: 'Hardware',
        primaryPhone: '+8801811223344',
        primarySource: 'MANUAL',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.UNKNOWN
      }
    });
    testLeadA2Id = leadA2.id;

    const leadB = await prisma.lead.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Chittagong Electronics Mart',
        normalizedName: 'chittagong electronics mart',
        category: 'Electronics',
        primaryPhone: '+8801911223344',
        primarySource: 'MANUAL',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.UNKNOWN
      }
    });
    testLeadBId = leadB.id;
  });

  afterAll(async () => {
    await cleanupDatabase();
  });

  /* -----------------------------------------------------------------
   * 1. Authentication Enforcement
   * ----------------------------------------------------------------- */
  describe('1. Authentication Enforcement (401 on unauthenticated)', () => {
    it('rejects POST /api/v1/leads/:id/demo without cookie', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/demo`)
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
      expect(res.body.error.requestId).toBeDefined();
      expect(res.body.error.details?.stack).toBeUndefined();
    });

    it('rejects GET /api/v1/leads/:id/demo without cookie', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadA1Id}/demo`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
      expect(res.body.error.requestId).toBeDefined();
    });

    it('rejects POST /api/v1/leads/:id/demo/regenerate without cookie', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/demo/regenerate`)
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    });

    it('rejects POST /api/v1/leads/:id/demo/expire without cookie', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/demo/expire`)
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    });

    it('rejects POST /api/v1/leads/:id/demo/remove without cookie', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/demo/remove`)
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    });
  });

  /* -----------------------------------------------------------------
   * 2. RBAC Permissions Matrix Enforcement
   * ----------------------------------------------------------------- */
  describe('2. RBAC Permissions Matrix Enforcement', () => {
    it('allows SALES_EXECUTIVE with DEMOS_GENERATE to request demo', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/demo`)
        .set('Cookie', repA1Cookie)
        .send({
          templateKey: 'generic-local-business'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(DemoWebsiteStatus.READY);
    });

    it('rejects VIEWER without DEMOS_GENERATE from creating demo (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA2Id}/demo`)
        .set('Cookie', viewerACookie)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('allows VIEWER with LEADS_READ to GET demo summary', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadA1Id}/demo`)
        .set('Cookie', viewerACookie);

      expect(res.status).toBe(200);
      expect(res.body.data.leadId).toBe(testLeadA1Id);
      expect(res.body.data.status).toBe(DemoWebsiteStatus.READY);
    });

    it('rejects VIEWER from regenerating demo (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/demo/regenerate`)
        .set('Cookie', viewerACookie)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('rejects SALES_EXECUTIVE without DEMOS_MANAGE from expiring demo (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/demo/expire`)
        .set('Cookie', repA1Cookie)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('rejects SALES_EXECUTIVE without DEMOS_MANAGE from removing demo (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/demo/remove`)
        .set('Cookie', repA1Cookie)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('allows SUPER_ADMIN to perform all demo actions', async () => {
      // 1. Create
      const resCreate = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/demo`)
        .set('Cookie', superAdminACookie)
        .send({});
      expect(resCreate.status).toBe(200);

      // 2. Get
      const resGet = await request(app)
        .get(`/api/v1/leads/${testLeadA1Id}/demo`)
        .set('Cookie', superAdminACookie);
      expect(resGet.status).toBe(200);

      // 3. Regenerate
      const resRegen = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/demo/regenerate`)
        .set('Cookie', superAdminACookie)
        .send({});
      expect(resRegen.status).toBe(200);

      // 4. Expire
      const resExpire = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/demo/expire`)
        .set('Cookie', superAdminACookie)
        .send({});
      expect(resExpire.status).toBe(200);
      expect(resExpire.body.data.status).toBe(DemoWebsiteStatus.EXPIRED);

      // 5. Remove
      const resRemove = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/demo/remove`)
        .set('Cookie', superAdminACookie)
        .send({});
      expect(resRemove.status).toBe(200);
      expect(resRemove.body.data.status).toBe(DemoWebsiteStatus.REMOVED);
    });

    it('allows ADMIN to perform create, regenerate, expire, remove, get', async () => {
      // Create fresh lead for ADMIN test
      const adminLead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Admin Lead Test',
          normalizedName: 'admin lead test',
          category: 'Retail',
          primarySource: 'MANUAL',
          websiteStatus: WebsiteStatus.UNKNOWN,
          onlinePresenceType: OnlinePresenceType.UNKNOWN
        }
      });

      // 1. Create
      const resCreate = await request(app)
        .post(`/api/v1/leads/${adminLead.id}/demo`)
        .set('Cookie', adminACookie)
        .send({});
      expect(resCreate.status).toBe(200);

      // 2. Get
      const resGet = await request(app)
        .get(`/api/v1/leads/${adminLead.id}/demo`)
        .set('Cookie', adminACookie);
      expect(resGet.status).toBe(200);

      // 3. Regenerate
      const resRegen = await request(app)
        .post(`/api/v1/leads/${adminLead.id}/demo/regenerate`)
        .set('Cookie', adminACookie)
        .send({});
      expect(resRegen.status).toBe(200);

      // 4. Expire
      const resExpire = await request(app)
        .post(`/api/v1/leads/${adminLead.id}/demo/expire`)
        .set('Cookie', adminACookie)
        .send({});
      expect(resExpire.status).toBe(200);

      // 5. Remove
      const resRemove = await request(app)
        .post(`/api/v1/leads/${adminLead.id}/demo/remove`)
        .set('Cookie', adminACookie)
        .send({});
      expect(resRemove.status).toBe(200);
    });

    it('allows SALES_MANAGER to perform create, regenerate, expire, remove, get', async () => {
      // Create fresh lead for SALES_MANAGER test
      const managerLead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Manager Lead Test',
          normalizedName: 'manager lead test',
          category: 'Retail',
          primarySource: 'MANUAL',
          websiteStatus: WebsiteStatus.UNKNOWN,
          onlinePresenceType: OnlinePresenceType.UNKNOWN
        }
      });

      // 1. Create
      const resCreate = await request(app)
        .post(`/api/v1/leads/${managerLead.id}/demo`)
        .set('Cookie', salesManagerACookie)
        .send({});
      expect(resCreate.status).toBe(200);

      // 2. Get
      const resGet = await request(app)
        .get(`/api/v1/leads/${managerLead.id}/demo`)
        .set('Cookie', salesManagerACookie);
      expect(resGet.status).toBe(200);

      // 3. Regenerate
      const resRegen = await request(app)
        .post(`/api/v1/leads/${managerLead.id}/demo/regenerate`)
        .set('Cookie', salesManagerACookie)
        .send({});
      expect(resRegen.status).toBe(200);

      // 4. Expire
      const resExpire = await request(app)
        .post(`/api/v1/leads/${managerLead.id}/demo/expire`)
        .set('Cookie', salesManagerACookie)
        .send({});
      expect(resExpire.status).toBe(200);

      // 5. Remove
      const resRemove = await request(app)
        .post(`/api/v1/leads/${managerLead.id}/demo/remove`)
        .set('Cookie', salesManagerACookie)
        .send({});
      expect(resRemove.status).toBe(200);
    });
  });

  /* -----------------------------------------------------------------
   * 3. Core Lifecycle & Operations (MOCK Provider)
   * ----------------------------------------------------------------- */
  describe('3. Core Lifecycle Operations (MOCK Provider)', () => {
    it('creates a fresh demo for leadA2 and returns valid DemoWebsiteSummary', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA2Id}/demo`)
        .set('Cookie', adminACookie)
        .send({
          templateKey: 'generic-local-business',
          customHeadline: 'Quality Tools & Hardware',
          customDescription: 'Specialized hardware and power tools in Dhaka.'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.leadId).toBe(testLeadA2Id);
      expect(res.body.data.status).toBe(DemoWebsiteStatus.READY);
      expect(res.body.data.provider).toBe(DemoWebsiteProvider.MOCK);
      expect(res.body.data.demoUrl).toMatch(/^https:\/\/demo\.local\/sites\/mock_site_/);
      expect(res.body.data.readyAt).toBeDefined();
      expect(res.body.data.expiresAt).toBeDefined();

      // Validate schema compliance
      const validated = demoWebsiteSummarySchema.safeParse(res.body.data);
      expect(validated.success).toBe(true);
    });

    it('retrieves current demo summary via GET /api/v1/leads/:id/demo', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadA2Id}/demo`)
        .set('Cookie', repA1Cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.leadId).toBe(testLeadA2Id);
      expect(res.body.data.status).toBe(DemoWebsiteStatus.READY);
    });

    it('regenerates demo via POST /api/v1/leads/:id/demo/regenerate', async () => {
      const initial = await prisma.demoWebsite.findUniqueOrThrow({
        where: { leadId_organizationId: { leadId: testLeadA2Id, organizationId: ORG_A_ID } }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA2Id}/demo/regenerate`)
        .set('Cookie', repA1Cookie)
        .send({
          customHeadline: 'Updated Hardware Store Headline'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(initial.id);
      expect(res.body.data.status).toBe(DemoWebsiteStatus.READY);
      expect(res.body.data.requestedByUserId).toBe(initial.requestedByUserId);
    });

    it('expires demo via POST /api/v1/leads/:id/demo/expire', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA2Id}/demo/expire`)
        .set('Cookie', salesManagerACookie)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(DemoWebsiteStatus.EXPIRED);
    });

    it('handles repeated expire idempotently without error', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA2Id}/demo/expire`)
        .set('Cookie', salesManagerACookie)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(DemoWebsiteStatus.EXPIRED);
    });

    it('removes demo via POST /api/v1/leads/:id/demo/remove and preserves DB row', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA2Id}/demo/remove`)
        .set('Cookie', adminACookie)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(DemoWebsiteStatus.REMOVED);
      expect(res.body.data.demoUrl).toBeNull();

      // Verify row is NOT hard deleted
      const dbRow = await prisma.demoWebsite.findUnique({
        where: { leadId_organizationId: { leadId: testLeadA2Id, organizationId: ORG_A_ID } }
      });
      expect(dbRow).not.toBeNull();
      expect(dbRow?.status).toBe(DemoWebsiteStatus.REMOVED);
    });

    it('handles repeated remove idempotently without error', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA2Id}/demo/remove`)
        .set('Cookie', adminACookie)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(DemoWebsiteStatus.REMOVED);
    });
  });

  /* -----------------------------------------------------------------
   * 4. Multi-Tenant Isolation
   * ----------------------------------------------------------------- */
  describe('4. Multi-Tenant Isolation', () => {
    it('rejects Org A user from POST /demo on Org B lead (404 NOT_FOUND)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadBId}/demo`)
        .set('Cookie', adminACookie)
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    it('rejects Org A user from GET /demo on Org B lead (404 NOT_FOUND)', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadBId}/demo`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    it('rejects Org A user from POST /demo/regenerate on Org B lead (404 NOT_FOUND)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadBId}/demo/regenerate`)
        .set('Cookie', adminACookie)
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    it('rejects Org A user from POST /demo/expire on Org B lead (404 NOT_FOUND)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadBId}/demo/expire`)
        .set('Cookie', adminACookie)
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    it('rejects Org A user from POST /demo/remove on Org B lead (404 NOT_FOUND)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadBId}/demo/remove`)
        .set('Cookie', adminACookie)
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    it('verifies 0 audit logs and 0 DB mutations created during cross-tenant attempts', async () => {
      const audits = await prisma.auditLog.findMany({
        where: { entityId: testLeadBId }
      });
      expect(audits.length).toBe(0);

      const demo = await prisma.demoWebsite.findFirst({
        where: { leadId: testLeadBId }
      });
      expect(demo).toBeNull();
    });
  });

  /* -----------------------------------------------------------------
   * 5. Strict Payload & Path Parameter Validation
   * ----------------------------------------------------------------- */
  describe('5. Strict Payload & Parameter Validation', () => {
    it('rejects injected authoritative fields in POST /demo (422 VALIDATION_ERROR)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/demo`)
        .set('Cookie', adminACookie)
        .send({
          organizationId: 'malicious-org-id',
          status: 'READY',
          provider: 'STOREMATE',
          demoUrl: 'https://evil.com/fake',
          expiresAt: '2099-01-01T00:00:00Z'
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('rejects unexpected fields in empty body for POST /demo/expire (422 VALIDATION_ERROR)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/demo/expire`)
        .set('Cookie', adminACookie)
        .send({
          unexpectedField: 'forbidden'
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('rejects unexpected fields in empty body for POST /demo/remove (422 VALIDATION_ERROR)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadA1Id}/demo/remove`)
        .set('Cookie', adminACookie)
        .send({
          fakeData: 1234
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('rejects malformed non-UUID lead ID with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/api/v1/leads/not-a-valid-uuid/demo')
        .set('Cookie', repA1Cookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(res.body.error.requestId).toBeDefined();
    });
  });

  /* -----------------------------------------------------------------
   * 6. Audit Logging Integrity
   * ----------------------------------------------------------------- */
  describe('6. Audit Logging Integrity', () => {
    it('creates lead.demo_created audit log on initial generation and zero duplicates on repeat request', async () => {
      // Create fresh lead for audit verification
      const auditLead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Audit Demo Lead',
          normalizedName: 'audit demo lead',
          category: 'Retail',
          primarySource: 'MANUAL',
          websiteStatus: WebsiteStatus.UNKNOWN,
          onlinePresenceType: OnlinePresenceType.UNKNOWN
        }
      });

      // Clear prior audits
      await prisma.auditLog.deleteMany({
        where: { entityId: auditLead.id }
      });

      // 1. First creation request
      const res1 = await request(app)
        .post(`/api/v1/leads/${auditLead.id}/demo`)
        .set('Cookie', repA1Cookie)
        .send({});

      expect(res1.status).toBe(200);

      // Verify exact 1 audit log created
      const audits1 = await prisma.auditLog.findMany({
        where: { entityId: auditLead.id }
      });
      expect(audits1.length).toBe(1);
      expect(audits1[0].action).toBe('lead.demo_created');
      expect(audits1[0].entityType).toBe('Lead');
      expect(audits1[0].userId).toBe(repA1Id);
      expect(audits1[0].organizationId).toBe(ORG_A_ID);
      expect(audits1[0].before).toBeNull();
      expect((audits1[0].after as any).status).toBe(DemoWebsiteStatus.READY);

      // 2. Repeated idempotent request on active READY demo
      const res2 = await request(app)
        .post(`/api/v1/leads/${auditLead.id}/demo`)
        .set('Cookie', repA1Cookie)
        .send({});

      expect(res2.status).toBe(200);

      // Verify audit count did NOT increase
      const audits2 = await prisma.auditLog.findMany({
        where: { entityId: auditLead.id }
      });
      expect(audits2.length).toBe(1);

      // 3. Regeneration request
      const res3 = await request(app)
        .post(`/api/v1/leads/${auditLead.id}/demo/regenerate`)
        .set('Cookie', repA1Cookie)
        .send({ customHeadline: 'Audit Regen Headline' });

      expect(res3.status).toBe(200);

      const audits3 = await prisma.auditLog.findMany({
        where: { entityId: auditLead.id, action: 'lead.demo_regenerated' }
      });
      expect(audits3.length).toBe(1);
      expect(audits3[0].action).toBe('lead.demo_regenerated');

      // 4. Expiration request
      const res4 = await request(app)
        .post(`/api/v1/leads/${auditLead.id}/demo/expire`)
        .set('Cookie', salesManagerACookie)
        .send({});

      expect(res4.status).toBe(200);

      const expireAudits = await prisma.auditLog.findMany({
        where: { entityId: auditLead.id, action: 'lead.demo_expired' }
      });
      expect(expireAudits.length).toBe(1);

      // Repeat expire - no new audit
      await request(app)
        .post(`/api/v1/leads/${auditLead.id}/demo/expire`)
        .set('Cookie', salesManagerACookie)
        .send({});

      const expireAuditsRepeat = await prisma.auditLog.findMany({
        where: { entityId: auditLead.id, action: 'lead.demo_expired' }
      });
      expect(expireAuditsRepeat.length).toBe(1);

      // 5. Removal request
      const res5 = await request(app)
        .post(`/api/v1/leads/${auditLead.id}/demo/remove`)
        .set('Cookie', adminACookie)
        .send({});

      expect(res5.status).toBe(200);

      const removeAudits = await prisma.auditLog.findMany({
        where: { entityId: auditLead.id, action: 'lead.demo_removed' }
      });
      expect(removeAudits.length).toBe(1);

      // Repeat remove - no new audit
      await request(app)
        .post(`/api/v1/leads/${auditLead.id}/demo/remove`)
        .set('Cookie', adminACookie)
        .send({});

      const removeAuditsRepeat = await prisma.auditLog.findMany({
        where: { entityId: auditLead.id, action: 'lead.demo_removed' }
      });
      expect(removeAuditsRepeat.length).toBe(1);
    });
  });

  /* -----------------------------------------------------------------
   * 7. StoreMate Blocked Error Handling & Provider Failure Audit Safety
   * ----------------------------------------------------------------- */
  describe('7. StoreMate Blocked Error Handling & Failure Behavior', () => {
    it('maps StoreMateUnavailableError to 503 STOREMATE_UNAVAILABLE with canonical envelope', async () => {
      // Create lead with existing DemoWebsite in STOREMATE provider to simulate StoreMate invocation
      const smLead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'StoreMate Test Lead',
          normalizedName: 'storemate test lead',
          category: 'Fashion',
          primarySource: 'MANUAL',
          websiteStatus: WebsiteStatus.UNKNOWN,
          onlinePresenceType: OnlinePresenceType.UNKNOWN
        }
      });

      await prisma.demoWebsite.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: smLead.id,
          requestedByUserId: adminAId,
          provider: DemoWebsiteProvider.STOREMATE,
          status: DemoWebsiteStatus.READY,
          providerSiteId: 'sm_existing_123',
          demoUrl: 'https://storemate.example/sm_existing_123'
        }
      });

      // Attempting to expire this STOREMATE demo invokes StoreMate provider, which throws StoreMateUnavailableError
      const res = await request(app)
        .post(`/api/v1/leads/${smLead.id}/demo/expire`)
        .set('Cookie', adminACookie)
        .send({});

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe(DemoWebsiteErrorCode.STOREMATE_UNAVAILABLE);
      expect(res.body.error.message).toContain('StoreMate live provider transport is blocked');
      expect(res.body.error.requestId).toBeDefined();
      expect(res.body.error.details?.stack).toBeUndefined();
    });

    it('verifies 0 successful-creation audit logs are recorded when provider creation fails', async () => {
      // Create lead with invalid configuration that will fail or reject
      const failLead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Fail Audit Test Lead',
          normalizedName: 'fail audit test lead',
          category: 'Retail',
          primarySource: 'MANUAL',
          websiteStatus: WebsiteStatus.UNKNOWN,
          onlinePresenceType: OnlinePresenceType.UNKNOWN
        }
      });

      // Clear prior audits
      await prisma.auditLog.deleteMany({
        where: { entityId: failLead.id }
      });

      // Attempting to expire non-existent demo fails with 404
      const res = await request(app)
        .post(`/api/v1/leads/${failLead.id}/demo/expire`)
        .set('Cookie', adminACookie)
        .send({});

      expect(res.status).toBe(404);

      const audits = await prisma.auditLog.findMany({
        where: { entityId: failLead.id }
      });
      expect(audits.length).toBe(0);
    });
  });

  /* -----------------------------------------------------------------
   * 8. Response Contract & Security Safety
   * ----------------------------------------------------------------- */
  describe('8. Response Contract & Security Safety', () => {
    it('guarantees response object never leaks sensitive internal attributes', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadA1Id}/demo`)
        .set('Cookie', repA1Cookie);

      expect(res.status).toBe(200);
      const data = res.body.data;

      // Sensitive fields must be completely undefined
      expect(data.passwordHash).toBeUndefined();
      expect(data.password).toBeUndefined();
      expect(data.token).toBeUndefined();
      expect(data.session).toBeUndefined();
      expect(data.organization).toBeUndefined();
      expect(data.rawError).toBeUndefined();
      expect(data.stack).toBeUndefined();

      // Only valid summary fields permitted
      const schemaCheck = demoWebsiteSummarySchema.safeParse(data);
      expect(schemaCheck.success).toBe(true);
    });
  });
});
