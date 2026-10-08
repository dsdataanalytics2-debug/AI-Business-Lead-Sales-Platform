'use client';

import React from 'react';
import {
  Users,
  Trophy,
  TrendingUp,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Send,
  CheckCheck,
  XCircle,
  Percent
} from 'lucide-react';
import type { DashboardSummaryResponse } from '@leadmate/shared';
import { formatPercentage } from '@/lib/dashboard/dashboard-display';

interface KpiSummaryCardsProps {
  summary: DashboardSummaryResponse;
  isLoading?: boolean;
}

export function KpiSummaryCards({ summary, isLoading = false }: KpiSummaryCardsProps) {
  const { leads, followUps, outreach } = summary;

  return (
    <div className="space-y-4">
      {/* 1. Lead Acquisition & Cohort Conversion */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
          Lead Acquisition & Cohort Conversion
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium">Total Leads</span>
              <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-white tracking-tight">
              {isLoading ? '...' : leads.totalCohort}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Leads acquired in selected period</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium">Won Leads</span>
              <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Trophy className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-emerald-400 tracking-tight">
              {isLoading ? '...' : leads.cohortWon}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Acquired leads currently in WON stage</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium">Conversion Rate</span>
              <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-cyan-300 tracking-tight">
              {isLoading ? '...' : formatPercentage(leads.cohortConversionRate)}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Won / Total leads in period cohort</p>
          </div>
        </div>
      </div>

      {/* 2. Follow-Up Task Workload */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Follow-Up Tasks
          </h3>
          <span className="text-[11px] text-slate-400 font-mono">Current workload vs Period performance</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium">Due Today</span>
              <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-amber-300 tracking-tight">
              {isLoading ? '...' : followUps.dueToday}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Pending tasks due today in tenant timezone</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium">Overdue</span>
              <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400">
                <AlertTriangle className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-rose-400 tracking-tight">
              {isLoading ? '...' : followUps.overdue}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Pending tasks past due date</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium">Completed</span>
              <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-200 tracking-tight">
              {isLoading ? '...' : followUps.completed}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Tasks completed in selected period</p>
          </div>
        </div>
      </div>

      {/* 3. Outreach Delivery Cohort */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
          Outreach Delivery Cohort
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium">Outreach Sent</span>
              <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
                <Send className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-white tracking-tight">
              {isLoading ? '...' : outreach.sent}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Messages sent in period</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium">Outreach Delivered</span>
              <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                <CheckCheck className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-emerald-400 tracking-tight">
              {isLoading ? '...' : outreach.delivered}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Delivered to prospect</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium">Outreach Failed</span>
              <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400">
                <XCircle className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-rose-400 tracking-tight">
              {isLoading ? '...' : outreach.failed}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Delivery errors or bounces</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-medium">Delivery Success Rate</span>
              <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400">
                <Percent className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-purple-300 tracking-tight">
              {isLoading ? '...' : formatPercentage(outreach.resolvedDeliverySuccessRate)}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Delivered / (Delivered + Failed)</p>
          </div>
        </div>
      </div>
    </div>
  );
}
