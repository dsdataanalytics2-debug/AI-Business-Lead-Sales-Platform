'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Megaphone,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  Send,
  Users,
  MessageSquare,
  Mail,
  ShieldCheck,
  Building2,
  X
} from 'lucide-react';
import {
  OutreachChannel,
  Permissions,
  type CampaignSummary,
  type LeadSummary
} from '@leadmate/shared';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/lib/auth-context';
import { apiClient } from '@/lib/api-client';
import { formatDate } from '@/lib/format-date';

const STATUS_BADGES: Record<
  string,
  { bg: string; text: string; border: string; label: string }
> = {
  DRAFT: {
    bg: 'bg-slate-500/10',
    text: 'text-slate-400',
    border: 'border-slate-500/20',
    label: 'Draft'
  },
  READY: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/20',
    label: 'Ready for Review'
  },
  ACTIVE: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    border: 'border-blue-500/20',
    label: 'Active'
  },
  PAUSED: {
    bg: 'bg-rose-500/10',
    text: 'text-rose-400',
    border: 'border-rose-500/20',
    label: 'Paused'
  },
  COMPLETED: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    border: 'border-emerald-500/20',
    label: 'Completed'
  }
};

export default function CampaignsPage() {
  const { hasPermission } = useAuth();
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Create Campaign Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalName, setModalName] = useState('');
  const [modalChannel, setModalChannel] = useState<OutreachChannel>(OutreachChannel.WHATSAPP);
  const [availableLeads, setAvailableLeads] = useState<LeadSummary[]>([]);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canManage = hasPermission(Permissions.CAMPAIGNS_MANAGE);

  const fetchCampaigns = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await apiClient.getCampaigns();
      setCampaigns(res.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load campaigns');
    } finally {
      setIsLoading(false);
    }
  };

  const openCreateModal = async () => {
    setIsModalOpen(true);
    setModalName('');
    setSelectedLeadIds([]);
    try {
      const res = await apiClient.leads.list({ limit: 50 });
      setAvailableLeads(res.data);
      // Pre-select first 3 leads if available
      if (res.data.length > 0) {
        setSelectedLeadIds(res.data.slice(0, 3).map((l: LeadSummary) => l.id));
      }
    } catch {
      // Ignore
    }

  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalName.trim() || selectedLeadIds.length === 0) {
      setFeedback({ type: 'error', message: 'Campaign name and at least one lead are required' });
      return;
    }

    try {
      setIsSubmitting(true);
      await apiClient.createCampaign({
        name: modalName.trim(),
        channel: modalChannel,
        leadIds: selectedLeadIds
      });
      setIsModalOpen(false);
      setFeedback({
        type: 'success',
        message: 'Campaign created successfully! AI offers generated for review.'
      });
      fetchCampaigns();
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to create campaign'
      });
      setTimeout(() => setFeedback(null), 4000);
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, []);

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                <Megaphone className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">Outreach Campaigns</h1>
                <p className="text-sm text-slate-400">
                  Orchestrate personalized multi-channel outreach campaigns with human-in-the-loop approval.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchCampaigns}
              disabled={isLoading}
              className="px-3.5 py-2 text-sm font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {canManage && (
              <button
                onClick={openCreateModal}
                className="px-3.5 py-2 text-sm font-medium rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                New Campaign
              </button>
            )}
          </div>
        </div>

        {/* Human-in-the-Loop Safeguard Notice */}
        <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5 text-indigo-400" />
          <div className="text-sm">
            <p className="font-semibold text-white">
              Strict Policy Invariant: Approval != Dispatch
            </p>
            <p className="text-slate-300 text-xs mt-0.5">
              Reviewing and approving an AI draft NEVER triggers immediate external message delivery.
              Dispatch is an explicit, audited action through the M6 delivery pipeline.
            </p>
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

        {/* Campaigns List Table */}
        {isLoading && campaigns.length === 0 ? (
          <div className="py-20 text-center">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-purple-400 mb-3" />
            <p className="text-sm text-slate-400">Loading campaigns...</p>
          </div>
        ) : error ? (
          <div className="p-8 rounded-xl bg-rose-500/10 border border-rose-500/20 text-center">
            <AlertCircle className="w-8 h-8 mx-auto text-rose-400 mb-2" />
            <p className="text-sm text-rose-300">{error}</p>
          </div>
        ) : (
          <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-900/80 border-b border-slate-800 text-xs uppercase font-semibold text-slate-400">
                  <tr>
                    <th className="px-6 py-3.5">Campaign Name</th>
                    <th className="px-6 py-3.5">Channel</th>
                    <th className="px-6 py-3.5">Status</th>
                    <th className="px-6 py-3.5 text-center">Target Leads</th>
                    <th className="px-6 py-3.5 text-center">AI Drafts</th>
                    <th className="px-6 py-3.5 text-center">Approved</th>
                    <th className="px-6 py-3.5 text-center">Sent</th>
                    <th className="px-6 py-3.5 text-center">Failed</th>
                    <th className="px-6 py-3.5">Created</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {campaigns.map((camp) => {
                    const statusBadge = STATUS_BADGES[camp.status] || STATUS_BADGES.DRAFT;

                    return (
                      <tr key={camp.id} className="hover:bg-slate-900/40 transition">
                        {/* Name */}
                        <td className="px-6 py-4 font-semibold text-white">
                          {camp.name}
                        </td>

                        {/* Channel */}
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                              camp.channel === OutreachChannel.WHATSAPP
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                            }`}
                          >
                            {camp.channel === OutreachChannel.WHATSAPP ? (
                              <MessageSquare className="w-3 h-3" />
                            ) : (
                              <Mail className="w-3 h-3" />
                            )}
                            {camp.channel}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusBadge.bg} ${statusBadge.text} ${statusBadge.border}`}
                          >
                            {statusBadge.label}
                          </span>
                        </td>

                        {/* Target Leads */}
                        <td className="px-6 py-4 text-center font-medium text-slate-200">
                          {camp.leadCount}
                        </td>

                        {/* AI Drafts */}
                        <td className="px-6 py-4 text-center text-slate-300">
                          {camp.draftCount}
                        </td>

                        {/* Approved */}
                        <td className="px-6 py-4 text-center">
                          <span className="font-semibold text-amber-400">
                            {camp.approvedCount}
                          </span>
                        </td>

                        {/* Sent */}
                        <td className="px-6 py-4 text-center">
                          <span className="font-semibold text-emerald-400">
                            {camp.sentCount}
                          </span>
                        </td>

                        {/* Failed */}
                        <td className="px-6 py-4 text-center">
                          <span className="font-medium text-slate-400">
                            {camp.failedCount}
                          </span>
                        </td>

                        {/* Created */}
                        <td className="px-6 py-4 text-xs text-slate-400">
                          {formatDate(camp.createdAt)}
                        </td>

                        {/* Actions */}
                        <td className="px-6 py-4 text-right">
                          <Link
                            href="/leads"
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition"
                          >
                            Manage Leads
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Modal: Create Campaign */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden p-6 space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Megaphone className="w-5 h-5 text-purple-400" />
                  Create Outreach Campaign
                </h3>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateCampaign} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    Campaign Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Website Acquisition - Dhanmondi Retailers"
                    value={modalName}
                    onChange={(e) => setModalName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    Channel
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setModalChannel(OutreachChannel.WHATSAPP)}
                      className={`p-3 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 transition ${
                        modalChannel === OutreachChannel.WHATSAPP
                          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <MessageSquare className="w-4 h-4" />
                      WhatsApp
                    </button>
                    <button
                      type="button"
                      onClick={() => setModalChannel(OutreachChannel.EMAIL)}
                      className={`p-3 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 transition ${
                        modalChannel === OutreachChannel.EMAIL
                          ? 'bg-blue-500/10 border-blue-500/40 text-blue-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Mail className="w-4 h-4" />
                      Email
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Select Target Leads ({selectedLeadIds.length} selected)
                    </label>
                  </div>

                  <div className="max-h-48 overflow-y-auto space-y-1.5 p-2 bg-slate-950 border border-slate-800 rounded-lg">
                    {availableLeads.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-4">
                        No leads available. Save leads from Business Search first.
                      </p>
                    ) : (
                      availableLeads.map((lead) => {
                        const isSelected = selectedLeadIds.includes(lead.id);
                        return (
                          <label
                            key={lead.id}
                            className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition text-xs ${
                              isSelected ? 'bg-purple-500/10 text-white' : 'hover:bg-slate-900 text-slate-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedLeadIds((prev) => [...prev, lead.id]);
                                } else {
                                  setSelectedLeadIds((prev) => prev.filter((id) => id !== lead.id));
                                }
                              }}
                              className="rounded border-slate-700 bg-slate-900 text-purple-600 focus:ring-purple-500"
                            />
                            <span className="font-semibold">{lead.name}</span>
                            <span className="text-slate-500">({lead.city})</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 text-sm rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || selectedLeadIds.length === 0 || !modalName.trim()}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition disabled:opacity-50 flex items-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Generating Drafts...
                      </>
                    ) : (
                      'Create & Generate Drafts'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
