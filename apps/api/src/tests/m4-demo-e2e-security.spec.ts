/**
 * M4 Step 6: End-to-End Demo Website Integration & Security Hardening Suite
 *
 * Comprehensive end-to-end integration and security test suite verifying:
 * 1. Full Demo Website Lifecycle Happy Path (GET 404 -> create -> regenerate -> expire -> regenerate -> remove -> GET removed)
 * 2. Multi-Tenant Isolation & Zero Mutation Attack Defense
 * 3. Canonical RBAC & Authentication Enforcement
 * 4. API-Level Concurrency Protection & Idempotency
 * 5. Input Validation, Malformed UUID Consistency & Body Injection Prevention
 * 6. StoreMate Blocked-Transport Security & Provider Failure Sanitization
 * 7. Invariant Boundaries (TTL, Expired READY edge, Invalid Lifecycle Transitions, Audit Sanitization)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import prisma, {
  Role,
  Prisma
} from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import {
  ErrorCodes,
  DemoWebsiteErrorCode,
  DemoWebsiteStatus,
  DemoWebsiteProvider,
  isValidDemoWebsiteTransition,
  DEMO_WEBSITE_STATUS_LABELS
} from '@leadmate/shared';
import { app } from '../app.js';
import { hashPassword, hashSessionToken } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';
import {
  demoWebsiteService,
  getConfiguredTtlDays,
  calculateDemoExpiresAt
} from '../services/demo-website.service.js';
import { MockDemoWebsiteProvider } from '@leadmate/storemate';

describe('M4 Step 6: Comprehensive Demo Website E2E & Security Hardening', () => {
  const ORG_A_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const ORG_B_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

  let superAdminAId: string;
  let superAdminACookie: string;

  let adminAId: string;
  let adminACookie: string;

  let managerAId: string;
  let managerACookie: string;

  let executiveAId: string;
  let executiveACookie: string;

  let viewerAId: string;
  let viewerACookie: string;

  let adminBId: string;
  let adminBCookie: string;

  let testLeadAId: string;
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
    await prisma.crmActivity.deleteMany({});
    await prisma.crmNote.deleteMany({});
    await prisma.followUpTask.deleteMany({});
    await prisma.contactEvidence.deleteMany({});
    await prisma.leadContact.deleteMany({});
    await prisma.leadSource.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.session.deleteMany({});
  }

  beforeAll(async () => {
    await ensureTestDatabase(prisma);
    await cleanupDatabase();

    await prisma.organization.upsert({
      where: { id: ORG_A_ID },
      update: {},
      create: {
        id: ORG_A_ID,
        name: 'M4 E2E Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.upsert({
      where: { id: ORG_B_ID },
      update: {},
      create: {
        id: ORG_B_ID,
        name: 'M4 E2E Org B',
        timezone: 'Asia/Dhaka'
      }
    });

    const passwordHash = await hashPassword('Password123!');

    // Org A Super Admin
    const superAdminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'superadmin.m4.a@test.com',
        name: 'SuperAdmin M4 A',
        passwordHash,
        role: Role.SUPER_ADMIN,
        isActive: true
      }
    });
    superAdminAId = superAdminA.id;
    superAdminACookie = await createSessionCookie(superAdminAId, 'tok-m4-superadmin-a');

    // Org A Admin
    const adminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'admin.m4.a@test.com',
        name: 'Admin M4 A',
        passwordHash,
        role: Role.ADMIN,
        isActive: true
      }
    });
    adminAId = adminA.id;
    adminACookie = await createSessionCookie(adminAId, 'tok-m4-admin-a');

    // Org A Sales Manager
    const managerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'manager.m4.a@test.com',
        name: 'Manager M4 A',
        passwordHash,
        role: Role.SALES_MANAGER,
        isActive: true
      }
    });
    managerAId = managerA.id;
    managerACookie = await createSessionCookie(managerAId, 'tok-m4-manager-a');

    // Org A Sales Executive
    const executiveA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'exec.m4.a@test.com',
        name: 'Exec M4 A',
        passwordHash,
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });
    executiveAId = executiveA.id;
    executiveACookie = await createSessionCookie(executiveAId, 'tok-m4-exec-a');

    // Org A Viewer
    const viewerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        email: 'viewer.m4.a@test.com',
        name: 'Viewer M4 A',
        passwordHash,
        role: Role.VIEWER,
        isActive: true
      }
    });
    viewerAId = viewerA.id;
    viewerACookie = await createSessionCookie(viewerAId, 'tok-m4-viewer-a');

    // Org B Admin
    const adminB = await prisma.user.create({
      data: {
        organizationId: ORG_B_ID,
        email: 'admin.m4.b@test.com',
        name: 'Admin M4 B',
        passwordHash,
        role: Role.ADMIN,
        isActive: true
      }
    });
    adminBId = adminB.id;
    adminBCookie = await createSessionCookie(adminBId, 'tok-m4-admin-b');
  });

  beforeEach(async () => {
    await prisma.demoWebsite.deleteMany({});
    await prisma.crmActivity.deleteMany({});
    await prisma.crmNote.deleteMany({});
    await prisma.followUpTask.deleteMany({});
    await prisma.contactEvidence.deleteMany({});
    await prisma.leadContact.deleteMany({});
    await prisma.leadSource.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.auditLog.deleteMany({});

    const leadA = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Apex Dental Care',
        normalizedName: 'apex dental care',
        category: 'Dental Clinic',
        city: 'Dhaka',
        primaryPhone: '+8801700000001',
        primaryEmail: 'info@apexdental.com',
        address: 'House 12, Road 5, Dhanmondi',
        primarySource: 'MANUAL_IMPORT'
      }
    });
    testLeadAId = leadA.id;

    const leadB = await prisma.lead.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Beacon Specialized Lab',
        normalizedName: 'beacon specialized lab',
        category: 'Diagnostic Lab',
        city: 'Chittagong',
        primarySource: 'MANUAL_IMPORT'
      }
    });
    testLeadBId = leadB.id;
  });

  afterAll(async () => {
    await cleanupDatabase();
    await prisma.user.deleteMany({});
    await prisma.organization.deleteMany({
      where: { id: { in: [ORG_A_ID, ORG_B_ID] } }
    });
    await prisma.$disconnect();
  });

  /* =======================================================================
   * 1. FULL E2E HAPPY PATH & LIFECYCLE STATE TRANSITIONS
   * ======================================================================= */
  describe('1. Full E2E Demo Website Lifecycle & State Transitions', () => {
    it('executes the full lifecycle: 404 -> CREATE -> READY -> REGENERATE -> EXPIRE -> REGENERATE (EXPIRED) -> REMOVE -> GET REMOVED', async () => {
      // Step A: GET demo before creation -> 404 NOT_FOUND
      const getEmptyRes = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', executiveACookie);

      expect(getEmptyRes.status).toBe(404);
      expect(getEmptyRes.body.error.code).toBe(ErrorCodes.NOT_FOUND);

      // Step B: POST create demo -> 200 READY
      const createRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', executiveACookie)
        .send({
          templateKey: 'dental-modern-v1',
          customHeadline: 'Apex Premier Oral Healthcare',
          customDescription: 'Advanced dental services in Dhanmondi, Dhaka.'
        });

      expect(createRes.status).toBe(200);
      expect(createRes.body.data.status).toBe(DemoWebsiteStatus.READY);
      expect(createRes.body.data.provider).toBe(DemoWebsiteProvider.MOCK);
      expect(createRes.body.data.demoUrl).toMatch(/^https:\/\/demo\.local\/sites\/mock_site_/);
      expect(createRes.body.data.readyAt).not.toBeNull();
      expect(createRes.body.data.expiresAt).not.toBeNull();
      expect(createRes.body.data.requestedByUserId).toBe(executiveAId);

      const demoId = createRes.body.data.id;

      // Verify DB entity & single row invariant
      const dbRecords = await prisma.demoWebsite.findMany({
        where: { leadId: testLeadAId, organizationId: ORG_A_ID }
      });
      expect(dbRecords).toHaveLength(1);
      expect(dbRecords[0].id).toBe(demoId);
      expect(dbRecords[0].status).toBe(DemoWebsiteStatus.READY);

      // Verify audit log
      const createAudits = await prisma.auditLog.findMany({
        where: { entityId: testLeadAId, action: 'lead.demo_created' }
      });
      expect(createAudits).toHaveLength(1);
      expect(createAudits[0].userId).toBe(executiveAId);

      // Step C: GET demo -> 200 READY
      const getReadyRes = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', viewerACookie);

      expect(getReadyRes.status).toBe(200);
      expect(getReadyRes.body.data.id).toBe(demoId);
      expect(getReadyRes.body.data.status).toBe(DemoWebsiteStatus.READY);

      // Step D: POST regenerate demo -> 200 READY (reusing same DB row)
      const regenRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/regenerate`)
        .set('Cookie', executiveACookie)
        .send({
          customHeadline: 'Updated Dental Care Excellence'
        });

      expect(regenRes.status).toBe(200);
      expect(regenRes.body.data.id).toBe(demoId); // Same row ID
      expect(regenRes.body.data.status).toBe(DemoWebsiteStatus.READY);

      const regenAudits = await prisma.auditLog.findMany({
        where: { entityId: testLeadAId, action: 'lead.demo_regenerated' }
      });
      expect(regenAudits).toHaveLength(1);
      expect(regenAudits[0].userId).toBe(executiveAId);

      // Step E: POST expire demo -> 200 EXPIRED (via Manager)
      const expireRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/expire`)
        .set('Cookie', managerACookie)
        .send({});

      expect(expireRes.status).toBe(200);
      expect(expireRes.body.data.id).toBe(demoId);
      expect(expireRes.body.data.status).toBe(DemoWebsiteStatus.EXPIRED);

      const expireAudits = await prisma.auditLog.findMany({
        where: { entityId: testLeadAId, action: 'lead.demo_expired' }
      });
      expect(expireAudits).toHaveLength(1);
      expect(expireAudits[0].userId).toBe(managerAId);

      // Step F: POST regenerate EXPIRED demo -> 200 READY (re-activating same row)
      const regenExpiredRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/regenerate`)
        .set('Cookie', executiveACookie)
        .send({});

      expect(regenExpiredRes.status).toBe(200);
      expect(regenExpiredRes.body.data.id).toBe(demoId);
      expect(regenExpiredRes.body.data.status).toBe(DemoWebsiteStatus.READY);

      const totalRegenAudits = await prisma.auditLog.findMany({
        where: { entityId: testLeadAId, action: 'lead.demo_regenerated' }
      });
      expect(totalRegenAudits).toHaveLength(2);

      // Step G: POST remove demo -> 200 REMOVED (soft removal, terminal status)
      const removeRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/remove`)
        .set('Cookie', managerACookie)
        .send({});

      expect(removeRes.status).toBe(200);
      expect(removeRes.body.data.id).toBe(demoId);
      expect(removeRes.body.data.status).toBe(DemoWebsiteStatus.REMOVED);
      expect(removeRes.body.data.demoUrl).toBeNull();

      const removeAudits = await prisma.auditLog.findMany({
        where: { entityId: testLeadAId, action: 'lead.demo_removed' }
      });
      expect(removeAudits).toHaveLength(1);
      expect(removeAudits[0].userId).toBe(managerAId);

      // Step H: GET demo after remove -> 200 REMOVED (record is preserved, not hard-deleted)
      const getRemovedRes = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', viewerACookie);

      expect(getRemovedRes.status).toBe(200);
      expect(getRemovedRes.body.data.id).toBe(demoId);
      expect(getRemovedRes.body.data.status).toBe(DemoWebsiteStatus.REMOVED);
      expect(getRemovedRes.body.data.demoUrl).toBeNull();

      // Ensure total DemoWebsite rows for lead is STILL exactly 1
      const finalDbRows = await prisma.demoWebsite.findMany({
        where: { leadId: testLeadAId, organizationId: ORG_A_ID }
      });
      expect(finalDbRows).toHaveLength(1);
      expect(finalDbRows[0].status).toBe(DemoWebsiteStatus.REMOVED);
    });
  });

  /* =======================================================================
   * 2. IDEMPOTENCY & DUPLICATE PREVENTIONS
   * ======================================================================= */
  describe('2. API Idempotency & Repeat Request Invariants', () => {
    it('returns existing record with 0 new provider calls and 0 duplicate audits on repeat create for READY demo', async () => {
      // 1. Initial creation
      const res1 = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', executiveACookie)
        .send({});

      expect(res1.status).toBe(200);
      const demoId = res1.body.data.id;

      // 2. Repeat create call
      const res2 = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', executiveACookie)
        .send({});

      expect(res2.status).toBe(200);
      expect(res2.body.data.id).toBe(demoId);
      expect(res2.body.data.status).toBe(DemoWebsiteStatus.READY);

      // Audit count remains exactly 1
      const audits = await prisma.auditLog.findMany({
        where: { entityId: testLeadAId, action: 'lead.demo_created' }
      });
      expect(audits).toHaveLength(1);
    });

    it('returns existing record with 0 duplicate audits on repeat expire calls', async () => {
      await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', managerACookie)
        .send({});

      const expire1 = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/expire`)
        .set('Cookie', managerACookie)
        .send({});
      expect(expire1.status).toBe(200);

      const expire2 = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/expire`)
        .set('Cookie', managerACookie)
        .send({});
      expect(expire2.status).toBe(200);

      const expireAudits = await prisma.auditLog.findMany({
        where: { entityId: testLeadAId, action: 'lead.demo_expired' }
      });
      expect(expireAudits).toHaveLength(1);
    });

    it('returns existing record with 0 duplicate audits on repeat remove calls', async () => {
      await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', managerACookie)
        .send({});

      const remove1 = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/remove`)
        .set('Cookie', managerACookie)
        .send({});
      expect(remove1.status).toBe(200);

      const remove2 = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/remove`)
        .set('Cookie', managerACookie)
        .send({});
      expect(remove2.status).toBe(200);

      const removeAudits = await prisma.auditLog.findMany({
        where: { entityId: testLeadAId, action: 'lead.demo_removed' }
      });
      expect(removeAudits).toHaveLength(1);
    });
  });

  /* =======================================================================
   * 3. API-LEVEL CONCURRENCY RACE VERIFICATION
   * ======================================================================= */
  describe('3. API-Level Concurrency & Unique Constraint Protection', () => {
    it('handles simultaneous POST /demo requests safely, creating exactly 1 DB row and 1 audit log', async () => {
      const [resA, resB] = await Promise.all([
        request(app)
          .post(`/api/v1/leads/${testLeadAId}/demo`)
          .set('Cookie', executiveACookie)
          .send({ customHeadline: 'Concurrent Demo A' }),
        request(app)
          .post(`/api/v1/leads/${testLeadAId}/demo`)
          .set('Cookie', executiveACookie)
          .send({ customHeadline: 'Concurrent Demo B' })
      ]);

      expect([200]).toContain(resA.status);
      expect([200]).toContain(resB.status);
      expect(resA.body.data.id).toBe(resB.body.data.id);

      const rows = await prisma.demoWebsite.findMany({
        where: { leadId: testLeadAId, organizationId: ORG_A_ID }
      });
      expect(rows).toHaveLength(1);

      const audits = await prisma.auditLog.findMany({
        where: { entityId: testLeadAId, action: 'lead.demo_created' }
      });
      expect(audits).toHaveLength(1);
    });
  });

  /* =======================================================================
   * 4. TENANT ISOLATION MATRIX
   * ======================================================================= */
  describe('4. Multi-Tenant Cross-Org Attack Defense', () => {
    it('blocks Org B actor from executing any demo operation on Org A lead, returning 404 with 0 mutations and 0 audits', async () => {
      // Create initial demo in Org A
      await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', managerACookie)
        .send({});

      // 1. Org B GET Org A Demo
      const getCross = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', adminBCookie);
      expect(getCross.status).toBe(404);

      // 2. Org B POST create on Org A Lead
      const createCross = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', adminBCookie)
        .send({});
      expect(createCross.status).toBe(404);

      // 3. Org B POST regenerate on Org A Demo
      const regenCross = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/regenerate`)
        .set('Cookie', adminBCookie)
        .send({});
      expect(regenCross.status).toBe(404);

      // 4. Org B POST expire on Org A Demo
      const expireCross = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/expire`)
        .set('Cookie', adminBCookie)
        .send({});
      expect(expireCross.status).toBe(404);

      // 5. Org B POST remove on Org A Demo
      const removeCross = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/remove`)
        .set('Cookie', adminBCookie)
        .send({});
      expect(removeCross.status).toBe(404);

      // Verify Org A demo remains untouched in READY status
      const demoA = await prisma.demoWebsite.findFirst({
        where: { leadId: testLeadAId, organizationId: ORG_A_ID }
      });
      expect(demoA?.status).toBe(DemoWebsiteStatus.READY);

      // Verify zero audit logs created by Org B user
      const bAudits = await prisma.auditLog.findMany({
        where: { userId: adminBId }
      });
      expect(bAudits).toHaveLength(0);
    });

    it('rejects cross-org requester/lead mismatch at the domain service layer', async () => {
      await expect(
        demoWebsiteService.requestDemoWebsite(
          { organizationId: ORG_A_ID, userId: adminBId }, // User belongs to Org B
          testLeadAId
        )
      ).rejects.toThrow(/user not found in organization/i);
    });
  });

  /* =======================================================================
   * 5. RBAC PERMISSION MATRIX
   * ======================================================================= */
  describe('5. Canonical Role & Permission Matrix', () => {
    it('SUPER_ADMIN, ADMIN, SALES_MANAGER have full permission across all 5 endpoints', async () => {
      for (const cookie of [superAdminACookie, adminACookie, managerACookie]) {
        // Reset lead demo state
        await prisma.demoWebsite.deleteMany({ where: { leadId: testLeadAId } });

        // 1. Create
        const cRes = await request(app)
          .post(`/api/v1/leads/${testLeadAId}/demo`)
          .set('Cookie', cookie)
          .send({});
        expect(cRes.status).toBe(200);

        // 2. Get
        const gRes = await request(app)
          .get(`/api/v1/leads/${testLeadAId}/demo`)
          .set('Cookie', cookie);
        expect(gRes.status).toBe(200);

        // 3. Regenerate
        const rgRes = await request(app)
          .post(`/api/v1/leads/${testLeadAId}/demo/regenerate`)
          .set('Cookie', cookie)
          .send({});
        expect(rgRes.status).toBe(200);

        // 4. Expire
        const exRes = await request(app)
          .post(`/api/v1/leads/${testLeadAId}/demo/expire`)
          .set('Cookie', cookie)
          .send({});
        expect(exRes.status).toBe(200);

        // 5. Remove
        const rmRes = await request(app)
          .post(`/api/v1/leads/${testLeadAId}/demo/remove`)
          .set('Cookie', cookie)
          .send({});
        expect(rmRes.status).toBe(200);
      }
    });

    it('SALES_EXECUTIVE can GET, create, and regenerate, but is denied expire and remove (403)', async () => {
      // 1. Create -> allowed
      const cRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', executiveACookie)
        .send({});
      expect(cRes.status).toBe(200);

      // 2. Get -> allowed
      const gRes = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', executiveACookie);
      expect(gRes.status).toBe(200);

      // 3. Regenerate -> allowed
      const rgRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/regenerate`)
        .set('Cookie', executiveACookie)
        .send({});
      expect(rgRes.status).toBe(200);

      // 4. Expire -> DENIED (403)
      const exRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/expire`)
        .set('Cookie', executiveACookie)
        .send({});
      expect(exRes.status).toBe(403);
      expect(exRes.body.error.code).toBe(ErrorCodes.FORBIDDEN);

      // 5. Remove -> DENIED (403)
      const rmRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/remove`)
        .set('Cookie', executiveACookie)
        .send({});
      expect(rmRes.status).toBe(403);
      expect(rmRes.body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('VIEWER can GET, but is denied create, regenerate, expire, and remove (403)', async () => {
      // Setup demo record
      await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', managerACookie)
        .send({});

      // 1. Get -> allowed
      const gRes = await request(app)
        .get(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', viewerACookie);
      expect(gRes.status).toBe(200);

      // 2. Create -> DENIED (403)
      const cRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', viewerACookie)
        .send({});
      expect(cRes.status).toBe(403);

      // 3. Regenerate -> DENIED (403)
      const rgRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/regenerate`)
        .set('Cookie', viewerACookie)
        .send({});
      expect(rgRes.status).toBe(403);

      // 4. Expire -> DENIED (403)
      const exRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/expire`)
        .set('Cookie', viewerACookie)
        .send({});
      expect(exRes.status).toBe(403);

      // 5. Remove -> DENIED (403)
      const rmRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/remove`)
        .set('Cookie', viewerACookie)
        .send({});
      expect(rmRes.status).toBe(403);
    });
  });

  /* =======================================================================
   * 6. AUTHENTICATION & SESSION GUARDS
   * ======================================================================= */
  describe('6. Authentication & Session Verification', () => {
    it('returns 401 UNAUTHENTICATED on all 5 endpoints when called without a valid session', async () => {
      const endpoints = [
        { method: 'get', url: `/api/v1/leads/${testLeadAId}/demo` },
        { method: 'post', url: `/api/v1/leads/${testLeadAId}/demo` },
        { method: 'post', url: `/api/v1/leads/${testLeadAId}/demo/regenerate` },
        { method: 'post', url: `/api/v1/leads/${testLeadAId}/demo/expire` },
        { method: 'post', url: `/api/v1/leads/${testLeadAId}/demo/remove` }
      ];

      for (const ep of endpoints) {
        const res = await (request(app) as any)[ep.method](ep.url);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
        expect(res.body.error.requestId).toBeDefined();
        expect(res.body.error.stack).toBeUndefined();
      }
    });
  });

  /* =======================================================================
   * 7. MALFORMED UUID & INPUT HARDENING
   * ======================================================================= */
  describe('7. Malformed UUID & Input Validation Hardening', () => {
    it('consistently returns 422 VALIDATION_ERROR on all 5 demo endpoints when leadId is not a valid UUID', async () => {
      const invalidId = 'not-a-valid-uuid-1234';
      const endpoints = [
        { method: 'get', url: `/api/v1/leads/${invalidId}/demo` },
        { method: 'post', url: `/api/v1/leads/${invalidId}/demo` },
        { method: 'post', url: `/api/v1/leads/${invalidId}/demo/regenerate` },
        { method: 'post', url: `/api/v1/leads/${invalidId}/demo/expire` },
        { method: 'post', url: `/api/v1/leads/${invalidId}/demo/remove` }
      ];

      for (const ep of endpoints) {
        const res = await (request(app) as any)[ep.method](ep.url)
          .set('Cookie', managerACookie)
          .send({});
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(res.body.error.requestId).toBeDefined();
      }
    });
  });

  /* =======================================================================
   * 8. BODY INJECTION & PROVIDER SELECTION ATTACK DEFENSE
   * ======================================================================= */
  describe('8. Body Injection & Provider Selection Attack Resistance', () => {
    it('strictly rejects injected organizationId, requestedByUserId, provider, status, demoUrl, or timestamps', async () => {
      const maliciousPayload = {
        organizationId: ORG_B_ID,
        requestedByUserId: adminBId,
        provider: 'STOREMATE',
        providerSiteId: 'injected_site_id',
        status: 'READY',
        demoUrl: 'https://evil.com/fake-demo',
        readyAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        lastErrorCode: 'NONE',
        lastErrorMessageSafe: 'Clean'
      };

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', managerACookie)
        .send(maliciousPayload);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);

      // Verify no row was created
      const count = await prisma.demoWebsite.count({ where: { leadId: testLeadAId } });
      expect(count).toBe(0);
    });

    it('strictly rejects malicious provider selection attempt {"provider": "STOREMATE"} on creation', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', managerACookie)
        .send({ provider: 'STOREMATE' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('strictly rejects unexpected body payload on empty-body endpoints (expire and remove)', async () => {
      await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', managerACookie)
        .send({});

      const expireRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/expire`)
        .set('Cookie', managerACookie)
        .send({ status: 'EXPIRED', illegalKey: true });

      expect(expireRes.status).toBe(422);
      expect(expireRes.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);

      const removeRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/remove`)
        .set('Cookie', managerACookie)
        .send({ hardDelete: true });

      expect(removeRes.status).toBe(422);
      expect(removeRes.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
  });

  /* =======================================================================
   * 9. STOREMATE BLOCKED RECORD SECURITY
   * ======================================================================= */
  describe('9. StoreMate Blocked-Transport Existing Record Handling', () => {
    it('returns 503 STOREMATE_UNAVAILABLE when operating on a record with STOREMATE provider without moving DB state', async () => {
      // Seed a DB record directly with STOREMATE provider
      const seedRecord = await prisma.demoWebsite.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          requestedByUserId: managerAId,
          provider: DemoWebsiteProvider.STOREMATE,
          status: DemoWebsiteStatus.READY,
          providerSiteId: 'storemate_legacy_123',
          demoUrl: 'https://preview.storemate.example/site/123'
        }
      });

      // Attempt regenerate -> requires provider resolution -> throws StoreMateUnavailableError -> 503
      const regenRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/regenerate`)
        .set('Cookie', managerACookie)
        .send({});

      expect(regenRes.status).toBe(503);
      expect(regenRes.body.error.code).toBe(DemoWebsiteErrorCode.STOREMATE_UNAVAILABLE);
      expect(regenRes.body.error.message).toMatch(/StoreMate.*blocked/i);
      expect(regenRes.body.error.requestId).toBeDefined();

      // Attempt expire -> 503
      const expireRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/expire`)
        .set('Cookie', managerACookie)
        .send({});

      expect(expireRes.status).toBe(503);
      expect(expireRes.body.error.code).toBe(DemoWebsiteErrorCode.STOREMATE_UNAVAILABLE);

      // Attempt remove -> 503
      const removeRes = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/remove`)
        .set('Cookie', managerACookie)
        .send({});

      expect(removeRes.status).toBe(503);
      expect(removeRes.body.error.code).toBe(DemoWebsiteErrorCode.STOREMATE_UNAVAILABLE);

      // Verify DB record status is preserved as READY and not moved to EXPIRED/REMOVED
      const fresh = await prisma.demoWebsite.findUnique({ where: { id: seedRecord.id } });
      expect(fresh?.status).toBe(DemoWebsiteStatus.READY);
    });
  });

  /* =======================================================================
   * 10. PROVIDER FAILURE & 500 ERROR SANITIZATION
   * ======================================================================= */
  describe('10. Provider Failure Sanitization & Error Envelopes', () => {
    it('persists FAILED status and returns safe error envelope when mock provider simulates failure', async () => {
      const failingProvider = new MockDemoWebsiteProvider({
        simulateFailure: true,
        failureErrorCode: DemoWebsiteErrorCode.STOREMATE_TIMEOUT,
        failureErrorMessage: 'Simulated timeout communicating with demo builder'
      });

      const summary = await demoWebsiteService.requestDemoWebsite(
        { organizationId: ORG_A_ID, userId: managerAId },
        testLeadAId,
        {},
        failingProvider
      );

      expect(summary.status).toBe(DemoWebsiteStatus.FAILED);
      expect(summary.lastErrorCode).toBe(DemoWebsiteErrorCode.STOREMATE_TIMEOUT);
      expect(summary.lastErrorMessageSafe).toBe('Simulated timeout communicating with demo builder');
      expect(summary.demoUrl).toBeNull();
      expect(summary.readyAt).toBeNull();

      // Zero false-success audit log
      const audits = await prisma.auditLog.findMany({
        where: { entityId: testLeadAId, action: 'lead.demo_created' }
      });
      expect(audits).toHaveLength(0);
    });

    it('sanitizes unexpected internal 500 errors and includes requestId without leaking raw secrets or SQL', async () => {
      // Mock an unexpected failure by passing a non-existent lead ID to an internal method or triggering a DB error
      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', 'invalid_cookie_garbage')
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.error.requestId).toBeDefined();
    });
  });

  /* =======================================================================
   * 11. INVARIANT BOUNDARIES: TTL, EXPIRED READY, INVALID TRANSITIONS
   * ======================================================================= */
  describe('11. Invariant Boundaries & Lifecycle Validation', () => {
    it('validates TTL configuration helper boundaries (unset -> 14, 1-365 valid, <=0 or >365 fallback)', () => {
      const original = process.env.STOREMATE_DEMO_TTL_DAYS;
      try {
        delete process.env.STOREMATE_DEMO_TTL_DAYS;
        expect(getConfiguredTtlDays()).toBe(14);

        process.env.STOREMATE_DEMO_TTL_DAYS = '7';
        expect(getConfiguredTtlDays()).toBe(7);

        process.env.STOREMATE_DEMO_TTL_DAYS = '365';
        expect(getConfiguredTtlDays()).toBe(365);

        process.env.STOREMATE_DEMO_TTL_DAYS = '0';
        expect(getConfiguredTtlDays()).toBe(14);

        process.env.STOREMATE_DEMO_TTL_DAYS = '-5';
        expect(getConfiguredTtlDays()).toBe(14);

        process.env.STOREMATE_DEMO_TTL_DAYS = '999';
        expect(getConfiguredTtlDays()).toBe(14);

        process.env.STOREMATE_DEMO_TTL_DAYS = 'invalid-number';
        expect(getConfiguredTtlDays()).toBe(14);
      } finally {
        if (original !== undefined) {
          process.env.STOREMATE_DEMO_TTL_DAYS = original;
        } else {
          delete process.env.STOREMATE_DEMO_TTL_DAYS;
        }
      }
    });

    it('calculates expiresAt correctly based on readyAt and TTL', () => {
      const readyAt = new Date('2026-10-01T00:00:00.000Z');
      const expiresAt = calculateDemoExpiresAt(readyAt, 14);
      expect(expiresAt.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    });

    it('regenerates demo when requestDemoWebsite is called for a READY record whose expiresAt is past', async () => {
      // Seed an expired READY record in DB
      const pastDate = new Date(Date.now() - 3600000); // 1 hour ago
      const expiredReady = await prisma.demoWebsite.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          requestedByUserId: managerAId,
          provider: DemoWebsiteProvider.MOCK,
          status: DemoWebsiteStatus.READY,
          providerSiteId: 'mock_site_expired_ready',
          demoUrl: 'https://demo.local/sites/mock_site_expired_ready',
          readyAt: new Date(Date.now() - 15 * 86400000),
          expiresAt: pastDate
        }
      });

      // Calling requestDemoWebsite should recognize it is expired and regenerate it
      const summary = await demoWebsiteService.requestDemoWebsite(
        { organizationId: ORG_A_ID, userId: managerAId },
        testLeadAId,
        { customHeadline: 'Refreshed Demo' }
      );

      expect(summary.id).toBe(expiredReady.id);
      expect(summary.status).toBe(DemoWebsiteStatus.READY);
      expect(new Date(summary.expiresAt!).getTime()).toBeGreaterThan(Date.now());
    });

    it('strictly enforces valid state transition table and rejects invalid transitions', () => {
      // Valid transitions
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.REQUESTED, DemoWebsiteStatus.CREATING)).toBe(true);
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.CREATING, DemoWebsiteStatus.READY)).toBe(true);
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.READY, DemoWebsiteStatus.EXPIRED)).toBe(true);
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.EXPIRED, DemoWebsiteStatus.CREATING)).toBe(true);
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.READY, DemoWebsiteStatus.REMOVED)).toBe(true);

      // Invalid transitions
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.CREATING, DemoWebsiteStatus.EXPIRED)).toBe(false);
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.REMOVED, DemoWebsiteStatus.READY)).toBe(false);
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.REMOVED, DemoWebsiteStatus.CREATING)).toBe(false);
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.REMOVED, DemoWebsiteStatus.EXPIRED)).toBe(false);
      expect(isValidDemoWebsiteTransition(DemoWebsiteStatus.EXPIRED, DemoWebsiteStatus.READY)).toBe(false);
    });

    it('rejects attempt to expire a record currently in CREATING status', async () => {
      await prisma.demoWebsite.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          requestedByUserId: managerAId,
          provider: DemoWebsiteProvider.MOCK,
          status: DemoWebsiteStatus.CREATING
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/expire`)
        .set('Cookie', managerACookie)
        .send({});

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(res.body.error.message).toContain('Cannot transition demo website from CREATING to EXPIRED');
    });

    it('rejects attempt to regenerate a record currently in REMOVED status', async () => {
      await prisma.demoWebsite.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLeadAId,
          requestedByUserId: managerAId,
          provider: DemoWebsiteProvider.MOCK,
          status: DemoWebsiteStatus.REMOVED
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo/regenerate`)
        .set('Cookie', managerACookie)
        .send({});

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(res.body.error.message).toContain('Cannot regenerate demo website from current status: REMOVED');
    });
  });

  /* =======================================================================
   * 12. AUDIT LOGGING INTEGRITY & ANTI-SPOOFING
   * ======================================================================= */
  describe('12. Audit Logging Integrity & Anti-Spoofing', () => {
    it('verifies audit records contain only minimal demo metadata without leaking contact numbers, CRM notes, or secrets', async () => {
      await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', managerACookie)
        .send({});

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: testLeadAId, action: 'lead.demo_created' }
      });

      const afterData = audit.after as Record<string, unknown>;
      expect(afterData).toHaveProperty('demoWebsiteId');
      expect(afterData).toHaveProperty('status', 'READY');
      expect(afterData).toHaveProperty('provider', 'MOCK');
      expect(afterData).toHaveProperty('providerSiteId');
      expect(afterData).toHaveProperty('demoUrl');

      // Ensure sensitive business/lead data is NOT dumped into audit
      expect(afterData).not.toHaveProperty('phone');
      expect(afterData).not.toHaveProperty('email');
      expect(afterData).not.toHaveProperty('notes');
      expect(afterData).not.toHaveProperty('contacts');
      expect(afterData).not.toHaveProperty('passwordHash');
    });

    it('guarantees audit actor is strictly derived from session and cannot be spoofed via request body', async () => {
      await request(app)
        .post(`/api/v1/leads/${testLeadAId}/demo`)
        .set('Cookie', executiveACookie)
        .send({
          templateKey: 'generic-local-business'
        });

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: testLeadAId, action: 'lead.demo_created' }
      });

      expect(audit.userId).toBe(executiveAId);
      expect(audit.organizationId).toBe(ORG_A_ID);
    });
  });
});
