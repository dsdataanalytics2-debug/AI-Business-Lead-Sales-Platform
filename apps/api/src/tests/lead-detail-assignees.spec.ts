/**
 * Lead Detail CRM Bridge & Assignee Directory API Tests (M3 Step 6A)
 *
 * Covers:
 * 1. GET /api/v1/leads/:id CRM fields:
 *    - crmStage (always present, defaults to NEW)
 *    - assignedUserId, assignedAt, assignedUser (null when unassigned)
 *    - assignedUser summary projection ({ id, name, email } when assigned)
 *    - No internal fields leaked (passwordHash, role, sessions, tokens)
 *    - Tenant isolation (cross-tenant lead returns 404)
 *    - Non-existent lead returns 404
 *    - Permissions: LEADS_READ can access (including VIEWER)
 *    - Unauthenticated returns 401
 * 2. GET /api/v1/leads/assignees directory:
 *    - Permissions: LEADS_ASSIGN can access (SALES_MANAGER, ADMIN, SUPER_ADMIN)
 *    - Users without LEADS_ASSIGN (SALES_EXECUTIVE, VIEWER) get 403
 *    - Unauthenticated returns 401
 *    - Returns only same-tenant users
 *    - Filters out inactive users (isActive: false)
 *    - Excludes cross-tenant users
 *    - Projections: only { id, name, email }
 *    - Deterministic ordering: name ASC, email ASC
 *    - Route order safety: GET /assignees is NOT captured by GET /:id
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import prisma, {
  Role,
  CrmStage,
  WebsiteStatus,
  OnlinePresenceType
} from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import { ErrorCodes, Permissions } from '@leadmate/shared';
import { app } from '../app.js';
import { hashPassword, hashSessionToken } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';

describe('M3 Step 6A: Lead Detail CRM Bridge & Assignee Directory Verification', () => {
  const ORG_A_ID = '77777777-7777-7777-7777-777777777701';
  const ORG_B_ID = '88888888-8888-8888-8888-888888888802';

  let superAdminAId: string;
  let superAdminACookie: string;

  let adminAId: string;
  let adminACookie: string;

  let managerAId: string;
  let managerACookie: string;

  let repAId: string;
  let repACookie: string;

  let repA2Id: string;

  let inactiveUserAId: string;

  let viewerAId: string;
  let viewerACookie: string;

  let managerBId: string;
  let managerBCookie: string;

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
    await prisma.crmActivity.deleteMany({});
    await prisma.crmNote.deleteMany({});
    await prisma.contactEvidence.deleteMany({});
    await prisma.leadContact.deleteMany({});
    await prisma.leadSource.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.auditLog.deleteMany({});
  }

  beforeAll(async () => {
    await ensureTestDatabase(prisma);
    await cleanupDatabase();
    await prisma.session.deleteMany({});
    await prisma.user.deleteMany({
      where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } }
    });

    // 1. Setup Tenant Organizations
    await prisma.organization.upsert({
      where: { id: ORG_A_ID },
      update: {},
      create: {
        id: ORG_A_ID,
        name: 'M3 6A Tenant Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.upsert({
      where: { id: ORG_B_ID },
      update: {},
      create: {
        id: ORG_B_ID,
        name: 'M3 6A Tenant Org B',
        timezone: 'Asia/Dhaka'
      }
    });

    const defaultPassword = await hashPassword('TestPass12345!');

    // 2. Setup Org A Users
    const superAdminA = await prisma.user.create({
      data: {
        email: 'superadmin-6a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Super Admin A',
        role: Role.SUPER_ADMIN,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    superAdminAId = superAdminA.id;
    superAdminACookie = await createSessionCookie(superAdminAId, 'token-superadmin-6a');

    const adminA = await prisma.user.create({
      data: {
        email: 'admin-6a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Alice Admin',
        role: Role.ADMIN,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    adminAId = adminA.id;
    adminACookie = await createSessionCookie(adminAId, 'token-admin-6a');

    const managerA = await prisma.user.create({
      data: {
        email: 'manager-6a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Bob Manager',
        role: Role.SALES_MANAGER,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    managerAId = managerA.id;
    managerACookie = await createSessionCookie(managerAId, 'token-manager-6a');

    const repA = await prisma.user.create({
      data: {
        email: 'rep-6a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Charlie Rep',
        role: Role.SALES_EXECUTIVE,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    repAId = repA.id;
    repACookie = await createSessionCookie(repAId, 'token-rep-6a');

    const repA2 = await prisma.user.create({
      data: {
        email: 'rep2-6a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'David Rep',
        role: Role.SALES_EXECUTIVE,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    repA2Id = repA2.id;

    // Inactive user in Org A
    const inactiveUserA = await prisma.user.create({
      data: {
        email: 'inactive-6a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Inactive User',
        role: Role.SALES_EXECUTIVE,
        organizationId: ORG_A_ID,
        isActive: false
      }
    });
    inactiveUserAId = inactiveUserA.id;

    const viewerA = await prisma.user.create({
      data: {
        email: 'viewer-6a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Eve Viewer',
        role: Role.VIEWER,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    viewerAId = viewerA.id;
    viewerACookie = await createSessionCookie(viewerAId, 'token-viewer-6a');

    // 3. Setup Org B User
    const managerB = await prisma.user.create({
      data: {
        email: 'manager-b-6a@leadmate.test',
        passwordHash: defaultPassword,
        name: 'Zara Org B',
        role: Role.SALES_MANAGER,
        organizationId: ORG_B_ID,
        isActive: true
      }
    });
    managerBId = managerB.id;
    managerBCookie = await createSessionCookie(managerBId, 'token-manager-b-6a');
  });

  beforeEach(async () => {
    await cleanupDatabase();

    // Re-create test leads for each test
    const leadA1 = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Alpha Dental Care',
        normalizedName: 'alpha dental care',
        category: 'Dental Clinic',
        city: 'Dhaka',
        country: 'BD',
        websiteStatus: WebsiteStatus.NONE_DETECTED,
        onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
        primarySource: 'TEST',
        crmStage: CrmStage.NEW
      }
    });
    testLeadA1Id = leadA1.id;

    const leadA2 = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Beta Healthcare Clinic',
        normalizedName: 'beta healthcare clinic',
        category: 'Clinic',
        city: 'Dhaka',
        country: 'BD',
        websiteStatus: WebsiteStatus.NONE_DETECTED,
        onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
        primarySource: 'TEST',
        crmStage: CrmStage.QUALIFIED,
        assignedUserId: repAId,
        assignedAt: new Date()
      }
    });
    testLeadA2Id = leadA2.id;

    const leadB = await prisma.lead.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Gamma Solutions Org B',
        normalizedName: 'gamma solutions org b',
        category: 'Software',
        city: 'Dhaka',
        country: 'BD',
        websiteStatus: WebsiteStatus.NONE_DETECTED,
        onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
        primarySource: 'TEST',
        crmStage: CrmStage.NEW
      }
    });
    testLeadBId = leadB.id;
  });

  afterAll(async () => {
    try {
      await cleanupDatabase();
      await prisma.user.deleteMany({
        where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } }
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [ORG_A_ID, ORG_B_ID] } }
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  /* =========================================================================
   * Section 1: Lead Detail CRM Fields (GET /api/v1/leads/:id)
   * ========================================================================= */
  describe('1. GET /api/v1/leads/:id CRM Fields', () => {
    it('returns 401 UNAUTHENTICATED when not logged in', async () => {
      const res = await request(app).get(`/api/v1/leads/${testLeadA1Id}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    });

    it('returns default crmStage: NEW and null assignment for unassigned lead', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadA1Id}`)
        .set('Cookie', viewerACookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBe(testLeadA1Id);
      expect(res.body.data.crmStage).toBe(CrmStage.NEW);
      expect(res.body.data.assignedUserId).toBeNull();
      expect(res.body.data.assignedAt).toBeNull();
      expect(res.body.data.assignedUser).toBeNull();
    });

    it('returns populated crmStage, assignedUserId, assignedAt, and assignedUser for assigned lead', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadA2Id}`)
        .set('Cookie', managerACookie);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBe(testLeadA2Id);
      expect(res.body.data.crmStage).toBe(CrmStage.QUALIFIED);
      expect(res.body.data.assignedUserId).toBe(repAId);
      expect(res.body.data.assignedAt).toBeDefined();
      expect(res.body.data.assignedUser).toEqual({
        id: repAId,
        name: 'Charlie Rep',
        email: 'rep-6a@leadmate.test'
      });

      // Confirm NO internal auth data leaked in assignedUser
      expect((res.body.data.assignedUser as any).passwordHash).toBeUndefined();
      expect((res.body.data.assignedUser as any).role).toBeUndefined();
      expect((res.body.data.assignedUser as any).isActive).toBeUndefined();
      expect((res.body.data.assignedUser as any).organizationId).toBeUndefined();
    });

    it('returns 404 NOT_FOUND when accessing lead of another organization (tenant isolation)', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${testLeadBId}`)
        .set('Cookie', managerACookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(res.body.error.message).toMatch(/Lead with ID.*not found/);
    });

    it('returns 404 NOT_FOUND for non-existent lead ID', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000999';
      const res = await request(app)
        .get(`/api/v1/leads/${nonExistentId}`)
        .set('Cookie', managerACookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    it('returns CRM fields in PATCH /api/v1/leads/:id response', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${testLeadA2Id}`)
        .set('Cookie', managerACookie)
        .send({ category: 'Specialized Clinic' });

      expect(res.status).toBe(200);
      expect(res.body.data.category).toBe('Specialized Clinic');
      expect(res.body.data.crmStage).toBe(CrmStage.QUALIFIED);
      expect(res.body.data.assignedUserId).toBe(repAId);
      expect(res.body.data.assignedUser).toEqual({
        id: repAId,
        name: 'Charlie Rep',
        email: 'rep-6a@leadmate.test'
      });
    });
  });

  /* =========================================================================
   * Section 2: Safe Assignee Directory (GET /api/v1/leads/assignees)
   * ========================================================================= */
  describe('2. GET /api/v1/leads/assignees Directory', () => {
    it('returns 401 UNAUTHENTICATED when unauthenticated', async () => {
      const res = await request(app).get('/api/v1/leads/assignees');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    });

    it('allows SALES_MANAGER (with Permissions.LEADS_ASSIGN) to list assignees', async () => {
      const res = await request(app)
        .get('/api/v1/leads/assignees')
        .set('Cookie', managerACookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('allows ADMIN and SUPER_ADMIN (with Permissions.LEADS_ASSIGN) to list assignees', async () => {
      const resAdmin = await request(app)
        .get('/api/v1/leads/assignees')
        .set('Cookie', adminACookie);

      expect(resAdmin.status).toBe(200);

      const resSuperAdmin = await request(app)
        .get('/api/v1/leads/assignees')
        .set('Cookie', superAdminACookie);

      expect(resSuperAdmin.status).toBe(200);
    });

    it('denies SALES_EXECUTIVE (without Permissions.LEADS_ASSIGN) with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get('/api/v1/leads/assignees')
        .set('Cookie', repACookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(res.body.error.message).toMatch(/Permission.*required/);
    });

    it('denies VIEWER (without Permissions.LEADS_ASSIGN) with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get('/api/v1/leads/assignees')
        .set('Cookie', viewerACookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('returns ONLY active users belonging to the caller organization, with exact safe fields', async () => {
      const res = await request(app)
        .get('/api/v1/leads/assignees')
        .set('Cookie', managerACookie);

      expect(res.status).toBe(200);
      const assignees: Array<{ id: string; name: string; email: string }> = res.body.data;

      // Org A has active users: Alice Admin, Bob Manager, Charlie Rep, David Rep, Eve Viewer, Super Admin A
      // Inactive user (inactive-6a@leadmate.test) must NOT be present
      // Org B user (Zara Org B) must NOT be present
      const emails = assignees.map((u) => u.email);
      expect(emails).toContain('admin-6a@leadmate.test');
      expect(emails).toContain('manager-6a@leadmate.test');
      expect(emails).toContain('rep-6a@leadmate.test');
      expect(emails).toContain('rep2-6a@leadmate.test');
      expect(emails).toContain('viewer-6a@leadmate.test');
      expect(emails).toContain('superadmin-6a@leadmate.test');

      expect(emails).not.toContain('inactive-6a@leadmate.test');
      expect(emails).not.toContain('manager-b-6a@leadmate.test');

      // Check safe field shape strictly
      for (const item of assignees) {
        expect(Object.keys(item).sort()).toEqual(['email', 'id', 'name']);
        expect(typeof item.id).toBe('string');
        expect(typeof item.name).toBe('string');
        expect(typeof item.email).toBe('string');
      }
    });

    it('returns assignees deterministically sorted by name ASC, email ASC', async () => {
      const res = await request(app)
        .get('/api/v1/leads/assignees')
        .set('Cookie', managerACookie);

      expect(res.status).toBe(200);
      const names = res.body.data.map((u: any) => u.name);

      const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sortedNames);
    });

    it('ensures /assignees static route is NOT captured as dynamic /:id route', async () => {
      // Calling /api/v1/leads/assignees should return 200 array, NOT a lead detail or 404 lead error
      const res = await request(app)
        .get('/api/v1/leads/assignees')
        .set('Cookie', managerACookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data[0].id).toBeDefined();
    });
  });
});
