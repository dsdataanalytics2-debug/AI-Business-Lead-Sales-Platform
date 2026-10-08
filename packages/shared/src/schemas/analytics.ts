import { z } from 'zod';
import { CrmStage, DashboardDatePreset, OutreachChannel, Role } from '../enums.js';

/* =========================================================
 * M7 Step 1: Sales Dashboard & Analytics Schemas & Contracts
 *
 * Provider-agnostic, database-agnostic shared contracts for:
 * Analytics filters, presets, KPI cards, pipeline distribution,
 * source analysis, send-cohort outreach, and team performance.
 * ========================================================= */

/* ---------------------------------------------------------
 * Pure Date Range Validation Helper
 * --------------------------------------------------------- */

export function isValidDateRange(
  from: string | Date,
  to: string | Date,
  maxDays: number = 365
): { valid: boolean; error?: string } {
  const fromTime = typeof from === 'string' ? Date.parse(from) : from.getTime();
  const toTime = typeof to === 'string' ? Date.parse(to) : to.getTime();

  if (Number.isNaN(fromTime)) {
    return { valid: false, error: 'Invalid from timestamp' };
  }
  if (Number.isNaN(toTime)) {
    return { valid: false, error: 'Invalid to timestamp' };
  }
  if (fromTime > toTime) {
    return { valid: false, error: 'from timestamp must be less than or equal to to timestamp' };
  }

  const diffMs = toTime - fromTime;
  const maxMs = maxDays * 24 * 60 * 60 * 1000;
  if (diffMs > maxMs) {
    return { valid: false, error: `Date range cannot exceed ${maxDays} days` };
  }

  return { valid: true };
}

/* ---------------------------------------------------------
 * 1. Analytics Query Filter Schema
 * --------------------------------------------------------- */

const isoDateStringSchema = z
  .string()
  .refine((val) => !Number.isNaN(Date.parse(val)), {
    message: 'Must be a valid ISO 8601 date string'
  });

export const dashboardFilterQuerySchema = z
  .object({
    preset: z
      .nativeEnum(DashboardDatePreset, {
        errorMap: () => ({ message: 'Invalid preset (allowed: 7d, 30d, 90d, custom)' })
      })
      .default(DashboardDatePreset.DAYS_30),
    from: isoDateStringSchema.optional(),
    to: isoDateStringSchema.optional(),
    assigneeId: z.string().uuid('assigneeId must be a valid UUID').optional(),
    source: z
      .string()
      .trim()
      .max(100, 'source cannot exceed 100 characters')
      .optional()
      .transform((val) => (val === '' ? undefined : val))
  })
  .strict()
  .superRefine((data, ctx) => {
    // If preset is custom, both from and to are required
    if (data.preset === DashboardDatePreset.CUSTOM) {
      if (!data.from) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'from date is required when preset is custom',
          path: ['from']
        });
      }
      if (!data.to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'to date is required when preset is custom',
          path: ['to']
        });
      }
    } else {
      // When preset is not custom, from and to are rejected if supplied
      if (data.from !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'from date is only allowed when preset is custom',
          path: ['from']
        });
      }
      if (data.to !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'to date is only allowed when preset is custom',
          path: ['to']
        });
      }
    }

    // When both from and to are provided, validate order and maximum window
    if (data.from && data.to) {
      const fromTime = Date.parse(data.from);
      const toTime = Date.parse(data.to);

      if (!Number.isNaN(fromTime) && !Number.isNaN(toTime)) {
        if (fromTime > toTime) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'from date must be less than or equal to to date',
            path: ['from']
          });
        }

        const diffMs = toTime - fromTime;
        const maxMs = 365 * 24 * 60 * 60 * 1000;
        if (diffMs > maxMs) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Custom date range cannot exceed 365 days',
            path: ['to']
          });
        }
      }
    }
  });

export type DashboardFilterQuery = z.infer<typeof dashboardFilterQuerySchema>;

/* ---------------------------------------------------------
 * 2. Shared KPI Primitives
 * --------------------------------------------------------- */

const nonNegativeInt = z.number().int().nonnegative();
const ratePercentage = z.number().min(0).max(100).finite();

/* ---------------------------------------------------------
 * 3. Dashboard Summary Response Contract
 * --------------------------------------------------------- */

export const dashboardSummaryResponseSchema = z
  .object({
    range: z
      .object({
        from: z.string(),
        to: z.string(),
        preset: z.nativeEnum(DashboardDatePreset)
      })
      .strict(),
    leads: z
      .object({
        totalCohort: nonNegativeInt,
        cohortWon: nonNegativeInt,
        cohortConversionRate: ratePercentage
      })
      .strict(),
    followUps: z
      .object({
        dueToday: nonNegativeInt,
        overdue: nonNegativeInt,
        completed: nonNegativeInt
      })
      .strict(),
    outreach: z
      .object({
        sent: nonNegativeInt,
        delivered: nonNegativeInt,
        failed: nonNegativeInt,
        awaitingDelivery: nonNegativeInt,
        resolvedDeliverySuccessRate: ratePercentage
      })
      .strict()
  })
  .strict();

