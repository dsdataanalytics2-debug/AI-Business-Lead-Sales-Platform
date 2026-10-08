'use client';

import React, { useState, useMemo } from 'react';
import {
  Users2,
  Inbox,
  Search,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  UserCheck,
  UserX,
  X
} from 'lucide-react';
import type { DashboardTeamPerformanceResponse, SalesTeamPerformanceMember } from '@leadmate/shared';
import {
  formatPercentage,
  calculateTeamCurrentWorkload,
  filterTeamMembers,
  sortTeamMembers,
  type TeamPerformanceSortField,
  type SortDirection,
  type TeamStatusFilter
} from '@/lib/dashboard/dashboard-display';

interface TeamPerformanceTableProps {
  performance: DashboardTeamPerformanceResponse;
  isLoading?: boolean;
}

export function TeamPerformanceTable({ performance, isLoading = false }: TeamPerformanceTableProps) {
  const { members, total } = performance;

  // Local UI filters & sorting state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<TeamStatusFilter>('all');
  const [sortField, setSortField] = useState<TeamPerformanceSortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [expandedUserIds, setExpandedUserIds] = useState<Set<string>>(new Set());

  // Aggregate operational workload counts (summed counts only, strictly no rate averaging!)
  const workloadSummary = useMemo(() => calculateTeamCurrentWorkload(members), [members]);

  // Filtered and sorted members
  const processedMembers = useMemo(() => {
    const filtered = filterTeamMembers(members, searchQuery, statusFilter);
    return sortTeamMembers(filtered, sortField, sortDirection);
  }, [members, searchQuery, statusFilter, sortField, sortDirection]);

  const toggleExpand = (userId: string) => {
    setExpandedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setSortField('name');
    setSortDirection('asc');
  };

  const toggleSortDirection = () => {
    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  };

  return (
    <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 shadow-sm space-y-5">
      {/* 1. Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
            <Users2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Team Performance</h3>
            <p className="text-[11px] text-slate-400">
              Operational workloads and period conversion analytics per sales representative
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-400">Total Members</span>
          <div className="text-lg font-bold text-white">
            {isLoading ? '...' : total}
          </div>
        </div>
      </div>

      {/* 2. Team Current Workload Summary Strip */}
      {members.length > 0 && (
        <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-300">Team Current Workload</span>
            <span className="text-[11px] text-slate-500">Point-in-time active operational counts</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-2.5 rounded-md bg-slate-900/80 border border-slate-800/80">
              <span className="text-[11px] text-slate-400 block">Active Leads</span>
              <p className="text-lg font-bold text-slate-100">{workloadSummary.totalActiveLeads}</p>
            </div>
            <div className="p-2.5 rounded-md bg-slate-900/80 border border-slate-800/80">
              <span className="text-[11px] text-slate-400 block">Pending Follow-ups</span>
              <p className="text-lg font-bold text-slate-100">{workloadSummary.totalPendingFollowUps}</p>
            </div>
            <div className="p-2.5 rounded-md bg-slate-900/80 border border-slate-800/80 flex items-center justify-between">
              <div>
                <span className="text-[11px] text-slate-400 block">Overdue Follow-ups</span>
                <p className={`text-lg font-bold ${workloadSummary.totalOverdueFollowUps > 0 ? 'text-rose-400' : 'text-slate-100'}`}>
                  {workloadSummary.totalOverdueFollowUps}
                </p>
              </div>
              {workloadSummary.totalOverdueFollowUps > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <AlertTriangle className="w-3 h-3" />
                  Requires Attention
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. Controls Toolbar: Search, Status Filter & Sorting */}
      {members.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search member or role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search sales team members"
              className="w-full bg-slate-950 pl-8 pr-7 py-1.5 rounded-lg border border-slate-800 text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500 text-xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search query"
                className="absolute right-2 top-2 text-slate-500 hover:text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Filter & Sort Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter Buttons */}
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  statusFilter === 'all'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('active')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  statusFilter === 'active'
                    ? 'bg-emerald-600/30 text-emerald-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('inactive')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  statusFilter === 'inactive'
                    ? 'bg-slate-800 text-slate-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Inactive
              </button>
            </div>

            {/* Sort Field Selector */}
            <div className="flex items-center gap-1 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
              <span className="text-slate-500 text-[11px]">Sort:</span>
              <select
                aria-label="Sort team table by field"
                value={sortField}
                onChange={(e) => setSortField(e.target.value as TeamPerformanceSortField)}
                className="bg-transparent text-slate-200 outline-none cursor-pointer text-xs"
              >
                <option value="name" className="bg-slate-900 text-slate-200">Name (A-Z)</option>
                <option value="activeLeads" className="bg-slate-900 text-slate-200">Active Leads</option>
                <option value="pendingFollowUps" className="bg-slate-900 text-slate-200">Pending Follow-ups</option>
                <option value="overdueFollowUps" className="bg-slate-900 text-slate-200">Overdue Follow-ups</option>
                <option value="leadsCreated" className="bg-slate-900 text-slate-200">Leads Created</option>
                <option value="cohortWon" className="bg-slate-900 text-slate-200">Won Leads</option>
                <option value="cohortConversionRate" className="bg-slate-900 text-slate-200">Conversion Rate</option>
                <option value="outreachSent" className="bg-slate-900 text-slate-200">Outreach Sent</option>
                <option value="resolvedDeliverySuccessRate" className="bg-slate-900 text-slate-200">Resolved Success Rate</option>
              </select>

              {/* Sort Direction Toggle */}
              <button
                type="button"
                onClick={toggleSortDirection}
                aria-label={`Toggle sort direction, currently ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
                className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800"
              >
                <ArrowUpDown className="w-3 h-3" />
              </button>
            </div>

            {/* Reset Filters (if modified) */}
            {(searchQuery || statusFilter !== 'all' || sortField !== 'name' || sortDirection !== 'asc') && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 underline"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}

      {/* 4. Table / Content Section */}
      {members.length === 0 ? (
        <div className="py-8 flex flex-col items-center justify-center text-center">
          <Inbox className="w-8 h-8 text-slate-600 mb-2" />
          <p className="text-xs text-slate-400">No sales-team performance data for this selection.</p>
        </div>
      ) : processedMembers.length === 0 ? (
        <div className="py-8 flex flex-col items-center justify-center text-center rounded-lg bg-slate-950/40 border border-slate-800/60">
          <Inbox className="w-8 h-8 text-slate-600 mb-2" />
          <p className="text-xs text-slate-400">No team members match your filter criteria.</p>
          <button
            type="button"
            onClick={handleResetFilters}
            className="mt-2 text-xs text-indigo-400 hover:text-indigo-300 font-medium"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div>
          {/* Desktop Structured Table */}
          <div className="hidden md:block overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-left text-xs text-slate-300" aria-label="Sales team performance table">
              <thead className="bg-slate-950/90 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
                <tr>
                  <th scope="col" className="px-3.5 py-3 font-semibold">
                    Member
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold">
                    Status
                  </th>
                  {/* Current Workload Group */}
                  <th scope="col" className="px-3 py-3 font-semibold text-right bg-slate-950/40 border-l border-slate-800/80">
                    Active Leads
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right bg-slate-950/40">
                    Pending
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right bg-slate-950/40">
                    Overdue
                  </th>
                  {/* Period Performance Group */}
                  <th scope="col" className="px-3 py-3 font-semibold text-right border-l border-slate-800/80">
                    Created
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">
                    Won
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">
                    Conversion
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">
                    Sent
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">
                    Delivered
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">
                    Failed
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">
                    Awaiting
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">
                    Resolved Success Rate
                  </th>
                  <th scope="col" className="px-3 py-3 text-center">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
                {processedMembers.map((member) => {
                  const isExpanded = expandedUserIds.has(member.userId);
                  const hasOverdue = member.currentWorkload.overdueFollowUps > 0;

                  return (
                    <React.Fragment key={member.userId}>
                      <tr className="hover:bg-slate-800/40 transition-colors">
                        <td className="px-3.5 py-3 font-medium text-white whitespace-nowrap">
                          <div>
                            <div className="font-semibold">{member.name}</div>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {member.role}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                              member.isActive
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : 'bg-slate-800 text-slate-400 border-slate-700'
                            }`}
                          >
                            {member.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        {/* Current Workload */}
                        <td className="px-3 py-3 text-right font-medium text-slate-200 border-l border-slate-800/60">
                          {member.currentWorkload.activeLeads}
                        </td>
                        <td className="px-3 py-3 text-right text-slate-200">
                          {member.currentWorkload.pendingFollowUps}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <span
                            className={`font-semibold ${
                              hasOverdue ? 'text-rose-400' : 'text-slate-300'
                            }`}
                          >
                            {member.currentWorkload.overdueFollowUps}
                          </span>
                        </td>
                        {/* Period Performance */}
                        <td className="px-3 py-3 text-right text-slate-200 border-l border-slate-800/60">
                          {member.periodPerformance.leadsCreated}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-emerald-400">
                          {member.periodPerformance.cohortWon}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-cyan-300">
                          {formatPercentage(member.periodPerformance.cohortConversionRate)}
                        </td>
                        <td className="px-3 py-3 text-right text-slate-200">
                          {member.periodPerformance.outreachSent}
                        </td>
                        <td className="px-3 py-3 text-right text-emerald-400">
                          {member.periodPerformance.outreachDelivered}
                        </td>
                        <td className="px-3 py-3 text-right text-rose-400">
                          {member.periodPerformance.outreachFailed}
                        </td>
                        <td className="px-3 py-3 text-right text-amber-300">
                          {member.periodPerformance.awaitingDelivery}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-purple-300">
                          {formatPercentage(member.periodPerformance.resolvedDeliverySuccessRate)}
                        </td>
                        {/* Expand Row Action */}
                        <td className="px-3 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => toggleExpand(member.userId)}
                            aria-expanded={isExpanded}
                            aria-controls={`detail-${member.userId}`}
                            aria-label={`Toggle details for ${member.name}`}
                            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>
                        </td>
                      </tr>

                      {/* Expandable Inline Detail Panel */}
                      {isExpanded && (
                        <tr id={`detail-${member.userId}`} className="bg-slate-950/70 border-b border-slate-800">
                          <td colSpan={14} className="p-4 space-y-3">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
                              {/* Current Workload Block */}
                              <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
                                <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
                                  <span className="font-semibold text-slate-200">Current Workload</span>
                                  <span className="text-[10px] text-slate-400">Operational Point-in-Time</span>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-center pt-1">
                                  <div className="p-2 rounded bg-slate-950/60 border border-slate-800/60">
                                    <span className="text-[10px] text-slate-400 block">Active Leads</span>
                                    <span className="text-sm font-bold text-slate-100">
                                      {member.currentWorkload.activeLeads}
                                    </span>
                                  </div>
                                  <div className="p-2 rounded bg-slate-950/60 border border-slate-800/60">
                                    <span className="text-[10px] text-slate-400 block">Pending Tasks</span>
                                    <span className="text-sm font-bold text-slate-100">
                                      {member.currentWorkload.pendingFollowUps}
                                    </span>
                                  </div>
                                  <div className="p-2 rounded bg-slate-950/60 border border-slate-800/60">
                                    <span className="text-[10px] text-slate-400 block">Overdue Tasks</span>
                                    <span className={`text-sm font-bold ${hasOverdue ? 'text-rose-400' : 'text-slate-100'}`}>
                                      {member.currentWorkload.overdueFollowUps}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Period Performance Block */}
                              <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
                                <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
                                  <span className="font-semibold text-slate-200">Period Performance</span>
                                  <span className="text-[10px] text-slate-400">Cohort & Outreach Attributions</span>
                                </div>
                                <div className="grid grid-cols-4 gap-2 text-center pt-1">
                                  <div className="p-2 rounded bg-slate-950/60 border border-slate-800/60">
                                    <span className="text-[10px] text-slate-400 block">Created</span>
                                    <span className="text-xs font-bold text-slate-100">
                                      {member.periodPerformance.leadsCreated}
                                    </span>
                                  </div>
                                  <div className="p-2 rounded bg-slate-950/60 border border-slate-800/60">
                                    <span className="text-[10px] text-slate-400 block">Won</span>
                                    <span className="text-xs font-bold text-emerald-400">
                                      {member.periodPerformance.cohortWon}
                                    </span>
                                  </div>
                                  <div className="p-2 rounded bg-slate-950/60 border border-slate-800/60">
                                    <span className="text-[10px] text-slate-400 block">Conversion</span>
                                    <span className="text-xs font-bold text-cyan-300">
                                      {formatPercentage(member.periodPerformance.cohortConversionRate)}
                                    </span>
                                  </div>
                                  <div className="p-2 rounded bg-slate-950/60 border border-slate-800/60">
                                    <span className="text-[10px] text-slate-400 block">Success Rate</span>
                                    <span className="text-xs font-bold text-purple-300">
                                      {formatPercentage(member.periodPerformance.resolvedDeliverySuccessRate)}
                                    </span>
                                  </div>
                                </div>

                                <div className="grid grid-cols-4 gap-2 text-center pt-1 text-[11px] text-slate-400">
                                  <div>Sent: <span className="text-slate-200 font-semibold">{member.periodPerformance.outreachSent}</span></div>
                                  <div>Delivered: <span className="text-emerald-400 font-semibold">{member.periodPerformance.outreachDelivered}</span></div>
                                  <div>Failed: <span className="text-rose-400 font-semibold">{member.periodPerformance.outreachFailed}</span></div>
                                  <div>Awaiting: <span className="text-amber-300 font-semibold">{member.periodPerformance.awaitingDelivery}</span></div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Responsive Cards (Stacked for < md screens) */}
          <div className="md:hidden space-y-3">
            {processedMembers.map((member) => {
              const isExpanded = expandedUserIds.has(member.userId);
              const hasOverdue = member.currentWorkload.overdueFollowUps > 0;

              return (
                <div
                  key={member.userId}
                  className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 space-y-3"
                >
                  {/* Member Identity Header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-semibold text-white">{member.name}</h4>
                      <span className="text-[10px] text-slate-400 font-mono">{member.role}</span>
                    </div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                        member.isActive
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {member.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  {/* Mobile Current Workload Strip */}
                  <div className="p-2.5 rounded bg-slate-900/90 border border-slate-800/80">
                    <span className="text-[10px] font-medium text-slate-400 block mb-1">
                      Current Workload
                    </span>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div>
                        <span className="text-[10px] text-slate-500 block">Active</span>
                        <span className="font-semibold text-slate-200">{member.currentWorkload.activeLeads}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">Pending</span>
                        <span className="font-semibold text-slate-200">{member.currentWorkload.pendingFollowUps}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">Overdue</span>
                        <span className={`font-semibold ${hasOverdue ? 'text-rose-400' : 'text-slate-200'}`}>
                          {member.currentWorkload.overdueFollowUps}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Mobile Period Performance Summary */}
                  <div className="p-2.5 rounded bg-slate-900/90 border border-slate-800/80">
                    <span className="text-[10px] font-medium text-slate-400 block mb-1">
                      Period Performance
                    </span>
                    <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
                      <div>
                        <span className="text-[9px] text-slate-500 block">Created</span>
                        <span className="font-semibold text-slate-200">{member.periodPerformance.leadsCreated}</span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 block">Won</span>
                        <span className="font-semibold text-emerald-400">{member.periodPerformance.cohortWon}</span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 block">Conversion</span>
                        <span className="font-semibold text-cyan-300">
                          {formatPercentage(member.periodPerformance.cohortConversionRate)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 block">Success</span>
                        <span className="font-semibold text-purple-300">
                          {formatPercentage(member.periodPerformance.resolvedDeliverySuccessRate)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Expand Mobile Toggle */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(member.userId)}
                    aria-expanded={isExpanded}
                    aria-label={`Toggle full details for ${member.name}`}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-900 rounded border border-slate-800 transition-colors"
                  >
                    <span>{isExpanded ? 'Hide Details' : 'View Full Breakdown'}</span>
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>

                  {/* Mobile Expanded Breakdown */}
                  {isExpanded && (
                    <div className="p-3 rounded bg-slate-900 border border-slate-800 space-y-2 text-xs">
                      <span className="font-semibold text-slate-300 block text-[11px]">
                        Outreach Details
                      </span>
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                        <div>Sent: <span className="font-semibold text-slate-200">{member.periodPerformance.outreachSent}</span></div>
                        <div>Delivered: <span className="font-semibold text-emerald-400">{member.periodPerformance.outreachDelivered}</span></div>
                        <div>Failed: <span className="font-semibold text-rose-400">{member.periodPerformance.outreachFailed}</span></div>
                        <div>Awaiting: <span className="font-semibold text-amber-300">{member.periodPerformance.awaitingDelivery}</span></div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
