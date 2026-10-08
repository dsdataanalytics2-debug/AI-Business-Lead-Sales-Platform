'use client';

import React from 'react';
import { Compass, Inbox } from 'lucide-react';
import type { DashboardSourcesResponse } from '@leadmate/shared';
import { formatFriendlySource } from '@/lib/dashboard/dashboard-display';

interface LeadSourcesCardProps {
  sourcesData: DashboardSourcesResponse;
  isLoading?: boolean;
}

export function LeadSourcesCard({ sourcesData, isLoading = false }: LeadSourcesCardProps) {
  const { sources, total: totalLeads } = sourcesData;

  return (
    <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
            <Compass className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Lead Acquisition Sources</h3>
            <p className="text-[11px] text-slate-400">
              Breakdown by primary source in selected period
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-400">Cohort Leads</span>
          <div className="text-lg font-bold text-white">
            {isLoading ? '...' : totalLeads}
          </div>
        </div>
      </div>

      {sources.length === 0 ? (
        <div className="py-8 flex flex-col items-center justify-center text-center">
          <Inbox className="w-8 h-8 text-slate-600 mb-2" />
          <p className="text-xs text-slate-400">No lead-source data for this selection.</p>
        </div>
      ) : (
        <div className="space-y-3 pt-1">
          {sources.map((item) => {
            const percentage = totalLeads > 0 ? (item.count / totalLeads) * 100 : 0;
            const friendlyName = formatFriendlySource(item.source);

            return (
              <div key={item.source} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-300">{friendlyName}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">{item.count}</span>
                    <span className="text-[11px] text-slate-400 w-12 text-right">
                      {percentage.toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
