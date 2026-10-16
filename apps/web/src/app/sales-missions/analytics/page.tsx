'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  BarChart3,
  TrendingUp,
  Users,
  Target,
  Flame,
  Zap,
  PhoneCall,
  MessageSquare,
  Sparkles,
  ShieldAlert,
  HelpCircle,
  AlertCircle,
  Layers,
  ArrowRight,
  RefreshCw,
  Award,
  CheckCircle2,
  DollarSign,
  Package,
  Compass,
  ArrowUpRight
} from 'lucide-react';
import {
  type DashboardSalesKpisDto,
  type ProductAnalyticsDto,
  type SourceEffectivenessDto,
  type RecommendationResponseDto,
  type ProductDto
} from '@leadmate/shared';
import { AppShell } from '@/components/layout/app-shell';
import { apiClient } from '@/lib/api-client';

const DEFAULT_SOURCES: SourceEffectivenessDto[] = [
  {
    provider: 'openstreetmap',
    displayName: 'OpenStreetMap',
    status: 'ACTIVE',
    primaryBuyersFound: 0,
    contactableBuyers: 0,
    contactedBuyers: 0,
    buyersReplied: 0,
    wonBuyers: 0,
    replyRate: 0,
    conversionRate: 0,
    wonValueByCurrency: {},
    assistedBuyerCount: 0,
    enrichmentContributionCount: 0,
    attributionNote: 'Primary discovery credits conversions.'
  },
  {
    provider: 'google-places',
    displayName: 'Google Places',
    status: 'ACTIVE',
    primaryBuyersFound: 0,
    contactableBuyers: 0,
    contactedBuyers: 0,
    buyersReplied: 0,
    wonBuyers: 0,
    replyRate: 0,
    conversionRate: 0,
    wonValueByCurrency: {},
    assistedBuyerCount: 0,
    enrichmentContributionCount: 0,
    attributionNote: 'Primary discovery credits conversions.'
  },
  {
    provider: 'facebook-business',
    displayName: 'Facebook Business',
    status: 'NOT_CONFIGURED',
    statusMessage: 'Provider not configured in organization settings.',
    primaryBuyersFound: 0,
    contactableBuyers: 0,
    contactedBuyers: 0,
    buyersReplied: 0,
    wonBuyers: 0,
    replyRate: 0,
    conversionRate: 0,
    wonValueByCurrency: {},
    assistedBuyerCount: 0,
    enrichmentContributionCount: 0,
    attributionNote: 'Primary discovery credits conversions.'
  }
];

const DEFAULT_RECOMMENDATIONS: RecommendationResponseDto = {
  recommendations: [
    {
      id: 'rec-buyer-cat-init',
      recommendationType: 'BUYER_CATEGORY',
      recommendedValue: 'Wholesale Lighting Stores',
      status: 'INSUFFICIENT_DATA',
      sampleSize: 0,
      supportingMetrics: {},
      reason: 'Evaluating historical contacted buyer cohorts (requires N ≥ 5).',
      disclaimer: 'AI Targeting Suggestion: Prediction only — not verified commercial performance.',
      aiTargetingFallback: 'Wholesale Lighting Stores'
    },
    {
      id: 'rec-loc-init',
      recommendationType: 'LOCATION',
      recommendedValue: 'Dhaka, Bangladesh',
      status: 'INSUFFICIENT_DATA',
      sampleSize: 0,
      supportingMetrics: {},
      reason: 'Evaluating regional location cohorts.',
      disclaimer: 'AI Targeting Suggestion: Suggested regional market.',
      aiTargetingFallback: 'Dhaka, Bangladesh'
    },
    {
      id: 'rec-source-init',
      recommendationType: 'SOURCE',
      recommendedValue: 'OpenStreetMap',
      status: 'INSUFFICIENT_DATA',
      sampleSize: 0,
      supportingMetrics: {},
      reason: 'Evaluating discovery source conversion rates.',
      disclaimer: 'Source suggestion based on default configured providers.',
      aiTargetingFallback: 'OpenStreetMap'
    }
  ],
  minimumCohortSize: 5,
  evaluatedCohortsCount: 0,
  hasSufficientData: false
};

