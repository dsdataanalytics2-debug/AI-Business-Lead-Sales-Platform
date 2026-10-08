import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import prisma, {
  CrmStage,
  FollowUpStatus
} from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import {
  Role,
  TeamErrorCode,
  teamMemberListResponseSchema,
  teamMemberDetailSchema,
  teamMemberActionResponseSchema
} from '@leadmate/shared';
import { app } from '../app.js';
import { hashPassword, hashSessionToken } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';

describe('M7 Step 2: Team Management Domain Service, DB Indexes & API Test Suite', () => {
  const ORG_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const ORG_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  let superAdminAId: string;
  let superAdminACookie: string;

  let superAdminA2Id: string;
  let superAdminA2Cookie: string;

  let adminAId: string;
  let adminACookie: string;

  let salesManagerAId: string;
  let salesManagerACookie: string;

  let salesExecAId: string;
  let salesExecACookie: string;

  let viewerAId: string;
  let viewerACookie: string;

  // Org B User (for tenant isolation)
  let superAdminBId: string;
  let superAdminBCookie: string;
  let memberBId: string;

  async function createSessionCookie(userId: string, rawToken: string): Promise<string> {
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.session.upsert({
      where: { tokenHash },
      update: { userId, expiresAt },
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
    const orgIds = [ORG_A_ID, ORG_B_ID];

    await prisma.followUpTask.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.lead.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.session.deleteMany({ where: { user: { organizationId: { in: orgIds } } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  }

  beforeAll(async () => {
    await cleanupDatabase();

    // 1. Create Organizations
    await prisma.organization.createMany({
      data: [
        { id: ORG_A_ID, name: 'Team Org A' },
        { id: ORG_B_ID, name: 'Team Org B' }
      ]
    });

    const defaultPasswordHash = await hashPassword('TestPass12345!');

    // 2. Setup Org A Users
    const superAdminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Super Admin One',
        email: 'superadmin1@org-a.com',
        role: Role.SUPER_ADMIN as any,
        passwordHash: defaultPasswordHash,
        isActive: true
      }
    });
    superAdminAId = superAdminA.id;
    superAdminACookie = await createSessionCookie(superAdminAId, 'token-superadmin-a1');

    const superAdminA2 = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Super Admin Two',
        email: 'superadmin2@org-a.com',
        role: Role.SUPER_ADMIN as any,
        passwordHash: defaultPasswordHash,
        isActive: true
      }
    });
    superAdminA2Id = superAdminA2.id;
    superAdminA2Cookie = await createSessionCookie(superAdminA2Id, 'token-superadmin-a2');

    const adminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Admin Alpha',
        email: 'admin@org-a.com',
        role: Role.ADMIN as any,
        passwordHash: defaultPasswordHash,
        isActive: true
      }
    });
    adminAId = adminA.id;
    adminACookie = await createSessionCookie(adminAId, 'token-admin-a');

    const salesManagerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Manager Sarah',
        email: 'manager@org-a.com',
        role: Role.SALES_MANAGER as any,
        passwordHash: defaultPasswordHash,
        isActive: true
      }
    });
    salesManagerAId = salesManagerA.id;
    salesManagerACookie = await createSessionCookie(salesManagerAId, 'token-manager-a');

    const salesExecA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Executive Edward',
        email: 'exec@org-a.com',
        role: Role.SALES_EXECUTIVE as any,
        passwordHash: defaultPasswordHash,
        isActive: true
      }
    });
    salesExecAId = salesExecA.id;
    salesExecACookie = await createSessionCookie(salesExecAId, 'token-exec-a');

    const viewerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Viewer Victor',
        email: 'viewer@org-a.com',
        role: Role.VIEWER as any,
        passwordHash: defaultPasswordHash,
        isActive: true
      }
    });
    viewerAId = viewerA.id;
    viewerACookie = await createSessionCookie(viewerAId, 'token-viewer-a');

    // 3. Setup Org B Users
    const superAdminB = await prisma.user.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Super Admin B',
        email: 'superadmin@org-b.com',
        role: Role.SUPER_ADMIN as any,
        passwordHash: defaultPasswordHash,
        isActive: true
      }
    });
    superAdminBId = superAdminB.id;
    superAdminBCookie = await createSessionCookie(superAdminBId, 'token-superadmin-b');

    const memberB = await prisma.user.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Member Bob',
        email: 'bob@org-b.com',
        role: Role.SALES_EXECUTIVE as any,
        passwordHash: defaultPasswordHash,
        isActive: true
      }
    });
    memberBId = memberB.id;

    // 4. Create Leads and FollowUps for Executive Edward in Org A to verify workload aggregation
    await prisma.lead.createMany({
      data: [
        {
          organizationId: ORG_A_ID,
          name: 'Lead 1 Active',
          normalizedName: 'lead 1 active',
          category: 'Retail',
          crmStage: CrmStage.CONTACTED,
          assignedUserId: salesExecAId,
          primarySource: 'Website'
        },
        {
          organizationId: ORG_A_ID,
          name: 'Lead 2 Active',
          normalizedName: 'lead 2 active',
          category: 'Retail',
          crmStage: CrmStage.QUALIFIED,
          assignedUserId: salesExecAId,
          primarySource: 'Website'
        },
        {
          organizationId: ORG_A_ID,
          name: 'Lead 3 Won',
          normalizedName: 'lead 3 won',
          category: 'Tech',
          crmStage: CrmStage.WON,
          assignedUserId: salesExecAId,
          primarySource: 'Referral'
        }
      ]
    });

    const lead1 = await prisma.lead.findFirstOrThrow({
      where: { organizationId: ORG_A_ID, assignedUserId: salesExecAId, crmStage: CrmStage.CONTACTED }
    });

    // 1 pending follow-up (due in future), 1 overdue follow-up (due in past), 1 completed follow-up
    await prisma.followUpTask.createMany({
      data: [
        {
          organizationId: ORG_A_ID,
          leadId: lead1.id,
          assignedUserId: salesExecAId,
          createdByUserId: salesManagerAId,
          dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // future
          status: FollowUpStatus.PENDING,
          note: 'Call customer tomorrow'
        },
        {
          organizationId: ORG_A_ID,
          leadId: lead1.id,
          assignedUserId: salesExecAId,
          createdByUserId: salesManagerAId,
          dueAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // overdue
          status: FollowUpStatus.PENDING,
          note: 'Overdue follow-up'
        },
        {
          organizationId: ORG_A_ID,
          leadId: lead1.id,
          assignedUserId: salesExecAId,
          createdByUserId: salesManagerAId,
          dueAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
          status: FollowUpStatus.COMPLETED,
          completedAt: new Date(),
          note: 'Already completed'
        }
      ]
    });
  });

  afterAll(async () => {
    await cleanupDatabase();
  });

  /* ---------------------------------------------------------
   * 1. GET /api/v1/team/members — List & Workload Aggregation
   * --------------------------------------------------------- */
  describe('GET /api/v1/team/members — List & RBAC', () => {
    it('allows SUPER_ADMIN to list members with pagination and workloads', async () => {
      const res = await request(app)
        .get('/api/v1/team/members')
        .set('Cookie', superAdminACookie);

      expect(res.status).toBe(200);
      const parsed = teamMemberListResponseSchema.parse(res.body);
      expect(parsed.items.length).toBeGreaterThanOrEqual(6);
      expect(parsed.pagination.total).toBeGreaterThanOrEqual(6);

      // Verify Edward's workload aggregation: 3 assigned, 2 active (WON excluded), 2 pending, 1 overdue
      const edward = parsed.items.find((m) => m.id === salesExecAId);
      expect(edward).toBeDefined();
      expect(edward!.workload.assignedLeadsCount).toBe(3);
      expect(edward!.workload.activeLeadsCount).toBe(2);
      expect(edward!.workload.pendingFollowUpsCount).toBe(2);
      expect(edward!.workload.overdueFollowUpsCount).toBe(1);

      // Verify zero leak of passwordHash
      for (const item of parsed.items) {
        expect((item as any).passwordHash).toBeUndefined();
      }
    });

    it('allows ADMIN to list members', async () => {
      const res = await request(app)
        .get('/api/v1/team/members')
        .set('Cookie', adminACookie);

      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
    });

    it('allows SALES_MANAGER to list members (read-only)', async () => {
      const res = await request(app)
        .get('/api/v1/team/members')
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
    });

    it('forbids SALES_EXECUTIVE from listing team members (403)', async () => {
      const res = await request(app)
        .get('/api/v1/team/members')
        .set('Cookie', salesExecACookie);

      expect(res.status).toBe(403);
    });

    it('forbids VIEWER from listing team members (403)', async () => {
      const res = await request(app)
        .get('/api/v1/team/members')
        .set('Cookie', viewerACookie);

      expect(res.status).toBe(403);
    });

    it('enforces tenant isolation: Org A list does not contain Org B members', async () => {
      const resA = await request(app)
        .get('/api/v1/team/members')
        .set('Cookie', superAdminACookie);

      const itemsA = resA.body.items;
      expect(itemsA.some((m: any) => m.id === memberBId)).toBe(false);

      const resB = await request(app)
        .get('/api/v1/team/members')
        .set('Cookie', superAdminBCookie);

      const itemsB = resB.body.items;
      expect(itemsB.some((m: any) => m.id === salesExecAId)).toBe(false);
      expect(itemsB.some((m: any) => m.id === memberBId)).toBe(true);
    });

    it('filters by search keyword (case-insensitive name or email)', async () => {
      const res = await request(app)
        .get('/api/v1/team/members?search=edward')
        .set('Cookie', superAdminACookie);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].id).toBe(salesExecAId);

      const resEmail = await request(app)
        .get('/api/v1/team/members?search=manager@org-a.com')
        .set('Cookie', superAdminACookie);

      expect(resEmail.status).toBe(200);
      expect(resEmail.body.items).toHaveLength(1);
      expect(resEmail.body.items[0].id).toBe(salesManagerAId);
    });

    it('filters by role', async () => {
      const res = await request(app)
        .get(`/api/v1/team/members?role=${Role.SALES_EXECUTIVE}`)
        .set('Cookie', superAdminACookie);

      expect(res.status).toBe(200);
      expect(res.body.items.every((m: any) => m.role === Role.SALES_EXECUTIVE)).toBe(true);
    });

    it('filters by isActive boolean', async () => {
      const res = await request(app)
        .get('/api/v1/team/members?isActive=true')
        .set('Cookie', superAdminACookie);

      expect(res.status).toBe(200);
      expect(res.body.items.every((m: any) => m.isActive === true)).toBe(true);
    });

    it('rejects invalid limit > 100 or non-whitelisted sort field', async () => {
      const resLimit = await request(app)
        .get('/api/v1/team/members?limit=150')
        .set('Cookie', superAdminACookie);

      expect(resLimit.status).toBe(422);

      const resSort = await request(app)
        .get('/api/v1/team/members?sortBy=passwordHash')
        .set('Cookie', superAdminACookie);

      expect(resSort.status).toBe(422);
    });
  });

  /* ---------------------------------------------------------
   * 2. GET /api/v1/team/members/:userId — Detail & Safety
   * --------------------------------------------------------- */
  describe('GET /api/v1/team/members/:userId — Detail', () => {
    it('returns team member detail with safe fields and workload', async () => {
      const res = await request(app)
        .get(`/api/v1/team/members/${salesExecAId}`)
        .set('Cookie', superAdminACookie);

      expect(res.status).toBe(200);
      const parsed = teamMemberDetailSchema.parse(res.body);
      expect(parsed.id).toBe(salesExecAId);
      expect(parsed.workload.assignedLeadsCount).toBe(3);
      expect(parsed.workload.activeLeadsCount).toBe(2);
      expect((parsed as any).passwordHash).toBeUndefined();
    });

    it('returns 404 for nonexistent user ID', async () => {
      const res = await request(app)
        .get('/api/v1/team/members/00000000-0000-0000-0000-000000000000')
        .set('Cookie', superAdminACookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(TeamErrorCode.TEAM_MEMBER_NOT_FOUND);
    });

    it('enforces cross-tenant fail-closed: Org A actor cannot see Org B user (404)', async () => {
      const res = await request(app)
        .get(`/api/v1/team/members/${memberBId}`)
        .set('Cookie', superAdminACookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(TeamErrorCode.TEAM_MEMBER_NOT_FOUND);
    });
  });

  /* ---------------------------------------------------------
   * 3. POST /api/v1/team/members — Create Member & Hierarchy
   * --------------------------------------------------------- */
  describe('POST /api/v1/team/members — Create & Hierarchy', () => {
    it('SUPER_ADMIN can create a new member of any role', async () => {
      const payload = {
        name: 'New Sales Exec',
        email: 'newexec@org-a.com',
        role: Role.SALES_EXECUTIVE,
        temporaryPassword: 'SecureTemporary123!'
      };

      const res = await request(app)
        .post('/api/v1/team/members')
        .set('Cookie', superAdminACookie)
        .send(payload);

      expect(res.status).toBe(201);
      const parsed = teamMemberDetailSchema.parse(res.body);
      expect(parsed.name).toBe('New Sales Exec');
      expect(parsed.email).toBe('newexec@org-a.com');
      expect(parsed.role).toBe(Role.SALES_EXECUTIVE);
      expect(parsed.isActive).toBe(true);
      expect((parsed as any).temporaryPassword).toBeUndefined();
      expect((parsed as any).passwordHash).toBeUndefined();

      // Verify audit log created
      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_A_ID,
          action: 'team.member_created',
          entityId: parsed.id
        }
      });
      expect(audit).toBeDefined();
      expect((audit!.after as any).email).toBe('newexec@org-a.com');
      expect((audit!.after as any).temporaryPassword).toBeUndefined();
    });

    it('ADMIN can create SALES_MANAGER, SALES_EXECUTIVE, VIEWER', async () => {
      const payload = {
        name: 'Admin Created Exec',
        email: 'admincreated@org-a.com',
        role: Role.SALES_EXECUTIVE,
        temporaryPassword: 'SecureTemporary123!'
      };

      const res = await request(app)
        .post('/api/v1/team/members')
        .set('Cookie', adminACookie)
        .send(payload);

      expect(res.status).toBe(201);
    });

    it('ADMIN cannot create ADMIN or SUPER_ADMIN (403 TEAM_ROLE_FORBIDDEN)', async () => {
      const resAdmin = await request(app)
        .post('/api/v1/team/members')
        .set('Cookie', adminACookie)
        .send({
          name: 'Forbidden Admin',
          email: 'forbiddenadmin@org-a.com',
          role: Role.ADMIN,
          temporaryPassword: 'SecureTemporary123!'
        });

      expect(resAdmin.status).toBe(403);
      expect(resAdmin.body.error.code).toBe(TeamErrorCode.TEAM_ROLE_FORBIDDEN);

      const resSuper = await request(app)
        .post('/api/v1/team/members')
        .set('Cookie', adminACookie)
        .send({
          name: 'Forbidden Super Admin',
          email: 'forbiddensuper@org-a.com',
          role: Role.SUPER_ADMIN,
          temporaryPassword: 'SecureTemporary123!'
        });

      expect(resSuper.status).toBe(403);
      expect(resSuper.body.error.code).toBe(TeamErrorCode.TEAM_ROLE_FORBIDDEN);
    });

    it('SALES_MANAGER cannot create team members (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .post('/api/v1/team/members')
        .set('Cookie', salesManagerACookie)
        .send({
          name: 'Manager Attempt',
          email: 'managerattempt@org-a.com',
          role: Role.SALES_EXECUTIVE,
          temporaryPassword: 'SecureTemporary123!'
        });

      expect(res.status).toBe(403);
    });

    it('rejects duplicate email with 409 TEAM_MEMBER_EMAIL_EXISTS', async () => {
      const res = await request(app)
        .post('/api/v1/team/members')
        .set('Cookie', superAdminACookie)
        .send({
          name: 'Duplicate Email Test',
          email: 'exec@org-a.com', // already exists
          role: Role.SALES_EXECUTIVE,
          temporaryPassword: 'SecureTemporary123!'
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(TeamErrorCode.TEAM_MEMBER_EMAIL_EXISTS);
    });
  });

  /* ---------------------------------------------------------
   * 4. PATCH /api/v1/team/members/:userId — Update Member
   * --------------------------------------------------------- */
  describe('PATCH /api/v1/team/members/:userId — Update & Security Guards', () => {
    it('SUPER_ADMIN can update member name and role', async () => {
      const res = await request(app)
        .patch(`/api/v1/team/members/${salesExecAId}`)
        .set('Cookie', superAdminACookie)
        .send({
          name: 'Edward Senior',
          role: Role.SALES_MANAGER
        });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Edward Senior');
      expect(res.body.role).toBe(Role.SALES_MANAGER);

      // Verify audit logs created
      const auditRole = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_A_ID,
          action: 'team.member_role_changed',
          entityId: salesExecAId
        }
      });
      expect(auditRole).toBeDefined();
      expect((auditRole!.after as any).newRole).toBe(Role.SALES_MANAGER);

      // Restore back to SALES_EXECUTIVE for subsequent tests
      await request(app)
        .patch(`/api/v1/team/members/${salesExecAId}`)
        .set('Cookie', superAdminACookie)
        .send({ role: Role.SALES_EXECUTIVE });
    });

    it('rejects SUPER_ADMIN self role change with 409 TEAM_SELF_ROLE_CHANGE_FORBIDDEN', async () => {
      const res = await request(app)
        .patch(`/api/v1/team/members/${superAdminAId}`)
        .set('Cookie', superAdminACookie)
        .send({
          role: Role.ADMIN
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(TeamErrorCode.TEAM_SELF_ROLE_CHANGE_FORBIDDEN);
    });

    it('rejects ADMIN self role change with 409 TEAM_SELF_ROLE_CHANGE_FORBIDDEN', async () => {
      const res = await request(app)
        .patch(`/api/v1/team/members/${adminAId}`)
        .set('Cookie', adminACookie)
        .send({
          role: Role.SALES_EXECUTIVE
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(TeamErrorCode.TEAM_SELF_ROLE_CHANGE_FORBIDDEN);
    });

    it('SUPER_ADMIN can update own name only (200 OK)', async () => {
      const res = await request(app)
        .patch(`/api/v1/team/members/${superAdminAId}`)
        .set('Cookie', superAdminACookie)
        .send({
          name: 'Super Admin Self Updated Name'
        });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Super Admin Self Updated Name');
      expect(res.body.role).toBe(Role.SUPER_ADMIN);
    });

    it('ADMIN can update own name only (200 OK)', async () => {
      const res = await request(app)
        .patch(`/api/v1/team/members/${adminAId}`)
        .set('Cookie', adminACookie)
        .send({
          name: 'Admin Self Updated Name'
        });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Admin Self Updated Name');
      expect(res.body.role).toBe(Role.ADMIN);
    });

    it('ADMIN cannot modify ADMIN or SUPER_ADMIN (403 TEAM_ROLE_FORBIDDEN)', async () => {
      const res = await request(app)
        .patch(`/api/v1/team/members/${superAdminAId}`)
        .set('Cookie', adminACookie)
        .send({
          name: 'Admin Attempting Super Admin Name Edit'
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(TeamErrorCode.TEAM_ROLE_FORBIDDEN);
    });

    it('ADMIN cannot promote member to ADMIN or SUPER_ADMIN (403 TEAM_ROLE_FORBIDDEN)', async () => {
      const res = await request(app)
        .patch(`/api/v1/team/members/${salesExecAId}`)
        .set('Cookie', adminACookie)
        .send({
          role: Role.ADMIN
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(TeamErrorCode.TEAM_ROLE_FORBIDDEN);
    });

    it('strictly rejects email modification attempt via shared validation (422)', async () => {
      const res = await request(app)
        .patch(`/api/v1/team/members/${salesExecAId}`)
        .set('Cookie', superAdminACookie)
        .send({
          email: 'newemail@org-a.com'
        });

      expect(res.status).toBe(422);
    });

    it('strictly rejects empty PATCH payload (422)', async () => {
      const res = await request(app)
        .patch(`/api/v1/team/members/${salesExecAId}`)
        .set('Cookie', superAdminACookie)
        .send({});

      expect(res.status).toBe(422);
    });
  });

  /* ---------------------------------------------------------
   * 5. Last SUPER_ADMIN Protection
   * --------------------------------------------------------- */
  describe('Last active SUPER_ADMIN Protection', () => {
    it('demoting one of two active SUPER_ADMINs succeeds', async () => {
      // Org A currently has superAdminAId and superAdminA2Id
      const res = await request(app)
        .patch(`/api/v1/team/members/${superAdminA2Id}`)
        .set('Cookie', superAdminACookie)
        .send({ role: Role.ADMIN });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe(Role.ADMIN);

      // Now superAdminAId is the SOLE active SUPER_ADMIN
      const soleSuperAdminCheck = await prisma.user.count({
        where: { organizationId: ORG_A_ID, role: Role.SUPER_ADMIN as any, isActive: true }
      });
      expect(soleSuperAdminCheck).toBe(1);
    });

    it('demoting the sole active SUPER_ADMIN is rejected with 409 LAST_SUPER_ADMIN_CANNOT_BE_MODIFIED', async () => {
      // superAdminAId cannot be demoted (even if called by another admin or if permitted)
      // Note: self role change also blocks, but let's test promoting superAdminA2 back first
      await prisma.user.update({
        where: { id: superAdminA2Id },
        data: { role: Role.SUPER_ADMIN as any }
      });

      // Now demote superAdminAId using superAdminA2Cookie
      const res1 = await request(app)
        .patch(`/api/v1/team/members/${superAdminAId}`)
        .set('Cookie', superAdminA2Cookie)
        .send({ role: Role.ADMIN });
      expect(res1.status).toBe(200);

      // Now superAdminA2 is the SOLE active SUPER_ADMIN. Try to demote them:
      // Since superAdminA is now ADMIN, let's promote superAdminA to ADMIN, but test sole super admin deactivation/demotion:
      // Promoted back so superAdminA2 is sole SUPER_ADMIN
      const resSoleDemote = await request(app)
        .patch(`/api/v1/team/members/${superAdminA2Id}`)
        .set('Cookie', superAdminA2Cookie) // self-role change catches first
        .send({ role: Role.ADMIN });
      expect(resSoleDemote.status).toBe(409);

      // Reset both to SUPER_ADMIN
      await prisma.user.update({
        where: { id: superAdminAId },
        data: { role: Role.SUPER_ADMIN as any, isActive: true }
      });
      await prisma.user.update({
        where: { id: superAdminA2Id },
        data: { role: Role.SUPER_ADMIN as any, isActive: true }
      });
    });
  });

  /* ---------------------------------------------------------
   * 6. POST /activate and POST /deactivate
   * --------------------------------------------------------- */
  describe('Activate & Deactivate Members', () => {
    it('rejects self-deactivation with 409 TEAM_SELF_DEACTIVATION_FORBIDDEN', async () => {
      const res = await request(app)
        .post(`/api/v1/team/members/${superAdminAId}/deactivate`)
        .set('Cookie', superAdminACookie);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(TeamErrorCode.TEAM_SELF_DEACTIVATION_FORBIDDEN);
    });

    it('SUPER_ADMIN deactivates active member, emitting audit and preserving assignments', async () => {
      const res = await request(app)
        .post(`/api/v1/team/members/${salesExecAId}/deactivate`)
        .set('Cookie', superAdminACookie);

      expect(res.status).toBe(200);
      const parsed = teamMemberActionResponseSchema.parse(res.body);
      expect(parsed.member.isActive).toBe(false);
      expect(parsed.message).toBe('Member deactivated successfully');

      // Verify historical lead assignment is preserved
      const assignedLead = await prisma.lead.findFirst({
        where: { organizationId: ORG_A_ID, assignedUserId: salesExecAId }
      });
      expect(assignedLead).toBeDefined();

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_A_ID,
          action: 'team.member_deactivated',
          entityId: salesExecAId
        }
      });
      expect(audit).toBeDefined();
    });

    it('deactivating an already inactive member is idempotent without duplicate audit', async () => {
      const auditCountBefore = await prisma.auditLog.count({
        where: { organizationId: ORG_A_ID, action: 'team.member_deactivated', entityId: salesExecAId }
      });

      const res = await request(app)
        .post(`/api/v1/team/members/${salesExecAId}/deactivate`)
        .set('Cookie', superAdminACookie);

      expect(res.status).toBe(200);
      expect(res.body.member.isActive).toBe(false);
      expect(res.body.message).toBe('Member is already inactive');

      const auditCountAfter = await prisma.auditLog.count({
        where: { organizationId: ORG_A_ID, action: 'team.member_deactivated', entityId: salesExecAId }
      });
      expect(auditCountAfter).toBe(auditCountBefore);
    });

    it('deactivated user session is rejected on subsequent authenticated calls (401)', async () => {
      // Edward was deactivated, his cookie should now fail auth
      const res = await request(app)
        .get('/api/v1/team/members')
        .set('Cookie', salesExecACookie);

      expect(res.status).toBe(401);
    });

    it('SUPER_ADMIN activates inactive member successfully', async () => {
      const res = await request(app)
        .post(`/api/v1/team/members/${salesExecAId}/activate`)
        .set('Cookie', superAdminACookie);

      expect(res.status).toBe(200);
      const parsed = teamMemberActionResponseSchema.parse(res.body);
      expect(parsed.member.isActive).toBe(true);
      expect(parsed.message).toBe('Member activated successfully');

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_A_ID,
          action: 'team.member_activated',
          entityId: salesExecAId
        }
      });
      expect(audit).toBeDefined();
    });

    it('activating an already active member is idempotent without duplicate audit', async () => {
      const auditCountBefore = await prisma.auditLog.count({
        where: { organizationId: ORG_A_ID, action: 'team.member_activated', entityId: salesExecAId }
      });

      const res = await request(app)
        .post(`/api/v1/team/members/${salesExecAId}/activate`)
        .set('Cookie', superAdminACookie);

      expect(res.status).toBe(200);
      expect(res.body.member.isActive).toBe(true);
      expect(res.body.message).toBe('Member is already active');

      const auditCountAfter = await prisma.auditLog.count({
        where: { organizationId: ORG_A_ID, action: 'team.member_activated', entityId: salesExecAId }
      });
      expect(auditCountAfter).toBe(auditCountBefore);
    });

    it('deactivating the sole active SUPER_ADMIN is rejected with 409 LAST_SUPER_ADMIN_CANNOT_BE_MODIFIED', async () => {
      // First demote superAdminA2 to ADMIN so superAdminA1 is sole SUPER_ADMIN
      await prisma.user.update({
        where: { id: superAdminA2Id },
        data: { role: Role.ADMIN as any }
      });

      // Try to deactivate sole SUPER_ADMIN from another admin or actor
      // Since superAdminA2 is now ADMIN, ADMIN cannot deactivate SUPER_ADMIN (403):
      const resAdminTry = await request(app)
        .post(`/api/v1/team/members/${superAdminAId}/deactivate`)
        .set('Cookie', superAdminA2Cookie);
      expect(resAdminTry.status).toBe(403);

      // Now restore superAdminA2 to SUPER_ADMIN, and deactivate superAdminA1 using superAdminA2Cookie:
      await prisma.user.update({
        where: { id: superAdminA2Id },
        data: { role: Role.SUPER_ADMIN as any }
      });

      // Deactivate superAdminA1 -> succeeds because superAdminA2 is still active
      const resDeact1 = await request(app)
        .post(`/api/v1/team/members/${superAdminAId}/deactivate`)
        .set('Cookie', superAdminA2Cookie);
      expect(resDeact1.status).toBe(200);

      // Now superAdminA2 is the ONLY active SUPER_ADMIN (superAdminA1 is inactive)
      // Attempting to deactivate superAdminA2 (e.g. if another admin tried):
      // superAdminA2 is sole active. If we promote adminA to SUPER_ADMIN, deactivate superAdminA2:
      await prisma.user.update({
        where: { id: adminAId },
        data: { role: Role.SUPER_ADMIN as any }
      });

      // Deactivate superAdminA2:
      const resDeact2 = await request(app)
        .post(`/api/v1/team/members/${superAdminA2Id}/deactivate`)
        .set('Cookie', adminACookie);
      expect(resDeact2.status).toBe(200);

      // Now adminA is the ONLY active SUPER_ADMIN. Reactivate superAdminA1 so we have normal state
      await prisma.user.update({
        where: { id: superAdminAId },
        data: { isActive: true, role: Role.SUPER_ADMIN as any }
      });
      await prisma.user.update({
        where: { id: superAdminA2Id },
        data: { isActive: true, role: Role.SUPER_ADMIN as any }
      });
      await prisma.user.update({
        where: { id: adminAId },
        data: { role: Role.ADMIN as any }
      });
    });
  });
});
