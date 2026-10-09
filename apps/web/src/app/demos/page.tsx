'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Globe,
  ExternalLink,
  RefreshCw,
  Building2,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Clock,
  Sparkles,
  Search,
  Filter
} from 'lucide-react';
import {
  DemoWebsiteStatus,
  Permissions,
  type DemoCatalogItem,
  getDemoWebsiteStatusLabel
} from '@leadmate/shared';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/lib/auth-context';
import { apiClient } from '@/lib/api-client';
import { formatDate } from '@/lib/format-date';

const STATUS_CONFIG: Record<
  DemoWebsiteStatus,
  { label: string; bg: string; text: string; border: string; icon: React.ElementType }
> = {
  [DemoWebsiteStatus.REQUESTED]: {
    label: 'Requested',
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/20',
    icon: Clock
  },
  [DemoWebsiteStatus.CREATING]: {
    label: 'Generating',
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    border: 'border-blue-500/20',
    icon: RefreshCw
  },
  [DemoWebsiteStatus.READY]: {
    label: 'Ready / Live',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    border: 'border-emerald-500/20',
    icon: CheckCircle2
  },
  [DemoWebsiteStatus.FAILED]: {
    label: 'Failed',
    bg: 'bg-rose-500/10',
    text: 'text-rose-400',
    border: 'border-rose-500/20',
    icon: AlertCircle
  },
  [DemoWebsiteStatus.EXPIRED]: {
    label: 'Expired',
    bg: 'bg-slate-500/10',
    text: 'text-slate-400',
    border: 'border-slate-500/20',
    icon: Clock
  },
  [DemoWebsiteStatus.REMOVED]: {
    label: 'Removed',
    bg: 'bg-slate-800',
    text: 'text-slate-500',
    border: 'border-slate-700',
    icon: AlertCircle
  }
};

