'use client';

import React, { useEffect, useState } from 'react';
import {
  Database,
  Key,
  Shield,
  Activity,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Power,
  Sparkles,
  FileSpreadsheet,
  Globe,
  MapPin,
  Lock,
  ExternalLink,
  X
} from 'lucide-react';
import {
  type DataSourceCardDTO,
  type DataSourcesListResponse,
  type DataSourceCardStatus
} from '@leadmate/shared';
import { AppShell } from '@/components/layout/app-shell';
import { apiClient } from '@/lib/api-client';
import { formatDate } from '@/lib/format-date';

const PROVIDER_ICONS: Record<string, React.ElementType> = {
  mock: Database,
  csv: FileSpreadsheet,
  openstreetmap: Globe,
  'google-places': MapPin
};

const DEFAULT_DATA_SOURCES: DataSourceCardDTO[] = [
  {
    id: 'mock',
    provider: 'mock',
    name: 'mock',
    displayName: 'Mock Provider (Standard)',
    description: 'Deterministic local business discovery fixtures for development, testing, and offline use.',
    isEnabled: true,
    isActive: true,
    isConfigured: true,
    requiresCredential: false,
    costType: 'FREE',
    status: 'CONNECTED',
    lastTestedAt: null
  },
  {
    id: 'csv',
    provider: 'csv',
    name: 'csv',
    displayName: 'CSV File Provider',
    description: 'Import and search structured business databases from local CSV spreadsheets.',
    isEnabled: true,
    isActive: false,
    isConfigured: true,
    requiresCredential: false,
    costType: 'FREE',
    status: 'CONNECTED',
    lastTestedAt: null
  },
  {
    id: 'openstreetmap',
    provider: 'openstreetmap',
    name: 'openstreetmap',
    displayName: 'OpenStreetMap (Overpass)',
    description: 'First free live buyer discovery provider via global OpenStreetMap Overpass API.',
    isEnabled: true,
    isActive: true,
    isConfigured: true,
    requiresCredential: false,
    costType: 'FREE',
    status: 'CONNECTED',
    lastTestedAt: null
  },
  {
    id: 'google-places',
    provider: 'google-places',
    name: 'google-places',
    displayName: 'Google Places API (New)',
    description: 'Live verified business discovery, high-accuracy geocoding, and official business details via Google Places API (New).',
    isEnabled: false,
    isActive: false,
    isConfigured: false,
    requiresCredential: true,
    costType: 'PAID',
    status: 'NOT_CONFIGURED',
    lastTestedAt: null
  }
];

