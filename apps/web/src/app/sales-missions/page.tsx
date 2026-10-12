'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Target,
  Plus,
  Search,
  Package,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  ArrowRight,
  Sparkles,
  Users,
  Compass,
  Building2
} from 'lucide-react';
import {
  type SalesMissionDetailDto,
  SalesMissionStatus,
  SalesMissionGoal,
  SALES_MISSION_GOAL_LABELS
} from '@leadmate/shared';
import { AppShell } from '@/components/layout/app-shell';
import { apiClient } from '@/lib/api-client';

export default function SalesMissionsPage() {
  const router = useRouter();
  const [missions, setMissions] = useState<SalesMissionDetailDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const loadMissions = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.listSalesMissions({
        search: searchQuery.trim() || undefined,
        status: statusFilter || undefined,
        limit: 50
      });
      setMissions(res.missions || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load sales missions');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMissions();
  }, [statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadMissions();
  };

  const getStatusBadge = (status: SalesMissionStatus) => {
    switch (status) {
      case SalesMissionStatus.READY:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Ready</span>
          </span>
        );
      case SalesMissionStatus.DISCOVERING:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Discovering</span>
          </span>
        );
      case SalesMissionStatus.ANALYZING:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            <span>Analyzing</span>
          </span>
        );
      case SalesMissionStatus.TARGETING:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Compass className="w-3.5 h-3.5" />
            <span>Targeting</span>
          </span>
        );
      case SalesMissionStatus.COMPLETED:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-300">
            <span>Completed</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800/80 text-slate-400">
            <Clock className="w-3.5 h-3.5" />
            <span>Draft</span>
          </span>
        );
    }
  };

  const totalBuyers = missions.reduce((acc, m) => acc + (m.buyerStats?.found || 0), 0);
  const readyMissions = missions.filter((m) => m.status === SalesMissionStatus.READY).length;

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Target className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Sales Missions</h1>
              <p className="text-sm text-slate-400">
                Autonomous AI Sales Operator finding ready buyers and closing pipelines
              </p>
            </div>
          </div>

          <Link
            href="/sales-missions/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition shadow-lg shadow-indigo-600/20"
          >
            <Plus className="w-4 h-4" />
            <span>New Sales Mission</span>
          </Link>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Total Missions</div>
            <div className="text-2xl font-bold text-slate-100 mt-1">{missions.length}</div>
          </div>
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Missions Ready</div>
            <div className="text-2xl font-bold text-emerald-400 mt-1">{readyMissions}</div>
          </div>
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Buyers Discovered</div>
            <div className="text-2xl font-bold text-indigo-400 mt-1">{totalBuyers}</div>
          </div>
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Saved to CRM</div>
            <div className="text-2xl font-bold text-cyan-400 mt-1">
              {missions.reduce((acc, m) => acc + (m.buyerStats?.savedToCrm || 0), 0)}
            </div>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-3 bg-slate-950/60 border border-slate-800/80 rounded-xl p-3">
          <form onSubmit={handleSearchSubmit} className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search missions by name or target market..."
              className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50"
            />
          </form>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-300 focus:outline-none focus:border-indigo-500/50"
          >
            <option value="">All Statuses</option>
            <option value={SalesMissionStatus.READY}>Ready</option>
            <option value={SalesMissionStatus.DISCOVERING}>Discovering</option>
            <option value={SalesMissionStatus.ANALYZING}>Analyzing</option>
            <option value={SalesMissionStatus.TARGETING}>Targeting</option>
            <option value={SalesMissionStatus.DRAFT}>Draft</option>
            <option value={SalesMissionStatus.COMPLETED}>Completed</option>
          </select>

          <button
            onClick={() => loadMissions()}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg transition"
          >
            Refresh
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm flex items-center gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Missions List */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
            <span className="text-sm">Loading sales missions...</span>
          </div>
        ) : missions.length === 0 ? (
          <div className="bg-slate-950/40 border border-slate-800 rounded-2xl p-12 text-center max-w-lg mx-auto space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto">
              <Target className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-200">No Sales Missions yet</h3>
              <p className="text-sm text-slate-400 mt-1">
                Start a mission to let AI analyze your product, identify target buyer segments, and discover authentic businesses.
              </p>
            </div>
            <Link
              href="/sales-missions/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition"
            >
              <Plus className="w-4 h-4" />
              <span>Launch First Sales Mission</span>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {missions.map((m) => (
              <div
                key={m.id}
                className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-5 hover:border-slate-700 transition flex flex-col justify-between space-y-4 group"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    {getStatusBadge(m.status as SalesMissionStatus)}
                    <span className="text-xs text-slate-400 font-medium">
                      Target: {m.targetMarket}
                    </span>
                  </div>

                  <h3 className="font-semibold text-slate-100 text-base leading-snug group-hover:text-indigo-300 transition">
                    {m.name}
                  </h3>

                  {m.product && (
                    <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-400">
                      <Package className="w-3.5 h-3.5 text-indigo-400" />
                      <span>{m.product.name}</span>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-900 border border-slate-800 text-slate-300">
                      {SALES_MISSION_GOAL_LABELS[m.goal as SalesMissionGoal] || m.goal}
                    </span>
                    {m.selectedBuyerTargets && m.selectedBuyerTargets.length > 0 && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                        {m.selectedBuyerTargets.length} Buyer Targets
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-3 pt-3 border-t border-slate-800/60">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <Building2 className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Discovered:</span>
                    </div>
                    <span className="font-semibold text-slate-200">
                      {m.buyerStats?.found || 0} businesses
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <Users className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Saved to CRM:</span>
                    </div>
                    <span className="font-semibold text-emerald-400">
                      {m.buyerStats?.savedToCrm || 0}
                    </span>
                  </div>

                  <Link
                    href={`/sales-missions/${m.id}`}
                    className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition group-hover:bg-indigo-600 group-hover:text-white"
                  >
                    <span>Open Mission</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