export default function DemosPage() {
  const { hasPermission } = useAuth();
  const [demos, setDemos] = useState<DemoCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [regeneratingLeadId, setRegeneratingLeadId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const canGenerate = hasPermission(Permissions.DEMOS_GENERATE);

  const fetchDemos = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await apiClient.getDemos();
      const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
      setDemos(list);
    } catch (err: any) {
      setError(err?.message || 'Failed to load StoreMate demo websites');
      setDemos([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDemos();
  }, []);

  const handleRegenerate = async (leadId: string) => {
    if (!canGenerate) return;
    try {
      setRegeneratingLeadId(leadId);
      await apiClient.leads.regenerateDemo(leadId);
      setFeedback({
        type: 'success',
        message: 'Demo website regenerated successfully!'
      });


      fetchDemos();
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to regenerate demo website'
      });
      setTimeout(() => setFeedback(null), 4000);
    } finally {
      setRegeneratingLeadId(null);
    }
  };

  const filteredDemos = (demos || []).filter((d) => {
    const matchesSearch =
      !searchTerm ||
      d.businessName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (d.category && d.category.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (d.city && d.city.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = statusFilter === 'ALL' || d.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                <Globe className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">StoreMate Demos</h1>
                <p className="text-sm text-slate-400">
                  Instant, tailored high-conversion website demos generated for prospects.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchDemos}
              disabled={isLoading}
              className="px-3.5 py-2 text-sm font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <Link
              href="/leads"
              className="px-3.5 py-2 text-sm font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Generate Demo for Lead
            </Link>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`p-4 rounded-xl border flex items-center gap-3 ${
              feedback.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
            )}
            <p className="text-sm font-medium">{feedback.message}</p>
          </div>
        )}

        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search demos by business name, category, or city..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              <option value="ALL">All Statuses ({demos.length})</option>
              <option value={DemoWebsiteStatus.READY}>Ready</option>
              <option value={DemoWebsiteStatus.CREATING}>Generating</option>
              <option value={DemoWebsiteStatus.REQUESTED}>Requested</option>
              <option value={DemoWebsiteStatus.FAILED}>Failed</option>
              <option value={DemoWebsiteStatus.EXPIRED}>Expired</option>
            </select>
          </div>
        </div>

        {/* Content Table / Cards */}
        {isLoading && demos.length === 0 ? (
          <div className="py-20 text-center">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-cyan-400 mb-3" />
            <p className="text-sm text-slate-400">Loading StoreMate demos catalog...</p>
          </div>
        ) : error ? (
          <div className="p-8 rounded-xl bg-rose-500/10 border border-rose-500/20 text-center">
            <AlertCircle className="w-8 h-8 mx-auto text-rose-400 mb-2" />
            <p className="text-sm text-rose-300">{error}</p>
          </div>
        ) : filteredDemos.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-slate-800 rounded-xl bg-slate-950/40 p-8 space-y-3">
            <Globe className="w-12 h-12 mx-auto text-slate-600 mb-2" />
            <h3 className="text-base font-semibold text-white">No Demo Websites Found</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              StoreMate generates live high-converting storefronts for businesses without websites.
              Pick a qualified lead from the Leads directory to generate their first instant demo.
            </p>
            <div className="pt-2">
              <Link
                href="/leads"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition"
              >
                <Building2 className="w-4 h-4" />
                Browse Leads
              </Link>
            </div>
          </div>
        ) : (
          <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-900/80 border-b border-slate-800 text-xs uppercase font-semibold text-slate-400">
                  <tr>
                    <th className="px-6 py-3.5">Business / Prospect</th>
                    <th className="px-6 py-3.5">Status</th>
                    <th className="px-6 py-3.5">Preview URL</th>
                    <th className="px-6 py-3.5">Created</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredDemos.map((demo) => {
                    const statusConf = STATUS_CONFIG[demo.status] || STATUS_CONFIG[DemoWebsiteStatus.REQUESTED];
                    const StatusIcon = statusConf.icon;
                    const isRegenerating = regeneratingLeadId === demo.leadId;

                    return (
                      <tr key={demo.id} className="hover:bg-slate-900/40 transition">
                        {/* Business Info */}
                        <td className="px-6 py-4">
                          <div className="space-y-0.5">
                            <Link
                              href={`/leads/${demo.leadId}`}
                              className="font-semibold text-white hover:text-cyan-400 transition flex items-center gap-1.5"
                            >
                              {demo.businessName}
                              <ExternalLink className="w-3 h-3 text-slate-500" />
                            </Link>
                            <p className="text-xs text-slate-400">
                              {demo.category || 'Local Business'} {demo.city ? `• ${demo.city}` : ''}
                            </p>
                          </div>
                        </td>

                        {/* Status Badge */}
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusConf.bg} ${statusConf.text} ${statusConf.border}`}
                          >
                            <StatusIcon className="w-3 h-3" />
                            {statusConf.label}
                          </span>
                        </td>

                        {/* Preview URL */}
                        <td className="px-6 py-4">
                          {demo.demoUrl ? (
                            <a
                              href={demo.demoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-cyan-400 hover:text-cyan-300 text-xs font-mono underline inline-flex items-center gap-1"
                            >
                              Open Demo Link
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-xs text-slate-500 italic">Not generated yet</span>
                          )}
                        </td>

                        {/* Created Date */}
                        <td className="px-6 py-4 text-xs text-slate-400">
                          {formatDate(demo.createdAt)}
                        </td>

                        {/* Actions */}
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {demo.demoUrl && (
                              <a
                                href={demo.demoUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2.5 py-1 text-xs font-medium rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/20 transition flex items-center gap-1"
                              >
                                Preview
                              </a>
                            )}

                            {canGenerate && (
                              <button
                                onClick={() => handleRegenerate(demo.leadId)}
                                disabled={isRegenerating}
                                className="px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition flex items-center gap-1 disabled:opacity-50"
                                title="Regenerate this demo website"
                              >
                                <RefreshCw className={`w-3 h-3 ${isRegenerating ? 'animate-spin' : ''}`} />
                                Regenerate
                              </button>
                            )}

                            <Link
                              href={`/leads/${demo.leadId}`}
                              className="px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition"
                            >
                              Lead
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
