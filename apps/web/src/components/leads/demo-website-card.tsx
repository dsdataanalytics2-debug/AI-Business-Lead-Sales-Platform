'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Laptop,
  ExternalLink,
  RefreshCw,
  Loader2,
  AlertCircle,
  Clock,
  Trash2,
  CheckCircle2,
  X,
  ShieldAlert,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';
import {
  DemoWebsiteStatus,
  DemoWebsiteProvider,
  type DemoWebsiteSummary
} from '@leadmate/shared';
import { apiClient } from '@/lib/api-client';
import { getSafeExternalUrl } from '@/lib/safe-url';
import { formatDate } from '@/lib/format-date';
import {
  DEMO_DISCLAIMER_TEXT,
  formatDemoStatusLabel,
  getDemoStatusBadgeClasses,
  formatDemoProviderLabel,
  classifyDemoWebsiteError,
  getSafeDemoWebsiteUrl,
  type ClassifiedDemoError
} from '@/lib/leads/demo-website-display';

export interface DemoWebsiteCardProps {
  leadId: string;
  canRead?: boolean;
  canGenerate?: boolean;
  canManage?: boolean;
  initialDemo?: DemoWebsiteSummary | null;
  initialError?: ClassifiedDemoError | null;
  onDemoUpdated?: (demo: DemoWebsiteSummary | null) => void;
}

