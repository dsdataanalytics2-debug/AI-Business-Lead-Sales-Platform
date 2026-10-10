'use client';

import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  Bot,
  Key,
  Shield,
  Activity,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Power,
  Lock,
  Cpu,
  Layers,
  Info,
  X,
  ExternalLink,
  ChevronDown,
  Database
} from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { apiClient } from '@/lib/api-client';
import { formatDate } from '@/lib/format-date';

interface AiProviderCard {
  id: string;
  provider: string;
  name: string;
  displayName: string;
  description: string;
  status: 'NOT_CONFIGURED' | 'CONNECTED' | 'ERROR' | 'DISABLED';
  isActive: boolean;
  isEnabled: boolean;
  isConfigured: boolean;
  defaultModel: string;
  supportedModels: string[];
  credentialMasked: string | null;
  credentialLastFour: string | null;
  lastTestedAt: string | null;
  updatedAt: string | null;
}

const DEFAULT_AI_PROVIDERS: AiProviderCard[] = [
  {
    id: 'gemini',
    provider: 'gemini',
    name: 'gemini',
    displayName: 'Google Gemini',
    description: 'High-speed generative AI for buyer target suggestions, market segment classification, and buyer fit reasoning.',
    status: 'NOT_CONFIGURED',
    isActive: true,
    isEnabled: false,
    isConfigured: false,
    defaultModel: 'gemini-3.5-flash-lite',
    supportedModels: ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-3.6-flash'],
    credentialMasked: null,
    credentialLastFour: null,
    lastTestedAt: null,
    updatedAt: null
  }
];

