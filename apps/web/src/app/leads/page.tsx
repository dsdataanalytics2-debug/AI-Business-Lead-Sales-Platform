'use client';

import React, { useState, useEffect, useReducer, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Users,
  Search,
  Filter,
  RotateCcw,
  Loader2,
  AlertCircle,
  Phone,
  Mail,
  Globe,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { Permissions } from '@leadmate/shared';
import { useAuth } from '@/lib/auth-context';
import { AppShell } from '@/components/layout/app-shell';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { getSafeExternalUrl } from '@/lib/safe-url';
import { formatDate } from '@/lib/format-date';
import {
  buildLeadListQuery,
  defaultLeadListFilters,
  type LeadListFilterState
} from '@/lib/leads/lead-list-query';
import {
  leadListReducer,
  initialLeadListState
} from '@/lib/leads/lead-list-state';

export default function LeadsPage() {
  const { user, isAuthenticated, isLoading: isAuthLoading, hasPermission } = useAuth();
  const router = useRouter();

  const canReadLeads = hasPermission(Permissions.LEADS_READ);

  // Draft filters (bound to user inputs) vs Applied filters (triggers queries)
  const [draftFilters, setDraftFilters] = useState<LeadListFilterState>(defaultLeadListFilters);
  const [appliedFilters, setAppliedFilters] = useState<LeadListFilterState>(defaultLeadListFilters);

  // Pure reducer state
  const [listState, dispatch] = useReducer(leadListReducer, initialLeadListState);

  // Monotonic generation counter ref to avoid stale closures under React StrictMode
  const generationRef = useRef<number>(0);

  // AbortController refs for in-flight requests
  const abortControllerRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const isLoadingMoreRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthLoading, isAuthenticated, router]);

  // Initial and Applied-Filter Data Fetching
  useEffect(() => {
    if (!isAuthenticated || !canReadLeads) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (loadMoreAbortRef.current) {
      loadMoreAbortRef.current.abort();
    }
    isLoadingMoreRef.current = false;

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    generationRef.current += 1;
    const currentGeneration = generationRef.current;

    dispatch({ type: 'APPLY_FILTERS', generation: currentGeneration });
    const query = buildLeadListQuery(appliedFilters);

    apiClient.leads
      .list(query, { signal: abortController.signal })
      .then((res) => {
        dispatch({
          type: 'FETCH_INITIAL_SUCCESS',
          payload: {
            generation: currentGeneration,
            leads: res.data,
            nextCursor: res.meta.nextCursor,
            total: res.meta.total,
            hasMore: res.meta.hasMore
          }
        });
      })
      .catch((err) => {
        if (err?.name === 'AbortError' || abortController.signal.aborted) {
          return;
        }
        if (err instanceof ApiClientError) {
          dispatch({
            type: 'FETCH_INITIAL_ERROR',
            payload: {
              generation: currentGeneration,
              error: {
                message: err.message || 'Failed to load leads from database.',
                code: err.code,
                requestId: err.requestId,
                statusCode: err.statusCode
              }
            }
          });
        } else {
          dispatch({
            type: 'FETCH_INITIAL_ERROR',
            payload: {
              generation: currentGeneration,
              error: {
                message: 'Unable to connect to lead database service. Please check your network and try again.'
              }
            }
          });
        }
      });

    return () => {
      abortController.abort();
      if (loadMoreAbortRef.current) {
        loadMoreAbortRef.current.abort();
      }
    };
  }, [isAuthenticated, canReadLeads, appliedFilters]);

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedFilters({ ...draftFilters });
  };

  const handleResetFilters = () => {
    setDraftFilters(defaultLeadListFilters);
    setAppliedFilters(defaultLeadListFilters);
  };

  const handleLoadMore = () => {
    if (isLoadingMoreRef.current || !listState.nextCursor || listState.isLoadingMore || listState.isLoading) {
      return;
    }

    isLoadingMoreRef.current = true;
    if (loadMoreAbortRef.current) {
      loadMoreAbortRef.current.abort();
    }
    const abortController = new AbortController();
    loadMoreAbortRef.current = abortController;

    dispatch({ type: 'LOAD_MORE_START' });
    const currentGeneration = listState.generation;
    const query = buildLeadListQuery(appliedFilters, listState.nextCursor);

    apiClient.leads
      .list(query, { signal: abortController.signal })
      .then((res) => {
        isLoadingMoreRef.current = false;
        dispatch({
          type: 'LOAD_MORE_SUCCESS',
          payload: {
            generation: currentGeneration,
            leads: res.data,
            nextCursor: res.meta.nextCursor,
            total: res.meta.total,
            hasMore: res.meta.hasMore
          }
        });
      })
      .catch((err) => {
        isLoadingMoreRef.current = false;
        if (err?.name === 'AbortError' || abortController.signal.aborted) {
          return;
        }
        if (err instanceof ApiClientError) {
          dispatch({
            type: 'LOAD_MORE_ERROR',
            payload: {
              generation: currentGeneration,
              error: {
                message: err.message || 'Failed to load additional leads.',
                code: err.code,
                requestId: err.requestId,
                statusCode: err.statusCode
              }
            }
          });
        } else {
          dispatch({
            type: 'LOAD_MORE_ERROR',
            payload: {
              generation: currentGeneration,
              error: {
                message: 'Network error while loading more leads. Please retry.'
              }
            }
          });
        }
      });
  };

  const hasActiveFilters =
    appliedFilters.search !== '' ||
    appliedFilters.city !== '' ||
    appliedFilters.category !== '' ||
    appliedFilters.websiteStatus !== 'ALL' ||
    appliedFilters.onlinePresence !== 'ALL' ||
    appliedFilters.hasPhone !== 'ALL' ||
    appliedFilters.hasEmail !== 'ALL' ||
    appliedFilters.hasWhatsApp !== 'ALL';

  if (isAuthLoading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <div className="text-xs text-slate-400 font-mono">Verifying Session...</div>
        </div>
      </div>
    );
  }

  if (!canReadLeads) {
    return (
      <AppShell>
        <div className="max-w-6xl mx-auto py-12 px-4 text-center">
          <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 max-w-md mx-auto">
            <div className="w-12 h-12 rounded-xl bg-amber-950/60 border border-amber-800/60 flex items-center justify-center mx-auto text-amber-400">
              <Users className="w-6 h-6" />
            </div>
            <h1 className="text-base font-bold text-slate-100">Access Restricted</h1>
            <p className="text-xs text-slate-400">
              You do not have permission to view the Master Lead Database. Please contact your organization administrator to request access.
            </p>
            <div className="pt-2">
              <Link
                href="/dashboard"
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-colors inline-block"
              >
                Return to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto space-y-6 pb-16">
        {/* Header Title & Primary Action */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-indigo-950/80 border border-indigo-800/60 text-indigo-400">
                <Users className="w-5 h-5" />
              </div>
              <h1 className="text-xl font-bold text-slate-100 tracking-tight">Master Lead Database</h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Authoritative, deduplicated business lead records discovered across marketing channels.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              href="/business-search"
              className="px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-sm shadow-indigo-500/20 transition-all flex items-center gap-2 cursor-pointer"
            >
              <Search className="w-4 h-4" />
              <span>Business Search</span>
            </Link>
          </div>
        </div>

        {/* Filter Controls Card */}
        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 shadow-md space-y-4">
          <form onSubmit={handleFilterSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Search (Name, Phone, Email) */}
              <div className="space-y-1.5 sm:col-span-1">
                <label htmlFor="filter-search" className="block text-xs font-medium text-slate-300">
                  Search (Name, Phone, Email)
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    id="filter-search"
                    type="text"
                    value={draftFilters.search}
                    onChange={(e) => setDraftFilters((prev) => ({ ...prev, search: e.target.value }))}
                    placeholder="Search name, phone, email..."
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>

              {/* City */}
              <div className="space-y-1.5 sm:col-span-1">
                <label htmlFor="filter-city" className="block text-xs font-medium text-slate-300">
                  City
                </label>
                <input
                  id="filter-city"
                  type="text"
                  value={draftFilters.city}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, city: e.target.value }))}
                  placeholder="e.g. Dhaka, Chittagong"
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
              </div>

              {/* Category */}
              <div className="space-y-1.5 sm:col-span-1">
                <label htmlFor="filter-category" className="block text-xs font-medium text-slate-300">
                  Category
                </label>
                <input
                  id="filter-category"
                  type="text"
                  value={draftFilters.category}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, category: e.target.value }))}
                  placeholder="e.g. Healthcare, Retail"
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
              </div>

              {/* Website Status */}
              <div className="space-y-1.5 sm:col-span-1">
                <label htmlFor="filter-website-status" className="block text-xs font-medium text-slate-300">
                  Website Status
                </label>
                <select
                  id="filter-website-status"
                  value={draftFilters.websiteStatus}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, websiteStatus: e.target.value }))}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="REACHABLE">Reachable</option>
                  <option value="UNREACHABLE">Unreachable</option>
                  <option value="UNKNOWN">Unknown</option>
                  <option value="NO_WEBSITE">No Website</option>
                </select>
              </div>

              {/* Online Presence */}
              <div className="space-y-1.5 sm:col-span-1">
                <label htmlFor="filter-online-presence" className="block text-xs font-medium text-slate-300">
                  Online Presence
                </label>
                <select
                  id="filter-online-presence"
                  value={draftFilters.onlinePresence}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, onlinePresence: e.target.value }))}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                >
                  <option value="ALL">All Channels</option>
                  <option value="WEBSITE">Website</option>
                  <option value="FACEBOOK_ONLY">Facebook Only</option>
                  <option value="INSTAGRAM_ONLY">Instagram Only</option>
                  <option value="NO_DIGITAL_PRESENCE">No Digital Presence</option>
                </select>
              </div>

              {/* Has Phone */}
              <div className="space-y-1.5 sm:col-span-1">
                <label htmlFor="filter-has-phone" className="block text-xs font-medium text-slate-300">
                  Has Phone
                </label>
                <select
                  id="filter-has-phone"
                  value={draftFilters.hasPhone}
                  onChange={(e) =>
                    setDraftFilters((prev) => ({ ...prev, hasPhone: e.target.value as 'ALL' | 'true' | 'false' }))
                  }
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                >
                  <option value="ALL">All Records</option>
                  <option value="true">Has Phone</option>
                  <option value="false">No Phone</option>
                </select>
              </div>

              {/* Has Email */}
              <div className="space-y-1.5 sm:col-span-1">
                <label htmlFor="filter-has-email" className="block text-xs font-medium text-slate-300">
                  Has Email
                </label>
                <select
                  id="filter-has-email"
                  value={draftFilters.hasEmail}
                  onChange={(e) =>
                    setDraftFilters((prev) => ({ ...prev, hasEmail: e.target.value as 'ALL' | 'true' | 'false' }))
                  }
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                >
                  <option value="ALL">All Records</option>
                  <option value="true">Has Email</option>
                  <option value="false">No Email</option>
                </select>
              </div>

              {/* Has WhatsApp */}
              <div className="space-y-1.5 sm:col-span-1">
                <label htmlFor="filter-has-whatsapp" className="block text-xs font-medium text-slate-300">
                  Has WhatsApp
                </label>
                <select
                  id="filter-has-whatsapp"
                  value={draftFilters.hasWhatsApp}
                  onChange={(e) =>
                    setDraftFilters((prev) => ({ ...prev, hasWhatsApp: e.target.value as 'ALL' | 'true' | 'false' }))
                  }
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                >
                  <option value="ALL">All Records</option>
                  <option value="true">Has WhatsApp</option>
                  <option value="false">No WhatsApp</option>
                </select>
              </div>
            </div>

            {/* Filter Action Buttons */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
              <div className="text-xs text-slate-400">
                {listState.hasLoaded && !listState.isLoading && (
                  <span>
                    Found <strong className="text-slate-200">{listState.total}</strong> total leads matching query
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-900 hover:bg-slate-800 rounded-lg border border-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset</span>
                  </button>
                )}

                <button
                  type="submit"
                  id="leads-filter-submit-btn"
                  disabled={listState.isLoading}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 disabled:opacity-60 rounded-lg shadow-sm shadow-indigo-500/20 transition-all flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                >
                  {listState.isLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Filtering Leads...</span>
                    </>
                  ) : (
                    <>
                      <Filter className="w-3.5 h-3.5" />
                      <span>Apply Filters</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Global Error Banner */}
        {listState.error && (
          <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/50 text-red-300 text-xs flex items-start justify-between gap-3 shadow-sm">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold text-red-200">
                  {listState.error.statusCode === 401 ? 'Session Expired' : 'Query Failed'}
                </div>
                <div className="mt-0.5 text-red-300">
                  {listState.error.statusCode === 401
                    ? 'Your session has expired. Please sign in again.'
                    : listState.error.message}
                </div>
                {listState.error.code && (
                  <div className="mt-1 font-mono text-[10px] text-red-400 uppercase">
                    Error Code: {listState.error.code}
                  </div>
                )}
              </div>
            </div>
            {listState.error.statusCode === 401 ? (
              <Link
                href="/login"
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shrink-0 transition-colors"
              >
                Sign In
              </Link>
            ) : listState.error.requestId ? (
              <div className="text-[10px] font-mono bg-red-900/40 px-2 py-1 rounded text-red-300 shrink-0 border border-red-800/30">
                Reference: {listState.error.requestId}
              </div>
            ) : null}
          </div>
        )}

        {/* Leads Table / Cards Container */}
        <div className="space-y-4">
          {/* Initial Loading Skeleton */}
          {listState.isLoading && (
            <div className="p-12 rounded-xl bg-slate-950/40 border border-slate-800/60 text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mx-auto" />
              <div className="text-xs font-semibold text-slate-200">Loading master lead records...</div>
              <p className="text-[11px] text-slate-500">Traversing tenant partition with cursor integrity.</p>
            </div>
          )}

          {/* Empty States */}
          {!listState.isLoading && listState.hasLoaded && !listState.error && listState.leads.length === 0 && (
            <div className="p-8 rounded-xl bg-slate-950/40 border border-slate-800/60 text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
                <Users className="w-6 h-6" />
              </div>
              <h2 className="text-sm font-semibold text-slate-200">
                {hasActiveFilters ? 'No leads match these filters.' : 'No leads found.'}
              </h2>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                {hasActiveFilters
                  ? 'Try clearing your search terms or relaxing category and channel filters.'
                  : 'Start discovering verified businesses from directory sources using Business Search.'}
              </p>
              <div className="pt-2 flex justify-center gap-2">
                {hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="px-3 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors cursor-pointer"
                  >
                    Clear All Filters
                  </button>
                ) : (
                  <Link
                    href="/business-search"
                    className="px-3.5 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors inline-flex items-center gap-1.5"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>Go to Business Search</span>
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Results Table (Desktop) & Cards (Mobile) */}
          {!listState.isLoading && listState.leads.length > 0 && (
            <div className="space-y-4">
              {/* Desktop View: Structured Table */}
              <div className="hidden lg:block overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950/70 shadow-lg">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-900/80 border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <tr>
                      <th scope="col" className="py-3.5 px-4">Business & Category</th>
                      <th scope="col" className="py-3.5 px-4">Location</th>
                      <th scope="col" className="py-3.5 px-4">Direct Contacts</th>
                      <th scope="col" className="py-3.5 px-4">Online Presence</th>
                      <th scope="col" className="py-3.5 px-4">Source & Date</th>
                      <th scope="col" className="py-3.5 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-normal">
                    {listState.leads.map((lead) => {
                      const safeWebsite = getSafeExternalUrl(lead.website);
                      return (
                        <tr key={lead.id} className="hover:bg-slate-900/40 transition-colors">
                          {/* Name & Category */}
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-slate-100 hover:text-indigo-300 transition-colors">
                              <Link href={`/leads/${lead.id}`} className="hover:underline">
                                {lead.name}
                              </Link>
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                              <span className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 font-medium">
                                {lead.category || '—'}
                              </span>
                              {lead.rating !== null && lead.rating !== undefined && (
                                <span className="text-amber-400 font-medium">★ {lead.rating.toFixed(1)}</span>
                              )}
                            </div>
                          </td>

                          {/* Location */}
                          <td className="py-3.5 px-4">
                            <div className="text-slate-200">{lead.city}</div>
                            <div className="text-[11px] text-slate-500">{lead.locality || lead.region || '—'}</div>
                          </td>

                          {/* Direct Contacts */}
                          <td className="py-3.5 px-4">
                            <div className="space-y-1">
                              {lead.primaryPhone ? (
                                <div className="flex items-center gap-1.5 text-slate-300 font-mono text-[11px]">
                                  <Phone className="w-3 h-3 text-indigo-400 shrink-0" />
                                  <span>{lead.primaryPhone}</span>
                                </div>
                              ) : (
                                <span className="text-slate-500 text-[11px]">—</span>
                              )}
                              {lead.primaryEmail && (
                                <div className="flex items-center gap-1.5 text-slate-400 text-[11px]">
                                  <Mail className="w-3 h-3 text-sky-400 shrink-0" />
                                  <span className="truncate max-w-[160px]">{lead.primaryEmail}</span>
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Online Presence & Website */}
                          <td className="py-3.5 px-4">
                            <div className="space-y-1">
                              {safeWebsite ? (
                                <a
                                  href={safeWebsite.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 hover:underline text-[11px] transition-colors"
                                  title={`Visit ${safeWebsite.href}`}
                                >
                                  <Globe className="w-3 h-3 shrink-0" />
                                  <span className="truncate max-w-[140px]">{safeWebsite.label}</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              ) : (
                                <span className="text-slate-500 text-[11px]">—</span>
                              )}
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                                  {lead.onlinePresenceType}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Source & Created Date */}
                          <td className="py-3.5 px-4 text-[11px] text-slate-400">
                            <div className="font-mono text-slate-300">{lead.primarySource}</div>
                            <div className="text-[10px] text-slate-500">
                              {formatDate(lead.createdAt)}
                            </div>
                          </td>

                          {/* Action */}
                          <td className="py-3.5 px-4 text-right">
                            <Link
                              href={`/leads/${lead.id}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 transition-colors"
                            >
                              <span>View</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile View: Stacked Cards */}
              <div className="lg:hidden space-y-3">
                {listState.leads.map((lead) => {
                  const safeWebsite = getSafeExternalUrl(lead.website);
                  return (
                    <div
                      key={lead.id}
                      className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 shadow-sm space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <Link
                            href={`/leads/${lead.id}`}
                            className="text-sm font-bold text-white hover:text-indigo-400 transition-colors"
                          >
                            {lead.name}
                          </Link>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-slate-300 font-medium">
                              {lead.category || '—'}
                            </span>
                            <span className="text-xs text-slate-400">{lead.city}</span>
                          </div>
                        </div>

                        <Link
                          href={`/leads/${lead.id}`}
                          className="px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shrink-0"
                        >
                          View
                        </Link>
                      </div>

                      <div className="space-y-1 text-xs text-slate-300 pt-2 border-t border-slate-800/60">
                        {lead.primaryPhone && (
                          <div className="flex items-center gap-2 font-mono">
                            <Phone className="w-3.5 h-3.5 text-indigo-400" />
                            <span>{lead.primaryPhone}</span>
                          </div>
                        )}
                        {lead.primaryEmail && (
                          <div className="flex items-center gap-2">
                            <Mail className="w-3.5 h-3.5 text-sky-400" />
                            <span className="truncate">{lead.primaryEmail}</span>
                          </div>
                        )}
                        {safeWebsite && (
                          <div className="flex items-center gap-2">
                            <Globe className="w-3.5 h-3.5 text-indigo-400" />
                            <a
                              href={safeWebsite.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-400 hover:underline truncate"
                            >
                              {safeWebsite.label}
                            </a>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-2 border-t border-slate-900">
                        <span>Source: {lead.primarySource}</span>
                        <span>{formatDate(lead.createdAt)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Load More Inline Error */}
              {listState.loadMoreError && (
                <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/50 text-red-300 text-xs flex items-center justify-between gap-3 shadow-sm">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    <span>{listState.loadMoreError.message}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    className="px-2.5 py-1 text-xs font-medium rounded bg-red-900/60 hover:bg-red-900 text-red-200 border border-red-700 transition-colors cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Cursor Pagination: Load More */}
              {listState.hasMore && (
                <div className="pt-4 pb-8 flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={listState.isLoadingMore || listState.isLoading}
                    className="px-5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-xl border border-slate-700 shadow-md transition-all flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {listState.isLoadingMore ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                        <span>Loading Next Page...</span>
                      </>
                    ) : (
                      <>
                        <span>Load More Leads</span>
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                      </>
                    )}
                  </button>
                  <div className="text-[11px] text-slate-500 font-mono">
                    Showing {listState.leads.length} of {listState.total} total leads
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
