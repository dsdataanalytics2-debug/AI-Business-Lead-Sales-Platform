import { describe, it, expect } from 'vitest';
import {
  CrmStage,
  DashboardDatePreset,
  OutreachChannel,
  Role,
  isValidDateRange,
  dashboardFilterQuerySchema,
  dashboardSummaryResponseSchema,
  dashboardFunnelResponseSchema,
  dashboardFunnelStageItemSchema,
  dashboardSourcesResponseSchema,
  dashboardSourceItemSchema,
  outreachCohortMetricsSchema,
  dashboardOutreachChannelItemSchema,
  dashboardOutreachResponseSchema,
  salesTeamMemberWorkloadSchema,
  salesTeamMemberPeriodPerformanceSchema,
  salesTeamPerformanceMemberSchema,
  dashboardTeamPerformanceResponseSchema
} from '../index.js';

describe('M7 Step 1: Sales Dashboard & Analytics Shared Contracts', () => {
  /* ---------------------------------------------------------
   * 1. Pure Date Range Validation Helper (isValidDateRange)
   * --------------------------------------------------------- */
  describe('isValidDateRange helper', () => {
    it('validates normal date ranges within 365 days', () => {
      const result = isValidDateRange('2026-01-01T00:00:00.000Z', '2026-01-31T00:00:00.000Z');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts Date objects directly', () => {
      const from = new Date('2026-01-01T00:00:00.000Z');
      const to = new Date('2026-06-01T00:00:00.000Z');
      expect(isValidDateRange(from, to).valid).toBe(true);
    });

    it('accepts exact 365 days boundary', () => {
      const from = new Date('2026-01-01T00:00:00.000Z');
      const to = new Date(from.getTime() + 365 * 24 * 60 * 60 * 1000);
      expect(isValidDateRange(from, to).valid).toBe(true);
    });

    it('rejects date ranges exceeding 365 days', () => {
      const from = new Date('2026-01-01T00:00:00.000Z');
      const to = new Date(from.getTime() + 366 * 24 * 60 * 60 * 1000);
      const result = isValidDateRange(from, to);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot exceed 365 days');
    });

    it('rejects from > to', () => {
      const result = isValidDateRange('2026-02-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('from timestamp must be less than or equal to to timestamp');
    });

    it('rejects invalid timestamps', () => {
      expect(isValidDateRange('invalid-date', '2026-01-01T00:00:00.000Z').valid).toBe(false);
      expect(isValidDateRange('2026-01-01T00:00:00.000Z', 'invalid-date').valid).toBe(false);
    });
  });

  /* ---------------------------------------------------------
   * 2. Dashboard Filter Query Schema (Presets & Custom)
   * --------------------------------------------------------- */
  describe('dashboardFilterQuerySchema', () => {
    it('defaults preset to 30d with all optional fields omitted', () => {
      const parsed = dashboardFilterQuerySchema.parse({});
      expect(parsed.preset).toBe(DashboardDatePreset.DAYS_30);
      expect(parsed.from).toBeUndefined();
      expect(parsed.to).toBeUndefined();
      expect(parsed.assigneeId).toBeUndefined();
      expect(parsed.source).toBeUndefined();
    });

    it('accepts valid predefined presets (7d, 30d, 90d) without from/to', () => {
      expect(dashboardFilterQuerySchema.parse({ preset: '7d' }).preset).toBe(DashboardDatePreset.DAYS_7);
      expect(dashboardFilterQuerySchema.parse({ preset: '30d' }).preset).toBe(DashboardDatePreset.DAYS_30);
      expect(dashboardFilterQuerySchema.parse({ preset: '90d' }).preset).toBe(DashboardDatePreset.DAYS_90);
    });

    it('rejects from/to when preset is not custom', () => {
      expect(() =>
        dashboardFilterQuerySchema.parse({
          preset: '30d',
          from: '2026-01-01T00:00:00.000Z'
        })
      ).toThrow(/from date is only allowed when preset is custom/);

      expect(() =>
        dashboardFilterQuerySchema.parse({
          preset: '7d',
          to: '2026-01-07T00:00:00.000Z'
        })
      ).toThrow(/to date is only allowed when preset is custom/);

      expect(() =>
        dashboardFilterQuerySchema.parse({
          // default 30d preset
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-01-31T00:00:00.000Z'
        })
      ).toThrow();
    });

    it('accepts custom preset with valid from and to timestamps within 365 days', () => {
      const parsed = dashboardFilterQuerySchema.parse({
        preset: 'custom',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-03-31T00:00:00.000Z'
      });
      expect(parsed.preset).toBe(DashboardDatePreset.CUSTOM);
      expect(parsed.from).toBe('2026-01-01T00:00:00.000Z');
      expect(parsed.to).toBe('2026-03-31T00:00:00.000Z');
    });

    it('rejects custom preset if from is missing', () => {
      expect(() =>
        dashboardFilterQuerySchema.parse({
          preset: 'custom',
          to: '2026-03-31T00:00:00.000Z'
        })
      ).toThrow(/from date is required/);
    });

    it('rejects custom preset if to is missing', () => {
      expect(() =>
        dashboardFilterQuerySchema.parse({
          preset: 'custom',
          from: '2026-01-01T00:00:00.000Z'
        })
      ).toThrow(/to date is required/);
    });

    it('rejects custom preset if from > to', () => {
      expect(() =>
        dashboardFilterQuerySchema.parse({
          preset: 'custom',
          from: '2026-05-01T00:00:00.000Z',
          to: '2026-04-01T00:00:00.000Z'
        })
      ).toThrow(/from date must be less than or equal to to date/);
    });

    it('rejects custom preset exceeding 365 days window', () => {
      expect(() =>
        dashboardFilterQuerySchema.parse({
          preset: 'custom',
          from: '2025-01-01T00:00:00.000Z',
          to: '2026-01-05T00:00:00.000Z' // 369 days
        })
      ).toThrow(/cannot exceed 365 days/);
    });

    it('rejects invalid timestamp strings', () => {
      expect(() =>
        dashboardFilterQuerySchema.parse({
          preset: 'custom',
          from: 'not-a-date',
          to: '2026-01-31T00:00:00.000Z'
        })
      ).toThrow();
    });

    it('accepts optional assigneeId as valid UUID and rejects non-UUID', () => {
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';
      const parsed = dashboardFilterQuerySchema.parse({ assigneeId: validUuid });
      expect(parsed.assigneeId).toBe(validUuid);

      expect(() =>
        dashboardFilterQuerySchema.parse({ assigneeId: 'invalid-non-uuid' })
      ).toThrow();
    });

    it('normalizes source: trims whitespace, transforms empty string to undefined', () => {
      const parsed1 = dashboardFilterQuerySchema.parse({ source: '  Google Maps  ' });
      expect(parsed1.source).toBe('Google Maps');

      const parsed2 = dashboardFilterQuerySchema.parse({ source: '   ' });
      expect(parsed2.source).toBeUndefined();
    });

    it('rejects source exceeding 100 characters', () => {
      expect(() =>
        dashboardFilterQuerySchema.parse({ source: 'A'.repeat(101) })
      ).toThrow();
    });

    it('strictly rejects unknown query parameters', () => {
      expect(() =>
        dashboardFilterQuerySchema.parse({
          preset: '30d',
          unknownField: 'malicious'
        })
      ).toThrow();
    });
  });

  /* ---------------------------------------------------------
   * 3. Dashboard Summary Response Contract
   * --------------------------------------------------------- */
  describe('dashboardSummaryResponseSchema', () => {
    const validSummary = {
      range: {
        from: '2026-09-08T00:00:00.000Z',
        to: '2026-10-08T00:00:00.000Z',
        preset: DashboardDatePreset.DAYS_30
      },
      leads: {
        totalCohort: 120,
        cohortWon: 18,
        cohortConversionRate: 15.0
      },
      followUps: {
        dueToday: 8,
        overdue: 3,
        completed: 25
      },
      outreach: {
        sent: 85,
        delivered: 80,
        failed: 3,
        awaitingDelivery: 2,
        resolvedDeliverySuccessRate: 96.38
      }
    };

    it('accepts valid summary response payload', () => {
      const parsed = dashboardSummaryResponseSchema.parse(validSummary);
      expect(parsed.leads.totalCohort).toBe(120);
      expect(parsed.outreach.resolvedDeliverySuccessRate).toBe(96.38);
    });

    it('rejects negative counts in leads, followUps, or outreach', () => {
      expect(() =>
        dashboardSummaryResponseSchema.parse({
          ...validSummary,
          leads: { ...validSummary.leads, totalCohort: -1 }
        })
      ).toThrow();

      expect(() =>
        dashboardSummaryResponseSchema.parse({
          ...validSummary,
          followUps: { ...validSummary.followUps, overdue: -1 }
        })
      ).toThrow();

      expect(() =>
        dashboardSummaryResponseSchema.parse({
          ...validSummary,
          outreach: { ...validSummary.outreach, failed: -1 }
        })
      ).toThrow();
    });

    it('rejects rate percentages < 0 or > 100 or non-finite', () => {
      expect(() =>
        dashboardSummaryResponseSchema.parse({
          ...validSummary,
          leads: { ...validSummary.leads, cohortConversionRate: -0.1 }
        })
      ).toThrow();

      expect(() =>
        dashboardSummaryResponseSchema.parse({
          ...validSummary,
          leads: { ...validSummary.leads, cohortConversionRate: 100.1 }
        })
      ).toThrow();

      expect(() =>
        dashboardSummaryResponseSchema.parse({
          ...validSummary,
          outreach: { ...validSummary.outreach, resolvedDeliverySuccessRate: Infinity }
        })
      ).toThrow();

      expect(() =>
        dashboardSummaryResponseSchema.parse({
          ...validSummary,
          outreach: { ...validSummary.outreach, resolvedDeliverySuccessRate: NaN }
        })
      ).toThrow();
    });

    it('strictly rejects unknown properties', () => {
      expect(() =>
        dashboardSummaryResponseSchema.parse({
          ...validSummary,
          extraField: 'unknown'
        })
      ).toThrow();
    });
  });

  /* ---------------------------------------------------------
   * 4. Current Pipeline Distribution (Funnel) Contract
   * --------------------------------------------------------- */
  describe('dashboardFunnelResponseSchema', () => {
    it('validates canonical CrmStage values and stage counts', () => {
      const validFunnel = {
        stages: [
          { stage: CrmStage.NEW, count: 50 },
          { stage: CrmStage.CONTACTED, count: 30 },
          { stage: CrmStage.QUALIFIED, count: 15 },
          { stage: CrmStage.PROPOSAL_SENT, count: 10 },
          { stage: CrmStage.NEGOTIATION, count: 6 },
          { stage: CrmStage.WON, count: 12 },
          { stage: CrmStage.LOST, count: 8 }
        ],
        total: 131
      };

      const parsed = dashboardFunnelResponseSchema.parse(validFunnel);
      expect(parsed.stages).toHaveLength(7);
      expect(parsed.total).toBe(131);
    });

    it('rejects non-canonical stage names', () => {
      expect(() =>
        dashboardFunnelStageItemSchema.parse({
          stage: 'INVALID_STAGE',
          count: 5
        })
      ).toThrow();
    });

    it('rejects negative counts in funnel stages or total', () => {
      expect(() =>
        dashboardFunnelStageItemSchema.parse({
          stage: CrmStage.NEW,
          count: -1
        })
      ).toThrow();

      expect(() =>
        dashboardFunnelResponseSchema.parse({
          stages: [{ stage: CrmStage.NEW, count: 5 }],
          total: -5
        })
      ).toThrow();
    });

    it('strictly rejects unknown properties', () => {
      expect(() =>
        dashboardFunnelResponseSchema.parse({
          stages: [{ stage: CrmStage.NEW, count: 5 }],
          total: 5,
          unknownProp: true
        })
      ).toThrow();
    });
  });

  /* ---------------------------------------------------------
   * 5. Lead Source Analytics Contract
   * --------------------------------------------------------- */
  describe('dashboardSourcesResponseSchema', () => {
    it('validates source items and total', () => {
      const validSources = {
        sources: [
          { source: 'Google Maps', count: 45 },
          { source: 'Yellow Pages', count: 20 },
          { source: 'Direct Inbound', count: 10 }
        ],
        total: 75
      };

      const parsed = dashboardSourcesResponseSchema.parse(validSources);
      expect(parsed.sources).toHaveLength(3);
      expect(parsed.total).toBe(75);
    });

    it('rejects empty source name or negative counts', () => {
      expect(() =>
        dashboardSourceItemSchema.parse({ source: '', count: 10 })
      ).toThrow();

      expect(() =>
        dashboardSourceItemSchema.parse({ source: 'Google Maps', count: -2 })
      ).toThrow();
    });

    it('strictly rejects unknown properties', () => {
      expect(() =>
        dashboardSourcesResponseSchema.parse({
          sources: [{ source: 'Google Maps', count: 10 }],
          total: 10,
          unexpected: 123
        })
      ).toThrow();
    });
  });

  /* ---------------------------------------------------------
   * 6. Outreach Send-Cohort Analytics Contract
   * --------------------------------------------------------- */
  describe('dashboardOutreachResponseSchema', () => {
    const validOutreach = {
      totals: {
        sent: 100,
        delivered: 92,
        failed: 5,
        awaitingDelivery: 3,
        resolvedDeliverySuccessRate: 94.85
      },
      channels: [
        {
          channel: OutreachChannel.WHATSAPP,
          sent: 60,
          delivered: 56,
          failed: 3,
          awaitingDelivery: 1,
          resolvedDeliverySuccessRate: 94.92
        },
        {
          channel: OutreachChannel.EMAIL,
          sent: 40,
          delivered: 36,
          failed: 2,
          awaitingDelivery: 2,
          resolvedDeliverySuccessRate: 94.74
        }
      ]
    };

    it('accepts valid outreach response with totals and channel metrics', () => {
      const parsed = dashboardOutreachResponseSchema.parse(validOutreach);
      expect(parsed.totals.sent).toBe(100);
      expect(parsed.channels).toHaveLength(2);
      expect(parsed.channels[0].channel).toBe(OutreachChannel.WHATSAPP);
      expect(parsed.channels[1].channel).toBe(OutreachChannel.EMAIL);
    });

    it('validates outreachCohortMetricsSchema rejects negative counts and rates > 100', () => {
      expect(() =>
        outreachCohortMetricsSchema.parse({
          sent: -1,
          delivered: 0,
          failed: 0,
          awaitingDelivery: 0,
          resolvedDeliverySuccessRate: 100
        })
      ).toThrow();

      expect(() =>
        outreachCohortMetricsSchema.parse({
          sent: 10,
          delivered: 10,
          failed: 0,
          awaitingDelivery: 0,
          resolvedDeliverySuccessRate: 101
        })
      ).toThrow();
    });

    it('rejects invalid outreach channel names', () => {
      expect(() =>
        dashboardOutreachChannelItemSchema.parse({
          channel: 'TELEGRAM',
          sent: 10,
          delivered: 10,
          failed: 0,
          awaitingDelivery: 0,
          resolvedDeliverySuccessRate: 100
        })
      ).toThrow();
    });

    it('strictly rejects unknown properties', () => {
      expect(() =>
        dashboardOutreachResponseSchema.parse({
          ...validOutreach,
          extraProp: 'bad'
        })
      ).toThrow();
    });
  });

  /* ---------------------------------------------------------
   * 7. Team Performance Contract (No Leaderboard / Gamification)
   * --------------------------------------------------------- */
  describe('dashboardTeamPerformanceResponseSchema', () => {
    const validMemberPerformance = {
      userId: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Tanvir Hossain',
      role: Role.SALES_EXECUTIVE,
      isActive: true,
      currentWorkload: {
        activeLeads: 14,
        pendingFollowUps: 5,
        overdueFollowUps: 1
      },
      periodPerformance: {
        leadsCreated: 22,
        cohortWon: 4,
        cohortConversionRate: 18.18,
        outreachSent: 45,
        outreachDelivered: 42,
        outreachFailed: 2,
        awaitingDelivery: 1,
        resolvedDeliverySuccessRate: 95.45
      }
    };

    it('accepts valid performance member schema with workload and period performance split', () => {
      const parsed = salesTeamPerformanceMemberSchema.parse(validMemberPerformance);
      expect(parsed.userId).toBe('123e4567-e89b-12d3-a456-426614174000');
      expect(parsed.currentWorkload.activeLeads).toBe(14);
      expect(parsed.periodPerformance.cohortWon).toBe(4);
    });

    it('strictly rejects gamification/leaderboard fields (rank, score, aiScore)', () => {
      expect(() =>
        salesTeamPerformanceMemberSchema.parse({
          ...validMemberPerformance,
          rank: 1
        })
      ).toThrow();

      expect(() =>
        salesTeamPerformanceMemberSchema.parse({
          ...validMemberPerformance,
          score: 95
        })
      ).toThrow();

      expect(() =>
        salesTeamPerformanceMemberSchema.parse({
          ...validMemberPerformance,
          aiScore: 88.5
        })
      ).toThrow();

      expect(() =>
        salesTeamPerformanceMemberSchema.parse({
          ...validMemberPerformance,
          leaderboardPosition: 1
        })
      ).toThrow();
    });

    it('validates full team performance list response schema', () => {
      const response = {
        members: [validMemberPerformance],
        total: 1
      };
      const parsed = dashboardTeamPerformanceResponseSchema.parse(response);
      expect(parsed.members).toHaveLength(1);
      expect(parsed.total).toBe(1);
    });

    it('rejects negative workload or period metrics', () => {
      expect(() =>
        salesTeamMemberWorkloadSchema.parse({
          activeLeads: -1,
          pendingFollowUps: 0,
          overdueFollowUps: 0
        })
      ).toThrow();

      expect(() =>
        salesTeamMemberPeriodPerformanceSchema.parse({
          leadsCreated: 0,
          cohortWon: 0,
          cohortConversionRate: 0,
          outreachSent: 0,
          outreachDelivered: 0,
          outreachFailed: -1,
          awaitingDelivery: 0,
          resolvedDeliverySuccessRate: 0
        })
      ).toThrow();
    });

    it('strictly rejects unknown properties in team performance response', () => {
      expect(() =>
        dashboardTeamPerformanceResponseSchema.parse({
          members: [validMemberPerformance],
          total: 1,
          arbitraryKey: 42
        })
      ).toThrow();
    });
  });
});