export default function AiModelsSettingsPage() {
  const [providers, setProviders] = useState<AiProviderCard[]>(DEFAULT_AI_PROVIDERS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [selectedProvider, setSelectedProvider] = useState<AiProviderCard | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [selectedModelInput, setSelectedModelInput] = useState('gemini-3.5-flash-lite');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Action states
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    provider: string;
    connected: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);
  const [togglingProvider, setTogglingProvider] = useState<string | null>(null);
  const [updatingModelProvider, setUpdatingModelProvider] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchProviders = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await apiClient.getAiProviders();
      if (res && Array.isArray(res.providers) && res.providers.length > 0) {
        setProviders(res.providers);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load AI providers');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  const handleOpenConfig = (p: AiProviderCard) => {
    setSelectedProvider(p);
    setApiKeyInput('');
    setSelectedModelInput(p.defaultModel || 'gemini-3.5-flash-lite');
  };

  const handleSaveCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProvider) return;

    try {
      setIsSubmitting(true);
      await apiClient.configureAiProvider(selectedProvider.provider, {
        apiKey: apiKeyInput,
        model: selectedModelInput
      });

      setFeedback({
        type: 'success',
        message: `${selectedProvider.displayName} API key safely encrypted with AES-256-GCM.`
      });

      setSelectedProvider(null);
      setApiKeyInput('');
      fetchProviders();
      setTimeout(() => setFeedback(null), 4000);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to encrypt and save AI credentials.'
      });
      setTimeout(() => setFeedback(null), 5000);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTestConnection = async (provider: string) => {
    try {
      setTestingProvider(provider);
      setTestResult(null);

      const res = await apiClient.testAiProvider(provider);
      setTestResult({
        provider,
        connected: res.connected,
        message: res.message,
        latencyMs: res.latencyMs
      });

      if (res.connected) {
        fetchProviders();
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

  const handleToggleEnabled = async (provider: string, currentEnabled: boolean) => {
    try {
      setTogglingProvider(provider);
      await apiClient.toggleAiProvider(provider, !currentEnabled);
      setProviders((prev) =>
        prev.map((p) => (p.provider === provider ? { ...p, isEnabled: !currentEnabled } : p))
      );
      setFeedback({
        type: 'success',
        message: `${provider} has been ${!currentEnabled ? 'enabled' : 'disabled'}`
      });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to toggle provider'
      });
      setTimeout(() => setFeedback(null), 4000);
    } finally {
      setTogglingProvider(null);
    }
  };

  const handleModelChange = async (provider: string, newModel: string) => {
    try {
      setUpdatingModelProvider(provider);
      await apiClient.updateAiModel(provider, newModel);
      setProviders((prev) =>
        prev.map((p) => (p.provider === provider ? { ...p, defaultModel: newModel } : p))
      );
      setFeedback({
        type: 'success',
        message: `Active model updated to ${newModel}`
      });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || 'Failed to update model'
      });
      setTimeout(() => setFeedback(null), 4000);
    } finally {
      setUpdatingModelProvider(null);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">AI Models & Providers</h1>
                <p className="text-sm text-slate-400">
                  Configure Gemini LLM integrations, per-tenant AES-256-GCM encryption, and buyer intelligence models.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchProviders}
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
            className="px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700 flex items-center gap-2 transition"
          >
            <Database className="w-4 h-4" />
            Data Sources & Places
          </a>
          <a
            href="/settings/ai-models"
            className="px-4 py-2.5 text-sm font-medium border-b-2 border-amber-500 text-amber-400 flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            AI Models & Gemini
          </a>
        </div>

        {/* Security & Model Strategy Banners */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 flex items-start gap-3">
            <Shield className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-semibold text-white">
                AES-256-GCM Tenant Secret Encryption Guarantee
              </p>
              <p className="text-slate-400">
                Gemini API keys are encrypted at rest with authenticated AES-256-GCM. Plaintext secrets are never stored, logged, or returned across API boundaries.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 flex items-start gap-3">
            <Cpu className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-semibold text-white">
                Model Strategy & Architecture
              </p>
              <p className="text-slate-400">
                Default: <span className="text-indigo-300 font-mono">gemini-3.5-flash-lite</span> (recommended low-cost / high-volume). Stronger: <span className="text-indigo-300 font-mono">gemini-3.8-flash</span> (advanced reasoning / generation). Legacy 3.1 & 3.6 fully supported.
              </p>
            </div>
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
                {testResult.latencyMs ? ` — ${testResult.latencyMs}ms` : ''}
              </p>
              <p className="text-xs mt-0.5 opacity-90">{testResult.message}</p>
            </div>
          </div>
        )}

        {/* AI Provider Cards Grid */}
        <div className="grid grid-cols-1 gap-4">
          {providers.map((p) => {
            const isConnected = p.status === 'CONNECTED';
            const isConfigured = p.isConfigured;
            const isEnabled = p.isEnabled;

            return (
              <div
                key={p.id}
                className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-700/80 transition-all shadow-lg space-y-5"
              >
                {/* Top Row */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30 text-amber-400">
                      <Sparkles className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h2 className="text-lg font-bold text-white">{p.displayName}</h2>
                        {isConnected ? (
                          <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            Connected
                          </span>
                        ) : isConfigured ? (
                          <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                            <Activity className="w-3 h-3" />
                            Configured
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                            Not Configured
                          </span>
                        )}

                        {isEnabled && (
                          <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                            Active in Discovery
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-1 max-w-2xl">{p.description}</p>
                    </div>
                  </div>

                  {/* Enable / Disable Switch */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleToggleEnabled(p.provider, isEnabled)}
                      disabled={togglingProvider === p.provider || !isConfigured}
                      title={!isConfigured ? 'Configure API key first' : isEnabled ? 'Disable AI discovery' : 'Enable AI discovery'}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition ${
                        isEnabled
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                          : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-300'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      {togglingProvider === p.provider ? 'Updating...' : isEnabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                </div>

                {/* Model Selection & Secret Display */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs">
                  <div>
                    <span className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold block mb-1">
                      Active Model
                    </span>
                    <div className="flex items-center gap-2">
                      <select
                        value={p.defaultModel}
                        disabled={updatingModelProvider === p.provider}
                        onChange={(e) => handleModelChange(p.provider, e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                      >
                        <optgroup label="Recommended for New Setups">
                          <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (Default / Low-Cost)</option>
                          <option value="gemini-3.8-flash">gemini-3.8-flash (Stronger / Advanced Reasoning)</option>
                        </optgroup>
                        <optgroup label="Legacy / Backward-Compatible">
                          <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Legacy Low-Cost)</option>
                          <option value="gemini-3.6-flash">gemini-3.6-flash (Legacy Stronger)</option>
                        </optgroup>
                      </select>
                    </div>
                  </div>

                  <div>
                    <span className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold block mb-1">
                      Credential Status
                    </span>
                    <div className="flex items-center gap-2 font-mono text-slate-300">
                      <Lock className="w-3.5 h-3.5 text-emerald-400" />
                      {p.credentialMasked ? (
                        <span>{p.credentialMasked}</span>
                      ) : (
                        <span className="text-slate-500 italic font-sans">No key stored</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <span className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold block mb-1">
                      Last Tested
                    </span>
                    <span className="text-slate-300">
                      {p.lastTestedAt ? formatDate(p.lastTestedAt) : 'Never tested'}
                    </span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <button
                    onClick={() => handleOpenConfig(p)}
                    className="px-3.5 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-2 transition"
                  >
                    <Key className="w-3.5 h-3.5" />
                    {isConfigured ? 'Update API Key' : 'Configure Gemini Key'}
                  </button>

                  <button
                    onClick={() => handleTestConnection(p.provider)}
                    disabled={testingProvider === p.provider || !isConfigured}
                    className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Activity className={`w-3.5 h-3.5 ${testingProvider === p.provider ? 'animate-spin' : ''}`} />
                    {testingProvider === p.provider ? 'Testing Safe Ping...' : 'Test Connection'}
                  </button>

                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-2 rounded-lg text-slate-400 hover:text-slate-200 text-xs flex items-center gap-1.5 transition ml-auto"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Get Gemini API Key
                  </a>
                </div>
              </div>
            );
          })}

          {/* Extensible Future Providers Card (Architecture Demonstration) */}
          <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800/50 space-y-3 opacity-75">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-slate-800 text-slate-400">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-300">
                  Extensible Provider Architecture (OpenAI, DeepSeek, GLM)
                </h3>
                <p className="text-xs text-slate-500">
                  The centralized AI Provider Registry is decoupled from UI and search logic. Additional LLMs can be registered without database schema mutations.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Configure Credential Modal */}
      {selectedProvider && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 space-y-5 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Configure {selectedProvider.displayName}</h3>
                  <p className="text-xs text-slate-400">API Key is stored using AES-256-GCM authenticated encryption.</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedProvider(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCredential} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Gemini API Key
                </label>
                <input
                  type="password"
                  required
                  placeholder="AIzaSy..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 font-mono"
                />
                <p className="text-[11px] text-slate-500">
                  Stored securely per-tenant. We never log or expose your API key.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Default Model
                </label>
                <select
                  value={selectedModelInput}
                  onChange={(e) => setSelectedModelInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                >
                  <optgroup label="Recommended for New Setups">
                    <option value="gemini-3.5-flash-lite">
                      gemini-3.5-flash-lite (Default / Low Cost / High Volume)
                    </option>
                    <option value="gemini-3.8-flash">
                      gemini-3.8-flash (Stronger / Advanced Reasoning)
                    </option>
                  </optgroup>
                  <optgroup label="Legacy / Backward-Compatible">
                    <option value="gemini-3.1-flash-lite">
                      gemini-3.1-flash-lite (Legacy Low-Cost)
                    </option>
                    <option value="gemini-3.6-flash">
                      gemini-3.6-flash (Legacy Stronger)
                    </option>
                  </optgroup>
                </select>
                <p className="text-[11px] text-slate-500">
                  New configurations default to gemini-3.5-flash-lite. Existing configurations with legacy models remain fully supported.
                </p>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setSelectedProvider(null)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !apiKeyInput.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center gap-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                >
                  <Lock className="w-3.5 h-3.5" />
                  {isSubmitting ? 'Encrypting & Saving...' : 'Encrypt & Save Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