export type DashboardSummaryResponse = z.infer<typeof dashboardSummaryResponseSchema>;

/* ---------------------------------------------------------
 * 4. Pipeline Funnel (Current Pipeline Distribution) Contract
 * --------------------------------------------------------- */

export const dashboardFunnelStageItemSchema = z
  .object({
    stage: z.nativeEnum(CrmStage),
    count: nonNegativeInt
  })
  .strict();

export type DashboardFunnelStageItem = z.infer<typeof dashboardFunnelStageItemSchema>;

export const dashboardFunnelResponseSchema = z
  .object({
    stages: z.array(dashboardFunnelStageItemSchema),
    total: nonNegativeInt
  })
  .strict();

export type DashboardFunnelResponse = z.infer<typeof dashboardFunnelResponseSchema>;

/* ---------------------------------------------------------
 * 5. Lead Source Analytics Contract
 * --------------------------------------------------------- */

export const dashboardSourceItemSchema = z
  .object({
    source: z.string().min(1),
    count: nonNegativeInt
  })
  .strict();

export type DashboardSourceItem = z.infer<typeof dashboardSourceItemSchema>;

export const dashboardSourcesResponseSchema = z
  .object({
    sources: z.array(dashboardSourceItemSchema),
    total: nonNegativeInt
  })
  .strict();

export type DashboardSourcesResponse = z.infer<typeof dashboardSourcesResponseSchema>;

/* ---------------------------------------------------------
 * 6. Outreach Send-Cohort Analytics Contract
 * --------------------------------------------------------- */

export const outreachCohortMetricsSchema = z
  .object({
    sent: nonNegativeInt,
    delivered: nonNegativeInt,
    failed: nonNegativeInt,
    awaitingDelivery: nonNegativeInt,
    resolvedDeliverySuccessRate: ratePercentage
  })
  .strict();

export type OutreachCohortMetrics = z.infer<typeof outreachCohortMetricsSchema>;

export const dashboardOutreachChannelItemSchema = z
  .object({
    channel: z.nativeEnum(OutreachChannel),
    sent: nonNegativeInt,
    delivered: nonNegativeInt,
    failed: nonNegativeInt,
    awaitingDelivery: nonNegativeInt,
    resolvedDeliverySuccessRate: ratePercentage
  })
  .strict();

export type DashboardOutreachChannelItem = z.infer<typeof dashboardOutreachChannelItemSchema>;

export const dashboardOutreachResponseSchema = z
  .object({
    totals: outreachCohortMetricsSchema,
    channels: z.array(dashboardOutreachChannelItemSchema)
  })
  .strict();

export type DashboardOutreachResponse = z.infer<typeof dashboardOutreachResponseSchema>;

/* ---------------------------------------------------------
 * 7. Sales Team Performance Contract (No Leaderboard / Gamification)
 * --------------------------------------------------------- */

export const salesTeamMemberWorkloadSchema = z
  .object({
    activeLeads: nonNegativeInt,
    pendingFollowUps: nonNegativeInt,
    overdueFollowUps: nonNegativeInt
  })
  .strict();

export type SalesTeamMemberWorkload = z.infer<typeof salesTeamMemberWorkloadSchema>;

export const salesTeamMemberPeriodPerformanceSchema = z
  .object({
    leadsCreated: nonNegativeInt,
    cohortWon: nonNegativeInt,
    cohortConversionRate: ratePercentage,
    outreachSent: nonNegativeInt,
    outreachDelivered: nonNegativeInt,
    outreachFailed: nonNegativeInt,
    awaitingDelivery: nonNegativeInt,
    resolvedDeliverySuccessRate: ratePercentage
  })
  .strict();

export type SalesTeamMemberPeriodPerformance = z.infer<typeof salesTeamMemberPeriodPerformanceSchema>;

export const salesTeamPerformanceMemberSchema = z
  .object({
    userId: z.string().uuid('Invalid user ID'),
    name: z.string().min(1),
    role: z.nativeEnum(Role),
    isActive: z.boolean(),
    currentWorkload: salesTeamMemberWorkloadSchema,
    periodPerformance: salesTeamMemberPeriodPerformanceSchema
  })
  .strict();

export type SalesTeamPerformanceMember = z.infer<typeof salesTeamPerformanceMemberSchema>;

export const dashboardTeamPerformanceResponseSchema = z
  .object({
    members: z.array(salesTeamPerformanceMemberSchema),
    total: nonNegativeInt
  })
  .strict();

export type DashboardTeamPerformanceResponse = z.infer<typeof dashboardTeamPerformanceResponseSchema>;
