'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Loader2,
  AlertCircle,
  ShieldAlert,
  UserCheck
} from 'lucide-react';
import {
  Permissions,
  Role,
  DashboardDatePreset,
  type DashboardFilterQuery,
  type DashboardSummaryResponse,
  type DashboardFunnelResponse,
  type DashboardSourcesResponse,
  type DashboardOutreachResponse,
  type DashboardTeamPerformanceResponse
} from '@leadmate/shared';
import { useAuth } from '@/lib/auth-context';
import { AppShell } from '@/components/layout/app-shell';
import { apiClient } from '@/lib/api-client';
import {
  DashboardFilterBar,
  type DashboardFilterState
} from '@/components/dashboard/dashboard-filter-bar';
import { KpiSummaryCards } from '@/components/dashboard/kpi-summary-cards';
import { CurrentPipelineCard } from '@/components/dashboard/current-pipeline-card';
import { LeadSourcesCard } from '@/components/dashboard/lead-sources-card';
import { OutreachPerformanceCard } from '@/components/dashboard/outreach-performance-card';
import { TeamPerformanceTable } from '@/components/dashboard/team-performance-table';
import {
  type DashboardAssigneeOption,
  deriveAssigneeOptions,
  mergeAvailableSources,
  getFriendlyDashboardErrorMessage
} from '@/lib/dashboard/dashboard-display';

const defaultFilters: DashboardFilterState = {
  preset: DashboardDatePreset.DAYS_30,
  from: undefined,
  to: undefined,
  assigneeId: undefined,
  source: undefined
};