export function DemoWebsiteCard({
  leadId,
  canRead = true,
  canGenerate = false,
  canManage = false,
  initialDemo,
  initialError,
  onDemoUpdated
}: DemoWebsiteCardProps) {
  const [demo, setDemo] = useState<DemoWebsiteSummary | null>(
    initialDemo !== undefined ? initialDemo : null
  );
  const [isLoading, setIsLoading] = useState<boolean>(
    initialDemo === undefined && initialError === undefined ? true : false
  );
  const [isMutating, setIsMutating] = useState<boolean>(false);
  const [mutatingAction, setMutatingAction] = useState<string | null>(null);
  const [error, setError] = useState<ClassifiedDemoError | null>(initialError ?? null);

  // Confirmation Modal States
  const [confirmModal, setConfirmModal] = useState<'expire' | 'remove' | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Fetch current demo website on mount or leadId change
  const fetchDemo = useCallback(async () => {
    if (!leadId || !canRead) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsLoading(true);
    setError(null);

    try {
      const data = await apiClient.leads.getDemo(leadId, {
        signal: abortController.signal
      });
      if (isMountedRef.current) {
        setDemo(data);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (isMountedRef.current) {
        setError(classifyDemoWebsiteError(err));
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [leadId, canRead]);

  useEffect(() => {
    isMountedRef.current = true;
    if (initialDemo === undefined && initialError === undefined) {
      fetchDemo();
    }

    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchDemo, initialDemo, initialError]);

  // Handle Generate Demo (Initial Creation)
  const handleGenerate = async () => {
    if (!canGenerate || isMutating || !leadId) return;

    setIsMutating(true);
    setMutatingAction('generate');
    setError(null);

    try {
      const result = await apiClient.leads.createDemo(leadId, {});
      if (isMountedRef.current) {
        setDemo(result);
        if (onDemoUpdated) {
          onDemoUpdated(result);
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(classifyDemoWebsiteError(err));
      }
    } finally {
      if (isMountedRef.current) {
        setIsMutating(false);
        setMutatingAction(null);
      }
    }
  };

  // Handle Regenerate Demo
  const handleRegenerate = async () => {
    if (!canGenerate || isMutating || !leadId) return;

    setIsMutating(true);
    setMutatingAction('regenerate');
    setError(null);

    try {
      const result = await apiClient.leads.regenerateDemo(leadId, {});
      if (isMountedRef.current) {
        setDemo(result);
        if (onDemoUpdated) {
          onDemoUpdated(result);
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(classifyDemoWebsiteError(err));
      }
    } finally {
      if (isMountedRef.current) {
        setIsMutating(false);
        setMutatingAction(null);
      }
    }
  };

  // Handle Expire Demo
  const handleExpireConfirm = async () => {
    if (!canManage || isMutating || !leadId) return;

    setIsMutating(true);
    setMutatingAction('expire');
    setError(null);
    setConfirmModal(null);

    try {
      const result = await apiClient.leads.expireDemo(leadId);
      if (isMountedRef.current) {
        setDemo(result);
        if (onDemoUpdated) {
          onDemoUpdated(result);
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(classifyDemoWebsiteError(err));
      }
    } finally {
      if (isMountedRef.current) {
        setIsMutating(false);
        setMutatingAction(null);
      }
    }
  };

  // Handle Remove Demo
  const handleRemoveConfirm = async () => {
    if (!canManage || isMutating || !leadId) return;

    setIsMutating(true);
    setMutatingAction('remove');
    setError(null);
    setConfirmModal(null);

    try {
      const result = await apiClient.leads.removeDemo(leadId);
      if (isMountedRef.current) {
        setDemo(result);
        if (onDemoUpdated) {
          onDemoUpdated(result);
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(classifyDemoWebsiteError(err));
      }
    } finally {
      if (isMountedRef.current) {
        setIsMutating(false);
        setMutatingAction(null);
      }
    }
  };

  const safeDemoUrl = demo?.demoUrl ? getSafeDemoWebsiteUrl(demo.demoUrl) : null;
  const isReady = demo?.status === DemoWebsiteStatus.READY;
  const isCreating = demo?.status === DemoWebsiteStatus.CREATING || demo?.status === DemoWebsiteStatus.REQUESTED;
  const isExpired = demo?.status === DemoWebsiteStatus.EXPIRED;
  const isFailed = demo?.status === DemoWebsiteStatus.FAILED;
  const isRemoved = demo?.status === DemoWebsiteStatus.REMOVED;

  return (
    <div
      id="demo-website-card"
      className="p-5 sm:p-6 rounded-xl bg-slate-950/70 border border-slate-800 shadow-md space-y-5"
    >
      {/* Card Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2">
            <Laptop className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
              Demo Website
            </h2>
            <span
              id="demo-disclaimer-badge"
              className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/60 border border-amber-700/60 text-amber-300 tracking-wider uppercase"
              title="Demonstration preview only - not an official business site"
            >
              {DEMO_DISCLAIMER_TEXT}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Preview storefront generated from discovered business information
          </p>
        </div>

        <div className="flex items-center gap-2">
          {demo && (
            <span className="text-[11px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 font-mono">
              {formatDemoProviderLabel(demo.provider)}
            </span>
          )}
        </div>
      </div>

      {/* Error Alert Banner */}
      {error && (
        <div
          role="alert"
          className={`p-3 rounded-lg border text-xs flex items-center justify-between gap-3 shadow-sm ${
            error.isUnavailable
              ? 'bg-amber-950/40 border-amber-800/50 text-amber-200'
              : error.isForbidden
              ? 'bg-rose-950/40 border-rose-800/50 text-rose-200'
              : 'bg-red-950/40 border-red-800/50 text-red-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>{error.message}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchDemo()}
              className="px-2 py-0.5 text-[11px] font-medium rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-slate-400 hover:text-white p-1 rounded transition-colors"
              aria-label="Dismiss error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading ? (
        <div className="py-8 flex flex-col items-center justify-center gap-3 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
          <span className="text-xs">Loading demo website details...</span>
        </div>
      ) : demo === null ? (
        /* Empty State: No Demo Generated Yet */
        <div className="p-8 rounded-xl bg-slate-900/40 border border-slate-800/80 text-center space-y-3">
          <div className="w-10 h-10 rounded-full bg-slate-800/80 border border-slate-700 mx-auto flex items-center justify-center text-slate-400">
            <Laptop className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">
              Demo website has not been generated yet.
            </h3>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto leading-relaxed">
              Generate a non-indexed demo website using verified business details to present during sales outreach.
            </p>
          </div>
          {canGenerate ? (
            <button
              type="button"
              id="demo-generate-btn"
              onClick={handleGenerate}
              disabled={isMutating}
              className="mt-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-400 disabled:cursor-not-allowed rounded-lg shadow-sm shadow-indigo-500/20 transition-all inline-flex items-center gap-2 cursor-pointer"
            >
              {isMutating && mutatingAction === 'generate' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-300" />
                  <span>Generating Demo...</span>
                </>
              ) : (
                <>
                  <Laptop className="w-3.5 h-3.5" />
                  <span>Generate Demo</span>
                </>
              )}
            </button>
          ) : (
            <p className="text-xs text-slate-500 italic">
              Demo generation requires sales executive or managerial permission.
            </p>
          )}
        </div>
      ) : (
        /* Populated Demo State */
        <div className="space-y-5">
          {/* Status and Overview Grid */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Demo Status:
              </span>
              <span
                id="demo-status-badge"
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getDemoStatusBadgeClasses(
                  demo.status
                )}`}
              >
                {formatDemoStatusLabel(demo.status)}
              </span>
            </div>

            {/* Top Right Quick Actions */}
            <div className="flex items-center gap-2">
              {isReady && safeDemoUrl && (
                <a
                  href={safeDemoUrl.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  id="demo-open-btn"
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-sm shadow-indigo-500/20 transition-all inline-flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Demo</span>
                </a>
              )}
            </div>
          </div>

          {/* Details Specification Box */}
          <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 text-xs">
            <div>
              <span className="text-[11px] text-slate-500 block">Demo URL</span>
              <div className="text-slate-200 mt-0.5 truncate font-mono">
                {safeDemoUrl ? (
                  <a
                    href={safeDemoUrl.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-400 hover:text-indigo-300 hover:underline inline-flex items-center gap-1 truncate"
                  >
                    <span className="truncate">{safeDemoUrl.label}</span>
                    <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                  </a>
                ) : (
                  <span className="text-slate-500">Not available</span>
                )}
              </div>
            </div>

            <div>
              <span className="text-[11px] text-slate-500 block">Ready Since</span>
              <div className="text-slate-200 mt-0.5 flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-400" />
                <span>{formatDate(demo.readyAt || demo.createdAt)}</span>
              </div>
            </div>

            <div>
              <span className="text-[11px] text-slate-500 block">Expires</span>
              <div
                className={`mt-0.5 flex items-center gap-1 ${
                  isExpired ? 'text-amber-400 font-semibold' : 'text-slate-300'
                }`}
              >
                <Clock className="w-3 h-3 text-slate-400" />
                <span>{formatDate(demo.expiresAt)}</span>
              </div>
            </div>

            {demo.requestedByUser && (
              <div className="sm:col-span-2 lg:col-span-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
                <span>
                  Requested by:{' '}
                  <span className="text-slate-200 font-medium">{demo.requestedByUser.name}</span>{' '}
                  <span className="text-slate-500">({demo.requestedByUser.email})</span>
                </span>
                <span className="text-slate-500">
                  Last updated: {formatDate(demo.updatedAt)}
                </span>
              </div>
            )}
          </div>

          {/* Special State Alerts */}
          {isCreating && (
            <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-800/40 text-indigo-300 text-xs flex items-center gap-2.5">
              <Loader2 className="w-4 h-4 animate-spin shrink-0 text-indigo-400" />
              <div>
                <span className="font-semibold block">Demo Generation In Progress</span>
                <span className="text-indigo-400/90 text-[11px]">
                  The preview site is being synthesized. This usually completes in a few seconds.
                </span>
              </div>
            </div>
          )}

          {isFailed && (
            <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-200 text-xs space-y-1">
              <div className="flex items-center gap-2 font-semibold">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                <span>Demo Generation Failed</span>
              </div>
              <p className="text-[11px] text-rose-300">
                {demo.lastErrorMessageSafe || 'Unable to build demo website with current lead parameters.'}
              </p>
            </div>
          )}

          {isExpired && (
            <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-200 text-xs space-y-1">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>Demo Access Expired</span>
              </div>
              <p className="text-[11px] text-amber-300/90">
                This demo has passed its validity window. Regenerate the demo to extend its expiration.
              </p>
            </div>
          )}

          {isRemoved && (
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-slate-400 text-xs space-y-1">
              <div className="flex items-center gap-2 font-medium text-slate-300">
                <Trash2 className="w-4 h-4 text-slate-500" />
                <span>Demo Unpublished</span>
              </div>
              <p className="text-[11px] text-slate-400">
                This demo website has been soft-removed and unpublished. The historical record remains in the database.
              </p>
            </div>
          )}

          {/* Action Buttons Bar */}
          {!isRemoved && (
            <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-800/80">
              {/* Regenerate / Retry (DEMOS_GENERATE) */}
              {canGenerate && (isReady || isFailed || isExpired) && (
                <button
                  type="button"
                  id="demo-regenerate-btn"
                  onClick={handleRegenerate}
                  disabled={isMutating}
                  className="px-3.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg border border-slate-700 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {isMutating && mutatingAction === 'regenerate' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                  )}
                  <span>{isFailed ? 'Retry Generation' : 'Regenerate'}</span>
                </button>
              )}

              {/* Expire (DEMOS_MANAGE) */}
              {canManage && isReady && (
                <button
                  type="button"
                  id="demo-expire-btn"
                  onClick={() => setConfirmModal('expire')}
                  disabled={isMutating}
                  className="px-3 py-1.5 text-xs font-medium text-amber-300 hover:text-amber-200 bg-amber-950/30 hover:bg-amber-950/60 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg border border-amber-800/50 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Expire Demo</span>
                </button>
              )}

              {/* Remove (DEMOS_MANAGE) */}
              {canManage && (isReady || isExpired || isFailed) && (
                <button
                  type="button"
                  id="demo-remove-btn"
                  onClick={() => setConfirmModal('remove')}
                  disabled={isMutating}
                  className="px-3 py-1.5 text-xs font-medium text-rose-400 hover:text-rose-300 bg-rose-950/30 hover:bg-rose-950/60 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg border border-rose-800/50 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove Demo</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal for Expire */}
      {confirmModal === 'expire' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md p-6 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-100">
                  Expire this demo website?
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Marking this demo as expired will indicate to your team that the active demonstration window has closed. You can regenerate it later if needed.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                disabled={isMutating}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                id="demo-confirm-expire-btn"
                onClick={handleExpireConfirm}
                disabled={isMutating}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                {isMutating && mutatingAction === 'expire' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Clock className="w-3.5 h-3.5" />
                )}
                <span>Confirm Expire</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Remove */}
      {confirmModal === 'remove' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md p-6 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-100">
                  Remove this demo website?
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  The demo website will be unpublished and marked as removed. The historical record and audit trail remain preserved in LeadAtlas.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                disabled={isMutating}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                id="demo-confirm-remove-btn"
                onClick={handleRemoveConfirm}
                disabled={isMutating}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                {isMutating && mutatingAction === 'remove' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                <span>Confirm Remove</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