export default function SalesMissionsAnalyticsPage() {
  const [kpis, setKpis] = useState<DashboardSalesKpisDto | null>(null);
  const [sources, setSources] = useState<SourceEffectivenessDto[]>(DEFAULT_SOURCES);
  const [recommendations, setRecommendations] = useState<RecommendationResponseDto | null>(DEFAULT_RECOMMENDATIONS);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [productAnalytics, setProductAnalytics] = useState<ProductAnalyticsDto | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async (refresh = false) => {
    if (refresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      // Zero external calls — only local PostgreSQL queries via tenant-isolated endpoints
      const [kpisRes, sourcesRes, recsRes, prodsRes] = await Promise.all([
        apiClient.getSalesDashboardAnalytics(),
        apiClient.getSourceAnalytics(),
        apiClient.getDiscoveryRecommendations(selectedProductId || undefined),
        apiClient.listProducts({ limit: 50 }).catch(() => ({ products: [] }))
      ]);

      setKpis(kpisRes.data);
      setSources(sourcesRes.data);
      setRecommendations(recsRes.data);
      const prodsList = prodsRes.products || [];
      setProducts(prodsList);

      if (prodsList.length > 0 && !selectedProductId) {
        const firstId = prodsList[0].id;
        setSelectedProductId(firstId);
        try {
          const prodRes = await apiClient.getProductAnalytics(firstId);
          setProductAnalytics(prodRes.data);
        } catch {
          // ignore product analytics error
        }
      } else if (selectedProductId) {
        try {
          const prodRes = await apiClient.getProductAnalytics(selectedProductId);
          setProductAnalytics(prodRes.data);
        } catch {
          // ignore product analytics error
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load sales analytics data.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleProductChange = async (productId: string) => {
    setSelectedProductId(productId);
    if (!productId) {
      setProductAnalytics(null);
      return;
    }
    try {
      const [prodRes, recRes] = await Promise.all([
        apiClient.getProductAnalytics(productId),
        apiClient.getDiscoveryRecommendations(productId)
      ]);
      setProductAnalytics(prodRes.data);
      setRecommendations(recRes.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load product analytics');
    }
  };

  const formatCurrencyMap = (map?: Record<string, number>) => {
    if (!map || Object.keys(map).length === 0) return 'None';
    return Object.entries(map)
      .map(([curr, val]) => `${curr} ${Number(val).toLocaleString()}`)
      .join(' | ');
  };

  return (
    <AppShell>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Phase D • Learning Loop
              </span>
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Zero External Calls • Local Persisted DB
              </span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
              <BarChart3 className="w-8 h-8 text-blue-400" />
              AI Sales Engine Analytics
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Empirical outreach performance, multi-currency revenue, source effectiveness, and deterministic discovery recommendations.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/sales-missions"
              className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 rounded-lg transition-colors flex items-center gap-2"
            >
              <Target className="w-4 h-4 text-blue-400" />
              Sales Missions
            </Link>
            <button
              onClick={() => loadData(true)}
              disabled={isRefreshing || isLoading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-2 shadow-lg shadow-blue-500/20"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh Analytics
            </button>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {/* 1. OVERVIEW KPIS */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-400" />
            Commercial Overview KPIs
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
              <span className="text-xs text-slate-400 flex items-center gap-1.5 mb-1">
                <Users className="w-4 h-4 text-slate-400" />
                Unique Buyers
              </span>
              <p className="text-2xl font-bold text-white">{kpis?.uniqueBuyers ?? 0}</p>
              <span className="text-xs text-slate-500">
                Found across {kpis?.activeMissions ?? 0} active missions
              </span>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
              <span className="text-xs text-slate-400 flex items-center gap-1.5 mb-1">
                <Flame className="w-4 h-4 text-amber-400" />
                HOT Buyers
              </span>
              <p className="text-2xl font-bold text-amber-400">{kpis?.hotBuyers ?? 0}</p>
              <span className="text-xs text-slate-500">
                High commercial priority
              </span>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
              <span className="text-xs text-slate-400 flex items-center gap-1.5 mb-1">
                <PhoneCall className="w-4 h-4 text-cyan-400" />
                Contactable
              </span>
              <p className="text-2xl font-bold text-cyan-400">{kpis?.contactableBuyers ?? 0}</p>
              <span className="text-xs text-slate-500">
                Rate: {((kpis?.contactabilityRate ?? 0) * 100).toFixed(1)}%
              </span>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
              <span className="text-xs text-slate-400 flex items-center gap-1.5 mb-1">
                <MessageSquare className="w-4 h-4 text-indigo-400" />
                Contacted
              </span>
              <p className="text-2xl font-bold text-indigo-400">{kpis?.contactedBuyers ?? 0}</p>
              <span className="text-xs text-slate-500">
                Actual contact evidence
              </span>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
              <span className="text-xs text-slate-400 flex items-center gap-1.5 mb-1">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                Reply Rate
              </span>
              <p className="text-2xl font-bold text-emerald-400">
                {((kpis?.replyRate ?? 0) * 100).toFixed(1)}%
              </p>
              <span className="text-xs text-slate-500">
                {kpis?.repliedBuyers ?? 0} replied / {kpis?.contactedBuyers ?? 0} contacted
              </span>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
              <span className="text-xs text-slate-400 flex items-center gap-1.5 mb-1">
                <Award className="w-4 h-4 text-emerald-400" />
                Conversion Rate
              </span>
              <p className="text-2xl font-bold text-emerald-400">
                {((kpis?.conversionRate ?? 0) * 100).toFixed(1)}%
              </p>
              <span className="text-xs text-slate-500">
                {kpis?.wonBuyers ?? 0} won / {kpis?.contactedBuyers ?? 0} contacted
              </span>
            </div>
          </div>

          {/* Currency-Safe Revenue Card */}
          <div className="bg-gradient-to-r from-slate-900 to-slate-900/80 border border-slate-800 p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5 mb-1">
                <DollarSign className="w-4 h-4" />
                Verified Closed Revenue (Currency-Safe)
              </span>
              <div className="flex flex-wrap items-baseline gap-4 mt-2">
                {kpis?.wonValueByCurrency && Object.keys(kpis.wonValueByCurrency).length > 0 ? (
                  Object.entries(kpis.wonValueByCurrency).map(([curr, val]) => (
                    <div key={curr} className="flex items-baseline gap-1.5">
                      <span className="text-3xl font-extrabold text-white">
                        {curr === 'BDT' ? '৳' : curr === 'USD' ? '$' : ''}
                        {Number(val).toLocaleString()}
                      </span>
                      <span className="text-sm font-semibold text-emerald-400">{curr}</span>
                    </div>
                  ))
                ) : (
                  <span className="text-2xl font-bold text-slate-500">No closed revenue yet</span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Currencies are strictly isolated. No automated FX conversion is applied without historical snapshots.
              </p>
            </div>

            <div className="border-t md:border-t-0 md:border-l border-slate-800 pt-4 md:pt-0 md:pl-6 text-sm">
              <span className="text-xs text-slate-400 block mb-1">Average Deal Value (AOV)</span>
              <div className="space-y-1">
                {kpis?.averageDealValueByCurrency && Object.keys(kpis.averageDealValueByCurrency).length > 0 ? (
                  Object.entries(kpis.averageDealValueByCurrency).map(([curr, val]) => (
                    <div key={curr} className="text-white font-medium">
                      {curr}: {Number(val).toLocaleString()}
                    </div>
                  ))
                ) : (
                  <span className="text-slate-500">N/A</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 2. SALES FUNNEL */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-400" />
            Deterministic Sales Funnel
          </h2>

          <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-2xl">
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
              {[
                { label: 'Discovered', val: kpis?.funnel.discovered ?? 0, color: 'text-slate-300', bg: 'bg-slate-800/60' },
                { label: 'Contactable', val: kpis?.funnel.contactable ?? 0, color: 'text-cyan-400', bg: 'bg-cyan-950/20' },
                { label: 'Contacted', val: kpis?.funnel.contacted ?? 0, color: 'text-indigo-400', bg: 'bg-indigo-950/20' },
                { label: 'Replied', val: kpis?.funnel.replied ?? 0, color: 'text-purple-400', bg: 'bg-purple-950/20' },
                { label: 'Interested', val: kpis?.funnel.interested ?? 0, color: 'text-amber-400', bg: 'bg-amber-950/20' },
                { label: 'Negotiating', val: kpis?.funnel.negotiating ?? 0, color: 'text-blue-400', bg: 'bg-blue-950/20' },
                { label: 'Won', val: kpis?.funnel.won ?? 0, color: 'text-emerald-400', bg: 'bg-emerald-950/30' }
              ].map((stage, idx, arr) => (
                <div key={stage.label} className={`p-4 rounded-xl border border-slate-800/80 ${stage.bg} flex flex-col justify-between`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-400">{stage.label}</span>
                    {idx < arr.length - 1 && (
                      <ArrowRight className="w-3.5 h-3.5 text-slate-600 hidden md:block" />
                    )}
                  </div>
                  <div className="mt-3">
                    <span className={`text-2xl font-bold ${stage.color}`}>{stage.val}</span>
                    {idx > 0 && (
                      <span className="block text-[11px] text-slate-500 mt-0.5">
                        {arr[0].val > 0 ? `${Math.round((stage.val / arr[0].val) * 100)}% of reach` : '0%'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 p-3 bg-slate-950/60 rounded-lg text-xs text-slate-400 flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-blue-400 shrink-0" />
              <span>
                <strong>Approval != Contacted Rule:</strong> Denominator strictly tracks buyers who reached actual outreach stage or verified outbound dispatch. Approved drafts pending human dispatch are never counted as contacted.
              </span>
            </div>
          </div>
        </div>

        {/* 3. DISCOVERY RECOMMENDATIONS */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Compass className="w-5 h-5 text-indigo-400" />
              Deterministic Discovery Recommendations
            </h2>
            <span className="text-xs text-slate-400">
              Minimum cohort requirement: N ≥ {recommendations?.minimumCohortSize ?? 5} contacted observations
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {recommendations?.recommendations.map((rec) => {
              const isInsufficient = rec.status === 'INSUFFICIENT_DATA';
              return (
                <div
                  key={rec.id}
                  className={`p-5 rounded-2xl border flex flex-col justify-between transition-all ${
                    isInsufficient
                      ? 'bg-slate-900/30 border-slate-800 text-slate-400'
                      : 'bg-slate-900/80 border-indigo-500/30 shadow-lg shadow-indigo-950/30'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        {rec.recommendationType.replace('_', ' ')}
                      </span>
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                          isInsufficient
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        }`}
                      >
                        {rec.status}
                      </span>
                    </div>

                    <h3 className="text-lg font-bold text-white mb-2">
                      {rec.recommendedValue}
                    </h3>

                    <p className="text-xs text-slate-300 leading-relaxed mb-3">
                      {rec.reason}
                    </p>

                    {!isInsufficient && rec.supportingMetrics && (
                      <div className="grid grid-cols-2 gap-2 p-2.5 bg-slate-950/60 rounded-lg text-xs mb-3 border border-slate-800">
                        <div>
                          <span className="text-slate-500 block">Sample Size:</span>
                          <span className="font-semibold text-slate-200">n = {rec.sampleSize} contacted</span>
                        </div>
                        {rec.supportingMetrics.conversionRate !== undefined && (
                          <div>
                            <span className="text-slate-500 block">Conversion Rate:</span>
                            <span className="font-semibold text-emerald-400">
                              {(rec.supportingMetrics.conversionRate * 100).toFixed(1)}%
                            </span>
                          </div>
                        )}
                        {rec.supportingMetrics.interestRate !== undefined && (
                          <div>
                            <span className="text-slate-500 block">Interest Rate:</span>
                            <span className="font-semibold text-cyan-400">
                              {(rec.supportingMetrics.interestRate * 100).toFixed(1)}%
                            </span>
                          </div>
                        )}
                        {rec.supportingMetrics.wonCount !== undefined && (
                          <div>
                            <span className="text-slate-500 block">Won Deals:</span>
                            <span className="font-semibold text-white">
                              {rec.supportingMetrics.wonCount}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-slate-800/80">
                    <p className="text-[11px] text-slate-500 italic">
                      {rec.disclaimer}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 4. SOURCE EFFECTIVENESS MATRIX */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Target className="w-5 h-5 text-blue-400" />
              Source Effectiveness & Multi-Source Attribution
            </h2>
            <span className="text-xs text-slate-400">
              Primary attribution basis. Multi-source enrichments counted separately.
            </span>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="text-xs uppercase bg-slate-950/80 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Discovery Provider</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Primary Found</th>
                    <th className="px-4 py-3 font-semibold">Contactable</th>
                    <th className="px-4 py-3 font-semibold">Contacted</th>
                    <th className="px-4 py-3 font-semibold">Replied</th>
                    <th className="px-4 py-3 font-semibold">Won</th>
                    <th className="px-4 py-3 font-semibold">Reply Rate</th>
                    <th className="px-4 py-3 font-semibold">Conv. Rate</th>
                    <th className="px-4 py-3 font-semibold">Won Value</th>
                    <th className="px-4 py-3 font-semibold">Assisted Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                  {sources.map((s) => {
                    const isConfigured = s.status === 'ACTIVE';
                    return (
                      <tr key={s.provider} className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-4 py-3 font-sans font-medium text-white flex items-center gap-2">
                          {s.displayName}
                        </td>
                        <td className="px-4 py-3 font-sans">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              s.status === 'ACTIVE'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : s.status === 'DISABLED'
                                ? 'bg-slate-700/50 text-slate-400'
                                : s.status === 'ERROR'
                                ? 'bg-rose-500/10 text-rose-400'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            }`}
                          >
                            {s.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">{s.primaryBuyersFound}</td>
                        <td className="px-4 py-3">{s.contactableBuyers}</td>
                        <td className="px-4 py-3">{s.contactedBuyers}</td>
                        <td className="px-4 py-3">{s.buyersReplied}</td>
                        <td className="px-4 py-3 font-semibold text-emerald-400">{s.wonBuyers}</td>
                        <td className="px-4 py-3">{(s.replyRate * 100).toFixed(1)}%</td>
                        <td className="px-4 py-3 font-semibold text-emerald-400">
                          {(s.conversionRate * 100).toFixed(1)}%
                        </td>
                        <td className="px-4 py-3 text-slate-200">
                          {formatCurrencyMap(s.wonValueByCurrency)}
                        </td>
                        <td className="px-4 py-3 text-indigo-400 font-semibold">
                          {s.assistedBuyerCount}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="p-4 bg-slate-950/60 border-t border-slate-800 text-xs text-slate-400 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <strong>Attribution Rule:</strong> Primary discoverer receives 100% of conversion and deal values. Secondary sources in multi-source merged profiles receive Assisted counts.
              </span>
              <span className="text-slate-500 text-[11px]">
                Unconfigured providers honestly marked NOT_CONFIGURED.
              </span>
            </div>
          </div>
        </div>

        {/* 5. PRODUCT ANALYTICS & LOSS ANALYSIS */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Package className="w-5 h-5 text-blue-400" />
              Product Performance & Loss Breakdown
            </h2>

            {products.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Select Product:</span>
                <select
                  value={selectedProductId}
                  onChange={(e) => handleProductChange(e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.currency} {p.sellingPrice ? Number(p.sellingPrice).toLocaleString() : ''})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {productAnalytics ? (
            <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-2xl space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                <div>
                  <h3 className="text-xl font-bold text-white">{productAnalytics.productName}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Category: {productAnalytics.category || 'General'} • Currency: {productAnalytics.currency} • Price:{' '}
                    {productAnalytics.sellingPrice ? Number(productAnalytics.sellingPrice).toLocaleString() : 'N/A'}
                  </p>
                </div>

                <div className="flex items-center gap-4 text-xs font-medium">
                  <span className="px-2.5 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    HOT: {productAnalytics.priorityBreakdown.hot}
                  </span>
                  <span className="px-2.5 py-1 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    WARM: {productAnalytics.priorityBreakdown.warm}
                  </span>
                  <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-400">
                    COLD: {productAnalytics.priorityBreakdown.cold}
                  </span>
                </div>
              </div>

              {/* Product metrics cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400 block mb-1">Potential Buyers</span>
                  <span className="text-xl font-bold text-white">{productAnalytics.potentialBuyers}</span>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400 block mb-1">Contactable</span>
                  <span className="text-xl font-bold text-cyan-400">{productAnalytics.contactableBuyers}</span>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400 block mb-1">Contacted</span>
                  <span className="text-xl font-bold text-indigo-400">{productAnalytics.contactedBuyers}</span>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400 block mb-1">Reply Rate</span>
                  <span className="text-xl font-bold text-purple-400">
                    {(productAnalytics.replyRate * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400 block mb-1">Conversion Rate</span>
                  <span className="text-xl font-bold text-emerald-400">
                    {(productAnalytics.conversionRate * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-400 block mb-1">Won Value</span>
                  <span className="text-sm font-bold text-emerald-400 block truncate">
                    {formatCurrencyMap(productAnalytics.wonValueByCurrency)}
                  </span>
                </div>
              </div>

              {/* Loss Analysis */}
              <div className="pt-4 border-t border-slate-800">
                <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-rose-400" />
                  Loss Reason Breakdown ({productAnalytics.lostBuyers} Lost Deals)
                </h4>

                {Object.keys(productAnalytics.lossReasons).length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(productAnalytics.lossReasons).map(([reason, count]) => (
                      <span
                        key={reason}
                        className="px-3 py-1 bg-rose-500/10 text-rose-300 border border-rose-500/20 rounded-lg text-xs font-medium"
                      >
                        {reason.replace('_', ' ')}: <strong className="text-white">{count}</strong>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No lost deal reasons recorded for this product.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center bg-slate-900/30 border border-slate-800 rounded-2xl">
              <Package className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No product selected or no products found in catalog.</p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