export default function DataSourcesSettingsPage() {
  const [dataSources, setDataSources] = useState<DataSourceCardDTO[]>(DEFAULT_DATA_SOURCES);
  const [activeProvider, setActiveProvider] = useState<string>('AUTO');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal State for Key Configuration
  const [modalProvider, setModalProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);

  // Testing State
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    provider: string;
    connected: boolean;
    message: string;
  } | null>(null);

  // Toggling State
  const [togglingProvider, setTogglingProvider] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchDataSources = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await apiClient.getDataSources();
      setDataSources(res.dataSources);
      setActiveProvider(res.activeProvider);
    } catch (err: any) {
      setError(err?.message || 'Failed to load data sources');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDataSources();
  }, []);

  const handleConfigureKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKeyInput.trim()) return;

    try {
      setIsSavingKey(true);
      const res = await apiClient.configureGooglePlaces(apiKeyInput.trim());
      setModalProvider(null);
      setApiKeyInput('');
      setFeedback({
        type: 'success',
        message: `Google Places API key saved and encrypted! Masked: ${res.credentialMasked}`
      });
      fetchDataSources();
      setTimeout(() => setFeedback(null), 4000);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to configure API key'
      });
      setTimeout(() => setFeedback(null), 5000);
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleTestConnection = async (provider: string) => {
    try {
      setTestingProvider(provider);
      setTestResult(null);

      let res: { connected: boolean; provider: string; message: string };
      if (provider === 'google-places') {
        res = await apiClient.testGooglePlaces();
      } else {
        res = await apiClient.testProvider(provider);
      }

      setTestResult({
        provider,
        connected: res.connected,
        message: res.message
      });

      if (res.connected) {
        fetchDataSources();
      }
    } catch (err: any) {
      setTestResult({
        provider,
        connected: false,
        message: err?.message || 'Connection test failed'
      });
    } finally {
      setTestingProvider(null);
    }
  };

  const handleSetActive = async (provider: string) => {
    try {
      await apiClient.setActiveProvider(provider);
      setActiveProvider(provider.toUpperCase());
      setFeedback({
        type: 'success',
        message: `Active business discovery provider set to ${provider}`
      });
      fetchDataSources();
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to activate provider'
      });
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  const handleToggleEnabled = async (provider: string, currentEnabled: boolean) => {
    try {
      setTogglingProvider(provider);
      await apiClient.toggleProviderEnabled(provider, !currentEnabled);
      setDataSources((prev) =>
        prev.map((d) => (d.provider === provider ? { ...d, isEnabled: !currentEnabled } : d))
      );
      setFeedback({
        type: 'success',
        message: `${provider} has been ${!currentEnabled ? 'enabled' : 'disabled'}`
      });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to toggle provider status'
      });
      setTimeout(() => setFeedback(null), 4000);
    } finally {
      setTogglingProvider(null);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                <Database className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">Data Sources & Credentials</h1>
                <p className="text-sm text-slate-400">
                  Manage discovery providers, AES-256-GCM encrypted credentials, and search strategies.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchDataSources}
              disabled={isLoading}
              className="px-3.5 py-2 text-sm font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Settings Sub-navigation Tabs */}
        <div className="flex border-b border-slate-800 gap-2">
          <a
            href="/settings/data-sources"
            className="px-4 py-2.5 text-sm font-medium border-b-2 border-indigo-500 text-indigo-400 flex items-center gap-2"
          >
            <Database className="w-4 h-4" />
            Data Sources & Places
          </a>
          <a
            href="/settings/ai-models"
            className="px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700 flex items-center gap-2 transition"
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            AI Models & Gemini
          </a>
        </div>

        {/* Security Invariant Banner */}
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 flex items-start gap-3">
          <Shield className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-semibold text-white">
              AES-256-GCM Server-Side Encryption Guarantee
            </p>
            <p className="text-slate-400">
              API keys are encrypted in-memory before storage with a random 12-byte IV and authenticated tag.
              Plaintext secrets are never stored, logged, or returned in HTTP responses.
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

        {/* Test Result Banner */}
        {testResult && (
          <div
            className={`p-4 rounded-xl border flex items-start gap-3 ${
              testResult.connected
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            {testResult.connected ? (
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            )}
            <div>
              <p className="text-sm font-semibold">
                Connection Test: {testResult.connected ? 'Successful' : 'Failed'} ({testResult.provider})
              </p>
              <p className="text-xs mt-0.5 opacity-90">{testResult.message}</p>
            </div>
          </div>
        )}

        {/* Provider Cards Grid */}
        {isLoading && dataSources.length === 0 ? (
          <div className="py-20 text-center">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-400 mb-3" />
            <p className="text-sm text-slate-400">Loading data sources...</p>
          </div>
        ) : error ? (
          <div className="p-8 rounded-xl bg-rose-500/10 border border-rose-500/20 text-center">
            <AlertCircle className="w-8 h-8 mx-auto text-rose-400 mb-2" />
            <p className="text-sm text-rose-300">{error}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {dataSources.map((ds) => {
              const Icon = PROVIDER_ICONS[ds.provider] || Database;
              const isTesting = testingProvider === ds.provider;
              const isToggling = togglingProvider === ds.provider;
              const isConfigured = ds.isConfigured;

              return (
                <div
                  key={ds.provider}
                  className="p-5 rounded-2xl bg-slate-950 border border-slate-800 hover:border-slate-700 transition shadow-sm space-y-4 flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-indigo-400">
                          <Icon className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-white">{ds.displayName}</h3>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] font-mono text-slate-400">
                              provider: {ds.provider}
                            </span>
                            <span
                              className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${
                                ds.costType === 'FREE'
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                              }`}
                            >
                              {ds.costType}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Status Badge */}
                      <span
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                          ds.status === 'CONNECTED'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : ds.status === 'DISABLED'
                            ? 'bg-slate-800 text-slate-400 border-slate-700'
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        }`}
                      >
                        {ds.status}
                      </span>
                    </div>

                    {/* Description */}
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {ds.description}
                    </p>

                    {/* Credential & Tested Details */}
                    <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-1.5 text-xs">
                      {ds.requiresCredential ? (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400 flex items-center gap-1.5">
                            <Lock className="w-3.5 h-3.5 text-slate-500" />
                            Stored Credential:
                          </span>
                          <span className="font-mono text-slate-200">
                            {ds.credentialMasked ? ds.credentialMasked : 'Not Configured'}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Authentication:</span>
                          <span className="text-emerald-400 font-medium">No Key Required (Free Public)</span>
                        </div>
                      )}

                      {ds.lastTestedAt && (
                        <div className="flex items-center justify-between text-slate-400">
                          <span>Last Tested:</span>
                          <span>{formatDate(ds.lastTestedAt)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {/* Test Connection Button */}
                      <button
                        onClick={() => handleTestConnection(ds.provider)}
                        disabled={isTesting || (ds.requiresCredential && !isConfigured)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 transition flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Activity className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                        {isTesting ? 'Testing...' : 'Test Connection'}
                      </button>

                      {/* Configure / Rotate Key */}
                      {ds.requiresCredential && (
                        <button
                          onClick={() => {
                            setModalProvider(ds.provider);
                            setApiKeyInput('');
                          }}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 transition flex items-center gap-1.5"
                        >
                          <Key className="w-3.5 h-3.5" />
                          {isConfigured ? 'Rotate Key' : 'Configure Key'}
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Enable / Disable Toggle */}
                      <button
                        onClick={() => handleToggleEnabled(ds.provider, ds.isEnabled)}
                        disabled={isToggling}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition flex items-center gap-1.5 ${
                          ds.isEnabled
                            ? 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                        }`}
                      >
                        <Power className="w-3.5 h-3.5" />
                        {ds.isEnabled ? 'Disable' : 'Enable'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Modal: Configure API Key */}
        {modalProvider && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden p-6 space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Lock className="w-4 h-4 text-indigo-400" />
                  Configure Google Places API Key
                </h3>
                <button
                  onClick={() => setModalProvider(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleConfigureKey} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    Google Places API (New) Key
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="AIzaSy..."
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                  />
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    Stored securely using AES-256-GCM. The plaintext key is discarded immediately after encryption.
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setModalProvider(null)}
                    className="px-4 py-2 text-sm rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingKey || apiKeyInput.trim().length < 10}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition disabled:opacity-50 flex items-center gap-2"
                  >
                    {isSavingKey ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Verifying & Encrypting...
                      </>
                    ) : (
                      'Save & Encrypt'
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
