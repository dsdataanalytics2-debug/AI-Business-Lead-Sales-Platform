'use client';

import React from 'react';
import { RefreshCw, Filter, Calendar, User, Search } from 'lucide-react';
import { DashboardDatePreset } from '@leadmate/shared';
import {
  type DashboardAssigneeOption,
  formatAssigneeLabel,
  formatFriendlySource
} from '@/lib/dashboard/dashboard-display';

export interface DashboardFilterState {
  preset: DashboardDatePreset;
  from?: string;
  to?: string;
  assigneeId?: string;
  source?: string;
}

interface DashboardFilterBarProps {
  filters: DashboardFilterState;
  onFilterChange: (newFilters: DashboardFilterState) => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  showAssigneePicker: boolean;
  teamMembers?: DashboardAssigneeOption[];
  availableSources?: string[];
  customDateError?: string | null;
}

export function DashboardFilterBar({
  filters,
  onFilterChange,
  onRefresh,
  isRefreshing = false,
  showAssigneePicker,
  teamMembers = [],
  availableSources = [],
  customDateError
}: DashboardFilterBarProps) {
  const handlePresetChange = (preset: DashboardDatePreset) => {
    if (preset === DashboardDatePreset.CUSTOM) {
      // Initialize custom dates with reasonable default (past 30 days) if not already set
      const toDate = new Date();
      const fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      onFilterChange({
        ...filters,
        preset,
        from: filters.from || fromDate.toISOString().slice(0, 10),
        to: filters.to || toDate.toISOString().slice(0, 10)
      });
    } else {
      // Clear custom date fields when switching to a preset
      onFilterChange({
        ...filters,
        preset,
        from: undefined,
        to: undefined
      });
    }
  };

  return (
    <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Preset Selector */}
        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <Calendar className="w-3.5 h-3.5 ml-1.5 text-slate-500" />
          <button
            type="button"
            onClick={() => handlePresetChange(DashboardDatePreset.DAYS_7)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
              filters.preset === DashboardDatePreset.DAYS_7
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            7 Days
          </button>
          <button
            type="button"
            onClick={() => handlePresetChange(DashboardDatePreset.DAYS_30)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
              filters.preset === DashboardDatePreset.DAYS_30
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            30 Days
          </button>
          <button
            type="button"
            onClick={() => handlePresetChange(DashboardDatePreset.DAYS_90)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
              filters.preset === DashboardDatePreset.DAYS_90
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            90 Days
          </button>
          <button
            type="button"
            onClick={() => handlePresetChange(DashboardDatePreset.CUSTOM)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
              filters.preset === DashboardDatePreset.CUSTOM
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            Custom
          </button>
        </div>

        {/* Action Controls & Dropdowns */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Assignee Filter (Hidden for SALES_EXECUTIVE) */}
          {showAssigneePicker && (
            <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800 text-xs">
              <User className="w-3.5 h-3.5 text-slate-500" />
              <select
                aria-label="Filter by team member"
                value={filters.assigneeId || ''}
                onChange={(e) =>
                  onFilterChange({
                    ...filters,
                    assigneeId: e.target.value ? e.target.value : undefined
                  })
                }
                className="bg-transparent text-slate-200 outline-none cursor-pointer text-xs"
              >
                <option value="" className="bg-slate-900 text-slate-200">
                  All Team Members
                </option>
                {teamMembers.map((member) => (
                  <option key={member.id} value={member.id} className="bg-slate-900 text-slate-200">
                    {formatAssigneeLabel(member)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Lead Source Filter */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800 text-xs">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <select
              aria-label="Filter by lead source"
              value={filters.source || ''}
              onChange={(e) =>
                onFilterChange({
                  ...filters,
                  source: e.target.value ? e.target.value : undefined
                })
              }
              className="bg-transparent text-slate-200 outline-none cursor-pointer text-xs"
            >
              <option value="" className="bg-slate-900 text-slate-200">
                All Sources
              </option>
              {Array.from(new Set([...availableSources, ...(filters.source ? [filters.source] : [])])).map((src) => (
                <option key={src} value={src} className="bg-slate-900 text-slate-200">
                  {formatFriendlySource(src)}
                </option>
              ))}
            </select>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label="Refresh dashboard metrics"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700/80 transition-all border border-slate-700/60 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Custom Date Range Row */}
      {filters.preset === DashboardDatePreset.CUSTOM && (
        <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <label htmlFor="custom-from" className="font-medium text-slate-300">
              From:
            </label>
            <input
              id="custom-from"
              type="date"
              value={filters.from || ''}
              onChange={(e) =>
                onFilterChange({
                  ...filters,
                  from: e.target.value
                })
              }
              className="bg-slate-950 px-2.5 py-1 rounded-md border border-slate-800 text-slate-200 text-xs outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <label htmlFor="custom-to" className="font-medium text-slate-300">
              To:
            </label>
            <input
              id="custom-to"
              type="date"
              value={filters.to || ''}
              onChange={(e) =>
                onFilterChange({
                  ...filters,
                  to: e.target.value
                })
              }
              className="bg-slate-950 px-2.5 py-1 rounded-md border border-slate-800 text-slate-200 text-xs outline-none focus:border-indigo-500"
            />
          </div>

          {customDateError && (
            <span className="text-xs text-rose-400 font-medium">
              {customDateError}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