export default function DashboardPage() {
  const { user, isAuthenticated, isLoading: isAuthLoading, hasPermission } = useAuth();
  const router = useRouter();

  const canReadReports = hasPermission(Permissions.REPORTS_READ);
  const isExecutive = user?.role === Role.SALES_EXECUTIVE;

  // Filter state
  const [filters, setFilters] = useState<DashboardFilterState>(defaultFilters);
  const [customDateError, setCustomDateError] = useState<string | null>(null);

  // Assignee members & discovered sources derived from analytics responses
  const [teamMembers, setTeamMembers] = useState<DashboardAssigneeOption[]>([]);
  const [availableSources, setAvailableSources] = useState<string[]>([]);

  // Analytics data state
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);
  const [funnel, setFunnel] = useState<DashboardFunnelResponse | null>(null);
  const [sourcesData, setSourcesData] = useState<DashboardSourcesResponse | null>(null);
  const [outreachData, setOutreachData] = useState<DashboardOutreachResponse | null>(null);
  const [teamPerformance, setTeamPerformance] = useState<DashboardTeamPerformanceResponse | null>(null);

  // Loading & error state
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Monotonic generation counter & AbortController ref to prevent stale response races
  const generationRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Auth gate
  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthLoading, isAuthenticated, router]);

  // Fetch all dashboard data with race condition protection
  const fetchDashboardData = useCallback(
    async (isManualRefresh = false) => {
      if (!isAuthenticated || !canReadReports) return;

      // Validate custom dates before making request
      if (filters.preset === DashboardDatePreset.CUSTOM) {
        if (!filters.from || !filters.to) {
          setCustomDateError('Both From and To dates are required for custom range.');
          return;
        }
        if (filters.from > filters.to) {
          setCustomDateError('From date must be before or equal to To date.');
          return;
        }
      }
      setCustomDateError(null);

      // Abort previous in-flight requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const currentGen = ++generationRef.current;

      if (isManualRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const query: DashboardFilterQuery = {
          preset: filters.preset,
          from: filters.preset === DashboardDatePreset.CUSTOM && filters.from ? new Date(`${filters.from}T00:00:00.000Z`).toISOString() : undefined,
          to: filters.preset === DashboardDatePreset.CUSTOM && filters.to ? new Date(`${filters.to}T23:59:59.999Z`).toISOString() : undefined,
          assigneeId: !isExecutive ? filters.assigneeId : undefined,
          source: filters.source
        };

        const fetchOptions = { signal: controller.signal };

        // Execute bounded parallel requests
        const [sumRes, funRes, srcRes, outRes, teamRes] = await Promise.all([
          apiClient.dashboard.getSummary(query, fetchOptions),
          apiClient.dashboard.getFunnel(query, fetchOptions),
          apiClient.dashboard.getSources(query, fetchOptions),
          apiClient.dashboard.getOutreach(query, fetchOptions),
          // SALES_EXECUTIVE MUST NOT request /team-performance
          !isExecutive
            ? apiClient.dashboard.getTeamPerformance(query, fetchOptions)
            : Promise.resolve(null)
        ]);

        // Stale response guard
        if (currentGen !== generationRef.current) {
          return;
        }

        setSummary(sumRes);
        setFunnel(funRes);
        setSourcesData(srcRes);
        setOutreachData(outRes);
        if (teamRes) {
          setTeamPerformance(teamRes);
          // Derive assignee filter options from team-performance response
          setTeamMembers((prev) => deriveAssigneeOptions(prev, teamRes.members));
        }

        // Collect available sources for filter dropdown, preserving previously discovered sources
        if (srcRes?.sources) {
          const discovered = srcRes.sources.map((s) => s.source);
          setAvailableSources((prev) => mergeAvailableSources(prev, discovered, filters.source));
        }
      } catch (err: unknown) {
        if (currentGen !== generationRef.current) return;
        if (err instanceof Error && err.name === 'AbortError') return;

        setError(getFriendlyDashboardErrorMessage(err));
      } finally {
        if (currentGen === generationRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [isAuthenticated, canReadReports, isExecutive, filters]
  );

  // Trigger fetch on filter changes
  useEffect(() => {
    fetchDashboardData(false);
  }, [fetchDashboardData]);

  // Auth / Permission loading & guard
  if (isAuthLoading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <div className="text-xs text-slate-400 font-mono">Verifying Access...</div>
        </div>
      </div>
    );
  }

  if (!canReadReports) {
    return (
      <AppShell>
        <div className="max-w-4xl mx-auto py-12 px-4">
          <div className="p-8 rounded-2xl bg-rose-950/20 border border-rose-900/40 text-center space-y-4">
            <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto" />
            <h1 className="text-xl font-bold text-white">Access Denied</h1>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              You do not have permission to view sales reports and analytics. Contact your organization administrator for access.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header & Role Context Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                {user.role}
              </span>
              <span className="text-xs text-slate-400 font-bengali">স্বাগতম • Welcome</span>
              {isExecutive && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center gap-1">
                  <UserCheck className="w-3 h-3" />
                  Self-Scoped View
                </span>
              )}
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
              <LayoutDashboard className="w-6 h-6 text-indigo-400" />
              Sales & Pipeline Dashboard
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              {isExecutive
                ? 'Your personal lead pipeline, follow-ups, and outreach performance'
                : 'Organization-wide sales pipeline, operational workloads, and outreach metrics'}
            </p>
          </div>
        </div>

        {/* Global Filter Bar */}
        <DashboardFilterBar
          filters={filters}
          onFilterChange={(newFilters) => setFilters(newFilters)}
          onRefresh={() => fetchDashboardData(true)}
          isRefreshing={isRefreshing}
          showAssigneePicker={!isExecutive}
          teamMembers={teamMembers}
          availableSources={availableSources}
          customDateError={customDateError}
        />

        {/* Error Banner */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-900/50 flex items-center justify-between text-rose-300 text-xs">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => fetchDashboardData(true)}
              className="px-2.5 py-1 rounded-md bg-rose-900/60 hover:bg-rose-800/80 text-rose-200 font-medium text-xs transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading State Skeleton */}
        {isLoading && !summary && (
          <div className="py-20 flex flex-col items-center justify-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
            <p className="text-xs text-slate-400 font-mono">Loading sales analytics...</p>
          </div>
        )}

        {/* Analytics Content */}
        {summary && (
          <div className="space-y-6">
            {/* 1. Summary KPI Cards */}
            <KpiSummaryCards summary={summary} isLoading={isLoading} />

            {/* 2. Visualizations Grid: Current Pipeline & Sources */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {funnel && <CurrentPipelineCard funnel={funnel} isLoading={isLoading} />}
              {sourcesData && <LeadSourcesCard sourcesData={sourcesData} isLoading={isLoading} />}
            </div>

            {/* 3. Outreach Performance */}
            {outreachData && <OutreachPerformanceCard outreach={outreachData} isLoading={isLoading} />}

            {/* 4. Team Performance Table (Hidden for SALES_EXECUTIVE) */}
            {!isExecutive && teamPerformance && (
              <TeamPerformanceTable performance={teamPerformance} isLoading={isLoading} />
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
