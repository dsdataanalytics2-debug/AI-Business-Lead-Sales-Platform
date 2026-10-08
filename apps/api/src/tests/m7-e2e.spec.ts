import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
import { hashPassword, hashSessionToken, verifyPassword } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';
import { resetLoginRateLimiter } from '../middleware/rate-limiter.js';

describe('M7 Step 9: Full E2E / Integration Regression & Release Readiness Suite', () => {
  const ORG_ALPHA_ID = '88888888-8888-8888-8888-888888888801';
  const ORG_BETA_ID = '88888888-8888-8888-8888-888888888802';

  // Org Alpha Users
  let superAdminId: string;
  let superAdminCookie: string;

  let adminId: string;
  let adminCookie: string;

  let salesManagerId: string;
  let salesManagerCookie: string;

  let salesExec1Id: string;
  let salesExec1Cookie: string;

  let salesExec2Id: string;
  let salesExec2Cookie: string;

  let viewerId: string;
  let viewerCookie: string;

  let deactivatedUserId: string;
  let deactivatedUserCookie: string;

  // Org Beta Users
  let betaSuperAdminId: string;
  let betaSuperAdminCookie: string;
  let betaMemberId: string;

  // Seeded data references
  let lead1Id: string;
  let lead2Id: string;
  let leadOldId: string;
  let betaLeadId: string;

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
        userAgent: 'e2e-agent',
        expiresAt
      }
    });

    return `${SESSION_COOKIE_NAME}=${rawToken}`;
  }

  async function cleanupDb() {
    await ensureTestDatabase(prisma);
    const orgIds = [ORG_ALPHA_ID, ORG_BETA_ID];

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
        { id: ORG_ALPHA_ID, name: 'LeadAtlas Alpha Org', timezone: 'Asia/Dhaka' },
        { id: ORG_BETA_ID, name: 'LeadAtlas Beta Org', timezone: 'Asia/Dhaka' }
      ]
    });

    const passHash = await hashPassword('E2EPassword123!');

    // 2. Setup Org Alpha Users across all roles
    const sa = await prisma.user.create({
      data: {
        organizationId: ORG_ALPHA_ID,
        name: 'Alpha SuperAdmin',
        email: 'sa@alpha.com',
        role: Role.SUPER_ADMIN as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    superAdminId = sa.id;
    superAdminCookie = await createSessionCookie(superAdminId, 'token-alpha-sa');

    const adm = await prisma.user.create({
      data: {
        organizationId: ORG_ALPHA_ID,
        name: 'Alpha Admin',
        email: 'admin@alpha.com',
        role: Role.ADMIN as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    adminId = adm.id;
    adminCookie = await createSessionCookie(adminId, 'token-alpha-admin');

    const mgr = await prisma.user.create({
      data: {
        organizationId: ORG_ALPHA_ID,
        name: 'Alpha Manager',
        email: 'manager@alpha.com',
        role: Role.SALES_MANAGER as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    salesManagerId = mgr.id;
    salesManagerCookie = await createSessionCookie(salesManagerId, 'token-alpha-manager');

    const rep1 = await prisma.user.create({
      data: {
        organizationId: ORG_ALPHA_ID,
        name: 'Alpha Rep One',
        email: 'rep1@alpha.com',
        role: Role.SALES_EXECUTIVE as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    salesExec1Id = rep1.id;
    salesExec1Cookie = await createSessionCookie(salesExec1Id, 'token-alpha-rep1');

    const rep2 = await prisma.user.create({
      data: {
        organizationId: ORG_ALPHA_ID,
        name: 'Alpha Rep Two',
        email: 'rep2@alpha.com',
        role: Role.SALES_EXECUTIVE as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    salesExec2Id = rep2.id;
    salesExec2Cookie = await createSessionCookie(salesExec2Id, 'token-alpha-rep2');

    const vwr = await prisma.user.create({
      data: {
        organizationId: ORG_ALPHA_ID,
        name: 'Alpha Viewer',
        email: 'viewer@alpha.com',
        role: Role.VIEWER as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    viewerId = vwr.id;
    viewerCookie = await createSessionCookie(viewerId, 'token-alpha-viewer');

    const deactUser = await prisma.user.create({
      data: {
        organizationId: ORG_ALPHA_ID,
        name: 'Alpha Deactivating Rep',
        email: 'deact@alpha.com',
        role: Role.SALES_EXECUTIVE as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    deactivatedUserId = deactUser.id;
    deactivatedUserCookie = await createSessionCookie(deactivatedUserId, 'token-alpha-deact');

    // 3. Setup Org Beta Users
    const betaSa = await prisma.user.create({
      data: {
        organizationId: ORG_BETA_ID,
        name: 'Beta SuperAdmin',
        email: 'sa@beta.com',
        role: Role.SUPER_ADMIN as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    betaSuperAdminId = betaSa.id;
    betaSuperAdminCookie = await createSessionCookie(betaSuperAdminId, 'token-beta-sa');

    const betaMember = await prisma.user.create({
      data: {
        organizationId: ORG_BETA_ID,
        name: 'Beta Rep',
        email: 'rep@beta.com',
        role: Role.SALES_EXECUTIVE as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    betaMemberId = betaMember.id;

    // 4. Seed Representative Operational Data
    const now = new Date();
    const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
    const fortyFiveDaysAgo = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);

    // Lead 1: Rep 1, created 15d ago, stage WON, primarySource WEBSITE
    const l1 = await prisma.lead.create({
      data: {
        organizationId: ORG_ALPHA_ID,
        name: 'Alpha Lead Rep 1 Won',
        normalizedName: 'alpha lead rep 1 won',
        category: 'Software',
        primarySource: 'WEBSITE',
        crmStage: CrmStage.WON,
        assignedUserId: salesExec1Id,
        createdAt: fifteenDaysAgo,
        updatedAt: now
      }
    });
    lead1Id = l1.id;

    // Lead 2: Rep 2, created 15d ago, stage NEGOTIATION, primarySource LINKEDIN
    const l2 = await prisma.lead.create({
      data: {
        organizationId: ORG_ALPHA_ID,
        name: 'Alpha Lead Rep 2 Neg',
        normalizedName: 'alpha lead rep 2 neg',
        category: 'Services',
        primarySource: 'LINKEDIN',
        crmStage: CrmStage.NEGOTIATION,
        assignedUserId: salesExec2Id,
        createdAt: fifteenDaysAgo,
        updatedAt: now
      }
    });
    lead2Id = l2.id;

    // Lead Old: Rep 1, created 45d ago (outside 30d period), stage WON
    const lOld = await prisma.lead.create({
      data: {
        organizationId: ORG_ALPHA_ID,
        name: 'Alpha Lead Old Won',
        normalizedName: 'alpha lead old won',
        category: 'Retail',
        primarySource: 'REFERRAL',
        crmStage: CrmStage.WON,
        assignedUserId: salesExec1Id,
        createdAt: fortyFiveDaysAgo,
        updatedAt: now
      }
    });
    leadOldId = lOld.id;

    // Beta Lead: Org Beta, isolated
    const bLead = await prisma.lead.create({
      data: {
        organizationId: ORG_BETA_ID,
        name: 'Beta Confidential Lead',
        normalizedName: 'beta confidential lead',
        category: 'Banking',
        primarySource: 'OUTBOUND',
        crmStage: CrmStage.WON,
        assignedUserId: betaMemberId,
        createdAt: fifteenDaysAgo,
        updatedAt: now
      }
    });
    betaLeadId = bLead.id;

    // Follow-ups: Rep 1 has 1 overdue task, 1 due today, 1 completed
    await prisma.followUpTask.create({
      data: {
        organizationId: ORG_ALPHA_ID,
        leadId: lead1Id,
        assignedUserId: salesExec1Id,
        createdByUserId: superAdminId,
        dueAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), // Overdue & today
        status: FollowUpStatus.PENDING
      }
    });

    await prisma.followUpTask.create({
      data: {
        organizationId: ORG_ALPHA_ID,
        leadId: lead1Id,
        assignedUserId: salesExec1Id,
        createdByUserId: superAdminId,
        dueAt: fifteenDaysAgo,
        completedAt: fifteenDaysAgo,
        status: FollowUpStatus.COMPLETED
      }
    });

    // Outreach: Rep 1 has 1 delivered WhatsApp outreach
    const draft1 = await prisma.salesAssistantDraft.create({
      data: {
        organizationId: ORG_ALPHA_ID,
        leadId: lead1Id,
        createdByUserId: salesExec1Id,
        type: 'WHATSAPP' as any,
        language: 'ENGLISH' as any,
        tone: 'PROFESSIONAL' as any,
        status: 'APPROVED' as any,
        content: 'WhatsApp message content'
      }
    });

    await prisma.outreachDelivery.create({
      data: {
        organizationId: ORG_ALPHA_ID,
        leadId: lead1Id,
        draftId: draft1.id,
        channel: OutreachChannel.WHATSAPP,
        status: OutreachDeliveryStatus.DELIVERED,
        recipientNormalized: '+8801700000010',
        approvedDraftSnapshotHash: 'hash-e2e-1',
        idempotencyKey: 'idemp-e2e-1',
        requestFingerprint: 'fp-e2e-1',
        requestedByUserId: salesExec1Id,
        sentAt: fifteenDaysAgo,
        deliveredAt: fifteenDaysAgo
      }
    });
  });

  afterAll(async () => {
    await cleanupDb();
  });

  // =========================================================================
  // 1. Role Matrix & Lifecycle Verification
  // =========================================================================
  describe('1. Full E2E Role Matrix Verification', () => {
    it('SUPER_ADMIN possesses full Team management and tenant-wide Dashboard visibility', async () => {
      // 1. Can view team list
      const teamRes = await request(app)
        .get('/api/v1/team/members')
        .set('Cookie', superAdminCookie);
      expect(teamRes.status).toBe(200);
      const teamList = teamMemberListResponseSchema.parse(teamRes.body);
      expect(teamList.items.length).toBeGreaterThanOrEqual(6);

      // 2. Can create new team member
      const createRes = await request(app)
        .post('/api/v1/team/members')
        .set('Cookie', superAdminCookie)
        .send({
          name: 'New Trainee',
          email: 'trainee@alpha.com',
          role: Role.SALES_EXECUTIVE,
          temporaryPassword: 'ValidTempPass123!'
        });
      expect(createRes.status).toBe(201);
      const detail = teamMemberDetailSchema.parse(createRes.body);
      expect(detail.name).toBe('New Trainee');

      // 3. Can view tenant-wide dashboard summary
      const sumRes = await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Cookie', superAdminCookie);
      expect(sumRes.status).toBe(200);
      const summary = dashboardSummaryResponseSchema.parse(sumRes.body);
      expect(summary.leads.totalCohort).toBe(2); // lead1 + lead2 inside 30d

      // 4. Can view team performance
      const perfRes = await request(app)
        .get('/api/v1/dashboard/team-performance')
        .set('Cookie', superAdminCookie);
      expect(perfRes.status).toBe(200);
      const perf = dashboardTeamPerformanceResponseSchema.parse(perfRes.body);
      expect(perf.members.length).toBeGreaterThanOrEqual(2);
    });

    it('ADMIN has restricted team management hierarchy and tenant-wide dashboard', async () => {
      // 1. Can view team list
      const teamRes = await request(app)
        .get('/api/v1/team/members')
        .set('Cookie', adminCookie);
      expect(teamRes.status).toBe(200);

      // 2. Cannot create ADMIN or SUPER_ADMIN
      const createSaRes = await request(app)
        .post('/api/v1/team/members')
        .set('Cookie', adminCookie)
        .send({
          name: 'Escalated SA',
          email: 'escalated@alpha.com',
          role: Role.SUPER_ADMIN,
          temporaryPassword: 'ValidTempPass123!'
        });
      expect(createSaRes.status).toBe(403);
      expect(createSaRes.body.error.code).toBe(TeamErrorCode.TEAM_ROLE_FORBIDDEN);

      // 3. Can create SALES_EXECUTIVE
      const createRepRes = await request(app)
        .post('/api/v1/team/members')
        .set('Cookie', adminCookie)
        .send({
          name: 'Admin Created Rep',
          email: 'admin.rep@alpha.com',
          role: Role.SALES_EXECUTIVE,
          temporaryPassword: 'ValidTempPass123!'
        });
      expect(createRepRes.status).toBe(201);

      // 4. Cannot modify SUPER_ADMIN
      const editSaRes = await request(app)
        .patch(`/api/v1/team/members/${superAdminId}`)
        .set('Cookie', adminCookie)
        .send({ name: 'Hacked SA' });
      expect(editSaRes.status).toBe(403);

      // 5. Can access tenant-wide dashboard
      const dashRes = await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Cookie', adminCookie);
      expect(dashRes.status).toBe(200);
    });

    it('SALES_MANAGER has view-only Team access and full Dashboard visibility', async () => {
      // 1. Can view team roster (USERS_READ)
      const listRes = await request(app)
        .get('/api/v1/team/members')
        .set('Cookie', salesManagerCookie);
      expect(listRes.status).toBe(200);

      // 2. Cannot create members
      const createRes = await request(app)
        .post('/api/v1/team/members')
        .set('Cookie', salesManagerCookie)
        .send({
          name: 'Manager Created Rep',
          email: 'mgr.rep@alpha.com',
          role: Role.SALES_EXECUTIVE,
          temporaryPassword: 'ValidTempPass123!'
        });
      expect(createRes.status).toBe(403);

      // 3. Cannot update members
      const patchRes = await request(app)
        .patch(`/api/v1/team/members/${salesExec1Id}`)
        .set('Cookie', salesManagerCookie)
        .send({ name: 'Tampered Name' });
      expect(patchRes.status).toBe(403);

      // 4. Accesses tenant-wide dashboard and team performance
      const dashRes = await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Cookie', salesManagerCookie);
      expect(dashRes.status).toBe(200);

      const perfRes = await request(app)
        .get('/api/v1/dashboard/team-performance')
        .set('Cookie', salesManagerCookie);
      expect(perfRes.status).toBe(200);
    });

    it('SALES_EXECUTIVE is denied Team access, self-scoped on Dashboard, and forbidden on team-performance', async () => {
      // 1. Team roster denied
      const teamRes = await request(app)
        .get('/api/v1/team/members')
        .set('Cookie', salesExec1Cookie);
      expect(teamRes.status).toBe(403);

      // 2. Team detail denied
      const detailRes = await request(app)
        .get(`/api/v1/team/members/${salesExec1Id}`)
        .set('Cookie', salesExec1Cookie);
      expect(detailRes.status).toBe(403);

      // 3. Dashboard access is self-scoped
      const sumRes = await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Cookie', salesExec1Cookie);
      expect(sumRes.status).toBe(200);
      const summary = dashboardSummaryResponseSchema.parse(sumRes.body);
      expect(summary.leads.totalCohort).toBe(1); // Only Rep 1's lead
      expect(summary.leads.cohortWon).toBe(1);

      // 4. Team performance denied
      const perfRes = await request(app)
        .get('/api/v1/dashboard/team-performance')
        .set('Cookie', salesExec1Cookie);
      expect(perfRes.status).toBe(403);

      // 5. Tampering via ?assigneeId=<peer> is overridden to self
      const tamperRes = await request(app)
        .get(`/api/v1/dashboard/summary?assigneeId=${salesExec2Id}`)
        .set('Cookie', salesExec1Cookie);
      expect(tamperRes.status).toBe(200);
      const tampered = dashboardSummaryResponseSchema.parse(tamperRes.body);
      expect(tampered.leads.totalCohort).toBe(1); // Still Rep 1's lead only
    });

    it('VIEWER is denied Team access but has tenant-wide read-only Dashboard access', async () => {
      // 1. Team roster denied
      const teamRes = await request(app)
        .get('/api/v1/team/members')
        .set('Cookie', viewerCookie);
      expect(teamRes.status).toBe(403);

      // 2. Dashboard summary permitted tenant-wide
      const sumRes = await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Cookie', viewerCookie);
      expect(sumRes.status).toBe(200);
      const summary = dashboardSummaryResponseSchema.parse(sumRes.body);
      expect(summary.leads.totalCohort).toBe(2);

      // 3. Team performance permitted
      const perfRes = await request(app)
        .get('/api/v1/dashboard/team-performance')
        .set('Cookie', viewerCookie);
      expect(perfRes.status).toBe(200);
    });
  });

  // =========================================================================
  // 2. Team Management Complete E2E Lifecycle
  // =========================================================================
  describe('2. Team Management E2E Lifecycle', () => {
    let createdMemberId: string;

    it('creates a new member with audited record, canonical Argon2id hashed password, and workload counters', async () => {
      resetLoginRateLimiter();

      const res = await request(app)
        .post('/api/v1/team/members')
        .set('Cookie', superAdminCookie)
        .send({
          name: 'Lifecycle Rep',
          email: 'lifecycle@alpha.com',
          role: Role.SALES_EXECUTIVE,
          temporaryPassword: 'TempLifecyclePass123!'
        });

      expect(res.status).toBe(201);
      const detail = teamMemberDetailSchema.parse(res.body);
      expect(detail.name).toBe('Lifecycle Rep');
      expect(detail.email).toBe('lifecycle@alpha.com');
      expect(detail.role).toBe(Role.SALES_EXECUTIVE);
      expect(detail.isActive).toBe(true);
      expect(detail.workload.assignedLeadsCount).toBe(0);
      createdMemberId = detail.id;

      // 1. Secret safety: temporaryPassword and passwordHash absent from API response
      expect((res.body as any).passwordHash).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('TempLifecyclePass123!');
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');

      // 2. Database storage verification:
      // Stored passwordHash exists, uses canonical Argon2id ($argon2id$), and plaintext is NOT stored
      const storedUser = await prisma.user.findUnique({
        where: { id: createdMemberId }
      });
      expect(storedUser).toBeDefined();
      expect(storedUser?.passwordHash).toBeDefined();
      expect(typeof storedUser?.passwordHash).toBe('string');
      expect(storedUser!.passwordHash.startsWith('$argon2id$')).toBe(true);
      expect(JSON.stringify(storedUser)).not.toContain('TempLifecyclePass123!');

      // 3. Canonical password verification accepts the temporary password
      const isValid = await verifyPassword(storedUser!.passwordHash, 'TempLifecyclePass123!');
      expect(isValid).toBe(true);

      // 4. Canonical password verification fails for wrong password
      const isInvalid = await verifyPassword(storedUser!.passwordHash, 'WrongPassword999!');
      expect(isInvalid).toBe(false);

      // 5. Newly created user can authenticate through existing login/session flow
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'lifecycle@alpha.com',
          password: 'TempLifecyclePass123!'
        });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.data.user.email).toBe('lifecycle@alpha.com');
      expect(loginRes.body.data.user.role).toBe(Role.SALES_EXECUTIVE);
      const sessionCookies = loginRes.headers['set-cookie'];
      expect(sessionCookies).toBeDefined();
      expect(sessionCookies[0]).toContain(`${SESSION_COOKIE_NAME}=`);

      // 6. Login fails when using incorrect password
      const badLoginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'lifecycle@alpha.com',
          password: 'WrongPassword999!'
        });
      expect(badLoginRes.status).toBe(401);
      expect(badLoginRes.body.error.message).toBe('Invalid email or password');

      // 7. Verify audit log: temporaryPassword and passwordHash absent from audit metadata
      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_ALPHA_ID,
          action: 'team.member_created',
          entityId: createdMemberId
        }
      });
      expect(audit).toBeDefined();
      expect(JSON.stringify(audit?.after)).not.toContain('TempLifecyclePass123!');
      expect(JSON.stringify(audit?.after)).not.toContain('passwordHash');
    });

    it('updates member name and promotes role with audit entry', async () => {
      const res = await request(app)
        .patch(`/api/v1/team/members/${createdMemberId}`)
        .set('Cookie', superAdminCookie)
        .send({
          name: 'Promoted Lifecycle Rep',
          role: Role.SALES_MANAGER
        });

      expect(res.status).toBe(200);
      const updated = teamMemberDetailSchema.parse(res.body);
      expect(updated.name).toBe('Promoted Lifecycle Rep');
      expect(updated.role).toBe(Role.SALES_MANAGER);

      // Verify audit log
      const roleAudit = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_ALPHA_ID,
          action: 'team.member_role_changed',
          entityId: createdMemberId
        }
      });
      expect(roleAudit).toBeDefined();
    });

    it('deactivates member successfully and handles idempotent repeat deactivation', async () => {
      // First deactivation
      const res1 = await request(app)
        .post(`/api/v1/team/members/${createdMemberId}/deactivate`)
        .set('Cookie', superAdminCookie);

      expect(res1.status).toBe(200);
      const act1 = teamMemberActionResponseSchema.parse(res1.body);
      expect(act1.member.isActive).toBe(false);
      expect(act1.message).toBe('Member deactivated successfully');

      // Second deactivation (idempotent no-op)
      const res2 = await request(app)
        .post(`/api/v1/team/members/${createdMemberId}/deactivate`)
        .set('Cookie', superAdminCookie);

      expect(res2.status).toBe(200);
      const act2 = teamMemberActionResponseSchema.parse(res2.body);
      expect(act2.member.isActive).toBe(false);
      expect(act2.message).toBe('Member is already inactive');
    });

    it('activates member successfully and handles idempotent repeat activation', async () => {
      // First activation
      const res1 = await request(app)
        .post(`/api/v1/team/members/${createdMemberId}/activate`)
        .set('Cookie', superAdminCookie);

      expect(res1.status).toBe(200);
      const act1 = teamMemberActionResponseSchema.parse(res1.body);
      expect(act1.member.isActive).toBe(true);
      expect(act1.message).toBe('Member activated successfully');

      // Second activation (idempotent no-op)
      const res2 = await request(app)
        .post(`/api/v1/team/members/${createdMemberId}/activate`)
        .set('Cookie', superAdminCookie);

      expect(res2.status).toBe(200);
      const act2 = teamMemberActionResponseSchema.parse(res2.body);
      expect(act2.member.isActive).toBe(true);
      expect(act2.message).toBe('Member is already active');
    });
  });

  // =========================================================================
  // 3. Inactive Session Immediate Revocation
  // =========================================================================
  describe('3. Inactive Session Revocation Regression', () => {
    it('deactivating user immediately invalidates active sessions across Team and Dashboard APIs', async () => {
      // Session starts valid
      const validRes = await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Cookie', deactivatedUserCookie);
      expect(validRes.status).toBe(200);

      // Deactivate user via Team API
      const deactRes = await request(app)
        .post(`/api/v1/team/members/${deactivatedUserId}/deactivate`)
        .set('Cookie', superAdminCookie);
      expect(deactRes.status).toBe(200);

      // Subsequent call using existing session cookie is rejected with 401
      const rejectDash = await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Cookie', deactivatedUserCookie);
      expect(rejectDash.status).toBe(401);
      expect(rejectDash.body.error.code).toBe('UNAUTHENTICATED');

      const rejectTeam = await request(app)
        .get('/api/v1/team/members')
        .set('Cookie', deactivatedUserCookie);
      expect(rejectTeam.status).toBe(401);
      expect(rejectTeam.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  // =========================================================================
  // 4. Sales Dashboard End-to-End Analytics Engine
  // =========================================================================
  describe('4. Sales Dashboard Integration & Exact Analytics Values', () => {
    it('GET /summary calculates exact KPI values and cohort conversion rates', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/summary?preset=30d')
        .set('Cookie', superAdminCookie);

      expect(res.status).toBe(200);
      const summary = dashboardSummaryResponseSchema.parse(res.body);

      // 2 leads created inside 30d (Lead 1 [WON] and Lead 2 [NEGOTIATION])
      expect(summary.leads.totalCohort).toBe(2);
      expect(summary.leads.cohortWon).toBe(1);
      expect(summary.leads.cohortConversionRate).toBe(50); // 1 / 2 * 100

      // Operational follow-ups
      expect(summary.followUps.dueToday).toBe(1);
      expect(summary.followUps.overdue).toBe(1);
      expect(summary.followUps.completed).toBe(1);

      // Outreach send cohort
      expect(summary.outreach.sent).toBe(1);
      expect(summary.outreach.delivered).toBe(1);
      expect(summary.outreach.failed).toBe(0);
      expect(summary.outreach.resolvedDeliverySuccessRate).toBe(100);
    });

    it('GET /funnel returns all 7 canonical stages as point-in-time snapshot including historical leads', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/funnel')
        .set('Cookie', superAdminCookie);

      expect(res.status).toBe(200);
      const funnel = dashboardFunnelResponseSchema.parse(res.body);

      // Total leads in tenant: lead1 (WON), lead2 (NEGOTIATION), leadOld (WON) = 3 total
      expect(funnel.total).toBe(3);
      expect(funnel.stages.length).toBe(7);

      const won = funnel.stages.find((s) => s.stage === CrmStage.WON);
      const neg = funnel.stages.find((s) => s.stage === CrmStage.NEGOTIATION);
      expect(won?.count).toBe(2); // lead1 + leadOld
      expect(neg?.count).toBe(1); // lead2
    });

    it('GET /sources returns acquisition source breakdown for period cohort', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/sources?preset=30d')
        .set('Cookie', superAdminCookie);

      expect(res.status).toBe(200);
      const sourcesRes = dashboardSourcesResponseSchema.parse(res.body);

      expect(sourcesRes.total).toBe(2);
      const website = sourcesRes.sources.find((s) => s.source === 'WEBSITE');
      const linkedin = sourcesRes.sources.find((s) => s.source === 'LINKEDIN');
      expect(website?.count).toBe(1);
      expect(linkedin?.count).toBe(1);
    });

    it('GET /outreach returns channel delivery breakdown with send-cohort semantics', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/outreach?preset=30d')
        .set('Cookie', superAdminCookie);

      expect(res.status).toBe(200);
      const outreachRes = dashboardOutreachResponseSchema.parse(res.body);

      expect(outreachRes.totals.sent).toBe(1);
      expect(outreachRes.totals.delivered).toBe(1);
      expect(outreachRes.totals.resolvedDeliverySuccessRate).toBe(100);

      const wa = outreachRes.channels.find((c) => c.channel === OutreachChannel.WHATSAPP);
      const em = outreachRes.channels.find((c) => c.channel === OutreachChannel.EMAIL);
      expect(wa?.delivered).toBe(1);
      expect(em?.delivered).toBe(0);
    });

    it('GET /team-performance returns per-member current workload and period performance without gamification', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/team-performance?preset=30d')
        .set('Cookie', superAdminCookie);

      expect(res.status).toBe(200);
      const perf = dashboardTeamPerformanceResponseSchema.parse(res.body);

      const rep1 = perf.members.find((m) => m.userId === salesExec1Id);
      expect(rep1).toBeDefined();
      expect(rep1?.currentWorkload.activeLeads).toBe(0); // WON leads are closed
      expect(rep1?.currentWorkload.pendingFollowUps).toBe(1);
      expect(rep1?.currentWorkload.overdueFollowUps).toBe(1);
      expect(rep1?.periodPerformance.leadsCreated).toBe(1);
      expect(rep1?.periodPerformance.cohortWon).toBe(1);
      expect(rep1?.periodPerformance.cohortConversionRate).toBe(100);
      expect(rep1?.periodPerformance.outreachDelivered).toBe(1);

      // Verify absence of gamification attributes
      const rawJson = JSON.stringify(perf);
      expect(rawJson).not.toContain('rank');
      expect(rawJson).not.toContain('leaderboard');
      expect(rawJson).not.toContain('score');
    });
  });

  // =========================================================================
  // 5. Cross-Tenant Data Isolation
  // =========================================================================
  describe('5. Cross-Tenant Data Isolation Verification', () => {
    it('Org Alpha caller never observes Org Beta data across all endpoints', async () => {
      // 1. Team list
      const teamRes = await request(app)
        .get('/api/v1/team/members?limit=100')
        .set('Cookie', superAdminCookie);
      const teamIds = teamRes.body.items.map((m: any) => m.id);
      expect(teamIds).not.toContain(betaMemberId);
      expect(teamIds).not.toContain(betaSuperAdminId);

      // 2. Summary
      const sumRes = await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Cookie', superAdminCookie);
      expect(sumRes.body.leads.totalCohort).toBe(2); // Excludes Beta's lead

      // 3. Funnel
      const funRes = await request(app)
        .get('/api/v1/dashboard/funnel')
        .set('Cookie', superAdminCookie);
      expect(funRes.body.total).toBe(3); // Excludes Beta's lead

      // 4. Sources
      const srcRes = await request(app)
        .get('/api/v1/dashboard/sources')
        .set('Cookie', superAdminCookie);
      expect(srcRes.body.sources.map((s: any) => s.source)).not.toContain('OUTBOUND'); // Beta source
    });

    it('Org Alpha caller attempting mutations on Org Beta member fails closed with 404', async () => {
      const getRes = await request(app)
        .get(`/api/v1/team/members/${betaMemberId}`)
        .set('Cookie', superAdminCookie);
      expect(getRes.status).toBe(404);

      const patchRes = await request(app)
        .patch(`/api/v1/team/members/${betaMemberId}`)
        .set('Cookie', superAdminCookie)
        .send({ name: 'Tampered Beta Member' });
      expect(patchRes.status).toBe(404);

      const actRes = await request(app)
        .post(`/api/v1/team/members/${betaMemberId}/activate`)
        .set('Cookie', superAdminCookie);
      expect(actRes.status).toBe(404);

      const deactRes = await request(app)
        .post(`/api/v1/team/members/${betaMemberId}/deactivate`)
        .set('Cookie', superAdminCookie);
      expect(deactRes.status).toBe(404);
    });
  });

  // =========================================================================
  // 6. Response & Secret Safety
  // =========================================================================
  describe('6. Response & Secret Safety Verification', () => {
    it('ensures integrated API responses strictly exclude credentials and customer PII', async () => {
      const endpoints = [
        ['GET', '/api/v1/team/members'],
        ['GET', `/api/v1/team/members/${salesExec1Id}`],
        ['GET', '/api/v1/dashboard/summary'],
        ['GET', '/api/v1/dashboard/funnel'],
        ['GET', '/api/v1/dashboard/sources'],
        ['GET', '/api/v1/dashboard/outreach'],
        ['GET', '/api/v1/dashboard/team-performance']
      ];

      for (const [method, url] of endpoints) {
        const res = await (method === 'GET' ? request(app).get(url) : request(app).post(url))
          .set('Cookie', superAdminCookie);

        const bodyStr = JSON.stringify(res.body);

        // Credential secrets
        expect(bodyStr).not.toContain('passwordHash');
        expect(bodyStr).not.toContain('temporaryPassword');
        expect(bodyStr).not.toContain('tokenHash');
        expect(bodyStr).not.toContain('DATABASE_URL');

        // Customer PII
        expect(bodyStr).not.toContain('+8801700000010');
        expect(bodyStr).not.toContain('WhatsApp message content');
      }
    });
  });
});
