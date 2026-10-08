import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import {
  CrmStage,
  DashboardDatePreset,
  FollowUpStatus,
  OutreachChannel,
  OutreachDeliveryStatus,
  Role
} from '@leadmate/shared';
import { analyticsService, AnalyticsActorContext } from '../services/analytics.service.js';
import { hashPassword } from '../lib/crypto.js';
import { NotFoundError, ForbiddenError } from '../lib/errors.js';

describe('M7 Step 4: Analytics Service Domain Engine Integration Tests', () => {
  const ORG_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const ORG_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  let superAdminA: AnalyticsActorContext;
  let salesManagerA: AnalyticsActorContext;
  let salesExecA1: AnalyticsActorContext;
  let salesExecA2: AnalyticsActorContext;
  let superAdminB: AnalyticsActorContext;

  let inactiveExecA: any;

  // Fixed reference point for deterministic testing: 2026-10-08 at 12:00:00 UTC
  // In Asia/Dhaka (+06:00), this is 2026-10-08 at 18:00:00 (6:00 PM)
  const FIXED_NOW = new Date('2026-10-08T12:00:00.000Z');

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
        { id: ORG_A_ID, name: 'Analytics Org A', timezone: 'Asia/Dhaka' },
        { id: ORG_B_ID, name: 'Analytics Org B', timezone: 'Asia/Dhaka' }
      ]
    });

    const passHash = await hashPassword('AnalyticsTestPass123!');

    // 2. Create Users for Org A
    const saA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Alice SuperAdmin',
        email: 'alice.sa@orga.test',
        role: Role.SUPER_ADMIN as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    superAdminA = { actorId: saA.id, organizationId: ORG_A_ID, role: Role.SUPER_ADMIN };

    const smA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Bob Manager',
        email: 'bob.sm@orga.test',
        role: Role.SALES_MANAGER as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    salesManagerA = { actorId: smA.id, organizationId: ORG_A_ID, role: Role.SALES_MANAGER };

    const seA1 = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Charlie Rep1',
        email: 'charlie.se@orga.test',
        role: Role.SALES_EXECUTIVE as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    salesExecA1 = { actorId: seA1.id, organizationId: ORG_A_ID, role: Role.SALES_EXECUTIVE };

    const seA2 = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'David Rep2',
        email: 'david.se@orga.test',
        role: Role.SALES_EXECUTIVE as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    salesExecA2 = { actorId: seA2.id, organizationId: ORG_A_ID, role: Role.SALES_EXECUTIVE };

    inactiveExecA = await prisma.user.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Eve InactiveRep',
        email: 'eve.inactive@orga.test',
        role: Role.SALES_EXECUTIVE as any,
        passwordHash: passHash,
        isActive: false
      }
    });

    // 3. Create User for Org B
    const saB = await prisma.user.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Zoe SuperAdmin B',
        email: 'zoe.sa@orgb.test',
        role: Role.SUPER_ADMIN as any,
        passwordHash: passHash,
        isActive: true
      }
    });
    superAdminB = { actorId: saB.id, organizationId: ORG_B_ID, role: Role.SUPER_ADMIN };
  });

  afterAll(async () => {
    await cleanupDb();
  });

  describe('1. Cohort Analytics & updatedAt Regression Protection', () => {
    it('calculates cohort metrics and ignores updatedAt changes outside acquisition range', async () => {
      // 10 days ago (within 30d cohort)
      const tenDaysAgo = new Date(FIXED_NOW.getTime() - 10 * 24 * 60 * 60 * 1000);
      // 45 days ago (outside 30d cohort)
      const fortyFiveDaysAgo = new Date(FIXED_NOW.getTime() - 45 * 24 * 60 * 60 * 1000);

      // Lead 1: Inside cohort, WON
      await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Lead Cohort Won',
          normalizedName: 'lead cohort won',
          category: 'Retail',
          city: 'Dhaka',
          primarySource: 'GOOGLE_SEARCH',
          crmStage: CrmStage.WON,
          assignedUserId: salesExecA1.actorId,
          createdAt: tenDaysAgo,
          updatedAt: FIXED_NOW
        }
      });

      // Lead 2: Inside cohort, NOT won (QUALIFIED)
      await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Lead Cohort In Progress',
          normalizedName: 'lead cohort in progress',
          category: 'Retail',
          city: 'Dhaka',
          primarySource: 'GOOGLE_SEARCH',
          crmStage: CrmStage.QUALIFIED,
          assignedUserId: salesExecA1.actorId,
          createdAt: tenDaysAgo,
          updatedAt: FIXED_NOW
        }
      });

      // Lead 3: OUTSIDE cohort (created 45d ago), but updated today to WON
      // Crucial test: MUST NOT enter 30d cohort simply because updatedAt changed!
      await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Old Lead Updated Recently',
          normalizedName: 'old lead updated recently',
          category: 'Retail',
          city: 'Dhaka',
          primarySource: 'GOOGLE_SEARCH',
          crmStage: CrmStage.WON,
          assignedUserId: salesExecA1.actorId,
          createdAt: fortyFiveDaysAgo,
          updatedAt: FIXED_NOW
        }
      });

      const summary = await analyticsService.getSummary(
        superAdminA,
        { preset: DashboardDatePreset.DAYS_30 },
        FIXED_NOW
      );

      // Total cohort should be exactly 2 (Lead 1 and Lead 2)
      expect(summary.leads.totalCohort).toBe(2);
      // Cohort WON should be exactly 1 (Lead 1)
      expect(summary.leads.cohortWon).toBe(1);
      // Conversion rate = 1 / 2 * 100 = 50.00%
      expect(summary.leads.cohortConversionRate).toBe(50);
    });
  });

  describe('2. Current Pipeline Funnel Snapshot', () => {
    it('returns point-in-time snapshot of all canonical stages independent of date range', async () => {
      // Seed one lead in each stage
      const allStages = [
        CrmStage.NEW,
        CrmStage.CONTACTED,
        CrmStage.QUALIFIED,
        CrmStage.PROPOSAL_SENT,
        CrmStage.NEGOTIATION,
        CrmStage.LOST
      ];

      for (const stage of allStages) {
        await prisma.lead.create({
          data: {
            organizationId: ORG_A_ID,
            name: `Lead Stage ${stage}`,
            normalizedName: `lead stage ${stage.toLowerCase()}`,
            category: 'Tech',
            city: 'Dhaka',
            primarySource: 'FACEBOOK',
            crmStage: stage,
            createdAt: new Date('2025-01-01T00:00:00.000Z') // created long ago
          }
        });
      }

      const funnel = await analyticsService.getFunnel(superAdminA, {
        preset: DashboardDatePreset.DAYS_30
      });

      expect(funnel.stages.length).toBe(7);
      const stageMap = new Map(funnel.stages.map((s) => [s.stage, s.count]));

      expect(stageMap.get(CrmStage.NEW)).toBeGreaterThanOrEqual(1);
      expect(stageMap.get(CrmStage.CONTACTED)).toBeGreaterThanOrEqual(1);
      expect(stageMap.get(CrmStage.QUALIFIED)).toBeGreaterThanOrEqual(2); // +1 from previous test
      expect(stageMap.get(CrmStage.PROPOSAL_SENT)).toBeGreaterThanOrEqual(1);
      expect(stageMap.get(CrmStage.NEGOTIATION)).toBeGreaterThanOrEqual(1);
      expect(stageMap.get(CrmStage.WON)).toBeGreaterThanOrEqual(2); // +2 from previous test
      expect(stageMap.get(CrmStage.LOST)).toBeGreaterThanOrEqual(1);

      expect(funnel.total).toBe(funnel.stages.reduce((sum, s) => sum + s.count, 0));
    });
  });

  describe('3. Operational Follow-Up Metrics & Timezone Boundaries', () => {
    it('accurately counts due-today (Asia/Dhaka window), overdue, and completed follow-ups', async () => {
      // Create a test lead for follow-ups
      const testLead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'FollowUp Lead A',
          normalizedName: 'followup lead a',
          category: 'Health',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          createdAt: FIXED_NOW
        }
      });

      // In Asia/Dhaka (+06:00), FIXED_NOW (2026-10-08 12:00 UTC) is 2026-10-08 18:00 (today).
      // 1. Task Due Today (future today in Dhaka: 2026-10-08 14:00 UTC = 20:00 Dhaka)
      const dueTodayTime = new Date('2026-10-08T14:00:00.000Z');
      await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLead.id,
          assignedUserId: salesExecA1.actorId,
          createdByUserId: superAdminA.actorId,
          status: FollowUpStatus.PENDING,
          dueAt: dueTodayTime
        }
      });

      // 2. Task Overdue (yesterday: 2026-10-07 10:00 UTC)
      const overdueTime = new Date('2026-10-07T10:00:00.000Z');
      await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLead.id,
          assignedUserId: salesExecA1.actorId,
          createdByUserId: superAdminA.actorId,
          status: FollowUpStatus.PENDING,
          dueAt: overdueTime
        }
      });

      // 3. Task Due Tomorrow (2026-10-09 06:00 UTC = 12:00 Dhaka tomorrow) -> neither due today nor overdue
      const tomorrowTime = new Date('2026-10-09T06:00:00.000Z');
      await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLead.id,
          assignedUserId: salesExecA1.actorId,
          createdByUserId: superAdminA.actorId,
          status: FollowUpStatus.PENDING,
          dueAt: tomorrowTime
        }
      });

      // 4. Task Completed within 30d window
      await prisma.followUpTask.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: testLead.id,
          assignedUserId: salesExecA1.actorId,
          createdByUserId: superAdminA.actorId,
          status: FollowUpStatus.COMPLETED,
          dueAt: overdueTime,
          completedAt: new Date(FIXED_NOW.getTime() - 2 * 24 * 60 * 60 * 1000)
        }
      });

      const summary = await analyticsService.getSummary(
        superAdminA,
        { preset: DashboardDatePreset.DAYS_30 },
        FIXED_NOW
      );

      expect(summary.followUps.dueToday).toBe(1);
      expect(summary.followUps.overdue).toBe(1);
      expect(summary.followUps.completed).toBe(1);
    });
  });

  describe('4. Outreach Send-Cohort Analytics', () => {
    it('isolates send-cohort by sentAt (ignoring messages delivered in period but sent outside)', async () => {
      // Create lead and draft
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Outreach Test Lead',
          normalizedName: 'outreach test lead',
          category: 'Retail',
          city: 'Dhaka',
          primarySource: 'OUTREACH',
          assignedUserId: salesExecA1.actorId,
          createdAt: FIXED_NOW
        }
      });

      const draft = await prisma.salesAssistantDraft.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: lead.id,
          createdByUserId: superAdminA.actorId,
          type: 'WHATSAPP' as any,
          language: 'BANGLA' as any,
          tone: 'PROFESSIONAL' as any,
          content: 'Hello World'
        }
      });

      const fiveDaysAgo = new Date(FIXED_NOW.getTime() - 5 * 24 * 60 * 60 * 1000);
      const fortyDaysAgo = new Date(FIXED_NOW.getTime() - 40 * 24 * 60 * 60 * 1000);

      // Message A (WHATSAPP): Sent 5d ago (inside 30d cohort), delivered 2d ago -> DELIVERED
      await prisma.outreachDelivery.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: lead.id,
          draftId: draft.id,
          channel: OutreachChannel.WHATSAPP,
          status: OutreachDeliveryStatus.DELIVERED,
          recipientNormalized: '+8801700000001',
          approvedDraftSnapshotHash: 'hash1',
          idempotencyKey: 'outreach-key-1',
          requestFingerprint: 'fp-1',
          requestedByUserId: superAdminA.actorId,
          sentAt: fiveDaysAgo,
          deliveredAt: new Date(FIXED_NOW.getTime() - 2 * 24 * 60 * 60 * 1000)
        }
      });

      // Message B (WHATSAPP): Sent 5d ago, failed 4d ago -> FAILED
      await prisma.outreachDelivery.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: lead.id,
          draftId: draft.id,
          channel: OutreachChannel.WHATSAPP,
          status: OutreachDeliveryStatus.FAILED,
          recipientNormalized: '+8801700000002',
          approvedDraftSnapshotHash: 'hash2',
          idempotencyKey: 'outreach-key-2',
          requestFingerprint: 'fp-2',
          requestedByUserId: superAdminA.actorId,
          sentAt: fiveDaysAgo,
          failedAt: new Date(FIXED_NOW.getTime() - 4 * 24 * 60 * 60 * 1000)
        }
      });

      // Message C (WHATSAPP): Sent 5d ago, currently SENT (awaiting terminal status) -> SENT
      await prisma.outreachDelivery.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: lead.id,
          draftId: draft.id,
          channel: OutreachChannel.WHATSAPP,
          status: OutreachDeliveryStatus.SENT,
          recipientNormalized: '+8801700000003',
          approvedDraftSnapshotHash: 'hash3',
          idempotencyKey: 'outreach-key-3',
          requestFingerprint: 'fp-3',
          requestedByUserId: superAdminA.actorId,
          sentAt: fiveDaysAgo
        }
      });

      // Message D (EMAIL): Sent 5d ago, delivered 3d ago -> DELIVERED
      await prisma.outreachDelivery.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: lead.id,
          draftId: draft.id,
          channel: OutreachChannel.EMAIL,
          status: OutreachDeliveryStatus.DELIVERED,
          recipientNormalized: 'test@client.test',
          approvedDraftSnapshotHash: 'hash4',
          idempotencyKey: 'outreach-key-4',
          requestFingerprint: 'fp-4',
          requestedByUserId: superAdminA.actorId,
          sentAt: fiveDaysAgo,
          deliveredAt: new Date(FIXED_NOW.getTime() - 3 * 24 * 60 * 60 * 1000)
        }
      });

      // Message E: Sent 40 days ago (OUTSIDE cohort), delivered 2 days ago!
      // Must NOT be counted in 30d send cohort!
      await prisma.outreachDelivery.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: lead.id,
          draftId: draft.id,
          channel: OutreachChannel.EMAIL,
          status: OutreachDeliveryStatus.DELIVERED,
          recipientNormalized: 'old@client.test',
          approvedDraftSnapshotHash: 'hash5',
          idempotencyKey: 'outreach-key-5',
          requestFingerprint: 'fp-5',
          requestedByUserId: superAdminA.actorId,
          sentAt: fortyDaysAgo,
          deliveredAt: new Date(FIXED_NOW.getTime() - 2 * 24 * 60 * 60 * 1000)
        }
      });

      const outreach = await analyticsService.getOutreach(
        superAdminA,
        { preset: DashboardDatePreset.DAYS_30 },
        FIXED_NOW
      );

      // Totals:
      // Messages in cohort: A (WA delivered), B (WA failed), C (WA sent), D (Email delivered) = 4 total
      expect(outreach.totals.sent).toBe(4);
      expect(outreach.totals.delivered).toBe(2); // A + D
      expect(outreach.totals.failed).toBe(1); // B
      expect(outreach.totals.awaitingDelivery).toBe(1); // C
      // Resolved rate: 2 / (2 + 1) * 100 = 66.67%
      expect(outreach.totals.resolvedDeliverySuccessRate).toBe(66.67);

      // WhatsApp channel:
      const wa = outreach.channels.find((c) => c.channel === OutreachChannel.WHATSAPP)!;
      expect(wa.sent).toBe(3);
      expect(wa.delivered).toBe(1);
      expect(wa.failed).toBe(1);
      expect(wa.awaitingDelivery).toBe(1);
      expect(wa.resolvedDeliverySuccessRate).toBe(50); // 1 / (1 + 1) * 100

      // Email channel:
      const email = outreach.channels.find((c) => c.channel === OutreachChannel.EMAIL)!;
      expect(email.sent).toBe(1);
      expect(email.delivered).toBe(1);
      expect(email.failed).toBe(0);
      expect(email.awaitingDelivery).toBe(0);
      expect(email.resolvedDeliverySuccessRate).toBe(100);
    });
  });

  describe('5. Lead Sources Analytics', () => {
    it('groups counts by primarySource and handles empty string as UNKNOWN', async () => {
      const tenDaysAgo = new Date(FIXED_NOW.getTime() - 10 * 24 * 60 * 60 * 1000);

      await prisma.lead.createMany({
        data: [
          {
            organizationId: ORG_A_ID,
            name: 'Source Lead 1',
            normalizedName: 'source lead 1',
            category: 'Tech',
            primarySource: 'LINKEDIN',
            createdAt: tenDaysAgo
          },
          {
            organizationId: ORG_A_ID,
            name: 'Source Lead 2',
            normalizedName: 'source lead 2',
            category: 'Tech',
            primarySource: 'LINKEDIN',
            createdAt: tenDaysAgo
          },
          {
            organizationId: ORG_A_ID,
            name: 'Source Lead 3',
            normalizedName: 'source lead 3',
            category: 'Tech',
            primarySource: '', // Empty source
            createdAt: tenDaysAgo
          }
        ]
      });

      const res = await analyticsService.getSources(
        superAdminA,
        { preset: DashboardDatePreset.DAYS_30 },
        FIXED_NOW
      );

      const linkedin = res.sources.find((s) => s.source === 'LINKEDIN');
      expect(linkedin).toBeDefined();
      expect(linkedin!.count).toBe(2);

      const unknownSource = res.sources.find((s) => s.source === 'UNKNOWN');
      expect(unknownSource).toBeDefined();
      expect(unknownSource!.count).toBe(1);

      // Filtering by specific source
      const filteredRes = await analyticsService.getSources(
        superAdminA,
        { preset: DashboardDatePreset.DAYS_30, source: 'LINKEDIN' },
        FIXED_NOW
      );
      expect(filteredRes.sources.length).toBe(1);
      expect(filteredRes.sources[0].source).toBe('LINKEDIN');
      expect(filteredRes.sources[0].count).toBe(2);
    });
  });

  describe('6. SALES_EXECUTIVE Scoping & Security Enforcement', () => {
    it('restricts SALES_EXECUTIVE to only their own assigned leads unconditionally', async () => {
      // Charlie Rep1 requests summary
      const repSummary = await analyticsService.getSummary(
        salesExecA1,
        { preset: DashboardDatePreset.DAYS_30 },
        FIXED_NOW
      );

      // Charlie Rep1 sees their assigned leads, not all tenant leads
      expect(repSummary.leads.totalCohort).toBeGreaterThanOrEqual(1);

      // Malicious attempt: Charlie Rep1 tries to query David Rep2 data by passing assigneeId
      const spoofedSummary = await analyticsService.getSummary(
        salesExecA1,
        { preset: DashboardDatePreset.DAYS_30, assigneeId: salesExecA2.actorId },
        FIXED_NOW
      );

      // Scope expansion MUST be overridden/denied: spoofedSummary must match Charlie's own scope
      expect(spoofedSummary.leads.totalCohort).toBe(repSummary.leads.totalCohort);
    });

    it('forbids SALES_EXECUTIVE from accessing team performance analytics (403 FORBIDDEN)', async () => {
      try {
        await analyticsService.getTeamPerformance(
          salesExecA1,
          { preset: DashboardDatePreset.DAYS_30 },
          FIXED_NOW
        );
        expect.fail('Should have thrown ForbiddenError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ForbiddenError);
        expect(err.statusCode).toBe(403);
      }
    });

    it('rejects cross-tenant or non-existent assignee IDs for managers (404 NOT_FOUND)', async () => {
      try {
        await analyticsService.getSummary(
          superAdminA,
          {
            preset: DashboardDatePreset.DAYS_30,
            assigneeId: superAdminB.actorId // Org B user!
          },
          FIXED_NOW
        );
        expect.fail('Should have thrown NotFoundError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(NotFoundError);
        expect(err.statusCode).toBe(404);
      }
    });
  });

  describe('7. Team Performance Analytics Engine', () => {
    it('returns batched per-member workload and period performance in deterministic order', async () => {
      const teamRes = await analyticsService.getTeamPerformance(
        salesManagerA,
        { preset: DashboardDatePreset.DAYS_30 },
        FIXED_NOW
      );

      // Must include sales roles: SALES_MANAGER and SALES_EXECUTIVE (including inactive)
      expect(teamRes.members.length).toBeGreaterThanOrEqual(4);
      expect(teamRes.total).toBe(teamRes.members.length);

      // Verify deterministic name ASC ordering
      for (let i = 0; i < teamRes.members.length - 1; i++) {
        expect(teamRes.members[i].name.localeCompare(teamRes.members[i + 1].name)).toBeLessThanOrEqual(0);
      }

      // Verify member structure and fields
      const charlie = teamRes.members.find((m) => m.userId === salesExecA1.actorId);
      expect(charlie).toBeDefined();
      expect(charlie!.role).toBe(Role.SALES_EXECUTIVE);
      expect(charlie!.isActive).toBe(true);
      expect(charlie!.currentWorkload.activeLeads).toBeGreaterThanOrEqual(0);
      expect(charlie!.periodPerformance.leadsCreated).toBeGreaterThanOrEqual(1);

      // Inactive member Eve is included with isActive: false
      const eve = teamRes.members.find((m) => m.userId === inactiveExecA.id);
      expect(eve).toBeDefined();
      expect(eve!.isActive).toBe(false);
    });
  });

  describe('8. Tenant Isolation Verification Across All 5 Methods', () => {
    beforeAll(async () => {
      // Seed data exclusively in Org B
      const leadB = await prisma.lead.create({
        data: {
          organizationId: ORG_B_ID,
          name: 'Org B Unique Lead',
          normalizedName: 'org b unique lead',
          category: 'Finance',
          city: 'Dhaka',
          primarySource: 'ORG_B_EXCLUSIVE',
          crmStage: CrmStage.WON,
          createdAt: new Date(FIXED_NOW.getTime() - 5 * 24 * 60 * 60 * 1000)
        }
      });

      await prisma.followUpTask.create({
        data: {
          organizationId: ORG_B_ID,
          leadId: leadB.id,
          createdByUserId: superAdminB.actorId,
          status: FollowUpStatus.PENDING,
          dueAt: FIXED_NOW
        }
      });
    });

    it('verifies Org A and Org B data are strictly isolated across summary, funnel, sources, outreach, and team', async () => {
      // Org A Summary
      const summaryA = await analyticsService.getSummary(superAdminA, { preset: DashboardDatePreset.DAYS_30 }, FIXED_NOW);
      // Org B Summary
      const summaryB = await analyticsService.getSummary(superAdminB, { preset: DashboardDatePreset.DAYS_30 }, FIXED_NOW);
      expect(summaryB.leads.totalCohort).toBe(1);
      expect(summaryB.leads.cohortWon).toBe(1);
      // Org A must NOT have Org B's source
      const sourcesA = await analyticsService.getSources(superAdminA, { preset: DashboardDatePreset.DAYS_30 }, FIXED_NOW);
      expect(sourcesA.sources.some((s) => s.source === 'ORG_B_EXCLUSIVE')).toBe(false);

      const sourcesB = await analyticsService.getSources(superAdminB, { preset: DashboardDatePreset.DAYS_30 }, FIXED_NOW);
      expect(sourcesB.sources.some((s) => s.source === 'ORG_B_EXCLUSIVE')).toBe(true);

      // Org B Outreach is empty
      const outreachB = await analyticsService.getOutreach(superAdminB, { preset: DashboardDatePreset.DAYS_30 }, FIXED_NOW);
      expect(outreachB.totals.sent).toBe(0);

      // Org B Funnel has only 1 lead in WON
      const funnelB = await analyticsService.getFunnel(superAdminB, { preset: DashboardDatePreset.DAYS_30 });
      expect(funnelB.total).toBe(1);
      const wonStageB = funnelB.stages.find((s) => s.stage === CrmStage.WON);
      expect(wonStageB?.count).toBe(1);

      // Org B Team Performance has 0 sales executives (only Super Admin)
      const teamB = await analyticsService.getTeamPerformance(superAdminB, { preset: DashboardDatePreset.DAYS_30 }, FIXED_NOW);
      expect(teamB.members.length).toBe(0);
    });
  });
});
