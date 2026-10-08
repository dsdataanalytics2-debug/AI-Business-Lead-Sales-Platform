import prisma from '@leadmate/db';
import {
  CrmStage,
  FollowUpStatus,
  OutreachChannel,
  OutreachDeliveryStatus,
  Role,
  type DashboardFilterQuery,
  type DashboardSummaryResponse,
  type DashboardFunnelResponse,
  type DashboardSourcesResponse,
  type DashboardOutreachResponse,
  type DashboardTeamPerformanceResponse,
  type SalesTeamPerformanceMember,
  dashboardSummaryResponseSchema,
  dashboardFunnelResponseSchema,
  dashboardSourcesResponseSchema,
  dashboardOutreachResponseSchema,
  dashboardTeamPerformanceResponseSchema
} from '@leadmate/shared';
import { NotFoundError, ForbiddenError } from '../lib/errors.js';
import {
  resolveDashboardRange,
  getCalendarDayUtcBounds,
  calculateRate
} from '../lib/analytics-range.js';

export interface AnalyticsActorContext {
  actorId: string;
  organizationId: string;
  role: Role;
}

export class AnalyticsService {
  /**
   * Resolves effective assignee ID based on actor role and optional query filter.
   *
   * Invariant:
   * - SALES_EXECUTIVE: Scope is unconditionally forced to actor.actorId. Client-supplied
   *   assigneeId cannot expand or alter scope.
   * - Non-SALES_EXECUTIVE: If query.assigneeId is supplied, validates that the user exists
   *   within the tenant. Fails closed with 404 NOT_FOUND if not found (preventing cross-tenant leaks).
   */
  private async resolveEffectiveAssignee(
    actor: AnalyticsActorContext,
    query: Pick<DashboardFilterQuery, 'assigneeId'>
  ): Promise<string | undefined> {
    if (actor.role === Role.SALES_EXECUTIVE) {
      return actor.actorId;
    }

    if (!query.assigneeId) {
      return undefined;
    }

    const targetUser = await prisma.user.findFirst({
      where: {
        id: query.assigneeId,
        organizationId: actor.organizationId
      },
      select: { id: true }
    });

    if (!targetUser) {
      throw new NotFoundError(`Assignee "${query.assigneeId}" not found in organization`);
    }

    return targetUser.id;
  }

