'use client';

import React, { useState, useEffect, useRef } from 'react';
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
  Info,
  SlidersHorizontal,
  Eye
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
import { apiClient, ApiClientError, type LocationSuggestionItem } from '@/lib/api-client';

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

const QUICK_SEARCH_CHIPS = [
  { label: 'Pharmacies in Dhaka', q: 'Pharmacy', location: 'Dhaka', buyerType: 'RETAILER', category: 'Pharmacy' },
  { label: 'Electronics Shops in Mirpur', q: 'Smart Watch', location: 'Mirpur', buyerType: 'RETAILER', category: 'Electronics' },
  { label: 'Medical Distributors in Chattogram', q: 'Diabetes Machine', location: 'Chattogram', buyerType: 'DISTRIBUTOR', category: 'Medical Supplies' },
  { label: 'Retailers in Gulshan', q: 'General Retail', location: 'Gulshan', buyerType: 'RETAILER', category: 'Retail' }
];

export default function BusinessSearchPage() {
  const { user, isAuthenticated, isLoading: isAuthLoading, hasPermission } = useAuth();
  const router = useRouter();

  const canReadLeads = hasPermission(Permissions.LEADS_READ);
  const canWriteLeads = hasPermission(Permissions.LEADS_WRITE);

  // Search form state
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [buyerType, setBuyerType] = useState('ANY');
  const [category, setCategory] = useState('');
  const [showAdvancedCategory, setShowAdvancedCategory] = useState(false);
  const [limit, setLimit] = useState(20);
  const [provider, setProvider] = useState('AUTO');

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

  // Expanded card key for "View Details"
  const [expandedCardKey, setExpandedCardKey] = useState<string | null>(null);

  // Location Autocomplete state
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestionItem[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const locationContainerRef = useRef<HTMLDivElement>(null);
  const locationAbortRef = useRef<AbortController | null>(null);

  // AI Buyer Discovery state
  const [isGeneratingAiTargets, setIsGeneratingAiTargets] = useState(false);
  const [aiTargetCategories, setAiTargetCategories] = useState<Array<{ name: string; relevance: 'HIGH' | 'MEDIUM' | 'LOW'; rationale?: string; selected: boolean }>>([]);
  const [aiTargetsError, setAiTargetsError] = useState<string | null>(null);

  // Per-card AI Fit Explanation state tracked by `provider:externalId`
  const [aiFitExplanations, setAiFitExplanations] = useState<Record<string, {
    status: 'idle' | 'loading' | 'success' | 'error';
    fitLevel?: 'HIGH' | 'MEDIUM' | 'LOW';
    explanation?: string;
    keyFactors?: string[];
    isAiGenerated?: boolean;
    error?: string;
  }>>({});

  // Debounced location suggestion fetcher (350ms, >= 3 chars)
  useEffect(() => {
    const trimmed = location.trim();
    if (trimmed.length < 3) {
      setLocationSuggestions([]);
      setShowSuggestions(false);
      setIsLoadingSuggestions(false);
      setSuggestionsError(null);
      setHighlightedIndex(-1);
      return;
    }

    const timer = setTimeout(async () => {
      if (locationAbortRef.current) {
        locationAbortRef.current.abort();
      }
      const controller = new AbortController();
      locationAbortRef.current = controller;

      setIsLoadingSuggestions(true);
      setSuggestionsError(null);

      try {
        const items = await apiClient.locations.suggest(trimmed, 6, {
          signal: controller.signal
        });
        setLocationSuggestions(items);
        setShowSuggestions(true);
        setHighlightedIndex(-1);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setSuggestionsError('Location suggestions unavailable — you can still type manually.');
          setShowSuggestions(true);
        }
      } finally {
        setIsLoadingSuggestions(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [location]);

  // Close suggestions dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (locationContainerRef.current && !locationContainerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectSuggestion = (suggestion: LocationSuggestionItem) => {
    setLocation(suggestion.label);
    setShowSuggestions(false);
    setLocationSuggestions([]);
    setHighlightedIndex(-1);
  };

  const handleLocationKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions) {
      if (e.key === 'ArrowDown' && locationSuggestions.length > 0) {
        setShowSuggestions(true);
        setHighlightedIndex(0);
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < locationSuggestions.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : locationSuggestions.length - 1
      );
    } else if (e.key === 'Enter') {
      if (highlightedIndex >= 0 && locationSuggestions[highlightedIndex]) {
        e.preventDefault();
        handleSelectSuggestion(locationSuggestions[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowSuggestions(false);
    }
  };

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

  const handleApplyChip = (chip: typeof QUICK_SEARCH_CHIPS[0]) => {
    setQuery(chip.q);
    setLocation(chip.location);
    setBuyerType(chip.buyerType);
    if (chip.category) {
      setCategory(chip.category);
    }
    setShowSuggestions(false);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedQ = query.trim();
    const trimmedLoc = location.trim();

    if (!trimmedQ || !trimmedLoc) {
      setSearchError({
        message: 'Please provide both what you are selling and the target location.'
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
        buyerType: buyerType !== 'ANY' ? buyerType : undefined,
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
    setBuyerType('ANY');
    setShowAdvancedCategory(false);
    setLimit(20);
    setProvider('AUTO');
    setResults(null);
    setHasSearched(false);
    setSearchError(null);
    setSaveStates({});
    setExpandedCardKey(null);
    setShowSuggestions(false);
    setLocationSuggestions([]);
    setHighlightedIndex(-1);
    setAiTargetCategories([]);
    setAiTargetsError(null);
    setAiFitExplanations({});
  };

  const handleGenerateAiTargets = async () => {
    const trimmedQ = query.trim();
    if (!trimmedQ) {
      setAiTargetsError('Please enter what you are selling first.');
      return;
    }

    try {
      setIsGeneratingAiTargets(true);
      setAiTargetsError(null);

      const res = await apiClient.suggestBuyerTargets({
        product: trimmedQ,
        location: location.trim() || undefined,
        count: 6
      });

      if (res && res.categories && res.categories.length > 0) {
        setAiTargetCategories(
          res.categories.map((c: any) => ({
            name: c.name,
            relevance: c.relevance || 'HIGH',
            rationale: c.rationale,
            selected: true
          }))
        );
      }
    } catch (err: any) {
      setAiTargetsError(err?.message || 'Could not generate AI buyer suggestions. Check AI settings.');
    } finally {
      setIsGeneratingAiTargets(false);
    }
  };

  const handleToggleCategoryChip = (catName: string) => {
    setAiTargetCategories((prev) =>
      prev.map((c) => (c.name === catName ? { ...c, selected: !c.selected } : c))
    );
  };

  const handleApplyCategoryAsOverride = (catName: string) => {
    setCategory(catName);
    setShowAdvancedCategory(true);
  };

  const handleExplainBuyerFit = async (item: BusinessSearchResult) => {
    const key = `${item.provider}:${item.externalId}`;
    setAiFitExplanations((prev) => ({
      ...prev,
      [key]: { status: 'loading' }
    }));

    try {
      const res = await apiClient.explainBuyerFit({
        businessName: item.name,
        category: item.category,
        query: query.trim() || 'General Business',
        location: item.city || location.trim() || 'Dhaka',
        signals: (item as any).signals
      });

      setAiFitExplanations((prev) => ({
        ...prev,
        [key]: {
          status: 'success',
          fitLevel: res.fitLevel,
          explanation: res.explanation,
          keyFactors: res.keyFactors,
          isAiGenerated: true
        }
      }));
    } catch (err: any) {
      setAiFitExplanations((prev) => ({
        ...prev,
        [key]: {
          status: 'error',
          error: err?.message || 'Could not explain buyer fit.'
        }
      }));
    }
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
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700/80 text-xs text-slate-200"
          >
            <Phone className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="font-mono">{contact.rawValue}</span>
            {contact.whatsappStatus === WhatsAppStatus.CONFIRMED ? (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-medium">
                Confirmed
              </span>
            ) : contact.whatsappStatus === WhatsAppStatus.PUBLICLY_LISTED ? (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 font-medium">
                Listed
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-medium">
                Unverified
              </span>
            )}
          </div>
        );

      case ContactType.EMAIL:
        return (
          <div
            key={idx}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700/80 text-xs text-slate-200"
          >
            <Mail className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="font-mono">{contact.rawValue}</span>
          </div>
        );

      case ContactType.WHATSAPP:
        return (
          <div
            key={idx}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-200"
          >
            <MessageSquare className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="font-mono">{contact.rawValue}</span>
            <span className="text-[10px] font-medium text-emerald-400">Verified WhatsApp</span>
          </div>
        );

      default:
        return (
          <div
            key={idx}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 text-xs text-slate-400"
          >
            <span>{contact.rawValue}</span>
          </div>
        );
    }
  };

  const getStrategyLabel = () => {
    switch (provider) {
      case 'AUTO':
        return 'Auto — Free First';
      case 'OPENSTREETMAP':
        return 'OpenStreetMap — Free';
      case 'GOOGLE_PLACES':
        return 'Google Places — Verified';
      case 'MOCK':
      default:
        return 'Mock — Development';
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header & Positioning */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
              <Search className="w-6 h-6 text-indigo-400" />
              Find Potential Buyers
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Discover relevant retailers, wholesalers, distributors, and business buyers for your product or service.
            </p>
          </div>

          {/* Strategy Indicator Card */}
          <div className="flex flex-col text-xs text-slate-400 bg-slate-900/90 px-3.5 py-2 rounded-xl border border-slate-800 self-start sm:self-auto space-y-0.5">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="text-slate-400">Search Strategy:</span>
              <span className="font-semibold text-slate-100">
                {getStrategyLabel()}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 pl-6">
              OpenStreetMap is searched first. Google Places is used only when needed and configured.
            </p>
          </div>
        </div>

        {/* Primary Search Form Card */}
        <div className="p-5 sm:p-6 rounded-2xl bg-slate-950/70 border border-slate-800/80 shadow-lg space-y-5">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3.5">
              {/* What are you selling? (4 cols on lg) */}
              <div className="sm:col-span-2 lg:col-span-4 space-y-1">
                <label htmlFor="search-q" className="block text-xs font-semibold text-slate-200">
                  What are you selling? <span className="text-indigo-400">*</span>
                </label>
                <input
                  id="search-q"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. Smart Watch, Diabetes Machine, Power Bank, Water Bottle"
                  required
                  disabled={isSearching}
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-900/90 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all disabled:opacity-50"
                />
                <p className="text-[11px] text-slate-400">Enter the product or service you want to find buyers for.</p>
              </div>

              {/* Location / Market (3 cols on lg) with Real Autocomplete */}
              <div ref={locationContainerRef} className="sm:col-span-1 lg:col-span-3 space-y-1 relative">
                <label htmlFor="search-location" className="block text-xs font-semibold text-slate-200">
                  Location / Market <span className="text-indigo-400">*</span>
                </label>
                <div className="relative">
                  <input
                    id="search-location"
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    onKeyDown={handleLocationKeyDown}
                    onFocus={() => {
                      if (location.trim().length >= 3 && (locationSuggestions.length > 0 || suggestionsError)) {
                        setShowSuggestions(true);
                      }
                    }}
                    placeholder="e.g. Dhaka, Mirpur, Gulshan, Chattogram"
                    required
                    disabled={isSearching}
                    autoComplete="off"
                    className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-900/90 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all disabled:opacity-50"
                  />
                  {isLoadingSuggestions && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-label="Loading suggestions">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">Choose the city or market where you want to find customers.</p>

                {/* Autocomplete Dropdown */}
                {showSuggestions && (
                  <div
                    id="location-suggestions-dropdown"
                    role="listbox"
                    className="absolute z-50 left-0 right-0 top-full mt-1.5 py-1.5 rounded-xl bg-slate-900/95 border border-slate-700/90 shadow-2xl backdrop-blur-md max-h-60 overflow-y-auto"
                  >
                    {isLoadingSuggestions && locationSuggestions.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-slate-400 flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400 shrink-0" />
                        <span>Searching locations...</span>
                      </div>
                    ) : suggestionsError ? (
                      <div className="px-3 py-2 text-xs text-amber-400/90 flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        <span>{suggestionsError}</span>
                      </div>
                    ) : locationSuggestions.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-slate-400">
                        No matching locations found.
                      </div>
                    ) : (
                      locationSuggestions.map((item, idx) => {
                        const isHighlighted = idx === highlightedIndex;
                        return (
                          <button
                            key={item.id || idx}
                            type="button"
                            role="option"
                            aria-selected={isHighlighted}
                            onMouseEnter={() => setHighlightedIndex(idx)}
                            onClick={() => handleSelectSuggestion(item)}
                            className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2.5 transition-colors cursor-pointer ${
                              isHighlighted
                                ? 'bg-indigo-600/30 text-white'
                                : 'text-slate-200 hover:bg-slate-800/80'
                            }`}
                          >
                            <MapPin className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-slate-100 truncate">{item.primaryText}</div>
                              {item.secondaryText && (
                                <div className="text-[11px] text-slate-400 truncate">{item.secondaryText}</div>
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              {/* Buyer Type (2 cols on lg) */}
              <div className="sm:col-span-1 lg:col-span-2 space-y-1">
                <label htmlFor="search-buyer-type" className="block text-xs font-semibold text-slate-200">
                  Buyer Type
                </label>
                <select
                  id="search-buyer-type"
                  value={buyerType}
                  onChange={(e) => setBuyerType(e.target.value)}
                  disabled={isSearching}
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-900/90 border border-slate-700/80 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all disabled:opacity-50"
                >
                  <option value="ANY">Any Buyer</option>
                  <option value="RETAILER">Retailer</option>
                  <option value="WHOLESALER">Wholesaler</option>
                  <option value="DISTRIBUTOR">Distributor</option>
                  <option value="ECOMMERCE_SELLER">E-commerce Seller</option>
                  <option value="CORPORATE_BUYER">Corporate Buyer</option>
                </select>
                <p className="text-[11px] text-slate-400">Choose who you want to sell to.</p>
              </div>

              {/* Search Source (2 cols on lg) */}
              <div className="sm:col-span-1 lg:col-span-2 space-y-1">
                <label htmlFor="search-provider" className="block text-xs font-semibold text-slate-200">
                  Search Source
                </label>
                <select
                  id="search-provider"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  disabled={isSearching}
                  className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-900/90 border border-slate-700/80 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all disabled:opacity-50"
                >
                  <option value="AUTO">Auto — Free First</option>
                  <option value="OPENSTREETMAP">OpenStreetMap — Free</option>
                  <option value="GOOGLE_PLACES">Google Places — Verified</option>
                  <option value="MOCK">Mock — Development</option>
                </select>
                <p className="text-[11px] text-slate-400">Data source provider.</p>
              </div>

              {/* Result Limit (1 col on lg) */}
              <div className="sm:col-span-1 lg:col-span-1 space-y-1">
                <label htmlFor="search-limit" className="block text-xs font-semibold text-slate-200">
                  Result Limit
                </label>
                <select
                  id="search-limit"
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  disabled={isSearching}
                  className="w-full px-2.5 py-2.5 text-xs rounded-xl bg-slate-900/90 border border-slate-700/80 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all disabled:opacity-50"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
                <p className="text-[11px] text-slate-400">Max limit.</p>
              </div>
            </div>

            {/* Advanced / Specific Business Category Filter Toggle */}
            <div className="pt-0.5">
              <button
                type="button"
                onClick={() => setShowAdvancedCategory(!showAdvancedCategory)}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1.5 transition"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>{showAdvancedCategory ? 'Hide Advanced Options' : '+ Advanced: Specific Business Category'}</span>
              </button>

              {showAdvancedCategory && (
                <div className="mt-2.5 p-3.5 rounded-xl bg-slate-900/70 border border-slate-800/80 max-w-md space-y-1.5">
                  <label htmlFor="search-category" className="block text-xs font-semibold text-slate-200">
                    Specific Business Category <span className="text-slate-500 font-normal">(Optional override)</span>
                  </label>
                  <input
                    id="search-category"
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="e.g. Pharmacy, Electronics, Dental Clinic, Retail"
                    disabled={isSearching}
                    className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="text-[10px] text-slate-400">Fine-tunes Overpass or Places API classification filter.</p>
                </div>
              )}
            </div>

            {/* AI Buyer Discovery & Target Categories */}
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white">AI Buyer Discovery (Gemini)</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 font-medium">
                        Targeting Assistant
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Discovers high-probability buyer segments and retail categories for your product.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    id="btn-suggest-ai-targets"
                    onClick={handleGenerateAiTargets}
                    disabled={isGeneratingAiTargets || !query.trim()}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${isGeneratingAiTargets ? 'animate-spin' : ''}`} />
                    <span>{isGeneratingAiTargets ? 'Analyzing Market...' : 'Suggest Buyer Categories'}</span>
                  </button>
                </div>
              </div>

              {/* Error Alert */}
              {aiTargetsError && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{aiTargetsError}</span>
                  </div>
                  <a href="/settings/ai-models" className="underline hover:text-white shrink-0 text-[11px]">
                    Configure AI Settings
                  </a>
                </div>
              )}

              {/* AI Category Chips */}
              {aiTargetCategories.length > 0 && (
                <div className="space-y-2 pt-1" id="ai-target-categories-container">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="font-medium text-slate-300">Suggested Target Categories:</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setAiTargetCategories((prev) => prev.map((c) => ({ ...c, selected: true })))}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300"
                      >
                        Select All
                      </button>
                      <span>•</span>
                      <button
                        type="button"
                        onClick={() => setAiTargetCategories((prev) => prev.map((c) => ({ ...c, selected: false })))}
                        className="text-[10px] text-slate-500 hover:text-slate-400"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {aiTargetCategories.map((cat) => (
                      <div
                        key={cat.name}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition cursor-pointer ${
                          cat.selected
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={cat.selected}
                          onChange={() => handleToggleCategoryChip(cat.name)}
                          className="rounded bg-slate-950 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
                        />
                        <span onClick={() => handleToggleCategoryChip(cat.name)} className="font-medium">
                          {cat.name}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800/80 text-slate-400 uppercase font-mono">
                          {cat.relevance}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleApplyCategoryAsOverride(cat.name);
                          }}
                          title="Apply as search category filter"
                          className="ml-1 text-[10px] text-indigo-400 hover:text-indigo-300 hover:underline"
                        >
                          Filter
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500 italic">
                    AI target recommendations — Not a verified fact. Select segments to refine buyer outreach.
                  </p>
                </div>
              )}
            </div>

            {/* Quick Search Chips */}
            <div className="pt-2 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-slate-400 font-medium">Quick examples:</span>
              {QUICK_SEARCH_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => handleApplyChip(chip)}
                  disabled={isSearching}
                  className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700 transition flex items-center gap-1.5"
                >
                  <span>{chip.label}</span>
                </button>
              ))}
            </div>

            {/* Form Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-800/60">
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>Search results are previewed securely before writing to database.</span>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto w-full sm:w-auto">
                {hasSearched && (
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={isSearching}
                    className="px-3.5 py-2.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 rounded-xl border border-slate-700 transition flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset</span>
                  </button>
                )}

                <button
                  type="submit"
                  id="business-search-submit-btn"
                  disabled={isSearching}
                  className="w-full sm:w-auto px-5 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 disabled:opacity-60 rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                >
                  {isSearching ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Finding Potential Buyers...</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      <span>Find Potential Buyers</span>
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
            <div className="p-8 sm:p-10 rounded-2xl bg-slate-950/60 border border-slate-800/80 text-center space-y-6 shadow-sm">
              <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto text-indigo-400 shadow-sm">
                <Sparkles className="w-7 h-7" />
              </div>
              <div className="max-w-lg mx-auto space-y-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  Find businesses that could become your next customers.
                </h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Search by product, location, and buyer type. LeadAtlas will find public business listings from configured data sources.
                </p>
              </div>

              {/* 3 Quick Visual Workflow Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-3xl mx-auto pt-2 text-left">
                <div
                  onClick={() => handleApplyChip(QUICK_SEARCH_CHIPS[1])}
                  className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-indigo-500/40 transition cursor-pointer group"
                >
                  <div className="text-[11px] font-semibold text-indigo-400 group-hover:text-indigo-300">Electronics Workflow</div>
                  <div className="text-xs font-bold text-white mt-1">Smart Watch → Electronics Retailers → Dhaka</div>
                  <div className="text-[10px] text-slate-500 mt-1">Targets gadget and electronics retailers in Dhaka</div>
                </div>
                <div
                  onClick={() => handleApplyChip(QUICK_SEARCH_CHIPS[2])}
                  className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-indigo-500/40 transition cursor-pointer group"
                >
                  <div className="text-[11px] font-semibold text-emerald-400 group-hover:text-emerald-300">Healthcare Workflow</div>
                  <div className="text-xs font-bold text-white mt-1">Diabetes Machine → Pharmacies → Chattogram</div>
                  <div className="text-[10px] text-slate-500 mt-1">Targets pharmacy shops and regional health distributors</div>
                </div>
                <div
                  onClick={() => {
                    setQuery('Power Bank');
                    setLocation('Mirpur');
                    setBuyerType('RETAILER');
                  }}
                  className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-indigo-500/40 transition cursor-pointer group"
                >
                  <div className="text-[11px] font-semibold text-amber-400 group-hover:text-amber-300">Accessories Workflow</div>
                  <div className="text-xs font-bold text-white mt-1">Power Bank → Mobile Shops → Mirpur</div>
                  <div className="text-[10px] text-slate-500 mt-1">Targets telecom and smartphone accessory stores</div>
                </div>
              </div>
            </div>
          )}

          {/* 2. Loading State */}
          {isSearching && (
            <div className="p-12 rounded-xl bg-slate-950/40 border border-slate-800/60 text-center space-y-4">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mx-auto" />
              <div className="text-xs font-semibold text-slate-200">Finding potential buyers from directories...</div>
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
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-400 px-1">
                <div>
                  Discovered <span className="font-semibold text-slate-200">{results.length}</span> potential buyers for &quot;<span className="text-slate-200">{query}</span>&quot; in &quot;<span className="text-slate-200">{location}</span>&quot;
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span>Source:</span>
                  <span className="font-semibold text-slate-200 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                    {provider}
                  </span>
                </div>
              </div>

              {/* Cards Grid / Stack */}
              <div className="space-y-3" id="business-search-results-list">
                {results.map((item) => {
                  const key = `${item.provider}:${item.externalId}`;
                  const saveState = saveStates[key] || { status: 'idle' };
                  const isSaving = saveState.status === 'saving';
                  const isExpanded = expandedCardKey === key;

                  return (
                    <div
                      key={key}
                      className="p-4 sm:p-5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700/80 transition-all shadow-sm space-y-3"
                    >
                      {/* Top Row: Name, Category, Rating & Actions */}
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">
                              {item.name}
                            </h3>
                            <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-slate-300 font-medium">
                              {item.category || '—'}
                            </span>
                            {buyerType !== 'ANY' && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 font-medium">
                                Target: {buyerType.replace(/_/g, ' ')}
                              </span>
                            )}
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

                        {/* Card Actions: View Details, Enrich, Save Lead */}
                        <div className="flex items-center gap-2 shrink-0 self-start">
                          <button
                            type="button"
                            onClick={() => setExpandedCardKey(isExpanded ? null : key)}
                            className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5 text-slate-400" />
                            <span>{isExpanded ? 'Hide' : 'Details'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleExplainBuyerFit(item)}
                            disabled={aiFitExplanations[key]?.status === 'loading'}
                            className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition flex items-center gap-1"
                          >
                            <Sparkles className={`w-3.5 h-3.5 ${aiFitExplanations[key]?.status === 'loading' ? 'animate-spin' : ''}`} />
                            <span>{aiFitExplanations[key]?.status === 'loading' ? 'Analyzing...' : 'Explain Fit'}</span>
                          </button>

                          <button
                            type="button"
                            disabled
                            title="Contact enrichment pipeline (wa.me inspection & email extraction) scheduled in M8 Step 5"
                            className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-900/60 text-slate-500 border border-slate-800/60 cursor-not-allowed opacity-60 flex items-center gap-1"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-slate-500" />
                            <span>Enrich</span>
                          </button>

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

                      {/* Expanded Details Drawer */}
                      {isExpanded && (
                        <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800/90 space-y-2 text-xs">
                          <div className="font-semibold text-slate-200">Listing Details & Provenance</div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-300 text-[11px]">
                            <div><span className="text-slate-500">Provider:</span> {item.provider}</div>
                            <div><span className="text-slate-500">External ID:</span> <span className="font-mono">{item.externalId}</span></div>
                            <div><span className="text-slate-500">Coordinates:</span> {item.latitude && item.longitude ? `${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)}` : 'Not listed'}</div>
                            <div><span className="text-slate-500">Country:</span> {item.country || 'BD'}</div>
                          </div>
                          {item.description && (
                            <div className="text-[11px] text-slate-300 border-t border-slate-800/60 pt-2">
                              {item.description}
                            </div>
                          )}
                        </div>
                      )}

                      {/* AI Buyer Fit Assessment Box */}
                      {aiFitExplanations[key] && aiFitExplanations[key].status === 'success' && (
                        <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-500/20 text-xs space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-1">
                            <div className="flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                              <span className="font-semibold text-amber-300">AI Buyer Fit:</span>
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                                  aiFitExplanations[key].fitLevel === 'HIGH'
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : aiFitExplanations[key].fitLevel === 'MEDIUM'
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                                }`}
                              >
                                {aiFitExplanations[key].fitLevel} FIT
                              </span>
                            </div>
                            <span className="text-[10px] text-amber-400/80 italic">
                              AI reasoning — Not a verified fact
                            </span>
                          </div>
                          <p className="text-slate-300 leading-relaxed text-[11px]">
                            {aiFitExplanations[key].explanation}
                          </p>
                          {aiFitExplanations[key].keyFactors && aiFitExplanations[key].keyFactors!.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-0.5">
                              {aiFitExplanations[key].keyFactors!.map((factor, fIdx) => (
                                <span
                                  key={fIdx}
                                  className="text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300"
                                >
                                  • {factor}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {aiFitExplanations[key] && aiFitExplanations[key].status === 'error' && (
                        <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-300 flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>{aiFitExplanations[key].error}</span>
                        </div>
                      )}

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
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-900 text-slate-400 border border-slate-800">
                            {item.provider === 'google-places' || item.provider === 'GOOGLE_PLACES'
                              ? 'Google Places'
                              : item.provider === 'openstreetmap' || item.provider === 'OPENSTREETMAP'
                              ? 'OpenStreetMap'
                              : 'Mock Provider'}
                          </span>
                          <span className="font-mono">
                            ID: {item.externalId} • Provider: {item.provider}
                          </span>
                        </div>
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
