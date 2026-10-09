'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Kanban,
  Building2,
  Phone,
  MapPin,
  User,
  ArrowRight,
  RefreshCw,
  Search,
  ExternalLink,
  ChevronRight,
  Filter,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import {
  CrmStage,
  ORDERED_CRM_STAGES,
  CRM_STAGE_LABELS,
  Permissions,
  type LeadSummary
} from '@leadmate/shared';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/lib/auth-context';
import { apiClient } from '@/lib/api-client';

const STAGE_COLORS: Record<CrmStage, { header: string; badge: string; border: string }> = {
  [CrmStage.NEW]: {
    header: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    badge: 'bg-blue-500/20 text-blue-300',
    border: 'border-blue-500/30'
  },
  [CrmStage.CONTACTED]: {
    header: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    badge: 'bg-cyan-500/20 text-cyan-300',
    border: 'border-cyan-500/30'
  },
  [CrmStage.QUALIFIED]: {
    header: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    badge: 'bg-amber-500/20 text-amber-300',
    border: 'border-amber-500/30'
  },
  [CrmStage.PROPOSAL_SENT]: {
    header: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    badge: 'bg-purple-500/20 text-purple-300',
    border: 'border-purple-500/30'
  },
  [CrmStage.NEGOTIATION]: {
    header: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    badge: 'bg-indigo-500/20 text-indigo-300',
    border: 'border-indigo-500/30'
  },
  [CrmStage.WON]: {
    header: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    badge: 'bg-emerald-500/20 text-emerald-300',
    border: 'border-emerald-500/30'
  },
  [CrmStage.LOST]: {
    header: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    badge: 'bg-rose-500/20 text-rose-300',
    border: 'border-rose-500/30'
  }
};

