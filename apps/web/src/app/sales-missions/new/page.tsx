'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Target,
  Package,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Building2,
  Plus,
  Compass,
  Check,
  X,
  Layers,
  MapPin
} from 'lucide-react';
import {
  type ProductDto,
  type AiProductAnalysisResult,
  SalesMissionGoal,
  SALES_MISSION_GOAL_LABELS
} from '@leadmate/shared';
import { AppShell } from '@/components/layout/app-shell';
import { apiClient, type LocationSuggestionItem } from '@/lib/api-client';

function NewSalesMissionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialProductId = searchParams.get('productId');

  // Step state: 1 = Product, 2 = Mission Config, 3 = AI Analysis & Buyer Targets, 4 = Executing
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Products catalog
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);

  // Selection
  const [selectedProductMode, setSelectedProductMode] = useState<'catalog' | 'manual'>('catalog');
  const [selectedProductId, setSelectedProductId] = useState<string>(initialProductId || '');

  // Manual product inputs
  const [manualProduct, setManualProduct] = useState({
    name: '',
    description: '',
    category: '',
    stockQuantity: 100
  });

  // Mission configurations
  const [missionName, setMissionName] = useState('');
  const [goal, setGoal] = useState<SalesMissionGoal>(SalesMissionGoal.WHOLESALE);
  const [targetMarket, setTargetMarket] = useState('Dhaka, Bangladesh');
  const [resultTarget, setResultTarget] = useState(50);

  // AI Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AiProductAnalysisResult | null>(null);
  const [selectedBuyerTargets, setSelectedBuyerTargets] = useState<string[]>([]);
  const [customTargetInput, setCustomTargetInput] = useState('');

  // Execution state
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // -------------------------------------------------------------------
  // Location autocomplete (Step 1)
  // -------------------------------------------------------------------
  const [locationInput, setLocationInput] = useState('');
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestionItem[]>([]);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [noResultsFound, setNoResultsFound] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationAbortRef = useRef<AbortController | null>(null);
  const locationInputRef = useRef<HTMLInputElement>(null);
  const locationContainerRef = useRef<HTMLDivElement>(null);

  // Click outside to dismiss suggestions dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        locationContainerRef.current &&
        !locationContainerRef.current.contains(event.target as Node)
      ) {
        setShowLocationDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Cleanup location debounce & abort controller on unmount
  useEffect(() => {
    return () => {
      if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
      if (locationAbortRef.current) locationAbortRef.current.abort();
    };
  }, []);

  // Load products
  useEffect(() => {
    async function fetchProducts() {
      setIsLoadingProducts(true);
      try {
        const res = await apiClient.listProducts({ limit: 100 });
        setProducts(res.products || []);
        if (initialProductId && res.products?.some((p) => p.id === initialProductId)) {
          setSelectedProductId(initialProductId);
          setSelectedProductMode('catalog');
          const found = res.products.find((p) => p.id === initialProductId);
          if (found) {
            setMissionName(`Distribute ${found.name} in ${targetMarket}`);
          }
        }
      } catch (err: any) {
        console.warn('Could not load products', err);
      } finally {
        setIsLoadingProducts(false);
      }
    }
    fetchProducts();
  }, [initialProductId]);

  // -------------------------------------------------------------------
  // Debounced location suggestions fetch (350ms, min 3 chars, AbortController)
  // -------------------------------------------------------------------
  const fetchLocationSuggestions = useCallback((q: string) => {
    if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);

    const trimmed = q.trim();
    if (trimmed.length < 3) {
      if (locationAbortRef.current) {
        locationAbortRef.current.abort();
        locationAbortRef.current = null;
      }
      setLocationSuggestions([]);
      setShowLocationDropdown(false);
      setIsLoadingLocation(false);
      setNoResultsFound(false);
      setActiveIndex(-1);
      return;
    }

    setIsLoadingLocation(true);
    setShowLocationDropdown(true);

    locationDebounceRef.current = setTimeout(async () => {
      if (locationAbortRef.current) {
        locationAbortRef.current.abort();
      }
      const controller = new AbortController();
      locationAbortRef.current = controller;

      try {
        const res = await apiClient.suggestLocations(trimmed, 6, {
          signal: controller.signal
        });
        const items: LocationSuggestionItem[] = Array.isArray(res)
          ? res
          : (res as any)?.data || [];
        setLocationSuggestions(items);
        setNoResultsFound(items.length === 0);
        setShowLocationDropdown(true);
        setActiveIndex(-1);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setLocationSuggestions([]);
        setNoResultsFound(true);
      } finally {
        setIsLoadingLocation(false);
      }
    }, 350);
  }, []);

  const selectLocation = useCallback((label: string) => {
    setLocationInput(label);
    setTargetMarket(label);
    setShowLocationDropdown(false);
    setLocationSuggestions([]);
    setNoResultsFound(false);
    setActiveIndex(-1);
    if (locationError) setLocationError(null);
  }, [locationError]);

  const handleLocationKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!showLocationDropdown && (locationSuggestions.length > 0 || locationInput.trim().length >= 3)) {
        setShowLocationDropdown(true);
        setActiveIndex(0);
      } else if (locationSuggestions.length > 0) {
        setActiveIndex((prev) => (prev + 1) % locationSuggestions.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (locationSuggestions.length > 0) {
        setActiveIndex((prev) => (prev <= 0 ? locationSuggestions.length - 1 : prev - 1));
      }
    } else if (e.key === 'Enter') {
      if (showLocationDropdown && activeIndex >= 0 && activeIndex < locationSuggestions.length) {
        e.preventDefault();
        selectLocation(locationSuggestions[activeIndex].label);
      } else {
        setShowLocationDropdown(false);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowLocationDropdown(false);
      setActiveIndex(-1);
    }
  }, [showLocationDropdown, locationSuggestions, locationInput, activeIndex, selectLocation]);

  const activeProductName =
    selectedProductMode === 'catalog'
      ? products.find((p) => p.id === selectedProductId)?.name || ''
      : manualProduct.name;

  const activeProductDesc =
    selectedProductMode === 'catalog'
      ? products.find((p) => p.id === selectedProductId)?.description || ''
      : manualProduct.description;

  const activeProductCategory =
    selectedProductMode === 'catalog'
      ? products.find((p) => p.id === selectedProductId)?.category || undefined
      : manualProduct.category || undefined;

  // Step 1 -> Step 2 validation
  const handleProceedToConfig = () => {
    if (selectedProductMode === 'catalog' && !selectedProductId) {
      setError('Please select a product from the catalog, or switch to manual entry');
      return;
    }
    if (selectedProductMode === 'manual') {
      if (!manualProduct.name.trim() || !manualProduct.description.trim()) {
        setError('Product name and description are required for manual products');
        return;
      }
      if (manualProduct.description.trim().length > 4000) {
        setError('Product description must be 4000 characters or fewer.');
        return;
      }
    }
    // Validate Target Location
    if (!locationInput.trim()) {
      setLocationError('Please enter a target location.');
      locationInputRef.current?.focus();
      return;
    }
    setLocationError(null);
    setError(null);

    // Persist location into targetMarket for Step 2
    setTargetMarket(locationInput.trim());

    if (!missionName) {
      setMissionName(`Find ${goal.toLowerCase()} buyers for ${activeProductName} in ${locationInput.trim()}`);
    }
    setStep(2);
  };

  // Step 2 -> Step 3: Run AI Product Analysis
  const handleRunAiAnalysis = async () => {
    if (!activeProductName.trim() || !activeProductDesc.trim()) {
      setError('Product name and product description are required');
      setStep(1);
      return;
    }
    if (activeProductDesc.trim().length > 4000) {
      setError('Product description must be 4000 characters or fewer.');
      return;
    }
    if (!targetMarket.trim()) {
      setError('Please provide a valid Target Market location');
      return;
    }
    setError(null);
    setIsAnalyzing(true);
    setStep(3);

    try {
      const result = await apiClient.analyzeProductDirect({
        productName: activeProductName.trim(),
        productDescription: activeProductDesc.trim(),
        category: activeProductCategory?.trim() || null,
        goal,
        targetMarket: targetMarket.trim(),
        buyerType: 'AI_DECIDE',
        resultTarget
      });
      setAnalysisResult(result);
      setSelectedBuyerTargets(result.searchTerms || result.buyerTargets.map((b) => b.category));
    } catch (err: any) {
      if (err?.fields && typeof err.fields === 'object') {
        const firstKey = Object.keys(err.fields)[0];
        setError(err.fields[firstKey] || err.message || 'AI product analysis failed');
      } else if (err?.details && Array.isArray(err.details) && err.details.length > 0) {
        setError(err.details[0].message || err.message || 'AI product analysis failed');
      } else {
        setError(err?.message || 'AI product analysis failed');
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const toggleBuyerTarget = (target: string) => {
    if (selectedBuyerTargets.includes(target)) {
      if (selectedBuyerTargets.length > 1) {
        setSelectedBuyerTargets((prev) => prev.filter((t) => t !== target));
      }
    } else {
      setSelectedBuyerTargets((prev) => [...prev, target]);
    }
  };

  const addCustomTarget = () => {
    const trimmed = customTargetInput.trim();
    if (trimmed && !selectedBuyerTargets.includes(trimmed)) {
      setSelectedBuyerTargets((prev) => [...prev, trimmed]);
      setCustomTargetInput('');
    }
  };

  // Step 4: Execute Discovery & Save Mission
  const handleLaunchDiscovery = async () => {
    if (selectedBuyerTargets.length === 0) {
      setError('Please select at least one buyer target category');
      return;
    }

    setError(null);
    setIsDiscovering(true);
    setStep(4);

    try {
      let createdProdId = selectedProductId;

      // If manual mode, create product first in catalog
      if (selectedProductMode === 'manual') {
        const prod = await apiClient.createProduct({
          name: manualProduct.name,
          description: manualProduct.description,
          category: manualProduct.category || undefined,
          stockQuantity: manualProduct.stockQuantity || 100,
          currency: 'BDT'
        });
        createdProdId = prod.id;
      }

      // 1. Create Mission
      const mission = await apiClient.createSalesMission({
        productId: createdProdId || undefined,
        name: missionName.trim() || `Sales Mission: ${activeProductName}`,
        goal,
        targetMarket: targetMarket.trim(),
        buyerType: 'AI_DECIDE',
        resultTarget: resultTarget || 50,
        productAnalysisSnapshot: analysisResult || undefined,
        selectedBuyerTargets
      });

      // 2. Execute discovery using existing business search
      await apiClient.discoverMissionBuyers(mission.id, selectedBuyerTargets);

      // 3. Redirect to Mission Detail
      router.push(`/sales-missions/${mission.id}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to execute sales mission discovery');
      setIsDiscovering(false);
      setStep(3);
    }
  };

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Back Link & Header */}
        <div className="flex items-center justify-between">
          <Link
            href="/sales-missions"
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Sales Missions</span>
          </Link>

          {/* Stepper Indicator */}
          <div className="flex items-center gap-2 text-xs font-medium">
            <span
              className={`px-2.5 py-1 rounded-full ${
                step === 1 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
              }`}
            >
              1. Product
            </span>
            <span className="text-slate-600">→</span>
            <span
              className={`px-2.5 py-1 rounded-full ${
                step === 2 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
              }`}
            >
              2. Goals
            </span>
            <span className="text-slate-600">→</span>
            <span
              className={`px-2.5 py-1 rounded-full ${
                step >= 3 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
              }`}
            >
              3. AI Analysis
            </span>
          </div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-6 space-y-6">
          {error && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm flex items-center gap-3">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* STEP 1: PRODUCT SELECTION */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-slate-100">Step 1: Select or Add a Product</h2>
                <p className="text-sm text-slate-400 mt-1">
                  Choose a product from your catalog or enter details for a new item.
                </p>
              </div>

              {/* Mode Toggle */}
              <div className="flex p-1 bg-slate-900 border border-slate-800 rounded-xl max-w-sm">
                <button
                  type="button"
                  onClick={() => setSelectedProductMode('catalog')}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition ${
                    selectedProductMode === 'catalog'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Select from Catalog ({products.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedProductMode('manual')}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition ${
                    selectedProductMode === 'manual'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Manual Product Entry
                </button>
              </div>

              {selectedProductMode === 'catalog' ? (
                <div>
                  {isLoadingProducts ? (
                    <div className="py-8 flex justify-center">
                      <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                    </div>
                  ) : products.length === 0 ? (
                    <div className="p-6 bg-slate-900/50 border border-slate-800 rounded-xl text-center space-y-3">
                      <p className="text-sm text-slate-400">Catalog is currently empty.</p>
                      <button
                        onClick={() => setSelectedProductMode('manual')}
                        className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg"
                      >
                        Enter Product Manually
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
                      {products.map((p) => {
                        const isSelected = selectedProductId === p.id;
                        return (
                          <div
                            key={p.id}
                            onClick={() => setSelectedProductId(p.id)}
                            className={`p-4 rounded-xl border cursor-pointer transition text-left flex flex-col justify-between space-y-2 ${
                              isSelected
                                ? 'bg-indigo-950/40 border-indigo-500 shadow-md shadow-indigo-500/10'
                                : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="font-semibold text-slate-200 text-sm">{p.name}</h4>
                              {isSelected && <Check className="w-4 h-4 text-indigo-400 flex-shrink-0" />}
                            </div>
                            <p className="text-xs text-slate-400 line-clamp-2">{p.description}</p>
                            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800/60">
                              <span>Stock: {p.stockQuantity}</span>
                              <span className="text-indigo-300 font-medium">{p.category || 'General'}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Product Name <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={manualProduct.name}
                      onChange={(e) => setManualProduct({ ...manualProduct, name: e.target.value })}
                      placeholder="e.g. Diamum, Portable Mini Blender, High-grade Cotton Fabric"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-slate-300">
                        Description <span className="text-rose-400">*</span>
                      </label>
                      <span
                        className={`text-[11px] font-mono ${
                          manualProduct.description.length > 4000
                            ? 'text-rose-400 font-semibold'
                            : manualProduct.description.length > 3500
                            ? 'text-amber-400'
                            : 'text-slate-500'
                        }`}
                      >
                        {manualProduct.description.length} / 4000
                      </span>
                    </div>
                    <textarea
                      rows={4}
                      maxLength={4000}
                      value={manualProduct.description}
                      onChange={(e) => {
                        const val = e.target.value;
                        setManualProduct({ ...manualProduct, description: val });
                        if (val.length > 4000) {
                          setError('Product description must be 4000 characters or fewer.');
                        } else if (error === 'Product description must be 4000 characters or fewer.') {
                          setError(null);
                        }
                      }}
                      placeholder="Describe target use case, specs, material, or application..."
                      className={`w-full px-3 py-2 bg-slate-900 border rounded-lg text-sm text-slate-200 focus:outline-none ${
                        manualProduct.description.length > 4000
                          ? 'border-rose-500/80 focus:border-rose-500'
                          : 'border-slate-800 focus:border-indigo-500'
                      }`}
                    />
                    {manualProduct.description.length > 4000 && (
                      <p className="text-xs text-rose-400 mt-1">
                        Product description must be 4000 characters or fewer.
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">Category</label>
                      <input
                        type="text"
                        value={manualProduct.category}
                        onChange={(e) => setManualProduct({ ...manualProduct, category: e.target.value })}
                        placeholder="e.g. Healthcare, Kitchenware, Textiles"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">Available Stock Units</label>
                      <input
                        type="number"
                        min={0}
                        value={manualProduct.stockQuantity}
                        onChange={(e) =>
                          setManualProduct({ ...manualProduct, stockQuantity: Number(e.target.value) })
                        }
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* TARGET LOCATION */}
              <div className="pt-2 border-t border-slate-800/60">
                <div className="space-y-1.5">
                  <label
                    htmlFor="step1-location-input"
                    className="flex items-center gap-1.5 text-xs font-medium text-slate-300"
                  >
                    <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                    Target Location <span className="text-rose-400">*</span>
                  </label>

                  <div ref={locationContainerRef} className="relative">
                    <input
                      id="step1-location-input"
                      ref={locationInputRef}
                      type="text"
                      autoComplete="off"
                      value={locationInput}
                      placeholder="Search or enter a city, area, or market"
                      onChange={(e) => {
                        const val = e.target.value;
                        setLocationInput(val);
                        setTargetMarket(val);
                        if (locationError) setLocationError(null);
                        fetchLocationSuggestions(val);
                      }}
                      onFocus={() => {
                        if (locationInput.trim().length >= 3 && (locationSuggestions.length > 0 || noResultsFound)) {
                          setShowLocationDropdown(true);
                        }
                      }}
                      onKeyDown={handleLocationKeyDown}
                      className={`w-full px-3 py-2 pr-8 bg-slate-900 border rounded-lg text-sm text-slate-200 focus:outline-none transition ${
                        locationError
                          ? 'border-rose-500/80 focus:border-rose-500'
                          : 'border-slate-800 focus:border-indigo-500'
                      }`}
                    />

                    {/* Spinner or pin icon */}
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                      {isLoadingLocation ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                      ) : (
                        <MapPin className="w-3.5 h-3.5 text-slate-500" />
                      )}
                    </div>

                    {/* Autocomplete dropdown */}
                    {showLocationDropdown && locationInput.trim().length >= 3 && (
                      <div
                        id="location-autocomplete-dropdown"
                        role="listbox"
                        aria-label="Location suggestions"
                        className="absolute z-50 top-full mt-1.5 w-full bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden max-h-60 overflow-y-auto"
                      >
                        {isLoadingLocation ? (
                          <div className="px-3.5 py-3 text-xs text-slate-400 flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400 flex-shrink-0" />
                            <span>Searching locations...</span>
                          </div>
                        ) : locationSuggestions.length > 0 ? (
                          locationSuggestions.map((s, idx) => (
                            <button
                              key={s.id || idx}
                              id={`location-suggestion-${idx}`}
                              role="option"
                              type="button"
                              aria-selected={activeIndex === idx || locationInput === s.label}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                selectLocation(s.label);
                              }}
                              onMouseEnter={() => setActiveIndex(idx)}
                              className={`w-full text-left px-3.5 py-2.5 transition flex items-start gap-2.5 border-b border-slate-800/40 last:border-b-0 group ${
                                activeIndex === idx
                                  ? 'bg-indigo-600/25 text-white'
                                  : 'hover:bg-slate-800/90 text-slate-200'
                              }`}
                            >
                              <MapPin
                                className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 transition ${
                                  activeIndex === idx ? 'text-indigo-300' : 'text-indigo-400 group-hover:text-indigo-300'
                                }`}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium leading-tight truncate">
                                  {s.primaryText || s.label}
                                </div>
                                {s.secondaryText && (
                                  <div className="text-[11px] text-slate-400 leading-tight truncate mt-0.5">
                                    {s.secondaryText}
                                  </div>
                                )}
                              </div>
                            </button>
                          ))
                        ) : noResultsFound ? (
                          <div className="px-3.5 py-3 text-xs text-slate-400 leading-relaxed">
                            No matching locations found — you can continue with your typed location.
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>

                  {/* Validation error */}
                  {locationError && (
                    <p
                      id="step1-location-error"
                      role="alert"
                      className="text-xs text-rose-400 flex items-center gap-1"
                    >
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      {locationError}
                    </p>
                  )}

                  {/* Quick location chips */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[11px] text-slate-500 font-medium mr-0.5">Quick picks:</span>
                    {['Dhaka', 'Mirpur', 'Uttara', 'Chattogram', 'Sylhet'].map((city) => (
                      <button
                        key={city}
                        type="button"
                        onClick={() => {
                          selectLocation(city);
                        }}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition ${
                          locationInput === city
                            ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                            : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700/60'
                        }`}
                      >
                        {city}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-slate-800">
                <button
                  id="step1-continue-btn"
                  type="button"
                  onClick={handleProceedToConfig}
                  disabled={!locationInput.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-sm transition"
                >
                  <span>Continue to Mission Config</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: MISSION PARAMETERS */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-slate-100">Step 2: Mission Goals & Target Market</h2>
                <p className="text-sm text-slate-400 mt-1">
                  Define the sales strategy and target geography for {activeProductName}.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Mission Name <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={missionName}
                    onChange={(e) => setMissionName(e.target.value)}
                    placeholder="e.g. Distribute Diamum in Dhaka Pharmacies"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Sales Goal</label>
                    <select
                      value={goal}
                      onChange={(e) => setGoal(e.target.value as SalesMissionGoal)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      {Object.entries(SALES_MISSION_GOAL_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-indigo-400" />
                      Target Market <span className="text-rose-400">*</span>
                      <span className="text-slate-600 font-normal ml-1">(from Step 1, editable)</span>
                    </label>
                    <input
                      type="text"
                      value={targetMarket}
                      onChange={(e) => setTargetMarket(e.target.value)}
                      placeholder="e.g. Dhanmondi, Dhaka or Chittagong or Bangladesh"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Target Discovered Businesses Count
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={10}
                      max={50}
                      step={5}
                      value={resultTarget}
                      onChange={(e) => setResultTarget(Number(e.target.value))}
                      className="flex-1 accent-indigo-500"
                    />
                    <span className="w-12 text-center text-sm font-semibold text-slate-200 bg-slate-900 border border-slate-800 py-1 rounded">
                      {resultTarget}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Max businesses to discover through verified directory providers
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm font-medium transition"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleRunAiAnalysis}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition shadow-lg shadow-indigo-600/20"
                >
                  <Sparkles className="w-4 h-4 text-indigo-200" />
                  <span>Analyze Product with AI</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: AI PRODUCT ANALYSIS & BUYER TARGETS */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-indigo-400" />
                  <span>AI Product Analysis & Buyer Strategy</span>
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  Gemini analyzed your product and generated high-probability commercial buyer categories.
                </p>
              </div>

              {isAnalyzing ? (
                <div className="py-16 flex flex-col items-center justify-center space-y-4 text-center">
                  <div className="relative">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center animate-pulse">
                      <Sparkles className="w-6 h-6 text-indigo-400" />
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-200 text-sm">Analyzing Product Attributes</h3>
                    <p className="text-xs text-slate-400 mt-1 max-w-sm">
                      Evaluating commercial buyers, B2B purchasing channels, and authentic search terms...
                    </p>
                  </div>
                </div>
              ) : analysisResult ? (
                <div className="space-y-6">
                  {/* Summary Card */}
                  <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/20 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
                        AI Categorization
                      </span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                        {analysisResult.productCategory}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {analysisResult.productSummary}
                    </p>
                  </div>

                  {/* Buyer Targets Identified */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-slate-200">
                        Target Commercial Buyer Segments
                      </h4>
                      <span className="text-xs text-slate-400">
                        {analysisResult.buyerTargets.length} segments identified
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {analysisResult.buyerTargets.map((target, idx) => (
                        <div
                          key={idx}
                          className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-200 text-xs">
                              {target.category}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                target.confidence === 'HIGH'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              }`}
                            >
                              {target.confidence} FIT
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 leading-snug">{target.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Active Search Chips */}
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-200">
                        Directory Search Terms (Click to toggle)
                      </label>
                      <span className="text-xs text-indigo-400 font-medium">
                        {selectedBuyerTargets.length} selected for query
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {selectedBuyerTargets.map((term) => (
                        <button
                          key={term}
                          type="button"
                          onClick={() => toggleBuyerTarget(term)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-white border border-indigo-500 shadow-sm transition hover:bg-indigo-700"
                        >
                          <span>{term}</span>
                          <X className="w-3 h-3 text-indigo-200" />
                        </button>
                      ))}
                    </div>

                    {/* Add Custom Search Term */}
                    <div className="flex gap-2 max-w-sm pt-1">
                      <input
                        type="text"
                        value={customTargetInput}
                        onChange={(e) => setCustomTargetInput(e.target.value)}
                        placeholder="Add another category..."
                        className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addCustomTarget();
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={addCustomTarget}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm font-medium transition"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleLaunchDiscovery}
                      className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition shadow-lg shadow-indigo-600/20"
                    >
                      <Compass className="w-4 h-4 text-indigo-200" />
                      <span>Launch Business Discovery</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* STEP 4: DISCOVERING BUSINESSES */}
          {step === 4 && (
            <div className="py-20 flex flex-col items-center justify-center space-y-4 text-center">
              <Loader2 className="w-10 h-10 animate-spin text-indigo-400" />
              <div>
                <h3 className="text-lg font-bold text-slate-100">Discovering Authentic Buyers</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Connecting to Google Places & OpenStreetMap directory providers to find real businesses in {targetMarket}...
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

export default function NewSalesMissionPage() {
  return (
    <React.Suspense
      fallback={
        <AppShell>
          <div className="py-20 flex flex-col items-center justify-center space-y-4 text-center">
            <Loader2 className="w-10 h-10 animate-spin text-indigo-400" />
            <p className="text-sm text-slate-400">Loading Sales Mission Wizard...</p>
          </div>
        </AppShell>
      }
    >
      <NewSalesMissionContent />
    </React.Suspense>
  );
}
