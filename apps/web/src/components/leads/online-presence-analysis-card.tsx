'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Globe,
  RefreshCw,
  Loader2,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  X,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Check,
  Minus
} from 'lucide-react';
import {
  AnalysisWebsiteStatus,
  CampaignType,
  type LeadAnalysisResponse,
  type CampaignScore
} from '@leadmate/shared';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { getSafeExternalUrl } from '@/lib/safe-url';
import { formatDate } from '@/lib/format-date';
import {
  formatWebsiteStatusLabel,
  getWebsiteStatusBadgeClasses,
  formatCampaignTypeLabel,
  formatReasonCodeLabel,
  classifyAnalysisError,
  type ClassifiedAnalysisError
} from '@/lib/leads/analysis-display';

interface OnlinePresenceAnalysisCardProps {
  leadId: string;
  canWrite: boolean;
  initialAnalysis?: LeadAnalysisResponse | null;
  initialError?: ClassifiedAnalysisError | null;
  onAnalysisUpdated?: (analysis: LeadAnalysisResponse) => void;
}

export function OnlinePresenceAnalysisCard({
  leadId,
  canWrite,
  initialAnalysis,
  initialError,
  onAnalysisUpdated
}: OnlinePresenceAnalysisCardProps) {
  const [analysis, setAnalysis] = useState<LeadAnalysisResponse | null>(
    initialAnalysis !== undefined ? initialAnalysis : null
  );
  const [isLoading, setIsLoading] = useState<boolean>(
    initialAnalysis === undefined && initialError === undefined ? true : false
  );
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [error, setError] = useState<ClassifiedAnalysisError | null>(
    initialError ?? null
  );

  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Fetch current persisted analysis on mount or leadId change
  const fetchAnalysis = useCallback(async () => {
    if (!leadId) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsLoading(true);
    setError(null);

    try {
      const data = await apiClient.leads.getAnalysis(leadId, {
        signal: abortController.signal
      });
      if (isMountedRef.current) {
        setAnalysis(data);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (isMountedRef.current) {
        setError(classifyAnalysisError(err));
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [leadId]);

  useEffect(() => {
    isMountedRef.current = true;
    if (initialAnalysis === undefined && initialError === undefined) {
      fetchAnalysis();
    }

    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchAnalysis, initialAnalysis, initialError]);

  // Execute or re-run analysis
  const handleAnalyze = async () => {
    if (!canWrite || isAnalyzing || !leadId) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      const result = await apiClient.leads.analyze(leadId);
      if (isMountedRef.current) {
        setAnalysis(result);
        if (onAnalysisUpdated) {
          onAnalysisUpdated(result);
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(classifyAnalysisError(err));
      }
    } finally {
      if (isMountedRef.current) {
        setIsAnalyzing(false);
      }
    }
  };

  return (
    <div
      id="online-presence-analysis-card"
      className="p-5 sm:p-6 rounded-xl bg-slate-950/70 border border-slate-800 shadow-md space-y-5"
    >
      {/* Card Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
              Online Presence Analysis
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Website health, online presence, and campaign qualification
          </p>
        </div>

        <div>
          {canWrite ? (
            <button
              type="button"
              id="analyze-lead-btn"
              onClick={handleAnalyze}
              disabled={isAnalyzing || isLoading}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-400 disabled:cursor-not-allowed rounded-lg shadow-sm shadow-indigo-500/20 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-300" />
                  <span>Analyzing...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-indigo-200" />
                  <span>{analysis ? 'Re-analyze' : 'Analyze Lead'}</span>
                </>
              )}
            </button>
          ) : (
            !analysis &&
            !isLoading && (
              <span className="text-xs text-slate-500 italic">
                Analysis has not been run yet.
              </span>
            )
          )}
        </div>
      </div>

      {/* Error Alert Banner */}
      {error && (
        <div
          role="alert"
          className={`p-3 rounded-lg border text-xs flex items-center justify-between gap-3 shadow-sm ${
            error.isConflict
              ? 'bg-amber-950/40 border-amber-800/50 text-amber-200'
              : error.isRateLimit
              ? 'bg-orange-950/40 border-orange-800/50 text-orange-200'
              : 'bg-red-950/40 border-red-800/50 text-red-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>{error.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-slate-400 hover:text-white p-1 rounded transition-colors"
            aria-label="Dismiss error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Initial Loading Skeleton */}
      {isLoading ? (
        <div className="py-8 flex flex-col items-center justify-center gap-3 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
          <span className="text-xs">Loading analysis data...</span>
        </div>
      ) : analysis === null ? (
        /* Empty State */
        <div className="p-8 rounded-xl bg-slate-900/40 border border-slate-800/80 text-center space-y-3">
          <div className="w-10 h-10 rounded-full bg-slate-800/80 border border-slate-700 mx-auto flex items-center justify-center text-slate-400">
            <Globe className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Not analyzed yet</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto leading-relaxed">
              Run an analysis to check the website, online presence, and campaign fit.
            </p>
          </div>
          {canWrite && (
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="mt-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-sm shadow-indigo-500/20 transition-all inline-flex items-center gap-2 cursor-pointer"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Analyzing...</span>
                </>
              ) : (
                <>
                  <Globe className="w-3.5 h-3.5" />
                  <span>Analyze Lead</span>
                </>
              )}
            </button>
          )}
        </div>
      ) : (
        /* Populated Analyzed State */
        <div className="space-y-6">
          {/* SECTION A: Website Analysis */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <span>Website Analysis</span>
              </h3>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${getWebsiteStatusBadgeClasses(
                  analysis.websiteStatus
                )}`}
              >
                {formatWebsiteStatusLabel(analysis.websiteStatus)}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 text-xs">
              <div>
                <span className="text-[11px] text-slate-500 block">Website URL</span>
                <div className="text-slate-200 mt-0.5 truncate">
                  {(() => {
                    const safeUrl = getSafeExternalUrl(analysis.websiteUrl);
                    return safeUrl ? (
                      <a
                        href={safeUrl.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 hover:underline inline-flex items-center gap-1 truncate"
                      >
                        <span className="truncate">{safeUrl.label}</span>
                        <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-slate-500">Not available</span>
                    );
                  })()}
                </div>
              </div>

              {analysis.isRedirected && analysis.finalUrl && (
                <div>
                  <span className="text-[11px] text-slate-500 block">Final Destination URL</span>
                  <div className="text-slate-200 mt-0.5 truncate">
                    {(() => {
                      const safeUrl = getSafeExternalUrl(analysis.finalUrl);
                      return safeUrl ? (
                        <a
                          href={safeUrl.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-400 hover:text-sky-300 hover:underline inline-flex items-center gap-1 truncate"
                        >
                          <span className="truncate">{safeUrl.label}</span>
                          <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-slate-500">Not available</span>
                      );
                    })()}
                  </div>
                </div>
              )}

              <div>
                <span className="text-[11px] text-slate-500 block">HTTP Status</span>
                <div className="text-slate-200 font-mono mt-0.5">
                  {analysis.httpStatusCode !== null && analysis.httpStatusCode !== undefined ? (
                    <span className="font-semibold text-slate-200">{analysis.httpStatusCode}</span>
                  ) : (
                    <span className="text-slate-500">Not available</span>
                  )}
                </div>
              </div>

              <div>
                <span className="text-[11px] text-slate-500 block">HTTPS Security</span>
                <div className="mt-0.5 flex items-center gap-1.5">
                  {analysis.isHttps ? (
                    <span className="text-emerald-400 font-medium inline-flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Enabled</span>
                    </span>
                  ) : (
                    <span className="text-slate-400 font-medium inline-flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                      <span>Not Enabled</span>
                    </span>
                  )}
                </div>
              </div>

              <div>
                <span className="text-[11px] text-slate-500 block">Redirected</span>
                <div className="text-slate-200 mt-0.5 font-medium">
                  {analysis.isRedirected ? (
                    <span className="text-indigo-300">Yes</span>
                  ) : (
                    <span className="text-slate-400">No</span>
                  )}
                </div>
              </div>

              <div>
                <span className="text-[11px] text-slate-500 block">Response Time</span>
                <div className="text-slate-200 font-mono mt-0.5 flex items-center gap-1">
                  {analysis.responseTimeMs !== null && analysis.responseTimeMs !== undefined ? (
                    <>
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>{analysis.responseTimeMs} ms</span>
                    </>
                  ) : (
                    <span className="text-slate-500">Not available</span>
                  )}
                </div>
              </div>

              {analysis.pageTitle && (
                <div className="sm:col-span-2 lg:col-span-3 pt-2 border-t border-slate-800/80">
                  <span className="text-[11px] text-slate-500 block">Page Title</span>
                  <p className="text-slate-200 font-medium mt-0.5">{analysis.pageTitle}</p>
                </div>
              )}

              {analysis.metaDescription && (
                <div className="sm:col-span-2 lg:col-span-3 pt-2 border-t border-slate-800/80">
                  <span className="text-[11px] text-slate-500 block">Meta Description</span>
                  <p className="text-slate-300 text-[11px] leading-relaxed mt-0.5">
                    {analysis.metaDescription}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* SECTION B: Online Presence Signals */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Online Presence Signals
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              {[
                { label: 'Standalone Website', detected: analysis.hasWebsite },
                { label: 'Facebook', detected: analysis.hasFacebook },
                { label: 'Instagram', detected: analysis.hasInstagram },
                { label: 'Marketplace', detected: analysis.hasMarketplace }
              ].map((channel) => (
                <div
                  key={channel.label}
                  className={`p-3 rounded-xl border flex flex-col justify-between gap-2 transition-all ${
                    channel.detected
                      ? 'bg-indigo-950/20 border-indigo-800/40 text-slate-200'
                      : 'bg-slate-900/40 border-slate-800/80 text-slate-400'
                  }`}
                >
                  <span className="text-[11px] font-medium text-slate-300">{channel.label}</span>
                  <div className="flex items-center gap-1.5">
                    {channel.detected ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-950/60 text-emerald-300 border border-emerald-800/50">
                        <Check className="w-2.5 h-2.5" />
                        <span>Detected</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-900 text-slate-400 border border-slate-800">
                        <Minus className="w-2.5 h-2.5" />
                        <span>Not detected</span>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* SECTION C: Campaign Qualification Scores */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Campaign Qualification
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {analysis.campaignScores.map((campaign: CampaignScore) => (
                <div
                  key={campaign.campaignType}
                  className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-200">
                        {formatCampaignTypeLabel(campaign.campaignType)}
                      </span>
                      <span className="text-xs font-bold font-mono text-indigo-300">
                        {campaign.score} / 100
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(0, campaign.score))}%` }}
                      />
                    </div>
                  </div>

                  {/* Reasons List */}
                  <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                    <span className="text-[10px] uppercase font-semibold text-slate-500 block">
                      Signals
                    </span>
                    {campaign.reasons.length === 0 ? (
                      <span className="text-[11px] text-slate-500 italic block">
                        No qualifying signals
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {campaign.reasons.map((reasonCode: string) => (
                          <span
                            key={reasonCode}
                            className="text-[10px] px-2 py-0.5 rounded-md bg-slate-800/90 text-slate-300 border border-slate-700/60 font-medium"
                          >
                            {formatReasonCodeLabel(reasonCode)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* SECTION D: Analysis Metadata Footer */}
          <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-500">
            <div className="flex items-center gap-4">
              <span>
                Analyzed At:{' '}
                <span className="text-slate-300">{formatDate(analysis.analyzedAt)}</span>
              </span>
              <span>
                Analyzer:{' '}
                <span className="font-mono text-slate-300">{analysis.analyzerVersion}</span>
              </span>
              <span>
                Score Version:{' '}
                <span className="font-mono text-slate-300">{analysis.scoreVersion}</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
