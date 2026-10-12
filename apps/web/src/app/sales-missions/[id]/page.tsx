'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Target,
  Package,
  MapPin,
  Building2,
  Phone,
  Globe,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  ArrowLeft,
  Sparkles,
  ExternalLink,
  Users,
  Search,
  Filter,
  Download,
  ShieldCheck,
  HelpCircle,
  BookmarkPlus
} from 'lucide-react';
import {
  type SalesMissionDetailDto,
  type SalesMissionBuyerDto,
  SalesMissionStatus,
  SalesMissionGoal,
  MissionBuyerStatus,
  SALES_MISSION_GOAL_LABELS
} from '@leadmate/shared';
import { AppShell } from '@/components/layout/app-shell';
import { apiClient } from '@/lib/api-client';

export default function SalesMissionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const missionId = params?.id as string;

  const [mission, setMission] = useState<SalesMissionDetailDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter & Search
  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Action states
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [savingLeadId, setSavingLeadId] = useState<string | null>(null);

  const loadMission = async () => {
    if (!missionId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.getSalesMission(missionId);
      setMission(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load Sales Mission');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMission();
  }, [missionId]);

  const handleRefreshDiscovery = async () => {
    if (!missionId) return;
    setIsRefreshing(true);
    try {
      const updated = await apiClient.refreshMission(missionId);
      setMission(updated);
    } catch (err: any) {
      setError(err?.message || 'Failed to refresh buyer discovery');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSaveToCrm = async (buyer: SalesMissionBuyerDto) => {
    setSavingLeadId(buyer.id);
    try {
      // Save lead using business search save lead endpoint
      await apiClient.businessSearch.saveLead({
        externalId: buyer.externalBusinessId,
        provider: buyer.provider
      });

      // Optimistically update buyer status locally
      if (mission) {
        setMission({
          ...mission,
          buyers: mission.buyers?.map((b) =>
            b.id === buyer.id ? { ...b, status: MissionBuyerStatus.SAVED_TO_CRM } : b
          ),
          buyerStats: {
            found: mission.buyerStats?.found || 0,
            savedToCrm: (mission.buyerStats?.savedToCrm || 0) + 1
          }
        });
      }
    } catch (err: any) {
      console.error('Failed to save to CRM', err);
      alert(`Could not save lead: ${err?.message || 'Unknown error'}`);
    } finally {
      setSavingLeadId(null);
    }
  };

  const handleExportCsv = () => {
    if (!mission?.buyers || mission.buyers.length === 0) return;

    const headers = ['Business Name', 'Category', 'Address', 'City', 'Phone', 'Website', 'Matched Category', 'Provider', 'Status'];
    const rows = mission.buyers.map((b) => [
      `"${b.businessName.replace(/"/g, '""')}"`,
      `"${(b.category || '').replace(/"/g, '""')}"`,
      `"${(b.address || '').replace(/"/g, '""')}"`,
      `"${(b.city || '').replace(/"/g, '""')}"`,
      `"${b.phone || ''}"`,
      `"${b.website || ''}"`,
      `"${b.matchedBuyerCategory || ''}"`,
      `"${b.provider}"`,
      `"${b.status}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `mission-${mission.id}-buyers.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const buyers = mission?.buyers || [];
  const filteredBuyers = buyers.filter((b) => {
    const matchesSearch =
      !searchFilter.trim() ||
      b.businessName.toLowerCase().includes(searchFilter.toLowerCase()) ||
      (b.category && b.category.toLowerCase().includes(searchFilter.toLowerCase())) ||
      (b.matchedBuyerCategory && b.matchedBuyerCategory.toLowerCase().includes(searchFilter.toLowerCase()));

    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'SAVED_TO_CRM' && b.status === MissionBuyerStatus.SAVED_TO_CRM) ||
      (statusFilter === 'POTENTIAL' && b.status === MissionBuyerStatus.POTENTIAL) ||
      (statusFilter === 'DISQUALIFIED' && b.status === MissionBuyerStatus.DISQUALIFIED);

    return matchesSearch && matchesStatus;
  });

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Navigation & Header */}
        <div className="flex items-center justify-between">
          <Link
            href="/sales-missions"
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>All Sales Missions</span>
          </Link>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCsv}
              disabled={buyers.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>

            <button
              onClick={handleRefreshDiscovery}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Re-run Discovery</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm flex items-center gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
            <span className="text-sm">Loading mission command center...</span>
          </div>
        ) : !mission ? (
          <div className="p-12 text-center text-slate-400">Mission not found</div>
        ) : (
          <div className="space-y-6">
            {/* Top Mission Header Card */}
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-6 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {mission.status}
                    </span>
                    <span className="text-xs text-slate-400 font-medium">
                      Target: {mission.targetMarket}
                    </span>
                  </div>
                  <h1 className="text-2xl font-bold text-slate-100 tracking-tight">
                    {mission.name}
                  </h1>
                </div>

                <div className="flex items-center gap-4 text-xs">
                  <div className="text-right">
                    <div className="text-slate-400">Sales Goal</div>
                    <div className="font-semibold text-slate-200">
                      {SALES_MISSION_GOAL_LABELS[mission.goal as SalesMissionGoal] || mission.goal}
                    </div>
                  </div>
                  <div className="text-right pl-4 border-l border-slate-800">
                    <div className="text-slate-400">Buyers Found</div>
                    <div className="font-semibold text-indigo-400 text-sm">
                      {buyers.length}
                    </div>
                  </div>
                  <div className="text-right pl-4 border-l border-slate-800">
                    <div className="text-slate-400">Saved to CRM</div>
                    <div className="font-semibold text-emerald-400 text-sm">
                      {mission.buyerStats?.savedToCrm || 0}
                    </div>
                  </div>
                </div>
              </div>

              {/* Linked Product Banner */}
              {mission.product && (
                <div className="p-3 bg-slate-900/60 border border-slate-800/60 rounded-xl flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                    <span className="font-medium text-slate-200">Linked Product:</span>
                    <span className="text-slate-300 font-semibold">{mission.product.name}</span>
                    <span className="text-slate-400">({mission.product.stockQuantity} in stock)</span>
                  </div>
                  <Link
                    href={`/products`}
                    className="text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"
                  >
                    <span>View Product</span>
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
              )}
            </div>

            {/* AI Product Analysis Snapshot (Reopened without re-calling external APIs) */}
            {mission.productAnalysisSnapshot && (
              <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    <h3 className="text-sm font-semibold text-slate-200">
                      AI Product Analysis Snapshot
                    </h3>
                  </div>
                  <span className="text-[11px] text-slate-500 font-mono">
                    Persisted Snapshot (Zero API cost)
                  </span>
                </div>

                <div className="p-3.5 bg-indigo-950/20 border border-indigo-500/20 rounded-xl space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400">Classified Category:</span>
                    <span className="font-semibold text-indigo-300">
                      {mission.productAnalysisSnapshot.productCategory}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {mission.productAnalysisSnapshot.productSummary}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">Target Buyer Categories:</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                    {mission.productAnalysisSnapshot.buyerTargets.map((b, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-200">{b.category}</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300">
                            {b.confidence}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 line-clamp-2">{b.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Discovered Businesses / Buyers Section */}
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-indigo-400" />
                  <h2 className="text-lg font-bold text-slate-100">Discovered Businesses</h2>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-medium">
                    {filteredBuyers.length} of {buyers.length}
                  </span>
                </div>

                {/* Filters */}
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      placeholder="Filter businesses..."
                      className="pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="ALL">All Status</option>
                    <option value="POTENTIAL">Potential</option>
                    <option value="SAVED_TO_CRM">Saved to CRM</option>
                    <option value="DISQUALIFIED">Disqualified</option>
                  </select>
                </div>
              </div>

              {filteredBuyers.length === 0 ? (
                <div className="p-12 text-center bg-slate-950/40 border border-slate-800 rounded-2xl space-y-2">
                  <Building2 className="w-8 h-8 text-slate-500 mx-auto" />
                  <p className="text-sm text-slate-300">No businesses match current filters</p>
                  <p className="text-xs text-slate-500">
                    Try broadening your search or click "Re-run Discovery" to query additional directories.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredBuyers.map((buyer) => {
                    const isSaved = buyer.status === MissionBuyerStatus.SAVED_TO_CRM;
                    const isSaving = savingLeadId === buyer.id;

                    return (
                      <div
                        key={buyer.id}
                        className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-5 hover:border-slate-700 transition flex flex-col justify-between space-y-3"
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h3 className="font-semibold text-slate-100 text-base">
                                {buyer.businessName}
                              </h3>
                              {buyer.category && (
                                <span className="text-xs text-slate-400">{buyer.category}</span>
                              )}
                            </div>

                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase flex-shrink-0 ${
                                isSaved
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-slate-800 text-slate-300'
                              }`}
                            >
                              {isSaved ? 'In CRM' : buyer.status}
                            </span>
                          </div>

                          {/* Address / Location */}
                          {(buyer.address || buyer.city) && (
                            <div className="flex items-center gap-1.5 text-xs text-slate-400">
                              <MapPin className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                              <span className="truncate">
                                {[buyer.address, buyer.city].filter(Boolean).join(', ')}
                              </span>
                            </div>
                          )}

                          {/* Provenance Tags */}
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {buyer.matchedBuyerCategory && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                                Target: {buyer.matchedBuyerCategory}
                              </span>
                            )}
                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-900 border border-slate-800 text-slate-400">
                              via {buyer.provider}
                            </span>
                          </div>
                        </div>

                        {/* Contacts & Actions */}
                        <div className="pt-3 border-t border-slate-800/60 space-y-3">
                          <div className="flex flex-wrap items-center gap-3 text-xs">
                            {buyer.phone ? (
                              <div className="flex items-center gap-1 text-slate-300 font-mono">
                                <Phone className="w-3.5 h-3.5 text-emerald-400" />
                                <span>{buyer.phone}</span>
                              </div>
                            ) : (
                              <span className="text-slate-500 text-[11px]">No phone listed</span>
                            )}

                            {buyer.website ? (
                              <a
                                href={buyer.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
                              >
                                <Globe className="w-3.5 h-3.5" />
                                <span>Website</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            ) : null}

                            {/* PHONE != WHATSAPP Invariant Display */}
                            <span
                              className="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-500 border border-slate-800"
                              title="Phone numbers are not assumed to have WhatsApp without explicit evidence"
                            >
                              WhatsApp: Unverified
                            </span>
                          </div>

                          {/* CTA */}
                          <div className="flex items-center justify-end gap-2">
                            {isSaved ? (
                              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-medium py-1 px-2 rounded bg-emerald-500/10 border border-emerald-500/20">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Saved to CRM</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => handleSaveToCrm(buyer)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition disabled:opacity-50"
                              >
                                {isSaving ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <BookmarkPlus className="w-3.5 h-3.5" />
                                )}
                                <span>Save to CRM</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
