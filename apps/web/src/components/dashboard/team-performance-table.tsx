'use client';

import React from 'react';
import { Users2, Inbox } from 'lucide-react';
import type { DashboardTeamPerformanceResponse } from '@leadmate/shared';
import { formatPercentage } from '@/lib/dashboard/dashboard-display';

interface TeamPerformanceTableProps {
  performance: DashboardTeamPerformanceResponse;
  isLoading?: boolean;
}

export function TeamPerformanceTable({ performance, isLoading = false }: TeamPerformanceTableProps) {
  const { members, total } = performance;

  return (
    <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
            <Users2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Team Performance</h3>
            <p className="text-[11px] text-slate-400">
              Workload and acquisition performance per sales representative
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

      {members.length === 0 ? (
        <div className="py-8 flex flex-col items-center justify-center text-center">
          <Inbox className="w-8 h-8 text-slate-600 mb-2" />
          <p className="text-xs text-slate-400">No sales team members found for this organization.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th scope="col" className="px-3.5 py-3 font-semibold">
                  Member
                </th>
                <th scope="col" className="px-3 py-3 font-semibold">
                  Status
                </th>
                <th scope="col" className="px-3 py-3 font-semibold text-right">
                  Active Leads
                </th>
                <th scope="col" className="px-3 py-3 font-semibold text-right">
                  Pending Tasks
                </th>
                <th scope="col" className="px-3 py-3 font-semibold text-right">
                  Overdue
                </th>
                <th scope="col" className="px-3 py-3 font-semibold text-right">
                  Leads Created
                </th>
                <th scope="col" className="px-3 py-3 font-semibold text-right">
                  Won
                </th>
                <th scope="col" className="px-3 py-3 font-semibold text-right">
                  Conversion
                </th>
                <th scope="col" className="px-3 py-3 font-semibold text-right">
                  Outreach Sent
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
                <th scope="col" className="px-3.5 py-3 font-semibold text-right">
                  Success Rate
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
              {members.map((member) => (
                <tr key={member.userId} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-3.5 py-3 font-medium text-white whitespace-nowrap">
                    <div>
                      <div>{member.name}</div>
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
                  <td className="px-3 py-3 text-right font-medium text-slate-200">
                    {member.currentWorkload.activeLeads}
                  </td>
                  <td className="px-3 py-3 text-right text-slate-200">
                    {member.currentWorkload.pendingFollowUps}
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-rose-400">
                    {member.currentWorkload.overdueFollowUps}
                  </td>
                  <td className="px-3 py-3 text-right text-slate-200">
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
                  <td className="px-3.5 py-3 text-right font-semibold text-purple-300">
                    {formatPercentage(member.periodPerformance.resolvedDeliverySuccessRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
