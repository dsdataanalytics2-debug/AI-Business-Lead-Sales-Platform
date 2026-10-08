'use client';

import React from 'react';
import { Layers } from 'lucide-react';
import { CrmStage, type DashboardFunnelResponse } from '@leadmate/shared';

interface CurrentPipelineCardProps {
  funnel: DashboardFunnelResponse;
  isLoading?: boolean;
}

const STAGE_CONFIG: Record<CrmStage, { label: string; barColor: string; badgeColor: string }> = {
  [CrmStage.NEW]: {
    label: 'New',
    barColor: 'bg-blue-500',
    badgeColor: 'text-blue-400 bg-blue-500/10 border-blue-500/20'
  },
  [CrmStage.CONTACTED]: {
    label: 'Contacted',
    barColor: 'bg-indigo-500',
    badgeColor: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20'
  },
  [CrmStage.QUALIFIED]: {
    label: 'Qualified',
    barColor: 'bg-cyan-500',
    badgeColor: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20'
  },
  [CrmStage.PROPOSAL_SENT]: {
    label: 'Proposal Sent',
    barColor: 'bg-amber-500',
    badgeColor: 'text-amber-400 bg-amber-500/10 border-amber-500/20'
  },
  [CrmStage.NEGOTIATION]: {
    label: 'Negotiation',
    barColor: 'bg-orange-500',
    badgeColor: 'text-orange-400 bg-orange-500/10 border-orange-500/20'
  },
  [CrmStage.WON]: {
    label: 'Won',
    barColor: 'bg-emerald-500',
    badgeColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
  },
  [CrmStage.LOST]: {
    label: 'Lost',
    barColor: 'bg-slate-500',
    badgeColor: 'text-slate-400 bg-slate-500/10 border-slate-500/20'
  }
};

export function CurrentPipelineCard({ funnel, isLoading = false }: CurrentPipelineCardProps) {
  const totalLeads = funnel.total;

  return (
    <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Current Pipeline</h3>
            <p className="text-[11px] text-slate-400">
              Active distribution across all 7 stages (point-in-time snapshot)
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-400">Total in Pipeline</span>
          <div className="text-lg font-bold text-white">
            {isLoading ? '...' : totalLeads}
          </div>
        </div>
      </div>

      <div className="space-y-3 pt-1">
        {funnel.stages.map((item) => {
          const config = STAGE_CONFIG[item.stage] || {
            label: item.stage,
            barColor: 'bg-indigo-500',
            badgeColor: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20'
          };
          const percentage = totalLeads > 0 ? (item.count / totalLeads) * 100 : 0;

          return (
            <div key={item.stage} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-300">{config.label}</span>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white">{item.count}</span>
                  <span className="text-[11px] text-slate-400 w-12 text-right">
                    {percentage.toFixed(1)}%
                  </span>
                </div>
              </div>

              <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                <div
                  className={`h-full ${config.barColor} transition-all duration-300 rounded-full`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
