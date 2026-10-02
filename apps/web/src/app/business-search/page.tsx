'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Building2,
  MapPin,
  Phone,
  Mail,
  MessageSquare,
  Globe,
  Star,
  BookmarkPlus,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  ExternalLink,
  RotateCcw,
  Sparkles,
  Database,
  Info
} from 'lucide-react';
import {
  type BusinessSearchResult,
  type DiscoveredContact,
  ContactType,
  WhatsAppStatus,
  DuplicateAction,
  Permissions
} from '@leadmate/shared';
import { useAuth } from '@/lib/auth-context';
import { AppShell } from '@/components/layout/app-shell';
import { apiClient, ApiClientError } from '@/lib/api-client';

interface RowSaveState {
  status: 'idle' | 'saving' | 'created' | 'merged' | 'candidate' | 'conflict' | 'error';
  message?: string;
  requestId?: string;
}

/**
 * Safely parses and sanitizes external URLs.
 * Rejects javascript:, data:, and malformed protocols.
 */
function getSafeExternalUrl(url?: string | null): { href: string; label: string } | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const formatted = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`;
    const parsed = new URL(formatted);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return {
        href: parsed.href,
        label: parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '')
      };
    }
    return null;
  } catch {
    return null;
  }
}

export default function BusinessSearchPage() {
  const { user, isAuthenticated, isLoading: isAuthLoading, hasPermission } = useAuth();
  const router = useRouter();

  const canReadLeads = hasPermission(Permissions.LEADS_READ);
  const canWriteLeads = hasPermission(Permissions.LEADS_WRITE);

  // Search form state
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('');
  const [limit, setLimit] = useState(50);
  const [provider, setProvider] = useState('MOCK');

  // Search execution state
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [results, setResults] = useState<BusinessSearchResult[] | null>(null);
  const [searchError, setSearchError] = useState<{
    message: string;
    code?: string;
    requestId?: string;
  } | null>(null);

  // Per-row save state tracked by `provider:externalId`
  const [saveStates, setSaveStates] = useState<Record<string, RowSaveState>>({});

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthLoading, isAuthenticated, router]);

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
        <div className="max-w-2xl mx-auto mt-12 p-8 rounded-xl bg-slate-950/70 border border-slate-800 text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-400">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-semibold text-slate-200">Access Restricted</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            Your account does not have permission (<code className="text-indigo-400 font-mono">leads:read</code>) to access Business Search. Please contact your administrator.
          </p>
        </div>
      </AppShell>
    );
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedQ = query.trim();
    const trimmedLoc = location.trim();

    if (!trimmedQ || !trimmedLoc) {
      setSearchError({
        message: 'Please provide both a search query and a location.'
      });
      return;
    }

    try {
      setIsSearching(true);
      setSearchError(null);
      // Reset row save states when executing a fresh search
      setSaveStates({});

      const data = await apiClient.businessSearch.search({
        q: trimmedQ,
        location: trimmedLoc,
        category: category.trim() || undefined,
        limit,
        provider: provider.trim() || undefined
      });

      setResults(data);
      setHasSearched(true);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setSearchError({
          message: err.message || 'An error occurred while searching businesses.',
          code: err.code,
          requestId: err.requestId
        });
      } else {
        setSearchError({
          message: 'Unable to connect to business search service. Please check your network and try again.'
        });
      }
      setResults(null);
    } finally {
      setIsSearching(false);
    }
  };

  const handleReset = () => {
    setQuery('');
    setLocation('');
    setCategory('');
    setLimit(50);
    setProvider('MOCK');
    setResults(null);
    setHasSearched(false);
    setSearchError(null);
    setSaveStates({});
  };

  const handleSaveLead = async (item: BusinessSearchResult) => {
    if (!canWriteLeads) {
      return;
    }

    const key = `${item.provider}:${item.externalId}`;
    const currentState = saveStates[key]?.status;

    // Prevent duplicate clicks while pending or already saved
    if (currentState === 'saving' || currentState === 'created' || currentState === 'merged') {
      return;
    }

    setSaveStates((prev) => ({
      ...prev,
      [key]: { status: 'saving' }
    }));

    try {
      // Critical security boundary: Client submits ONLY provider + externalId
      const res = await apiClient.businessSearch.saveLead({
        provider: item.provider,
        externalId: item.externalId
      });

      if (res.action === DuplicateAction.CREATED) {
        setSaveStates((prev) => ({
          ...prev,
          [key]: {
            status: 'created',
            message: 'Lead saved successfully.'
          }
        }));
      } else if (res.action === DuplicateAction.MERGED) {
        setSaveStates((prev) => ({
          ...prev,
          [key]: {
            status: 'merged',
            message: 'Existing lead updated with this source.'
          }
        }));
      } else {
        setSaveStates((prev) => ({
          ...prev,
          [key]: {
            status: 'created',
            message: 'Lead saved successfully.'
          }
        }));
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.statusCode === 409) {
          const details = err.details as Record<string, unknown> | undefined;
          const action = details?.action;

          if (action === DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION) {
            setSaveStates((prev) => ({
              ...prev,
              [key]: {
                status: 'candidate',
                message: 'Possible duplicate found. Manual confirmation is required.',
                requestId: err.requestId
              }
            }));
          } else if (action === 'DEFINITE_MATCH_CONFLICT' || err.code === 'CONFLICT') {
            setSaveStates((prev) => ({
              ...prev,
              [key]: {
                status: 'conflict',
                message: 'Conflicting duplicate signals were detected. No lead was changed.',
                requestId: err.requestId
              }
            }));
          } else {
            setSaveStates((prev) => ({
              ...prev,
              [key]: {
                status: 'candidate',
                message: err.message || 'Possible duplicate found. Manual confirmation is required.',
                requestId: err.requestId
              }
            }));
          }
        } else {
          setSaveStates((prev) => ({
            ...prev,
            [key]: {
              status: 'error',
              message: err.message || 'Failed to save lead.',
              requestId: err.requestId
            }
          }));
        }
      } else {
        setSaveStates((prev) => ({
          ...prev,
          [key]: {
            status: 'error',
            message: 'Network error while saving lead. Please try again.'
          }
        }));
      }
    }
  };

  const renderContactBadge = (contact: DiscoveredContact, idx: number) => {
    switch (contact.type) {
      case ContactType.PHONE:
        return (
          <div
            key={idx}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-xs text-slate-300"
            title={`Phone: ${contact.rawValue}`}
          >
            <Phone className="w-3.5 h-3.5 text-indigo-400" />
            <span className="font-mono">{contact.rawValue}</span>
          </div>
        );

      case ContactType.EMAIL:
        return (
          <div
            key={idx}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-xs text-slate-300"
            title={`Email: ${contact.rawValue}`}
          >
            <Mail className="w-3.5 h-3.5 text-sky-400" />
            <span className="truncate max-w-[200px]">{contact.rawValue}</span>
          </div>
        );

      case ContactType.WHATSAPP: {
        const isPublic = contact.whatsappStatus === WhatsAppStatus.PUBLICLY_LISTED;
        const isConfirmed = contact.whatsappStatus === WhatsAppStatus.CONFIRMED;

        return (
          <div
            key={idx}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border ${
              isPublic || isConfirmed
                ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300'
                : 'bg-slate-900 border-slate-800 text-slate-300'
            }`}
            title={`WhatsApp: ${contact.rawValue} (${contact.whatsappStatus})`}
          >
            <MessageSquare
              className={`w-3.5 h-3.5 ${isPublic || isConfirmed ? 'text-emerald-400' : 'text-slate-400'}`}
            />
            <span className="font-mono">{contact.rawValue}</span>
            {isPublic && (
              <span className="text-[10px] px-1 py-0.2 rounded bg-emerald-900/60 text-emerald-300 font-sans">
                Listed
              </span>
            )}
            {isConfirmed && (
              <span className="text-[10px] px-1 py-0.2 rounded bg-emerald-900/60 text-emerald-300 font-sans">
                Confirmed
              </span>
            )}
            {!isPublic && !isConfirmed && (
              <span className="text-[10px] px-1 py-0.2 rounded bg-slate-800 text-slate-400 font-sans">
                Unverified
              </span>
            )}
          </div>
        );
      }

      default:
        return (
          <div
            key={idx}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 text-xs text-slate-400 border border-slate-800"
          >
            <span>{contact.rawValue}</span>
          </div>
        );
    }
  };

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Discovery Engine
              </span>
              <span className="text-xs text-slate-400">Milestone M1</span>
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
              <Search className="w-6 h-6 text-indigo-400" />
              Business Search
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Discover verified business listings across Bangladesh directories and save them directly to your master lead database.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800 self-start sm:self-auto">
            <Database className="w-4 h-4 text-indigo-400" />
            <span>Active Datasource:</span>
            <span className="font-semibold text-slate-200">Mock Provider (Standard)</span>
          </div>
        </div>

        {/* Search Form Card */}
        <div className="p-5 rounded-xl bg-slate-950/70 border border-slate-800/80 shadow-lg">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Keyword / Name Query */}
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
                <label htmlFor="search-q" className="block text-xs font-medium text-slate-300">
                  Business Query <span className="text-indigo-400">*</span>
                </label>
                <div className="relative">
                  <input
                    id="search-q"
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="e.g. Dental Clinic, Steel, Bakery"
                    required
                    disabled={isSearching}
                    className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Location */}
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
                <label htmlFor="search-location" className="block text-xs font-medium text-slate-300">
                  Location / City <span className="text-indigo-400">*</span>
                </label>
                <div className="relative">
                  <input
                    id="search-location"
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g. Dhaka, Gulshan, Chittagong"
                    required
                    disabled={isSearching}
                    className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Category (Optional) */}
              <div className="space-y-1.5 sm:col-span-1">
                <label htmlFor="search-category" className="block text-xs font-medium text-slate-300">
                  Category <span className="text-slate-500">(Optional)</span>
                </label>
                <input
                  id="search-category"
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Dental Clinic, Retail"
                  disabled={isSearching}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all disabled:opacity-50"
                />
              </div>

              {/* Limit */}
              <div className="space-y-1.5 sm:col-span-1">
                <label htmlFor="search-limit" className="block text-xs font-medium text-slate-300">
                  Result Limit
                </label>
                <select
                  id="search-limit"
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  disabled={isSearching}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all disabled:opacity-50"
                >
                  <option value={10}>10 results</option>
                  <option value={20}>20 results</option>
                  <option value={50}>50 results</option>
                  <option value={100}>100 results</option>
                  <option value={200}>200 results</option>
                </select>
              </div>
            </div>

            {/* Form Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-slate-400" />
                <span>Search results are previewed securely before writing to database.</span>
              </div>

              <div className="flex items-center gap-2">
                {hasSearched && (
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={isSearching}
                    className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-900 hover:bg-slate-800 rounded-lg border border-slate-700 transition-colors flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset</span>
                  </button>
                )}

                <button
                  type="submit"
                  id="business-search-submit-btn"
                  disabled={isSearching}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 disabled:opacity-60 rounded-lg shadow-sm shadow-indigo-500/20 transition-all flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                >
                  {isSearching ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Searching Directories...</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      <span>Search Businesses</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Global Search Error Banner */}
        {searchError && (
          <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/50 text-red-300 text-xs flex items-start justify-between gap-3 shadow-sm">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold text-red-200">Search Failed</div>
                <div className="mt-0.5 text-red-300">{searchError.message}</div>
                {searchError.code && (
                  <div className="mt-1 font-mono text-[10px] text-red-400 uppercase">
                    Error Code: {searchError.code}
                  </div>
                )}
              </div>
            </div>
            {searchError.requestId && (
              <div className="text-[10px] font-mono bg-red-900/40 px-2 py-1 rounded text-red-300 shrink-0 border border-red-800/30">
                Reference: {searchError.requestId}
              </div>
            )}
          </div>
        )}

        {/* Search Results Area */}
        <div>
          {/* 1. Initial State before search */}
          {!hasSearched && !isSearching && (
            <div className="p-8 rounded-xl bg-slate-950/40 border border-slate-800/60 text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto text-indigo-400 shadow-sm">
                <Sparkles className="w-6 h-6" />
              </div>
              <h2 className="text-sm font-semibold text-slate-200">
                Search for businesses by name, category, or location.
              </h2>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Discover local dental clinics, steel distributors, bakeries, and retail businesses in Dhaka, Gulshan, Chittagong, and across Bangladesh.
              </p>
              <div className="pt-2 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setQuery('Dental');
                    setLocation('Dhaka');
                  }}
                  className="px-2.5 py-1 text-[11px] rounded-md bg-slate-900 border border-slate-800 text-slate-400 hover:text-indigo-300 hover:border-indigo-500/40 transition-colors"
                >
                  Try &quot;Dental in Dhaka&quot;
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuery('Steel');
                    setLocation('Chittagong');
                  }}
                  className="px-2.5 py-1 text-[11px] rounded-md bg-slate-900 border border-slate-800 text-slate-400 hover:text-indigo-300 hover:border-indigo-500/40 transition-colors"
                >
                  Try &quot;Steel in Chittagong&quot;
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuery('Bakery');
                    setLocation('Mirpur');
                  }}
                  className="px-2.5 py-1 text-[11px] rounded-md bg-slate-900 border border-slate-800 text-slate-400 hover:text-indigo-300 hover:border-indigo-500/40 transition-colors"
                >
                  Try &quot;Bakery in Mirpur&quot;
                </button>
              </div>
            </div>
          )}

          {/* 2. Loading State */}
          {isSearching && (
            <div className="p-12 rounded-xl bg-slate-950/40 border border-slate-800/60 text-center space-y-4">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mx-auto" />
              <div className="text-xs font-semibold text-slate-200">Querying provider directories...</div>
              <p className="text-[11px] text-slate-500">Normalizing addresses and formatting discovered contacts.</p>
            </div>
          )}

          {/* 3. Empty State (Zero Results) */}
          {hasSearched && !isSearching && results !== null && results.length === 0 && (
            <div className="p-8 rounded-xl bg-slate-950/40 border border-slate-800/60 text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
                <Search className="w-6 h-6" />
              </div>
              <h2 className="text-sm font-semibold text-slate-200">No businesses found for this search.</h2>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Try adjusting your search keyword or selecting a broader location (e.g., &quot;Dhaka&quot; instead of a specific road).
              </p>
            </div>
          )}

          {/* 4. Results List */}
          {hasSearched && !isSearching && results !== null && results.length > 0 && (
            <div className="space-y-4">
              {/* Summary Bar */}
              <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                <div>
                  Discovered <span className="font-semibold text-slate-200">{results.length}</span> business listings for &quot;<span className="text-slate-200">{query}</span>&quot; in &quot;<span className="text-slate-200">{location}</span>&quot;
                </div>
                <div className="text-[11px] text-slate-500">
                  Source: {provider}
                </div>
              </div>

              {/* Cards Grid / Stack */}
              <div className="space-y-3" id="business-search-results-list">
                {results.map((item) => {
                  const key = `${item.provider}:${item.externalId}`;
                  const saveState = saveStates[key] || { status: 'idle' };
                  const isSaving = saveState.status === 'saving';

                  return (
                    <div
                      key={key}
                      className="p-4 sm:p-5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700/80 transition-all shadow-sm space-y-3"
                    >
                      {/* Top Row: Name, Category, Rating & Save Action */}
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">
                              {item.name}
                            </h3>
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-slate-300 font-medium">
                              {item.category || '—'}
                            </span>
                            {item.rating !== undefined && (
                              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300">
                                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                                <span className="font-semibold">{item.rating.toFixed(1)}</span>
                                {item.reviewCount !== undefined && (
                                  <span className="text-amber-400/70">({item.reviewCount})</span>
                                )}
                              </span>
                            )}
                          </div>

                          {/* Location & Website */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 pt-0.5">
                            <div className="flex items-center gap-1">
                              <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                              <span>
                                {[item.address, item.locality, item.city, item.country].filter(Boolean).join(', ') || '—'}
                              </span>
                            </div>

                            {(() => {
                              const safeUrl = getSafeExternalUrl(item.website);
                              return safeUrl ? (
                                <a
                                  href={safeUrl.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 hover:underline transition-colors"
                                  title={`Visit ${safeUrl.href}`}
                                >
                                  <Globe className="w-3.5 h-3.5 shrink-0" />
                                  <span className="truncate max-w-[200px]">{safeUrl.label}</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : (
                                <div className="flex items-center gap-1 text-slate-500">
                                  <Globe className="w-3.5 h-3.5 shrink-0" />
                                  <span>—</span>
                                </div>
                              );
                            })()}
                          </div>
                        </div>

                        {/* Save Lead Button */}
                        <div className="shrink-0 self-start">
                          {saveState.status === 'created' ? (
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 text-xs font-medium">
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              <span>Lead saved successfully.</span>
                            </div>
                          ) : saveState.status === 'merged' ? (
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-950/40 border border-indigo-800/50 text-indigo-300 text-xs font-medium">
                              <CheckCircle2 className="w-4 h-4 text-indigo-400" />
                              <span>Existing lead updated with this source.</span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleSaveLead(item)}
                              disabled={isSaving || !canWriteLeads}
                              title={!canWriteLeads ? 'Requires leads:write permission' : undefined}
                              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800/60 disabled:opacity-60 rounded-lg shadow-sm shadow-indigo-500/20 transition-all flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                            >
                              {isSaving ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  <span>Saving...</span>
                                </>
                              ) : (
                                <>
                                  <BookmarkPlus className="w-3.5 h-3.5" />
                                  <span>Save Lead</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Contacts List */}
                      {item.contacts && item.contacts.length > 0 && (
                        <div className="pt-2 border-t border-slate-800/60">
                          <div className="text-[11px] font-medium text-slate-500 mb-1.5">
                            Discovered Contacts ({item.contacts.length}):
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {item.contacts.map((c, cIdx) => renderContactBadge(c, cIdx))}
                          </div>
                        </div>
                      )}

                      {/* Description if present */}
                      {item.description && (
                        <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">
                          {item.description}
                        </p>
                      )}

                      {/* Conflict / Candidate / Error Feedback Alert for this row */}
                      {saveState.status === 'candidate' && (
                        <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/40 text-amber-300 text-xs flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                            <div>
                              <div className="font-semibold text-amber-200">Possible Duplicate</div>
                              <div className="mt-0.5">{saveState.message}</div>
                            </div>
                          </div>
                          {saveState.requestId && (
                            <span className="text-[10px] font-mono bg-amber-900/40 px-1.5 py-0.5 rounded text-amber-300 border border-amber-800/30 shrink-0">
                              Ref: {saveState.requestId}
                            </span>
                          )}
                        </div>
                      )}

                      {saveState.status === 'conflict' && (
                        <div className="p-3 rounded-lg bg-purple-950/30 border border-purple-800/40 text-purple-300 text-xs flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                            <div>
                              <div className="font-semibold text-purple-200">Conflict Detected</div>
                              <div className="mt-0.5">{saveState.message}</div>
                            </div>
                          </div>
                          {saveState.requestId && (
                            <span className="text-[10px] font-mono bg-purple-900/40 px-1.5 py-0.5 rounded text-purple-300 border border-purple-800/30 shrink-0">
                              Ref: {saveState.requestId}
                            </span>
                          )}
                        </div>
                      )}

                      {saveState.status === 'error' && (
                        <div className="p-3 rounded-lg bg-red-950/30 border border-red-800/40 text-red-300 text-xs flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                            <div>
                              <div className="font-semibold text-red-200">Save Failed</div>
                              <div className="mt-0.5">{saveState.message}</div>
                            </div>
                          </div>
                          {saveState.requestId && (
                            <span className="text-[10px] font-mono bg-red-900/40 px-1.5 py-0.5 rounded text-red-300 border border-red-800/30 shrink-0">
                              Ref: {saveState.requestId}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Footer Metadata: External ID & Provider */}
                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-900">
                        <span className="font-mono">
                          ID: {item.externalId} • Provider: {item.provider}
                        </span>
                        {(() => {
                          const safeSourceUrl = getSafeExternalUrl(item.sourceUrl);
                          return safeSourceUrl ? (
                            <a
                              href={safeSourceUrl.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-300"
                            >
                              <span>Provider Listing</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
