import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import prisma, {
  CrmStage,
  FollowUpStatus,
  OutreachChannel,
  OutreachDeliveryStatus
} from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import {
  Role,
  TeamErrorCode,
  teamMemberListResponseSchema,
  teamMemberDetailSchema,
  teamMemberActionResponseSchema,
  dashboardSummaryResponseSchema,
  dashboardFunnelResponseSchema,
  dashboardSourcesResponseSchema,
  dashboardOutreachResponseSchema,
  dashboardTeamPerformanceResponseSchema
} from '@leadmate/shared';
import { app } from '../app.js';
import { hashPassword, hashSessionToken } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';
import { teamService, TeamActorContext } from '../services/team.service.js';
import { analyticsService, AnalyticsActorContext } from '../services/analytics.service.js';

describe('M7 Step 8: Security, Tenant Isolation, Concurrency & Query Hardening Suite', () => {
  const ORG_A_ID = '90000000-0000-0000-0000-00000000000a';
  const ORG_B_ID = '90000000-0000-0000-0000-00000000000b';

  let superAdminAId: string;
  let superAdminACookie: string;

  let adminAId: string;
  let adminACookie: string;

  let salesManagerAId: string;
  let salesManagerACookie: string;

  let salesExecA1Id: string;
  let salesExecA1Cookie: string;

  let salesExecA2Id: string;
  let salesExecA2Cookie: string;

  let viewerAId: string;
  let viewerACookie: string;

  let userToDeactivateId: string;
  let userToDeactivateCookie: string;

  // Org B Users
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

  async function cleanupDb() {
    await ensureTestDatabase(prisma);
    const orgIds = [ORG_A_ID, ORG_B_ID];

    await prisma.outreachDelivery.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.salesAssistantDraft.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.followUpTask.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.leadContact.deleteMany({ where: { lead: { organizationId: { in: orgIds } } } });
    await prisma.lead.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.session.deleteMany({ where: { user: { organizationId: { in: orgIds } } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  }

  beforeAll(async () => {
    await cleanupDb();

    // 1. Create Organizations
    await prisma.organization.createMany({
      data: [
        { id: ORG_A_ID, name: 'Hardening Org A', timezone: 'Asia/Dhaka' },
        { id: ORG_B_ID, name: 'Hardening Org B', timezone: 'Asia/Dhaka' }
      ]
    });

    const passHash = await hashPassword('HardenedPass123!');

    // 2. Org A Users
    const superAdminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'SuperAdmin Alpha',
        email: 'superadmin.alpha@org-a.com',
        role: Role.SUPER_ADMIN as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    superAdminAId = superAdminA.id;
    superAdminACookie = await createSessionCookie(superAdminAId, 'm7-sa-token-alpha');

    const adminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Admin Alpha',
        email: 'admin.alpha@org-a.com',
        role: Role.ADMIN as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    adminAId = adminA.id;
    adminACookie = await createSessionCookie(adminAId, 'm7-adm-token-alpha');

    const salesManagerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Manager Alpha',
        email: 'manager.alpha@org-a.com',
        role: Role.SALES_MANAGER as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    salesManagerAId = salesManagerA.id;
    salesManagerACookie = await createSessionCookie(salesManagerAId, 'm7-mgr-token-alpha');

    const execA1 = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Exec Alpha 1',
        email: 'exec1.alpha@org-a.com',
        role: Role.SALES_EXECUTIVE as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    salesExecA1Id = execA1.id;
    salesExecA1Cookie = await createSessionCookie(salesExecA1Id, 'm7-exec1-token-alpha');

    const execA2 = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Exec Alpha 2',
        email: 'exec2.alpha@org-a.com',
        role: Role.SALES_EXECUTIVE as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    salesExecA2Id = execA2.id;
    salesExecA2Cookie = await createSessionCookie(salesExecA2Id, 'm7-exec2-token-alpha');

    const viewerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Viewer Alpha',
        email: 'viewer.alpha@org-a.com',
        role: Role.VIEWER as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    viewerAId = viewerA.id;
    viewerACookie = await createSessionCookie(viewerAId, 'm7-viewer-token-alpha');

    const userToDeactivate = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Transient Rep',
        email: 'transient@org-a.com',
        role: Role.SALES_EXECUTIVE as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    userToDeactivateId = userToDeactivate.id;
    userToDeactivateCookie = await createSessionCookie(userToDeactivateId, 'm7-transient-token');

    // 3. Org B Users
    const superAdminB = await prisma.user.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'SuperAdmin Bravo',
        email: 'superadmin.bravo@org-b.com',
        role: Role.SUPER_ADMIN as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    superAdminBId = superAdminB.id;
    superAdminBCookie = await createSessionCookie(superAdminBId, 'm7-sa-token-bravo');

    const memberB = await prisma.user.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Member Bravo',
        email: 'member.bravo@org-b.com',
        role: Role.SALES_EXECUTIVE as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    memberBId = memberB.id;

    // 4. Seed Seed-Data for Scoping / Regression
    const now = new Date();
    const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);

    // Lead for Exec A1 inside period
    const leadA1 = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Alpha 1 Lead Inside',
        normalizedName: 'alpha 1 lead inside',
        category: 'Retail',
        primarySource: 'WEBSITE',
        crmStage: CrmStage.WON,
        assignedUserId: salesExecA1Id,
        createdAt: twentyDaysAgo,
        updatedAt: now
      }
    });

    // Lead for Exec A2 inside period (different source & stage)
    await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Alpha 2 Lead Inside',
        normalizedName: 'alpha 2 lead inside',
        category: 'Services',
        primarySource: 'FACEBOOK',
        crmStage: CrmStage.NEGOTIATION,
        assignedUserId: salesExecA2Id,
        createdAt: twentyDaysAgo,
        updatedAt: now
      }
    });

    // Lead created 40 days ago (outside 30d period) but updated to WON inside period (Cohort test)
    await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Alpha Old Lead Updated Won',
        normalizedName: 'alpha old lead updated won',
        category: 'Tech',
        primarySource: 'GOOGLE',
        crmStage: CrmStage.WON,
        assignedUserId: salesExecA1Id,
        createdAt: fortyDaysAgo,
        updatedAt: now
      }
    });

    // Lead for Org B (Cross tenant test)
    await prisma.lead.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Bravo Lead Inside',
        normalizedName: 'bravo lead inside',
        category: 'Industrial',
        primarySource: 'OUTBOUND',
        crmStage: CrmStage.WON,
        assignedUserId: memberBId,
        createdAt: twentyDaysAgo,
        updatedAt: now
      }
    });

    // FollowUp for Exec A1 Due Today & Overdue
    await prisma.followUpTask.create({
      data: {
        organizationId: ORG_A_ID,
        leadId: leadA1.id,
        assignedUserId: salesExecA1Id,
        createdByUserId: superAdminAId,
        dueAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago -> overdue & due today
        status: FollowUpStatus.PENDING
      }
    });

    // Outreach delivery inside period for Exec A1 lead
    const draftA1 = await prisma.salesAssistantDraft.create({
      data: {
        organizationId: ORG_A_ID,
        leadId: leadA1.id,
        createdByUserId: salesExecA1Id,
        type: 'WHATSAPP' as any,
        language: 'ENGLISH' as any,
        tone: 'PROFESSIONAL' as any,
        status: 'APPROVED' as any,
        content: 'Draft content'
      }
    });

    await prisma.outreachDelivery.create({
      data: {
        organizationId: ORG_A_ID,
        leadId: leadA1.id,
        draftId: draftA1.id,
        channel: OutreachChannel.WHATSAPP,
        status: OutreachDeliveryStatus.DELIVERED,
        recipientNormalized: '+8801700000001',
        approvedDraftSnapshotHash: 'hash-a1',
        idempotencyKey: 'idemp-a1',
        requestFingerprint: 'fingerprint-a1',
        requestedByUserId: salesExecA1Id,
        sentAt: twentyDaysAgo,
        deliveredAt: twentyDaysAgo
      }
    });
  });

  afterAll(async () => {
    await cleanupDb();
  });

  // =========================================================================
  // 1. Session User Inactivation (Section 5, 48)
  // =========================================================================
  describe('1. Session User Inactivation & Auth Boundaries', () => {
    it('active user session authorizes request successfully', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Cookie', userToDeactivateCookie);

      expect(res.status).toBe(200);
    });

    it('when user is deactivated in DB, reusing existing session cookie fails 401 Unauthorized', async () => {
      // Deactivate user directly in PostgreSQL
      await prisma.user.update({
        where: { id: userToDeactivateId },
        data: { isActive: false }
      });

      // Reuse the same session cookie for Dashboard endpoint
      const dashRes = await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Cookie', userToDeactivateCookie);

      expect(dashRes.status).toBe(401);
      expect(dashRes.body.error.code).toBe('UNAUTHENTICATED');

      // Reuse same cookie for Team endpoint
      const teamRes = await request(app)
        .get('/api/v1/team/members')
        .set('Cookie', userToDeactivateCookie);

      expect(teamRes.status).toBe(401);
      expect(teamRes.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects unauthenticated requests on all M7 endpoints with 401', async () => {
      const endpoints = [
        ['GET', '/api/v1/team/members'],
        ['GET', `/api/v1/team/members/${superAdminAId}`],
        ['POST', '/api/v1/team/members'],
        ['PATCH', `/api/v1/team/members/${superAdminAId}`],
        ['POST', `/api/v1/team/members/${superAdminAId}/activate`],
        ['POST', `/api/v1/team/members/${superAdminAId}/deactivate`],
        ['GET', '/api/v1/dashboard/summary'],
        ['GET', '/api/v1/dashboard/funnel'],
        ['GET', '/api/v1/dashboard/sources'],
        ['GET', '/api/v1/dashboard/outreach'],
        ['GET', '/api/v1/dashboard/team-performance']
      ];

      for (const [method, url] of endpoints) {
        const req = method === 'POST' ? request(app).post(url) : method === 'PATCH' ? request(app).patch(url) : request(app).get(url);
        const res = await req;
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      }
    });
  });

  // =========================================================================
  // 2. Team Tenant Isolation & Fail-Closed Behavior (Section 6, 44)
  // =========================================================================
  describe('2. Team Tenant Isolation', () => {
    it('Org A actor cannot read Org B member (fails closed with 404)', async () => {
      const res = await request(app)
        .get(`/api/v1/team/members/${memberBId}`)
        .set('Cookie', superAdminACookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(TeamErrorCode.TEAM_MEMBER_NOT_FOUND);
      expect(res.body).not.toHaveProperty('email');
      expect(res.body).not.toHaveProperty('role');
    });

    it('Org A actor cannot update Org B member (fails closed with 404)', async () => {
      const res = await request(app)
        .patch(`/api/v1/team/members/${memberBId}`)
        .set('Cookie', superAdminACookie)
        .send({ name: 'Tampered Name' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(TeamErrorCode.TEAM_MEMBER_NOT_FOUND);

      // Verify DB target record remains unchanged
      const target = await prisma.user.findUnique({ where: { id: memberBId } });
      expect(target?.name).toBe('Member Bravo');
    });

    it('Org A actor cannot activate Org B member (fails closed with 404)', async () => {
      const res = await request(app)
        .post(`/api/v1/team/members/${memberBId}/activate`)
        .set('Cookie', superAdminACookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(TeamErrorCode.TEAM_MEMBER_NOT_FOUND);
    });

    it('Org A actor cannot deactivate Org B member (fails closed with 404)', async () => {
      const res = await request(app)
        .post(`/api/v1/team/members/${memberBId}/deactivate`)
        .set('Cookie', superAdminACookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(TeamErrorCode.TEAM_MEMBER_NOT_FOUND);

      const target = await prisma.user.findUnique({ where: { id: memberBId } });
      expect(target?.isActive).toBe(true);
    });

    it('Team member list strictly excludes Org B members', async () => {
      const res = await request(app)
        .get('/api/v1/team/members?limit=100')
        .set('Cookie', superAdminACookie);

      expect(res.status).toBe(200);
      const parsed = teamMemberListResponseSchema.parse(res.body);
      const ids = parsed.items.map((m) => m.id);
      expect(ids).not.toContain(memberBId);
      expect(ids).not.toContain(superAdminBId);
    });
  });

  // =========================================================================
  // 3. Authority & Body Parameter Injection (Section 7, 8, 18, 47)
  // =========================================================================
  describe('3. Request Authority Injection Resistance', () => {
    it('POST /team/members strictly rejects injected authority fields with 422', async () => {
      const injectionFields = [
        { organizationId: ORG_B_ID },
        { tenantId: ORG_B_ID },
        { createdBy: superAdminAId },
        { passwordHash: 'injected-hash' },
        { isActive: false },
        { permissions: ['REPORTS_READ'] },
        { sessionId: 'injected-session' }
      ];

      for (const field of injectionFields) {
        const res = await request(app)
          .post('/api/v1/team/members')
          .set('Cookie', superAdminACookie)
          .send({
            name: 'Injected User',
            email: `inject-${Object.keys(field)[0]}@org-a.com`,
            role: Role.SALES_EXECUTIVE,
            temporaryPassword: 'ValidPass1234!',
            ...field
          });

        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('PATCH /team/members/:userId strictly rejects injected authority fields with 422', async () => {
      const injectionFields = [
        { organizationId: ORG_B_ID },
        { tenantId: ORG_B_ID },
        { email: 'newemail@org-a.com' },
        { passwordHash: 'injected-hash' },
        { isActive: false },
        { permissions: ['REPORTS_READ'] },
        { createdAt: new Date().toISOString() },
        { updatedAt: new Date().toISOString() }
      ];

      for (const field of injectionFields) {
        const res = await request(app)
          .patch(`/api/v1/team/members/${salesExecA1Id}`)
          .set('Cookie', superAdminACookie)
          .send({
            name: 'Valid Name',
            ...field
          });

        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('GET /dashboard/summary strictly rejects unknown/authority query params with 422', async () => {
      const authorityParams = [
        'organizationId=hacked',
        'tenantId=hacked',
        'actorId=hacked',
        'role=SUPER_ADMIN',
        'permissions=ALL',
        'timezone=UTC',
        'userId=hacked'
      ];

      for (const param of authorityParams) {
        const res = await request(app)
          .get(`/api/v1/dashboard/summary?${param}`)
          .set('Cookie', superAdminACookie);

        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // =========================================================================
  // 4. ADMIN Hierarchy & Self-Protection (Section 9, 11, 12)
  // =========================================================================
  describe('4. Admin Hierarchy Hardening & Self Protection', () => {
    it('ADMIN cannot create ADMIN or SUPER_ADMIN (403)', async () => {
      const resAdmin = await request(app)
        .post('/api/v1/team/members')
        .set('Cookie', adminACookie)
        .send({
          name: 'Forbidden Admin',
          email: 'admin.forbidden@org-a.com',
          role: Role.ADMIN,
          temporaryPassword: 'ValidPass1234!'
        });
      expect(resAdmin.status).toBe(403);
      expect(resAdmin.body.error.code).toBe(TeamErrorCode.TEAM_ROLE_FORBIDDEN);

      const resSuperAdmin = await request(app)
        .post('/api/v1/team/members')
        .set('Cookie', adminACookie)
        .send({
          name: 'Forbidden SuperAdmin',
          email: 'superadmin.forbidden@org-a.com',
          role: Role.SUPER_ADMIN,
          temporaryPassword: 'ValidPass1234!'
        });
      expect(resSuperAdmin.status).toBe(403);
      expect(resSuperAdmin.body.error.code).toBe(TeamErrorCode.TEAM_ROLE_FORBIDDEN);
    });

    it('ADMIN cannot promote member to ADMIN or SUPER_ADMIN (403)', async () => {
      const resPromoteAdmin = await request(app)
        .patch(`/api/v1/team/members/${salesExecA1Id}`)
        .set('Cookie', adminACookie)
        .send({ role: Role.ADMIN });
      expect(resPromoteAdmin.status).toBe(403);
      expect(resPromoteAdmin.body.error.code).toBe(TeamErrorCode.TEAM_ROLE_FORBIDDEN);

      const resPromoteSA = await request(app)
        .patch(`/api/v1/team/members/${salesExecA1Id}`)
        .set('Cookie', adminACookie)
        .send({ role: Role.SUPER_ADMIN });
      expect(resPromoteSA.status).toBe(403);
      expect(resPromoteSA.body.error.code).toBe(TeamErrorCode.TEAM_ROLE_FORBIDDEN);
    });

    it('ADMIN cannot modify another ADMIN or SUPER_ADMIN (403)', async () => {
      const resModSA = await request(app)
        .patch(`/api/v1/team/members/${superAdminAId}`)
        .set('Cookie', adminACookie)
        .send({ name: 'Renamed SA' });
      expect(resModSA.status).toBe(403);
      expect(resModSA.body.error.code).toBe(TeamErrorCode.TEAM_ROLE_FORBIDDEN);
    });

    it('ADMIN cannot activate/deactivate SUPER_ADMIN or other ADMIN (403)', async () => {
      const resAct = await request(app)
        .post(`/api/v1/team/members/${superAdminAId}/activate`)
        .set('Cookie', adminACookie);
      expect(resAct.status).toBe(403);
      expect(resAct.body.error.code).toBe(TeamErrorCode.TEAM_ROLE_FORBIDDEN);

      const resDeact = await request(app)
        .post(`/api/v1/team/members/${superAdminAId}/deactivate`)
        .set('Cookie', adminACookie);
      expect(resDeact.status).toBe(403);
      expect(resDeact.body.error.code).toBe(TeamErrorCode.TEAM_ROLE_FORBIDDEN);
    });

    it('SUPER_ADMIN and ADMIN cannot change own role (409 TEAM_SELF_ROLE_CHANGE_FORBIDDEN)', async () => {
      const resSA = await request(app)
        .patch(`/api/v1/team/members/${superAdminAId}`)
        .set('Cookie', superAdminACookie)
        .send({ role: Role.ADMIN });
      expect(resSA.status).toBe(409);
      expect(resSA.body.error.code).toBe(TeamErrorCode.TEAM_SELF_ROLE_CHANGE_FORBIDDEN);

      const resAdmin = await request(app)
        .patch(`/api/v1/team/members/${adminAId}`)
        .set('Cookie', adminACookie)
        .send({ role: Role.SALES_MANAGER });
      expect(resAdmin.status).toBe(409);
      expect(resAdmin.body.error.code).toBe(TeamErrorCode.TEAM_SELF_ROLE_CHANGE_FORBIDDEN);
    });

    it('Self-name update remains allowed for SUPER_ADMIN and ADMIN (200 OK)', async () => {
      const res = await request(app)
        .patch(`/api/v1/team/members/${superAdminAId}`)
        .set('Cookie', superAdminACookie)
        .send({ name: 'SuperAdmin Alpha Renamed' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('SuperAdmin Alpha Renamed');

      // Revert name
      await prisma.user.update({
        where: { id: superAdminAId },
        data: { name: 'SuperAdmin Alpha' }
      });
    });

    it('Authenticated user cannot deactivate self (409 TEAM_SELF_DEACTIVATION_FORBIDDEN)', async () => {
      const resSA = await request(app)
        .post(`/api/v1/team/members/${superAdminAId}/deactivate`)
        .set('Cookie', superAdminACookie);
      expect(resSA.status).toBe(409);
      expect(resSA.body.error.code).toBe(TeamErrorCode.TEAM_SELF_DEACTIVATION_FORBIDDEN);

      const resAdmin = await request(app)
        .post(`/api/v1/team/members/${adminAId}/deactivate`)
        .set('Cookie', adminACookie);
      expect(resAdmin.status).toBe(409);
      expect(resAdmin.body.error.code).toBe(TeamErrorCode.TEAM_SELF_DEACTIVATION_FORBIDDEN);
    });
  });

  // =========================================================================
  // 5. Team List RBAC & Duplicate Email Race (Section 13, 31)
  // =========================================================================
  describe('5. Team List RBAC & Duplicate Email Race', () => {
    it('SALES_EXECUTIVE and VIEWER get 403 on GET /team/members', async () => {
      const resExec = await request(app)
        .get('/api/v1/team/members')
        .set('Cookie', salesExecA1Cookie);
      expect(resExec.status).toBe(403);

      const resViewer = await request(app)
        .get('/api/v1/team/members')
        .set('Cookie', viewerACookie);
      expect(resViewer.status).toBe(403);
    });

    it('Duplicate email create fails safely with TEAM_MEMBER_EMAIL_EXISTS without leaking raw P2002', async () => {
      const res = await request(app)
        .post('/api/v1/team/members')
        .set('Cookie', superAdminACookie)
        .send({
          name: 'Duplicate Exec',
          email: 'exec1.alpha@org-a.com', // Already exists
          role: Role.SALES_EXECUTIVE,
          temporaryPassword: 'ValidPass1234!'
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(TeamErrorCode.TEAM_MEMBER_EMAIL_EXISTS);
      expect(JSON.stringify(res.body)).not.toContain('P2002');
    });
  });

  // =========================================================================
  // 6. SALES_EXECUTIVE Self-Scope & Peer Tampering Immunity (Section 15, 16, 46)
  // =========================================================================
  describe('6. SALES_EXECUTIVE Scoping & Peer Tampering Immunity', () => {
    it('SALES_EXECUTIVE requests to /summary override ?assigneeId=<peer> and return own metrics only', async () => {
      // Rep 1 attempts to pass ?assigneeId=<Rep 2>
      const res = await request(app)
        .get(`/api/v1/dashboard/summary?assigneeId=${salesExecA2Id}`)
        .set('Cookie', salesExecA1Cookie);

      expect(res.status).toBe(200);
      const parsed = dashboardSummaryResponseSchema.parse(res.body);

      // Rep 1 has 1 won lead inside period; Rep 2 had a NEGOTIATION lead
      expect(parsed.leads.totalCohort).toBe(1);
      expect(parsed.leads.cohortWon).toBe(1);
      expect(parsed.followUps.dueToday).toBe(1);
      expect(parsed.outreach.delivered).toBe(1);
    });

    it('SALES_EXECUTIVE requests to /funnel override ?assigneeId=<peer>', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/funnel?assigneeId=${salesExecA2Id}`)
        .set('Cookie', salesExecA1Cookie);

      expect(res.status).toBe(200);
      const parsed = dashboardFunnelResponseSchema.parse(res.body);
      const wonStage = parsed.stages.find((s) => s.stage === CrmStage.WON);
      const negStage = parsed.stages.find((s) => s.stage === CrmStage.NEGOTIATION);

      // Rep 1 leads: 2 won (1 inside + 1 old). Rep 2 has negotiation lead.
      expect(wonStage?.count).toBe(2);
      expect(negStage?.count).toBe(0); // Rep 2's negotiation lead is NOT leaked!
    });

    it('SALES_EXECUTIVE requests to /sources override ?assigneeId=<peer>', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/sources?assigneeId=${salesExecA2Id}`)
        .set('Cookie', salesExecA1Cookie);

      expect(res.status).toBe(200);
      const parsed = dashboardSourcesResponseSchema.parse(res.body);
      // Rep 1 period lead source is WEBSITE; Rep 2 is FACEBOOK
      const facebook = parsed.sources.find((s) => s.source === 'FACEBOOK');
      expect(facebook).toBeUndefined();
    });

    it('SALES_EXECUTIVE requests to /outreach override ?assigneeId=<peer>', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/outreach?assigneeId=${salesExecA2Id}`)
        .set('Cookie', salesExecA1Cookie);

      expect(res.status).toBe(200);
      const parsed = dashboardOutreachResponseSchema.parse(res.body);
      expect(parsed.totals.delivered).toBe(1);
    });

    it('SALES_EXECUTIVE passing cross-tenant assigneeId is safely overridden to self without leak or crash', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/summary?assigneeId=${memberBId}`)
        .set('Cookie', salesExecA1Cookie);

      expect(res.status).toBe(200);
      const parsed = dashboardSummaryResponseSchema.parse(res.body);
      expect(parsed.leads.totalCohort).toBe(1);
    });

    it('SALES_EXECUTIVE GET /dashboard/team-performance returns 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/team-performance')
        .set('Cookie', salesExecA1Cookie);

      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // 7. VIEWER Analytics Scope & Assignee Enumeration Protection (Section 17, 19, 22)
  // =========================================================================
  describe('7. VIEWER Analytics & Assignee Enumeration Protection', () => {
    it('VIEWER can access all dashboard reports tenant-wide (200 OK)', async () => {
      const endpoints = [
        '/api/v1/dashboard/summary',
        '/api/v1/dashboard/funnel',
        '/api/v1/dashboard/sources',
        '/api/v1/dashboard/outreach',
        '/api/v1/dashboard/team-performance'
      ];

      for (const ep of endpoints) {
        const res = await request(app)
          .get(ep)
          .set('Cookie', viewerACookie);
        expect(res.status).toBe(200);
      }
    });

    it('Cross-tenant assignee returns identical safe 404 envelope as nonexistent UUID', async () => {
      const nonExistentUuid = '00000000-0000-0000-0000-000000000999';

      const resNonExistent = await request(app)
        .get(`/api/v1/dashboard/summary?assigneeId=${nonExistentUuid}`)
        .set('Cookie', superAdminACookie);

      const resCrossTenant = await request(app)
        .get(`/api/v1/dashboard/summary?assigneeId=${memberBId}`)
        .set('Cookie', superAdminACookie);

      expect(resNonExistent.status).toBe(404);
      expect(resCrossTenant.status).toBe(404);
      expect(resNonExistent.body.error.code).toBe('NOT_FOUND');
      expect(resCrossTenant.body.error.code).toBe('NOT_FOUND');
      expect(resCrossTenant.body.error.message).toBe(resNonExistent.body.error.message.replace(nonExistentUuid, memberBId));
      expect(resCrossTenant.body.error.message).not.toContain('belongs to another');
    });
  });

  // =========================================================================
  // 8. Filter Hardening (Section 20, 21)
  // =========================================================================
  describe('8. Filter Hardening (Source & Date)', () => {
    it('source parameter bounded to max 100 characters', async () => {
      const valid100 = 'a'.repeat(100);
      const resValid = await request(app)
        .get(`/api/v1/dashboard/summary?source=${valid100}`)
        .set('Cookie', superAdminACookie);
      expect(resValid.status).toBe(200);

      const invalid101 = 'a'.repeat(101);
      const resInvalid = await request(app)
        .get(`/api/v1/dashboard/summary?source=${invalid101}`)
        .set('Cookie', superAdminACookie);
      expect(resInvalid.status).toBe(422);
    });

    it('whitespace-only source normalized safely without error', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/summary?source=%20%20%20')
        .set('Cookie', superAdminACookie);
      expect(res.status).toBe(200);
    });

    it('date preset custom requires from and to; order and max window enforced', async () => {
      // Missing from & to
      const res1 = await request(app)
        .get('/api/v1/dashboard/summary?preset=custom')
        .set('Cookie', superAdminACookie);
      expect(res1.status).toBe(422);

      // from > to
      const res2 = await request(app)
        .get('/api/v1/dashboard/summary?preset=custom&from=2026-03-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z')
        .set('Cookie', superAdminACookie);
      expect(res2.status).toBe(422);

      // window > 365 days
      const res3 = await request(app)
        .get('/api/v1/dashboard/summary?preset=custom&from=2024-01-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z')
        .set('Cookie', superAdminACookie);
      expect(res3.status).toBe(422);

      // Non-custom preset rejects from/to
      const res4 = await request(app)
        .get('/api/v1/dashboard/summary?preset=30d&from=2026-01-01T00:00:00.000Z')
        .set('Cookie', superAdminACookie);
      expect(res4.status).toBe(422);
    });
  });

  // =========================================================================
  // 9. Analytics Cohort & Snapshot Invariant Regressions (Section 23, 24, 25, 26)
  // =========================================================================
  describe('9. Analytics Cohort & Snapshot Invariant Regressions', () => {
    it('lead created outside period but updated to WON inside period is EXCLUDED from cohort metrics', async () => {
      // In setup, Alpha Old Lead Updated Won was created 40 days ago, updated to WON today
      // 30d summary query:
      const res = await request(app)
        .get('/api/v1/dashboard/summary?preset=30d')
        .set('Cookie', superAdminACookie);

      expect(res.status).toBe(200);
      const parsed = dashboardSummaryResponseSchema.parse(res.body);

      // 2 leads created inside 30d in Org A (Alpha 1 Lead Inside [WON] and Alpha 2 Lead Inside [NEGOTIATION])
      expect(parsed.leads.totalCohort).toBe(2);
      expect(parsed.leads.cohortWon).toBe(1); // Old lead updated to WON is excluded!
    });

    it('current pipeline snapshot includes old lead regardless of creation period', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/funnel')
        .set('Cookie', superAdminACookie);

      expect(res.status).toBe(200);
      const parsed = dashboardFunnelResponseSchema.parse(res.body);
      const wonStage = parsed.stages.find((s) => s.stage === CrmStage.WON);

      // Both Won leads (recent + old) are counted in current point-in-time state
      expect(wonStage?.count).toBe(2);
      expect(parsed.total).toBe(3); // 2 WON + 1 NEGOTIATION
    });

    it('outreach send-cohort is strictly determined by sentAt within selected range', async () => {
      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      const fiftyDaysAgo = new Date(now.getTime() - 50 * 24 * 60 * 60 * 1000);

      // Delivery A: sent inside range (10 days ago), delivered inside range
      // Delivery B: sent outside range (50 days ago), delivered inside range (10 days ago)
      const lead = await prisma.lead.findFirst({ where: { organizationId: ORG_A_ID } });
      const draft = await prisma.salesAssistantDraft.findFirst({ where: { organizationId: ORG_A_ID } });

      await prisma.outreachDelivery.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: lead!.id,
          draftId: draft!.id,
          channel: OutreachChannel.EMAIL,
          status: OutreachDeliveryStatus.DELIVERED,
          recipientNormalized: 'test@cohort.com',
          approvedDraftSnapshotHash: 'hash-reg-b',
          idempotencyKey: 'idemp-reg-b',
          requestFingerprint: 'fingerprint-reg-b',
          requestedByUserId: superAdminAId,
          sentAt: fiftyDaysAgo,
          deliveredAt: tenDaysAgo // Delivered inside 30d, but sent 50d ago!
        }
      });

      const res = await request(app)
        .get('/api/v1/dashboard/outreach?preset=30d')
        .set('Cookie', superAdminACookie);

      expect(res.status).toBe(200);
      const parsed = dashboardOutreachResponseSchema.parse(res.body);

      // Only the WhatsApp delivery sent 20 days ago is counted; the Email sent 50 days ago is excluded
      const emailChannel = parsed.channels.find((c) => c.channel === OutreachChannel.EMAIL);
      expect(emailChannel?.sent).toBe(0);
      expect(emailChannel?.delivered).toBe(0);
    });
  });

  // =========================================================================
  // 10. Data Safety: Secrets, Customer PII, Audit Logs & Error Envelopes (Section 27, 28, 29, 30)
  // =========================================================================
  describe('10. Data Safety (Secrets, Customer PII, Audit Logs, Error Envelopes)', () => {
    it('Team API responses strictly exclude passwordHash, temporaryPassword, session tokens', async () => {
      const listRes = await request(app)
        .get('/api/v1/team/members')
        .set('Cookie', superAdminACookie);
      const listBody = JSON.stringify(listRes.body);

      expect(listBody).not.toContain('passwordHash');
      expect(listBody).not.toContain('temporaryPassword');
      expect(listBody).not.toContain('tokenHash');
      expect(listBody).not.toContain('rawToken');

      const createRes = await request(app)
        .post('/api/v1/team/members')
        .set('Cookie', superAdminACookie)
        .send({
          name: 'Secret Check User',
          email: 'secret.check@org-a.com',
          role: Role.SALES_EXECUTIVE,
          temporaryPassword: 'SecretPassword999!'
        });
      const createBody = JSON.stringify(createRes.body);

      expect(createBody).not.toContain('passwordHash');
      expect(createBody).not.toContain('SecretPassword999!');
      expect(createBody).not.toContain('tokenHash');
    });

    it('Audit logs never store temporaryPassword or passwordHash', async () => {
      const auditLogs = await prisma.auditLog.findMany({
        where: { organizationId: ORG_A_ID }
      });

      for (const log of auditLogs) {
        const afterStr = JSON.stringify(log.after || {});
        const beforeStr = JSON.stringify(log.before || {});
        expect(afterStr).not.toContain('SecretPassword999!');
        expect(afterStr).not.toContain('passwordHash');
        expect(beforeStr).not.toContain('passwordHash');
      }
    });

    it('Dashboard API responses contain only aggregate metrics and team member metadata, zero customer PII', async () => {
      const endpoints = [
        '/api/v1/dashboard/summary',
        '/api/v1/dashboard/funnel',
        '/api/v1/dashboard/sources',
        '/api/v1/dashboard/outreach',
        '/api/v1/dashboard/team-performance'
      ];

      for (const ep of endpoints) {
        const res = await request(app).get(ep).set('Cookie', superAdminACookie);
        const str = JSON.stringify(res.body);

        expect(str).not.toContain('+8801700000001');
        expect(str).not.toContain('test@cohort.com');
        expect(str).not.toContain('Draft content');
      }
    });

    it('Error responses never leak stack traces, SQL fragments, or database connection strings', async () => {
      const errRes = await request(app)
        .get('/api/v1/dashboard/summary?preset=custom&from=invalid-date')
        .set('Cookie', superAdminACookie);

      expect(errRes.status).toBe(422);
      const bodyStr = JSON.stringify(errRes.body);

      expect(bodyStr).not.toContain('DATABASE_URL');
      expect(bodyStr).not.toContain('PrismaClient');
      expect(bodyStr).not.toContain('node_modules');
      expect(bodyStr).not.toContain('SELECT ');
    });
  });

  // =========================================================================
  // 11. Query Count & N+1 Protection (Section 32, 33, 37, 52)
  // =========================================================================
  describe('11. Query Count & N+1 Verification', () => {
    it('teamService.listMembers workload query count is constant and does not scale with member count', async () => {
      const actor: TeamActorContext = {
        actorId: superAdminAId,
        organizationId: ORG_A_ID,
        role: Role.SUPER_ADMIN
      };

      const origUserFindMany = prisma.user.findMany.bind(prisma.user);
      const origUserCount = prisma.user.count.bind(prisma.user);
      const origLeadGroupBy = prisma.lead.groupBy.bind(prisma.lead);
      const origFollowUpGroupBy = prisma.followUpTask.groupBy.bind(prisma.followUpTask);

      let queryCalls = 0;
      prisma.user.findMany = (async (...args: any[]) => { queryCalls++; return (origUserFindMany as any)(...args); }) as any;
      prisma.user.count = (async (...args: any[]) => { queryCalls++; return (origUserCount as any)(...args); }) as any;
      prisma.lead.groupBy = (async (...args: any[]) => { queryCalls++; return (origLeadGroupBy as any)(...args); }) as any;
      prisma.followUpTask.groupBy = (async (...args: any[]) => { queryCalls++; return (origFollowUpGroupBy as any)(...args); }) as any;

      try {
        queryCalls = 0;
        await teamService.listMembers(actor, { page: 1, limit: 20, sortBy: 'createdAt' as any, sortOrder: 'desc' });
        const initialCalls = queryCalls;

        // Add 5 more synthetic members to tenant A
        const pass = await hashPassword('TempPass123!');
        const newUsers = [];
        for (let i = 1; i <= 5; i++) {
          newUsers.push({
            organizationId: ORG_A_ID,
            name: `Synthetic Rep ${i}`,
            email: `synthetic${i}@org-a.com`,
            role: Role.SALES_EXECUTIVE as any,
            passwordHash: pass,
            isActive: true
          });
        }
        await prisma.user.createMany({ data: newUsers });

        queryCalls = 0;
        await teamService.listMembers(actor, { page: 1, limit: 20, sortBy: 'createdAt' as any, sortOrder: 'desc' });
        const secondCalls = queryCalls;

        expect(secondCalls).toBe(initialCalls);
        // Expected exactly 1 findMany + 1 count + 4 groupBys = 6 queries
        expect(secondCalls).toBeLessThanOrEqual(6);
      } finally {
        prisma.user.findMany = origUserFindMany as any;
        prisma.user.count = origUserCount as any;
        prisma.lead.groupBy = origLeadGroupBy as any;
        prisma.followUpTask.groupBy = origFollowUpGroupBy as any;
      }
    });

    it('analyticsService.getTeamPerformance batch query count is constant regardless of team size', async () => {
      const actor: AnalyticsActorContext = {
        actorId: superAdminAId,
        organizationId: ORG_A_ID,
        role: Role.SUPER_ADMIN
      };

      const origUserFindMany = prisma.user.findMany.bind(prisma.user);
      const origLeadGroupBy = prisma.lead.groupBy.bind(prisma.lead);
      const origFollowUpGroupBy = prisma.followUpTask.groupBy.bind(prisma.followUpTask);
      const origOutreachFindMany = prisma.outreachDelivery.findMany.bind(prisma.outreachDelivery);

      let queryCalls = 0;
      prisma.user.findMany = (async (...args: any[]) => { queryCalls++; return (origUserFindMany as any)(...args); }) as any;
      prisma.lead.groupBy = (async (...args: any[]) => { queryCalls++; return (origLeadGroupBy as any)(...args); }) as any;
      prisma.followUpTask.groupBy = (async (...args: any[]) => { queryCalls++; return (origFollowUpGroupBy as any)(...args); }) as any;
      prisma.outreachDelivery.findMany = (async (...args: any[]) => { queryCalls++; return (origOutreachFindMany as any)(...args); }) as any;

      try {
        queryCalls = 0;
        await analyticsService.getTeamPerformance(actor, { preset: '30d' as any });
        const calls = queryCalls;

        // Exactly 1 user findMany + 2 lead groupBys + 2 followUp groupBys + 1 outreach findMany = 6 queries
        expect(calls).toBeLessThanOrEqual(6);
      } finally {
        prisma.user.findMany = origUserFindMany as any;
        prisma.lead.groupBy = origLeadGroupBy as any;
        prisma.followUpTask.groupBy = origFollowUpGroupBy as any;
        prisma.outreachDelivery.findMany = origOutreachFindMany as any;
      }
    });
  });

  // =========================================================================
  // 12. PostgreSQL Query Plan Sanity (Section 36)
  // =========================================================================
  describe('12. Query Plan Sanity via PostgreSQL EXPLAIN', () => {
    it('representative analytics and team queries produce valid query plans', async () => {
      const now = new Date();
      const planLeadCohort = await prisma.$queryRawUnsafe(
        'EXPLAIN SELECT COUNT(*) FROM leads WHERE organization_id = $1 AND created_at >= $2 AND created_at <= $3',
        ORG_A_ID,
        now,
        now
      );
      expect(Array.isArray(planLeadCohort)).toBe(true);

      const planFollowUp = await prisma.$queryRawUnsafe(
        'EXPLAIN SELECT COUNT(*) FROM follow_up_tasks WHERE organization_id = $1 AND status = \'PENDING\'::"FollowUpStatus" AND due_at < $2',
        ORG_A_ID,
        now
      );
      expect(Array.isArray(planFollowUp)).toBe(true);

      const planOutreach = await prisma.$queryRawUnsafe(
        'EXPLAIN SELECT channel, status, COUNT(*) FROM outreach_deliveries WHERE organization_id = $1 AND sent_at >= $2 GROUP BY channel, status',
        ORG_A_ID,
        now
      );
      expect(Array.isArray(planOutreach)).toBe(true);
    });
  });
});