  /**
   * Fetches authoritative organization timezone once per service request.
   */
  private async getOrganizationTimezone(organizationId: string): Promise<string> {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true }
    });
    return org?.timezone || 'Asia/Dhaka';
  }

  /**
   * Computes KPI summary metrics across lead acquisition cohort, operational follow-ups,
   * and outreach send cohorts.
   */
  async getSummary(
    actor: AnalyticsActorContext,
    query: DashboardFilterQuery,
    now: Date = new Date()
  ): Promise<DashboardSummaryResponse> {
    const timezone = await this.getOrganizationTimezone(actor.organizationId);
    const range = resolveDashboardRange(query, timezone, now);
    const effectiveAssigneeId = await this.resolveEffectiveAssignee(actor, query);
    const todayBounds = getCalendarDayUtcBounds(now, timezone);

    // Lead cohort filter
    const leadWhere: Record<string, any> = {
      organizationId: actor.organizationId,
      createdAt: { gte: range.from, lte: range.to }
    };
    if (effectiveAssigneeId) {
      leadWhere.assignedUserId = effectiveAssigneeId;
    }
    if (query.source) {
      leadWhere.primarySource = query.source;
    }

    // Follow-up filters
    const followUpBase: Record<string, any> = {
      organizationId: actor.organizationId
    };
    if (effectiveAssigneeId) {
      followUpBase.assignedUserId = effectiveAssigneeId;
    }

    const followUpDueTodayWhere = {
      ...followUpBase,
      status: FollowUpStatus.PENDING,
      dueAt: { gte: todayBounds.startOfDayUtc, lt: todayBounds.nextDayStartUtc }
    };

    const followUpOverdueWhere = {
      ...followUpBase,
      status: FollowUpStatus.PENDING,
      dueAt: { lt: now }
    };

    const followUpCompletedWhere = {
      ...followUpBase,
      status: FollowUpStatus.COMPLETED,
      completedAt: { gte: range.from, lte: range.to }
    };

    // Outreach send-cohort filter
    const outreachWhere: Record<string, any> = {
      organizationId: actor.organizationId,
      sentAt: { gte: range.from, lte: range.to }
    };
    if (effectiveAssigneeId) {
      outreachWhere.lead = { assignedUserId: effectiveAssigneeId };
    }

    // Parallel aggregate queries (zero N+1)
    const [
      totalCohort,
      cohortWon,
      dueToday,
      overdue,
      completed,
      outreachGrouped
    ] = await Promise.all([
      prisma.lead.count({ where: leadWhere }),
      prisma.lead.count({ where: { ...leadWhere, crmStage: CrmStage.WON } }),
      prisma.followUpTask.count({ where: followUpDueTodayWhere }),
      prisma.followUpTask.count({ where: followUpOverdueWhere }),
      prisma.followUpTask.count({ where: followUpCompletedWhere }),
      prisma.outreachDelivery.groupBy({
        by: ['status'],
        where: outreachWhere,
        _count: { _all: true }
      })
    ]);

    // Aggregate outreach status counters
    let outreachSent = 0;
    let outreachDelivered = 0;
    let outreachFailed = 0;
    let awaitingDelivery = 0;

    for (const row of outreachGrouped) {
      const count = row._count._all;
      outreachSent += count;
      if (row.status === OutreachDeliveryStatus.DELIVERED) {
        outreachDelivered += count;
      } else if (row.status === OutreachDeliveryStatus.FAILED) {
        outreachFailed += count;
      } else if (row.status === OutreachDeliveryStatus.SENT) {
        awaitingDelivery += count;
      }
    }

    const resolvedDeliverySuccessRate = calculateRate(
      outreachDelivered,
      outreachDelivered + outreachFailed
    );
    const cohortConversionRate = calculateRate(cohortWon, totalCohort);

    const payload: DashboardSummaryResponse = {
      range: {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        preset: range.preset
      },
      leads: {
        totalCohort,
        cohortWon,
        cohortConversionRate
      },
      followUps: {
        dueToday,
        overdue,
        completed
      },
      outreach: {
        sent: outreachSent,
        delivered: outreachDelivered,
        failed: outreachFailed,
        awaitingDelivery,
        resolvedDeliverySuccessRate
      }
    };

    return dashboardSummaryResponseSchema.parse(payload);
  }

  /**
   * Computes Current Pipeline Distribution across all 7 canonical stages.
   * Defined as a point-in-time state snapshot (not historical drop-off).
   */
  async getFunnel(
    actor: AnalyticsActorContext,
    query: DashboardFilterQuery
  ): Promise<DashboardFunnelResponse> {
    const effectiveAssigneeId = await this.resolveEffectiveAssignee(actor, query);

    const leadWhere: Record<string, any> = {
      organizationId: actor.organizationId
    };
    if (effectiveAssigneeId) {
      leadWhere.assignedUserId = effectiveAssigneeId;
    }
    if (query.source) {
      leadWhere.primarySource = query.source;
    }

    const stageCounts = await prisma.lead.groupBy({
      by: ['crmStage'],
      where: leadWhere,
      _count: { _all: true }
    });

    const countMap = new Map<CrmStage, number>();
    for (const row of stageCounts) {
      countMap.set(row.crmStage as CrmStage, row._count._all);
    }

    const canonicalStages = [
      CrmStage.NEW,
      CrmStage.CONTACTED,
      CrmStage.QUALIFIED,
      CrmStage.PROPOSAL_SENT,
      CrmStage.NEGOTIATION,
      CrmStage.WON,
      CrmStage.LOST
    ];

    let total = 0;
    const stages = canonicalStages.map((stage) => {
      const count = countMap.get(stage) || 0;
      total += count;
      return { stage, count };
    });

    const payload: DashboardFunnelResponse = { stages, total };
    return dashboardFunnelResponseSchema.parse(payload);
  }

  /**
   * Computes lead volume distribution by acquisition source for the selected period cohort.
   */
  async getSources(
    actor: AnalyticsActorContext,
    query: DashboardFilterQuery,
    now: Date = new Date()
  ): Promise<DashboardSourcesResponse> {
    const timezone = await this.getOrganizationTimezone(actor.organizationId);
    const range = resolveDashboardRange(query, timezone, now);
    const effectiveAssigneeId = await this.resolveEffectiveAssignee(actor, query);

    const leadWhere: Record<string, any> = {
      organizationId: actor.organizationId,
      createdAt: { gte: range.from, lte: range.to }
    };
    if (effectiveAssigneeId) {
      leadWhere.assignedUserId = effectiveAssigneeId;
    }
    if (query.source) {
      leadWhere.primarySource = query.source;
    }

    const rows = await prisma.lead.groupBy({
      by: ['primarySource'],
      where: leadWhere,
      _count: { _all: true },
      orderBy: { _count: { primarySource: 'desc' } }
    });

    let total = 0;
    const sources = rows.map((r) => {
      const count = r._count._all;
      total += count;
      return {
        source: r.primarySource && r.primarySource.trim().length > 0 ? r.primarySource : 'UNKNOWN',
        count
      };
    });

    const payload: DashboardSourcesResponse = { sources, total };
    return dashboardSourcesResponseSchema.parse(payload);
  }

  /**
   * Computes outreach send-cohort analytics broken down by channel (WHATSAPP, EMAIL) and total.
   */
  async getOutreach(
    actor: AnalyticsActorContext,
    query: DashboardFilterQuery,
    now: Date = new Date()
  ): Promise<DashboardOutreachResponse> {
    const timezone = await this.getOrganizationTimezone(actor.organizationId);
    const range = resolveDashboardRange(query, timezone, now);
    const effectiveAssigneeId = await this.resolveEffectiveAssignee(actor, query);

    const outreachWhere: Record<string, any> = {
      organizationId: actor.organizationId,
      sentAt: { gte: range.from, lte: range.to }
    };
    if (effectiveAssigneeId) {
      outreachWhere.lead = { assignedUserId: effectiveAssigneeId };
    }

    const rows = await prisma.outreachDelivery.groupBy({
      by: ['channel', 'status'],
      where: outreachWhere,
      _count: { _all: true }
    });

    const channelMap: Record<
      OutreachChannel,
      { sent: number; delivered: number; failed: number; awaitingDelivery: number }
    > = {
      [OutreachChannel.WHATSAPP]: { sent: 0, delivered: 0, failed: 0, awaitingDelivery: 0 },
      [OutreachChannel.EMAIL]: { sent: 0, delivered: 0, failed: 0, awaitingDelivery: 0 }
    };

    for (const row of rows) {
      const count = row._count._all;
      const ch = row.channel;
      if (channelMap[ch]) {
        channelMap[ch].sent += count;
        if (row.status === OutreachDeliveryStatus.DELIVERED) {
          channelMap[ch].delivered += count;
        } else if (row.status === OutreachDeliveryStatus.FAILED) {
          channelMap[ch].failed += count;
        } else if (row.status === OutreachDeliveryStatus.SENT) {
          channelMap[ch].awaitingDelivery += count;
        }
      }
    }

    const channels = [OutreachChannel.WHATSAPP, OutreachChannel.EMAIL].map((channel) => {
      const data = channelMap[channel];
      return {
        channel,
        sent: data.sent,
        delivered: data.delivered,
        failed: data.failed,
        awaitingDelivery: data.awaitingDelivery,
        resolvedDeliverySuccessRate: calculateRate(data.delivered, data.delivered + data.failed)
      };
    });

    const totalSent = channels[0].sent + channels[1].sent;
    const totalDelivered = channels[0].delivered + channels[1].delivered;
    const totalFailed = channels[0].failed + channels[1].failed;
    const totalAwaiting = channels[0].awaitingDelivery + channels[1].awaitingDelivery;
    const totalResolvedSuccessRate = calculateRate(totalDelivered, totalDelivered + totalFailed);

    const payload: DashboardOutreachResponse = {
      totals: {
        sent: totalSent,
        delivered: totalDelivered,
        failed: totalFailed,
        awaitingDelivery: totalAwaiting,
        resolvedDeliverySuccessRate: totalResolvedSuccessRate
      },
      channels
    };

    return dashboardOutreachResponseSchema.parse(payload);
  }

  /**
   * Computes per-sales-team-member current workload and selected-period performance metrics.
   *
   * Invariants:
   * - SALES_EXECUTIVE callers are strictly forbidden from accessing team performance (403 FORBIDDEN).
   * - Evaluates sales assignees (SALES_MANAGER, SALES_EXECUTIVE) in deterministic order (name ASC, id ASC).
   * - Uses 5 batched aggregate queries in Promise.all (zero N+1 loops).
   */
  async getTeamPerformance(
    actor: AnalyticsActorContext,
    query: DashboardFilterQuery,
    now: Date = new Date()
  ): Promise<DashboardTeamPerformanceResponse> {
    if (actor.role === Role.SALES_EXECUTIVE) {
      throw new ForbiddenError('Sales executives are not authorized to view team performance reporting');
    }

    const timezone = await this.getOrganizationTimezone(actor.organizationId);
    const range = resolveDashboardRange(query, timezone, now);

    const users = await prisma.user.findMany({
      where: {
        organizationId: actor.organizationId,
        role: { in: [Role.SALES_MANAGER, Role.SALES_EXECUTIVE] }
      },
      select: {
        id: true,
        name: true,
        role: true,
        isActive: true
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }]
    });

    if (users.length === 0) {
      return { members: [], total: 0 };
    }

    const userIds = users.map((u) => u.id);

    // Bounded batch queries executing concurrently in Promise.all
    const [
      activeLeadsRows,
      pendingFollowUpsRows,
      overdueFollowUpsRows,
      cohortLeadRows,
      outreachDeliveries
    ] = await Promise.all([
      // 1. Current Active Leads per rep
      prisma.lead.groupBy({
        by: ['assignedUserId'],
        where: {
          organizationId: actor.organizationId,
          assignedUserId: { in: userIds },
          crmStage: { notIn: [CrmStage.WON, CrmStage.LOST] }
        },
        _count: { _all: true }
      }),
      // 2. Current Pending Follow-ups per rep
      prisma.followUpTask.groupBy({
        by: ['assignedUserId'],
        where: {
          organizationId: actor.organizationId,
          assignedUserId: { in: userIds },
          status: FollowUpStatus.PENDING
        },
        _count: { _all: true }
      }),
      // 3. Current Overdue Follow-ups per rep
      prisma.followUpTask.groupBy({
        by: ['assignedUserId'],
        where: {
          organizationId: actor.organizationId,
          assignedUserId: { in: userIds },
          status: FollowUpStatus.PENDING,
          dueAt: { lt: now }
        },
        _count: { _all: true }
      }),
      // 4. Period Cohort Leads per rep (breakdown by stage)
      prisma.lead.groupBy({
        by: ['assignedUserId', 'crmStage'],
        where: {
          organizationId: actor.organizationId,
          assignedUserId: { in: userIds },
          createdAt: { gte: range.from, lte: range.to }
        },
        _count: { _all: true }
      }),
      // 5. Period Outreach deliveries for rep-assigned leads
      prisma.outreachDelivery.findMany({
        where: {
          organizationId: actor.organizationId,
          sentAt: { gte: range.from, lte: range.to },
          lead: { assignedUserId: { in: userIds } }
        },
        select: {
          status: true,
          lead: { select: { assignedUserId: true } }
        }
      })
    ]);

    // Fast O(1) in-memory maps
    const activeLeadsMap = new Map<string, number>();
    for (const r of activeLeadsRows) {
      if (r.assignedUserId) activeLeadsMap.set(r.assignedUserId, r._count._all);
    }

    const pendingFollowUpsMap = new Map<string, number>();
    for (const r of pendingFollowUpsRows) {
      if (r.assignedUserId) pendingFollowUpsMap.set(r.assignedUserId, r._count._all);
    }

    const overdueFollowUpsMap = new Map<string, number>();
    for (const r of overdueFollowUpsRows) {
      if (r.assignedUserId) overdueFollowUpsMap.set(r.assignedUserId, r._count._all);
    }

    const cohortCreatedMap = new Map<string, number>();
    const cohortWonMap = new Map<string, number>();
    for (const r of cohortLeadRows) {
      if (r.assignedUserId) {
        const count = r._count._all;
        cohortCreatedMap.set(r.assignedUserId, (cohortCreatedMap.get(r.assignedUserId) || 0) + count);
        if (r.crmStage === CrmStage.WON) {
          cohortWonMap.set(r.assignedUserId, (cohortWonMap.get(r.assignedUserId) || 0) + count);
        }
      }
    }

    const outreachMap = new Map<
      string,
      { sent: number; delivered: number; failed: number; awaiting: number }
    >();
    for (const d of outreachDeliveries) {
      const repId = d.lead?.assignedUserId;
      if (repId) {
        if (!outreachMap.has(repId)) {
          outreachMap.set(repId, { sent: 0, delivered: 0, failed: 0, awaiting: 0 });
        }
        const bucket = outreachMap.get(repId)!;
        bucket.sent += 1;
        if (d.status === OutreachDeliveryStatus.DELIVERED) {
          bucket.delivered += 1;
        } else if (d.status === OutreachDeliveryStatus.FAILED) {
          bucket.failed += 1;
        } else if (d.status === OutreachDeliveryStatus.SENT) {
          bucket.awaiting += 1;
        }
      }
    }

    const members: SalesTeamPerformanceMember[] = users.map((user) => {
      const activeLeads = activeLeadsMap.get(user.id) || 0;
      const pendingFollowUps = pendingFollowUpsMap.get(user.id) || 0;
      const overdueFollowUps = overdueFollowUpsMap.get(user.id) || 0;

      const leadsCreated = cohortCreatedMap.get(user.id) || 0;
      const cohortWon = cohortWonMap.get(user.id) || 0;
      const cohortConversionRate = calculateRate(cohortWon, leadsCreated);

      const oData = outreachMap.get(user.id) || { sent: 0, delivered: 0, failed: 0, awaiting: 0 };
      const resolvedDeliverySuccessRate = calculateRate(oData.delivered, oData.delivered + oData.failed);

      return {
        userId: user.id,
        name: user.name,
        role: user.role as Role,
        isActive: user.isActive,
        currentWorkload: {
          activeLeads,
          pendingFollowUps,
          overdueFollowUps
        },
        periodPerformance: {
          leadsCreated,
          cohortWon,
          cohortConversionRate,
          outreachSent: oData.sent,
          outreachDelivered: oData.delivered,
          outreachFailed: oData.failed,
          awaitingDelivery: oData.awaiting,
          resolvedDeliverySuccessRate
        }
      };
    });

    const payload: DashboardTeamPerformanceResponse = {
      members,
      total: members.length
    };

    return dashboardTeamPerformanceResponseSchema.parse(payload);
  }
}

export const analyticsService = new AnalyticsService();
