import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import prisma from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import {
  CrmStage,
  DashboardDatePreset,
  FollowUpStatus,
  OutreachChannel,
  OutreachDeliveryStatus,
  Role,
  dashboardSummaryResponseSchema,
  dashboardFunnelResponseSchema,
  dashboardSourcesResponseSchema,
  dashboardOutreachResponseSchema,
  dashboardTeamPerformanceResponseSchema
} from '@leadmate/shared';
import { app } from '../app.js';
import { hashPassword, hashSessionToken } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';

describe('M7 Step 5: Sales Dashboard REST API & Scoping Integration Tests', () => {
  const ORG_A_ID = '11111111-1111-1111-1111-111111111111';
  const ORG_B_ID = '22222222-2222-2222-2222-222222222222';

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

  let superAdminBId: string;
  let superAdminBCookie: string;

  let leadA1Id: string;
  let leadA2Id: string;
  let leadB1Id: string;

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
    const orgs = [ORG_A_ID, ORG_B_ID];

    await prisma.outreachDelivery.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.salesAssistantDraft.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.followUpTask.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.leadContact.deleteMany({ where: { lead: { organizationId: { in: orgs } } } });
    await prisma.lead.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.session.deleteMany({ where: { user: { organizationId: { in: orgs } } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: orgs } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  }

  beforeAll(async () => {
    await cleanupDb();

    // 1. Create Organizations
    await prisma.organization.createMany({
      data: [
        { id: ORG_A_ID, name: 'Dashboard Org A', timezone: 'Asia/Dhaka' },
        { id: ORG_B_ID, name: 'Dashboard Org B', timezone: 'Asia/Dhaka' }
      ]
    });

    const passHash = await hashPassword('DashboardTest123!');

    // 2. Create Users for Org A
    const superAdminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'SuperAdmin Alice',
        email: 'alice.sa@dashboard-a.com',
        role: Role.SUPER_ADMIN as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    superAdminAId = superAdminA.id;
    superAdminACookie = await createSessionCookie(superAdminAId, 'token-sa-a');

    const adminA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Admin Aaron',
        email: 'aaron.admin@dashboard-a.com',
        role: Role.ADMIN as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    adminAId = adminA.id;
    adminACookie = await createSessionCookie(adminAId, 'token-admin-a');

    const salesManagerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Manager Bob',
        email: 'bob.manager@dashboard-a.com',
        role: Role.SALES_MANAGER as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    salesManagerAId = salesManagerA.id;
    salesManagerACookie = await createSessionCookie(salesManagerAId, 'token-sm-a');

    const salesExecA1 = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Executive Charlie',
        email: 'charlie.exec@dashboard-a.com',
        role: Role.SALES_EXECUTIVE as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    salesExecA1Id = salesExecA1.id;
    salesExecA1Cookie = await createSessionCookie(salesExecA1Id, 'token-se1-a');

    const salesExecA2 = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Executive Dave',
        email: 'dave.exec@dashboard-a.com',
        role: Role.SALES_EXECUTIVE as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    salesExecA2Id = salesExecA2.id;
    salesExecA2Cookie = await createSessionCookie(salesExecA2Id, 'token-se2-a');

    const viewerA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Viewer Vicky',
        email: 'vicky.viewer@dashboard-a.com',
        role: Role.VIEWER as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    viewerAId = viewerA.id;
    viewerACookie = await createSessionCookie(viewerAId, 'token-viewer-a');

    // 3. Create Users for Org B
    const superAdminB = await prisma.user.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'SuperAdmin Brenda',
        email: 'brenda.sa@dashboard-b.com',
        role: Role.SUPER_ADMIN as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    superAdminBId = superAdminB.id;
    superAdminBCookie = await createSessionCookie(superAdminBId, 'token-sa-b');

    // 4. Seed Data for Org A
    const now = new Date();
    const lead1 = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        assignedUserId: salesExecA1Id,
        name: 'Lead A1 - Charlie',
        normalizedName: 'lead a1 - charlie',
        category: 'Technology',
        city: 'Dhaka',
        primarySource: 'GOOGLE_MAPS',
        crmStage: CrmStage.WON as any,
        createdAt: now
      }
    });
    leadA1Id = lead1.id;

    const lead2 = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        assignedUserId: salesExecA2Id,
        name: 'Lead A2 - Dave',
        normalizedName: 'lead a2 - dave',
        category: 'Retail',
        city: 'Dhaka',
        primarySource: 'WEBSITE',
        crmStage: CrmStage.QUALIFIED as any,
        createdAt: now
      }
    });
    leadA2Id = lead2.id;

    await prisma.followUpTask.create({
      data: {
        organizationId: ORG_A_ID,
        leadId: leadA1Id,
        assignedUserId: salesExecA1Id,
        createdByUserId: superAdminAId,
        note: 'Follow-up with Lead A1',
        status: FollowUpStatus.PENDING as any,
        dueAt: new Date(now.getTime() + 60 * 60 * 1000)
      }
    });

    const draftA = await prisma.salesAssistantDraft.create({
      data: {
        organizationId: ORG_A_ID,
        leadId: leadA1Id,
        createdByUserId: superAdminAId,
        type: 'WHATSAPP' as any,
        language: 'BANGLA' as any,
        tone: 'PROFESSIONAL' as any,
        content: 'Draft A message'
      }
    });

    await prisma.outreachDelivery.create({
      data: {
        organizationId: ORG_A_ID,
        leadId: leadA1Id,
        draftId: draftA.id,
        channel: OutreachChannel.WHATSAPP as any,
        status: OutreachDeliveryStatus.DELIVERED as any,
        recipientNormalized: '+8801700000001',
        approvedDraftSnapshotHash: 'dash-hash-a1',
        idempotencyKey: 'dash-key-a1',
        requestFingerprint: 'dash-fp-a1',
        requestedByUserId: salesExecA1Id,
        providerName: 'meta_whatsapp',
        sentAt: now,
        deliveredAt: now
      }
    });

    // 5. Seed Data for Org B
    const leadB = await prisma.lead.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Lead B1 - Org B',
        normalizedName: 'lead b1 - org b',
        category: 'Services',
        city: 'Chittagong',
        primarySource: 'LINKEDIN',
        crmStage: CrmStage.PROPOSAL_SENT as any,
        createdAt: now
      }
    });
    leadB1Id = leadB.id;

    const draftB = await prisma.salesAssistantDraft.create({
      data: {
        organizationId: ORG_B_ID,
        leadId: leadB1Id,
        createdByUserId: superAdminBId,
        type: 'EMAIL' as any,
        language: 'ENGLISH' as any,
        tone: 'PROFESSIONAL' as any,
        content: 'Draft B message'
      }
    });

    await prisma.outreachDelivery.create({
      data: {
        organizationId: ORG_B_ID,
        leadId: leadB1Id,
        draftId: draftB.id,
        channel: OutreachChannel.EMAIL as any,
        status: OutreachDeliveryStatus.DELIVERED as any,
        recipientNormalized: 'test@orgb.com',
        approvedDraftSnapshotHash: 'dash-hash-b1',
        idempotencyKey: 'dash-key-b1',
        requestFingerprint: 'dash-fp-b1',
        requestedByUserId: superAdminBId,
        providerName: 'resend',
        sentAt: now,
        deliveredAt: now
      }
    });
  });

  afterAll(async () => {
    await cleanupDb();
  });

  describe('1. Authentication & Authorization Middleware', () => {
    it('rejects unauthenticated requests with 401 UNAUTHENTICATED on all endpoints', async () => {
      const endpoints = [
        '/api/v1/dashboard/summary',
        '/api/v1/dashboard/funnel',
        '/api/v1/dashboard/sources',
        '/api/v1/dashboard/outreach',
        '/api/v1/dashboard/team-performance'
      ];

      for (const endpoint of endpoints) {
        const res = await request(app).get(endpoint);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      }
    });

    it('rejects invalid or forged session cookie with 401', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Cookie', `${SESSION_COOKIE_NAME}=invalid-forged-cookie-token`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('2. Role Access Matrix & RBAC Verification', () => {
    it('allows SUPER_ADMIN full access to all endpoints', async () => {
      const resSummary = await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Cookie', superAdminACookie);
      expect(resSummary.status).toBe(200);
      expect(dashboardSummaryResponseSchema.safeParse(resSummary.body).success).toBe(true);

      const resTeam = await request(app)
        .get('/api/v1/dashboard/team-performance')
        .set('Cookie', superAdminACookie);
      expect(resTeam.status).toBe(200);
      expect(dashboardTeamPerformanceResponseSchema.safeParse(resTeam.body).success).toBe(true);
    });

    it('allows ADMIN full access to all endpoints', async () => {
      const resFunnel = await request(app)
        .get('/api/v1/dashboard/funnel')
        .set('Cookie', adminACookie);
      expect(resFunnel.status).toBe(200);
      expect(dashboardFunnelResponseSchema.safeParse(resFunnel.body).success).toBe(true);

      const resTeam = await request(app)
        .get('/api/v1/dashboard/team-performance')
        .set('Cookie', adminACookie);
      expect(resTeam.status).toBe(200);
    });

    it('allows SALES_MANAGER full access to all endpoints', async () => {
      const resOutreach = await request(app)
        .get('/api/v1/dashboard/outreach')
        .set('Cookie', salesManagerACookie);
      expect(resOutreach.status).toBe(200);
      expect(dashboardOutreachResponseSchema.safeParse(resOutreach.body).success).toBe(true);

      const resTeam = await request(app)
        .get('/api/v1/dashboard/team-performance')
        .set('Cookie', salesManagerACookie);
      expect(resTeam.status).toBe(200);
    });

    it('allows VIEWER tenant-wide read-only access to all endpoints including team-performance', async () => {
      const resSummary = await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Cookie', viewerACookie);
      expect(resSummary.status).toBe(200);

      const resTeam = await request(app)
        .get('/api/v1/dashboard/team-performance')
        .set('Cookie', viewerACookie);
      expect(resTeam.status).toBe(200);
      expect(resTeam.body.members.length).toBeGreaterThanOrEqual(1);
    });

    it('allows SALES_EXECUTIVE access to summary, funnel, sources, and outreach', async () => {
      const resSummary = await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Cookie', salesExecA1Cookie);
      expect(resSummary.status).toBe(200);
      expect(dashboardSummaryResponseSchema.safeParse(resSummary.body).success).toBe(true);

      const resFunnel = await request(app)
        .get('/api/v1/dashboard/funnel')
        .set('Cookie', salesExecA1Cookie);
      expect(resFunnel.status).toBe(200);
      expect(dashboardFunnelResponseSchema.safeParse(resFunnel.body).success).toBe(true);

      const resSources = await request(app)
        .get('/api/v1/dashboard/sources')
        .set('Cookie', salesExecA1Cookie);
      expect(resSources.status).toBe(200);
      expect(dashboardSourcesResponseSchema.safeParse(resSources.body).success).toBe(true);

      const resOutreach = await request(app)
        .get('/api/v1/dashboard/outreach')
        .set('Cookie', salesExecA1Cookie);
      expect(resOutreach.status).toBe(200);
      expect(dashboardOutreachResponseSchema.safeParse(resOutreach.body).success).toBe(true);
    });

    it('forbids SALES_EXECUTIVE from accessing /team-performance with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/team-performance')
        .set('Cookie', salesExecA1Cookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('Sales executives are not authorized to view team performance');
    });
  });

  describe('3. SALES_EXECUTIVE Self-Scoping & Scope Expansion Tamper Resistance', () => {
    it('scopes SALES_EXECUTIVE summary to own assigned leads only', async () => {
      // Charlie (Exec A1) has leadA1 (WON)
      const resCharlie = await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Cookie', salesExecA1Cookie);

      expect(resCharlie.status).toBe(200);
      expect(resCharlie.body.leads.totalCohort).toBe(1);
      expect(resCharlie.body.leads.cohortWon).toBe(1);

      // Dave (Exec A2) has leadA2 (QUALIFIED)
      const resDave = await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Cookie', salesExecA2Cookie);

      expect(resDave.status).toBe(200);
      expect(resDave.body.leads.totalCohort).toBe(1);
      expect(resDave.body.leads.cohortWon).toBe(0);
    });

    it('overrides client-supplied assigneeId when SALES_EXECUTIVE queries peer id (scope expansion prevention)', async () => {
      // Charlie passes Dave's user ID as assigneeId
      const res = await request(app)
        .get(`/api/v1/dashboard/summary?assigneeId=${salesExecA2Id}`)
        .set('Cookie', salesExecA1Cookie);

      expect(res.status).toBe(200);
      // Still returns Charlie's data (totalCohort=1, cohortWon=1), Dave's lead is NOT returned
      expect(res.body.leads.totalCohort).toBe(1);
      expect(res.body.leads.cohortWon).toBe(1);
    });
  });

  describe('4. Non-Executive Assignee Filtering & Cross-Tenant Safety', () => {
    it('allows SALES_MANAGER to filter by a valid member in the same organization', async () => {
      const resFiltered = await request(app)
        .get(`/api/v1/dashboard/summary?assigneeId=${salesExecA1Id}`)
        .set('Cookie', salesManagerACookie);

      expect(resFiltered.status).toBe(200);
      expect(resFiltered.body.leads.totalCohort).toBe(1);
      expect(resFiltered.body.leads.cohortWon).toBe(1);

      // Dave filter
      const resDave = await request(app)
        .get(`/api/v1/dashboard/summary?assigneeId=${salesExecA2Id}`)
        .set('Cookie', salesManagerACookie);

      expect(resDave.status).toBe(200);
      expect(resDave.body.leads.totalCohort).toBe(1);
      expect(resDave.body.leads.cohortWon).toBe(0);
    });

    it('fails closed with 404 NOT_FOUND when non-executive requests a cross-tenant assigneeId', async () => {
      // Manager A requests SuperAdmin B's user ID
      const res = await request(app)
        .get(`/api/v1/dashboard/summary?assigneeId=${superAdminBId}`)
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toContain('not found in organization');
    });

    it('fails closed with 404 NOT_FOUND when non-executive requests a non-existent UUID assigneeId', async () => {
      const randomUuid = '99999999-9999-9999-9999-999999999999';
      const res = await request(app)
        .get(`/api/v1/dashboard/summary?assigneeId=${randomUuid}`)
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('5. Strict Query Validation & Parameter Injection Rejection', () => {
    it('rejects client organizationId injection with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/summary?organizationId=${ORG_B_ID}`)
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(res.body.error.details)).toContain('organizationId');
    });

    it('rejects client tenantId injection with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get(`/api/v1/dashboard/summary?tenantId=${ORG_B_ID}`)
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(res.body.error.details)).toContain('tenantId');
    });

    it('rejects client timezone injection with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/summary?timezone=UTC')
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(res.body.error.details)).toContain('timezone');
    });

    it('rejects arbitrary unknown query parameters with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/summary?unknownKey=randomValue')
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid preset with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/summary?preset=180d')
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects custom preset when from or to is missing', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/summary?preset=custom&from=2026-01-01T00:00:00.000Z')
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects from/to when preset is not custom', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/summary?preset=30d&from=2026-01-01T00:00:00.000Z')
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects custom preset when from > to', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/summary?preset=custom&from=2026-02-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z')
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects custom preset when range exceeds 365 days', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/summary?preset=custom&from=2024-01-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z')
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('6. Tenant Isolation Tests', () => {
    it('ensures Org A summary never includes Org B leads or outreach', async () => {
      const resA = await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Cookie', superAdminACookie);

      expect(resA.status).toBe(200);
      expect(resA.body.leads.totalCohort).toBe(2);
      expect(resA.body.outreach.sent).toBe(1);

      const resB = await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Cookie', superAdminBCookie);

      expect(resB.status).toBe(200);
      expect(resB.body.leads.totalCohort).toBe(1);
      expect(resB.body.outreach.sent).toBe(1);
    });

    it('ensures Org A sources never include Org B lead sources', async () => {
      const resA = await request(app)
        .get('/api/v1/dashboard/sources')
        .set('Cookie', superAdminACookie);

      expect(resA.status).toBe(200);
      const sourcesA = resA.body.sources.map((s: any) => s.source);
      expect(sourcesA).toContain('GOOGLE_MAPS');
      expect(sourcesA).toContain('WEBSITE');
      expect(sourcesA).not.toContain('LINKEDIN'); // LINKEDIN is in Org B only

      const resB = await request(app)
        .get('/api/v1/dashboard/sources')
        .set('Cookie', superAdminBCookie);

      expect(resB.status).toBe(200);
      const sourcesB = resB.body.sources.map((s: any) => s.source);
      expect(sourcesB).toContain('LINKEDIN');
      expect(sourcesB).not.toContain('GOOGLE_MAPS');
    });

    it('ensures Org A team performance never includes Org B members', async () => {
      const resA = await request(app)
        .get('/api/v1/dashboard/team-performance')
        .set('Cookie', salesManagerACookie);

      expect(resA.status).toBe(200);
      const userIdsA = resA.body.members.map((m: any) => m.userId);
      expect(userIdsA).not.toContain(superAdminBId);
    });
  });

  describe('7. Endpoint Shared Schema Conformance', () => {
    it('GET /api/v1/dashboard/summary validates against dashboardSummaryResponseSchema', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/summary')
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(200);
      const parseResult = dashboardSummaryResponseSchema.safeParse(res.body);
      expect(parseResult.success).toBe(true);
      expect(res.body.range.preset).toBe(DashboardDatePreset.DAYS_30);
    });

    it('GET /api/v1/dashboard/funnel validates against dashboardFunnelResponseSchema', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/funnel')
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(200);
      const parseResult = dashboardFunnelResponseSchema.safeParse(res.body);
      expect(parseResult.success).toBe(true);
      expect(res.body.stages.length).toBe(7);
    });

    it('GET /api/v1/dashboard/sources validates against dashboardSourcesResponseSchema', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/sources')
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(200);
      const parseResult = dashboardSourcesResponseSchema.safeParse(res.body);
      expect(parseResult.success).toBe(true);
      expect(res.body.sources.length).toBeGreaterThan(0);
    });

    it('GET /api/v1/dashboard/outreach validates against dashboardOutreachResponseSchema', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/outreach')
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(200);
      const parseResult = dashboardOutreachResponseSchema.safeParse(res.body);
      expect(parseResult.success).toBe(true);
      expect(res.body.channels.length).toBe(2);
    });

    it('GET /api/v1/dashboard/team-performance validates against dashboardTeamPerformanceResponseSchema', async () => {
      const res = await request(app)
        .get('/api/v1/dashboard/team-performance')
        .set('Cookie', salesManagerACookie);

      expect(res.status).toBe(200);
      const parseResult = dashboardTeamPerformanceResponseSchema.safeParse(res.body);
      expect(parseResult.success).toBe(true);
      expect(res.body.total).toBe(res.body.members.length);
    });
  });
});