export default function PipelinePage() {
  const { hasPermission } = useAuth();
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCity, setSelectedCity] = useState('ALL');
  const [updatingLeadId, setUpdatingLeadId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const canWrite = hasPermission(Permissions.LEADS_WRITE);

  const fetchLeads = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await apiClient.leads.list({ limit: 100 });
      const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
      setLeads(list);
    } catch (err: any) {
      setError(err?.message || 'Failed to load pipeline leads');
      setLeads([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, []);

  const handleStageChange = async (leadId: string, newStage: CrmStage) => {
    if (!canWrite) return;
    try {
      setUpdatingLeadId(leadId);
      await apiClient.leads.updateCrmStage(leadId, newStage);
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, crmStage: newStage } : l))
      );

      setFeedback({
        type: 'success',
        message: `Lead stage updated to ${CRM_STAGE_LABELS[newStage]}`
      });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to update lead stage'
      });
      setTimeout(() => setFeedback(null), 4000);
    } finally {
      setUpdatingLeadId(null);
    }
  };

  const cities = useMemo(() => {
    const list = Array.from(new Set(leads.map((l) => l.city).filter(Boolean)));
    return list.sort();
  }, [leads]);

  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      const matchesSearch =
        !searchTerm ||
        l.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        l.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (l.primaryPhone && l.primaryPhone.includes(searchTerm));
      const matchesCity = selectedCity === 'ALL' || l.city === selectedCity;
      return matchesSearch && matchesCity;
    });
  }, [leads, searchTerm, selectedCity]);

  // Group leads by stage
  const groupedLeads = useMemo(() => {
    const groups: Record<CrmStage, LeadSummary[]> = {
      [CrmStage.NEW]: [],
      [CrmStage.CONTACTED]: [],
      [CrmStage.QUALIFIED]: [],
      [CrmStage.PROPOSAL_SENT]: [],
      [CrmStage.NEGOTIATION]: [],
      [CrmStage.WON]: [],
      [CrmStage.LOST]: []
    };

    for (const lead of filteredLeads) {
      const stage = (lead.crmStage as CrmStage) || CrmStage.NEW;
      if (groups[stage]) {
        groups[stage].push(lead);
      } else {
        groups[CrmStage.NEW].push(lead);
      }
    }

    return groups;
  }, [filteredLeads]);

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                <Kanban className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">CRM Pipeline</h1>
                <p className="text-sm text-slate-400">
                  Track sales stages and convert verified business leads into customers.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchLeads}
              disabled={isLoading}
              className="px-3.5 py-2 text-sm font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <Link
              href="/leads"
              className="px-3.5 py-2 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition flex items-center gap-2"
            >
              <Building2 className="w-4 h-4" />
              All Leads
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

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search leads by business name, category, or phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={selectedCity}
              onChange={(e) => setSelectedCity(e.target.value)}
              className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">All Cities ({leads.length})</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Kanban Board Container */}
        {isLoading && leads.length === 0 ? (
          <div className="py-20 text-center">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-400 mb-3" />
            <p className="text-sm text-slate-400">Loading CRM Pipeline...</p>
          </div>
        ) : error ? (
          <div className="p-8 rounded-xl bg-rose-500/10 border border-rose-500/20 text-center">
            <AlertCircle className="w-8 h-8 mx-auto text-rose-400 mb-2" />
            <p className="text-sm text-rose-300">{error}</p>
          </div>
        ) : (
          <div className="overflow-x-auto pb-6">
            <div className="flex gap-4 min-w-[1300px]">
              {ORDERED_CRM_STAGES.map((stage) => {
                const stageLeads = groupedLeads[stage];
                const colors = STAGE_COLORS[stage];

                return (
                  <div
                    key={stage}
                    className="flex-1 flex flex-col min-w-[220px] max-w-[280px] bg-slate-950/60 rounded-xl border border-slate-800/80 p-3"
                  >
                    {/* Stage Header */}
                    <div
                      className={`flex items-center justify-between px-3 py-2 rounded-lg border mb-3 ${colors.header}`}
                    >
                      <span className="text-xs font-semibold tracking-wide uppercase">
                        {CRM_STAGE_LABELS[stage]}
                      </span>
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-full ${colors.badge}`}
                      >
                        {stageLeads.length}
                      </span>
                    </div>

                    {/* Stage Cards */}
                    <div className="space-y-3 flex-1 overflow-y-auto max-h-[calc(100vh-320px)] pr-1">
                      {stageLeads.length === 0 ? (
                        <div className="py-10 text-center border border-dashed border-slate-800/60 rounded-lg">
                          <p className="text-xs text-slate-500">No leads in stage</p>
                        </div>
                      ) : (
                        stageLeads.map((lead) => {
                          const isUpdating = updatingLeadId === lead.id;

                          return (
                            <div
                              key={lead.id}
                              className={`p-3.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 transition shadow-sm space-y-2.5 relative ${
                                isUpdating ? 'opacity-60 pointer-events-none' : ''
                              }`}
                            >
                              {/* Business Name & Link */}
                              <div className="flex items-start justify-between gap-2">
                                <Link
                                  href={`/leads/${lead.id}`}
                                  className="text-sm font-semibold text-white hover:text-indigo-400 line-clamp-1 transition"
                                >
                                  {lead.name}
                                </Link>
                                <Link
                                  href={`/leads/${lead.id}`}
                                  className="text-slate-500 hover:text-slate-300 p-0.5"
                                  title="View lead details"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </Link>
                              </div>

                              {/* Category & Location */}
                              <div className="text-xs text-slate-400 space-y-1">
                                <p className="truncate text-slate-300 font-medium">
                                  {lead.category}
                                </p>
                                <div className="flex items-center gap-1.5 text-slate-400">
                                  <MapPin className="w-3 h-3 text-slate-500" />
                                  <span className="truncate">{lead.city}</span>
                                </div>
                                {lead.primaryPhone && (
                                  <div className="flex items-center gap-1.5 text-slate-400">
                                    <Phone className="w-3 h-3 text-slate-500" />
                                    <span className="truncate">{lead.primaryPhone}</span>
                                  </div>
                                )}
                              </div>

                              {/* Rating / Review count */}
                              {lead.rating && (
                                <div className="text-[11px] text-amber-400 font-medium">
                                  ⭐ {lead.rating.toFixed(1)}{' '}
                                  <span className="text-slate-500">
                                    ({lead.reviewCount || 0} reviews)
                                  </span>
                                </div>
                              )}

                              {/* Stage Switcher Action */}
                              {canWrite && (
                                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-1">
                                  <span className="text-[10px] uppercase font-bold text-slate-500">
                                    Move:
                                  </span>
                                  <select
                                    value={stage}
                                    onChange={(e) =>
                                      handleStageChange(lead.id, e.target.value as CrmStage)
                                    }
                                    className="text-[11px] bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                  >
                                    {ORDERED_CRM_STAGES.map((s) => (
                                      <option key={s} value={s}>
                                        {CRM_STAGE_LABELS[s]}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
