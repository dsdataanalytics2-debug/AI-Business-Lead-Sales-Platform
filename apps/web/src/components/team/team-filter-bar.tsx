'use client';

import React from 'react';
import { Search, RotateCcw, ArrowUpDown } from 'lucide-react';
import { Role, TeamSortBy } from '@leadmate/shared';
import { ROLE_LABELS } from '@/lib/team/team-display';

export interface TeamFilterState {
  search: string;
  role?: Role;
  isActive?: boolean;
  sortBy: TeamSortBy;
  sortOrder: 'asc' | 'desc';
}

interface TeamFilterBarProps {
  filters: TeamFilterState;
  onFilterChange: (filters: Partial<TeamFilterState>) => void;
  onReset: () => void;
  isFiltered: boolean;
}

export function TeamFilterBar({
  filters,
  onFilterChange,
  onReset,
  isFiltered
}: TeamFilterBarProps) {
  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm space-y-3">
      <div className="flex flex-col md:flex-row gap-3">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => onFilterChange({ search: e.target.value })}
            placeholder="Search by name or email..."
            aria-label="Search team members by name or email"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        {/* Filters Group */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Role Filter */}
          <select
            value={filters.role || ''}
            onChange={(e) => onFilterChange({ role: (e.target.value as Role) || undefined })}
            aria-label="Filter by role"
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">All Roles</option>
            {Object.values(Role).map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={filters.isActive === undefined ? '' : String(filters.isActive)}
            onChange={(e) => {
              const val = e.target.value;
              onFilterChange({
                isActive: val === '' ? undefined : val === 'true'
              });
            }}
            aria-label="Filter by status"
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">All Statuses</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>

          {/* Sort Field */}
          <select
            value={filters.sortBy}
            onChange={(e) => onFilterChange({ sortBy: e.target.value as TeamSortBy })}
            aria-label="Sort by field"
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value={TeamSortBy.CREATED_AT}>Created Date</option>
            <option value={TeamSortBy.NAME}>Name</option>
            <option value={TeamSortBy.ROLE}>Role</option>
          </select>

          {/* Sort Direction Toggle */}
          <button
            type="button"
            onClick={() => onFilterChange({ sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc' })}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-950 border border-slate-800 rounded-lg hover:bg-slate-900 transition-colors"
            title={`Sort direction: ${filters.sortOrder === 'asc' ? 'Ascending' : 'Descending'}`}
            aria-label="Toggle sort direction"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
            <span className="uppercase text-[10px] font-mono">{filters.sortOrder}</span>
          </button>

          {/* Reset Filters */}
          {isFiltered && (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-800/60 rounded-lg hover:bg-slate-800 transition-colors"
              title="Reset all filters"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
