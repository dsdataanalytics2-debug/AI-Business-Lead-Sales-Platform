'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sparkles,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Clock,
  ShieldAlert,
  User,
  History,
  FileText
} from 'lucide-react';
import {
  SalesAssistantDraftType,
  SalesAssistantLanguage,
  SalesAssistantTone,
  SalesAssistantDraftStatus,
  SalesAssistantWarning,
  type SalesAssistantDraftSummary,
  type GenerateSalesAssistantDraftRequest
} from '@leadmate/shared';
import { apiClient } from '@/lib/api-client';
import { formatDate } from '@/lib/format-date';
import {
  SALES_ASSISTANT_APPROVAL_NOTICE,
  SALES_ASSISTANT_UNVERIFIED_WHATSAPP_NOTICE,
  formatSalesAssistantDraftTypeLabel,
  formatSalesAssistantLanguageLabel,
  formatSalesAssistantToneLabel,
  getSalesAssistantStatusBadgeClasses,
  getSalesAssistantWarningMessage,
  formatDraftForClipboard,
  classifySalesAssistantError,
  type ClassifiedSalesAssistantError
} from '@/lib/leads/sales-assistant-display';

export interface SalesAssistantCardProps {
  leadId: string;
  canRead?: boolean;
  canGenerate?: boolean;
  canReview?: boolean;
  initialDrafts?: SalesAssistantDraftSummary[];
  initialSelectedDraft?: SalesAssistantDraftSummary | null;
  initialError?: ClassifiedSalesAssistantError | null;
  onDraftCreated?: (draft: SalesAssistantDraftSummary) => void;
  onDraftReviewed?: (draft: SalesAssistantDraftSummary) => void;
}

const OBJECTIVE_MAX_LENGTH = 300;
const CUSTOM_INSTRUCTION_MAX_LENGTH = 1000;

export function SalesAssistantCard({
  leadId,
  canRead = true,
  canGenerate = false,
  canReview = false,
  initialDrafts,
  initialSelectedDraft,
  initialError,
  onDraftCreated,
  onDraftReviewed
}: SalesAssistantCardProps) {
  const [drafts, setDrafts] = useState<SalesAssistantDraftSummary[]>(
    initialDrafts !== undefined ? initialDrafts : []
  );
  const [selectedDraft, setSelectedDraft] = useState<SalesAssistantDraftSummary | null>(
    initialSelectedDraft !== undefined
      ? initialSelectedDraft
      : initialDrafts && initialDrafts.length > 0
      ? initialDrafts[0]
      : null
  );
  const [isLoading, setIsLoading] = useState<boolean>(
    initialDrafts === undefined && initialError === undefined
  );
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isReviewing, setIsReviewing] = useState<boolean>(false);
  const [error, setError] = useState<ClassifiedSalesAssistantError | null>(
    initialError ?? null
  );
  const [feedback, setFeedback] = useState<{ type: 'success' | 'info'; message: string } | null>(
    null
  );
  const [copied, setCopied] = useState<boolean>(false);

  // Review Confirmation Modal
  const [confirmModal, setConfirmModal] = useState<'approve' | 'reject' | null>(null);

  // Form State
  const [draftType, setDraftType] = useState<SalesAssistantDraftType>(
    SalesAssistantDraftType.WHATSAPP
  );
  const [language, setLanguage] = useState<SalesAssistantLanguage>(
    SalesAssistantLanguage.BANGLA
  );
  const [tone, setTone] = useState<SalesAssistantTone>(SalesAssistantTone.PROFESSIONAL);
  const [objective, setObjective] = useState<string>('');
  const [customInstruction, setCustomInstruction] = useState<string>('');

  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTemporaryFeedback = (type: 'success' | 'info', message: string) => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    setFeedback({ type, message });
    feedbackTimerRef.current = setTimeout(() => {
      setFeedback(null);
    }, 4000);
  };

  // Fetch drafts history
  const fetchDrafts = useCallback(
    async (selectNewest = false) => {
      if (!leadId || !canRead) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setIsLoading(true);
      setError(null);

      try {
        const list = await apiClient.leads.listSalesAssistantDrafts(leadId, {
          signal: abortController.signal
        });
        if (isMountedRef.current) {
          setDrafts(list);
          if (selectNewest && list.length > 0) {
            setSelectedDraft(list[0]);
          } else if (selectedDraft) {
            // Keep current selection fresh if still in list
            const fresh = list.find((d) => d.id === selectedDraft.id);
            if (fresh) {
              setSelectedDraft(fresh);
            } else if (list.length > 0) {
              setSelectedDraft(list[0]);
            } else {
              setSelectedDraft(null);
            }
          } else if (list.length > 0) {
            setSelectedDraft(list[0]);
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        if (isMountedRef.current) {
          setError(classifySalesAssistantError(err));
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [leadId, canRead, selectedDraft]
  );

  useEffect(() => {
    isMountedRef.current = true;
    if (initialDrafts === undefined && initialError === undefined) {
      fetchDrafts();
    }
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
    };
  }, [fetchDrafts, initialDrafts, initialError]);

  // Form Submission: Generate Draft
  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canGenerate || isGenerating) return;

    if (objective.length > OBJECTIVE_MAX_LENGTH) {
      setError({
        message: `Objective must not exceed ${OBJECTIVE_MAX_LENGTH} characters.`,
        isConflict: false,
        isRateLimited: false,
        isForbidden: false,
        isNotFound: false,
        isValidation: true,
        isTimeout: false,
        isUnavailable: false
      });
      return;
    }

    if (customInstruction.length > CUSTOM_INSTRUCTION_MAX_LENGTH) {
      setError({
        message: `Custom instruction must not exceed ${CUSTOM_INSTRUCTION_MAX_LENGTH} characters.`,
        isConflict: false,
        isRateLimited: false,
        isForbidden: false,
        isNotFound: false,
        isValidation: true,
        isTimeout: false,
        isUnavailable: false
      });
      return;
    }

    setIsGenerating(true);
    setError(null);

    const payload: GenerateSalesAssistantDraftRequest = {
      type: draftType,
      language,
      tone,
      objective: objective.trim() ? objective.trim() : undefined,
      customInstruction: customInstruction.trim() ? customInstruction.trim() : undefined
    };

    try {
      const created = await apiClient.leads.generateSalesAssistantDraft(leadId, payload);
      if (isMountedRef.current) {
        setDrafts((prev) => [created, ...prev.filter((d) => d.id !== created.id)]);
        setSelectedDraft(created);
        setObjective('');
        setCustomInstruction('');
        showTemporaryFeedback('success', 'Draft generated successfully. Human approval required.');
        if (onDraftCreated) {
          onDraftCreated(created);
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(classifySalesAssistantError(err));
      }
    } finally {
      if (isMountedRef.current) {
        setIsGenerating(false);
      }
    }
  };

  // Review Actions: Approve / Reject
  const handleReviewAction = async (action: 'approve' | 'reject') => {
    if (!selectedDraft || !canReview || isReviewing) return;
    setConfirmModal(null);
    setIsReviewing(true);
    setError(null);

    try {
      let updated: SalesAssistantDraftSummary;
      if (action === 'approve') {
        updated = await apiClient.leads.approveSalesAssistantDraft(leadId, selectedDraft.id);
        showTemporaryFeedback('success', 'Draft approved successfully.');
      } else {
        updated = await apiClient.leads.rejectSalesAssistantDraft(leadId, selectedDraft.id);
        showTemporaryFeedback('info', 'Draft marked as rejected.');
      }

      if (isMountedRef.current) {
        setSelectedDraft(updated);
        setDrafts((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
        if (onDraftReviewed) {
          onDraftReviewed(updated);
        }
      }
    } catch (err) {
      const classified = classifySalesAssistantError(err);
      if (isMountedRef.current) {
        setError(classified);
        if (classified.isConflict) {
          // 409 Conflict: refetch latest draft and history
          fetchDrafts();
        }
      }
    } finally {
      if (isMountedRef.current) {
        setIsReviewing(false);
      }
    }
  };

  // Copy Draft Content
  const handleCopy = async () => {
    if (!selectedDraft) return;
    const textToCopy = formatDraftForClipboard(selectedDraft);
    if (!textToCopy) return;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        // Fallback for non-secure / test environments
        const textArea = document.createElement('textarea');
        textArea.value = textToCopy;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      showTemporaryFeedback('success', 'Copied to clipboard.');
    } catch {
      showTemporaryFeedback('info', 'Failed to copy to clipboard.');
    }
  };

  const isObjectiveOver = objective.length > OBJECTIVE_MAX_LENGTH;
  const isCustomInstructionOver = customInstruction.length > CUSTOM_INSTRUCTION_MAX_LENGTH;
  const isSubmitDisabled = isGenerating || isObjectiveOver || isCustomInstructionOver;

  return (
    <div
      id="sales-assistant-card"
      className="p-5 rounded-xl bg-slate-950/70 border border-slate-800 shadow-md space-y-6"
    >
      {/* Card Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-4">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>AI Sales Assistant</span>
          </h2>
          <p className="text-[11px] text-slate-500 mt-1">
            Generate sales drafts using verified lead context. All generated content requires human
            approval before use.
          </p>
        </div>

        {selectedDraft && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span
              id="selected-draft-status-badge"
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wider uppercase border ${getSalesAssistantStatusBadgeClasses(
                selectedDraft.status
              )}`}
            >
              {selectedDraft.status}
            </span>
          </div>
        )}
      </div>

      {/* Global Error Banner */}
      {error && (
        <div
          id="sales-assistant-error-banner"
          className="p-3.5 rounded-lg bg-rose-950/30 border border-rose-800/50 text-rose-300 text-xs flex items-start justify-between gap-3 shadow-sm"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">{error.message}</div>
              {error.isConflict && (
                <div className="text-[11px] text-rose-400 mt-1">
                  Draft was updated by another reviewer. Refetching latest status...
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-rose-400 hover:text-rose-200 text-xs cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Feedback Banner */}
      {feedback && (
        <div
          id="sales-assistant-feedback-banner"
          className={`p-3 rounded-lg text-xs flex items-center gap-2 shadow-sm ${
            feedback.type === 'success'
              ? 'bg-emerald-950/40 border border-emerald-800/50 text-emerald-300'
              : 'bg-slate-900 border border-slate-700 text-slate-300'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Generation Form (Visible only to authorized generators) */}
      {canGenerate ? (
        <form onSubmit={handleGenerate} className="space-y-4 bg-slate-900/30 p-4 rounded-lg border border-slate-800/60">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-indigo-400" />
              <span>Create New Draft</span>
            </span>
            <span className="text-[10px] text-slate-500">Drafts only • No auto-send</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            {/* Draft Type */}
            <div>
              <label htmlFor="sales-assistant-type" className="block text-slate-400 font-medium mb-1">
                Draft Type
              </label>
              <select
                id="sales-assistant-type"
                value={draftType}
                onChange={(e) => setDraftType(e.target.value as SalesAssistantDraftType)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              >
                <option value={SalesAssistantDraftType.WHATSAPP}>WhatsApp Message</option>
                <option value={SalesAssistantDraftType.EMAIL}>Email Outreach</option>
                <option value={SalesAssistantDraftType.CALL_SCRIPT}>Phone Call Script</option>
                <option value={SalesAssistantDraftType.PROPOSAL}>Sales Proposal</option>
                <option value={SalesAssistantDraftType.FOLLOW_UP}>Follow-up Note</option>
              </select>
            </div>

            {/* Language */}
            <div>
              <label htmlFor="sales-assistant-language" className="block text-slate-400 font-medium mb-1">
                Language
              </label>
              <select
                id="sales-assistant-language"
                value={language}
                onChange={(e) => setLanguage(e.target.value as SalesAssistantLanguage)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              >
                <option value={SalesAssistantLanguage.BANGLA}>Bangla</option>
                <option value={SalesAssistantLanguage.ENGLISH}>English</option>
                <option value={SalesAssistantLanguage.MIXED}>Mixed (Banglish)</option>
              </select>
            </div>

            {/* Tone */}
            <div>
              <label htmlFor="sales-assistant-tone" className="block text-slate-400 font-medium mb-1">
                Tone
              </label>
              <select
                id="sales-assistant-tone"
                value={tone}
                onChange={(e) => setTone(e.target.value as SalesAssistantTone)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              >
                <option value={SalesAssistantTone.PROFESSIONAL}>Professional</option>
                <option value={SalesAssistantTone.FRIENDLY}>Friendly</option>
                <option value={SalesAssistantTone.CONCISE}>Concise</option>
                <option value={SalesAssistantTone.PERSUASIVE}>Persuasive</option>
              </select>
            </div>
          </div>

          {/* Objective */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="sales-assistant-objective" className="block text-slate-400 font-medium text-xs">
                Objective (Optional)
              </label>
              <span
                id="objective-char-counter"
                className={`text-[10px] font-mono ${
                  isObjectiveOver ? 'text-rose-400 font-semibold' : 'text-slate-500'
                }`}
              >
                {objective.length} / {OBJECTIVE_MAX_LENGTH}
              </span>
            </div>
            <input
              id="sales-assistant-objective"
              type="text"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="e.g. Schedule product demo meeting with manager"
              maxLength={OBJECTIVE_MAX_LENGTH + 20}
              className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          {/* Custom Instruction */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="sales-assistant-custom-instruction"
                className="block text-slate-400 font-medium text-xs"
              >
                Custom Instruction (Optional)
              </label>
              <span
                id="custom-instruction-char-counter"
                className={`text-[10px] font-mono ${
                  isCustomInstructionOver ? 'text-rose-400 font-semibold' : 'text-slate-500'
                }`}
              >
                {customInstruction.length} / {CUSTOM_INSTRUCTION_MAX_LENGTH}
              </span>
            </div>
            <textarea
              id="sales-assistant-custom-instruction"
              rows={2}
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              placeholder="e.g. Emphasize fast setup in Bangladesh; mention local payment methods"
              maxLength={CUSTOM_INSTRUCTION_MAX_LENGTH + 50}
              className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end">
            <button
              id="sales-assistant-generate-btn"
              type="submit"
              disabled={isSubmitDisabled}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm shadow-indigo-500/20 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Generating...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Generate Draft</span>
                </>
              )}
            </button>
          </div>
        </form>
      ) : (
        <div className="p-3 bg-slate-900/30 rounded-lg border border-slate-800 text-xs text-slate-400">
          Sales draft generation is restricted to authorized sales and administration roles.
        </div>
      )}

      {/* Selected Draft View / Preview */}
      {selectedDraft ? (
        <div className="space-y-4 pt-2 border-t border-slate-800/80">
          {/* Draft Attributes & Human Approval Notice */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium border border-slate-700">
                {formatSalesAssistantDraftTypeLabel(selectedDraft.type)}
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium border border-slate-700">
                {formatSalesAssistantLanguageLabel(selectedDraft.language)}
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium border border-slate-700">
                {formatSalesAssistantToneLabel(selectedDraft.tone)}
              </span>
              <span
                className={`px-2 py-0.5 rounded font-semibold border ${getSalesAssistantStatusBadgeClasses(
                  selectedDraft.status
                )}`}
              >
                {selectedDraft.status}
              </span>
            </div>

            {/* Copy Button */}
            <button
              id="sales-assistant-copy-btn"
              type="button"
              onClick={handleCopy}
              className="px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 text-slate-400" />
                  <span>{selectedDraft.type === SalesAssistantDraftType.EMAIL ? 'Copy Email' : 'Copy Draft'}</span>
                </>
              )}
            </button>
          </div>

          {/* DRAFT Mandatory Human Approval Notice */}
          {selectedDraft.status === SalesAssistantDraftStatus.DRAFT && (
            <div
              id="human-approval-notice"
              className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/40 text-amber-300 text-xs flex items-center gap-2"
            >
              <Clock className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{SALES_ASSISTANT_APPROVAL_NOTICE}</span>
            </div>
          )}

          {/* Warnings List */}
          {selectedDraft.warnings && selectedDraft.warnings.length > 0 && (
            <div id="sales-assistant-warnings" className="space-y-1.5">
              <span className="text-[10px] uppercase font-semibold text-slate-500 block">
                Safety & Quality Warnings ({selectedDraft.warnings.length})
              </span>
              <div className="space-y-1">
                {selectedDraft.warnings.map((warning, idx) => {
                  const isUnverifiedWa = warning === SalesAssistantWarning.UNVERIFIED_WHATSAPP;
                  return (
                    <div
                      key={`${warning}-${idx}`}
                      className={`p-2.5 rounded-lg text-xs flex items-start gap-2 ${
                        isUnverifiedWa
                          ? 'bg-rose-950/30 border border-rose-800/50 text-rose-300'
                          : 'bg-slate-900 border border-slate-800 text-amber-300'
                      }`}
                    >
                      <ShieldAlert
                        className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                          isUnverifiedWa ? 'text-rose-400' : 'text-amber-400'
                        }`}
                      />
                      <div className="space-y-0.5">
                        <div className="font-medium">{getSalesAssistantWarningMessage(warning)}</div>
                        {isUnverifiedWa && (
                          <div className="text-[10px] text-rose-400">
                            <div>{SALES_ASSISTANT_UNVERIFIED_WHATSAPP_NOTICE}</div>
                            <div className="mt-0.5">Strict safety guard: phone numbers are never promoted to WhatsApp without verified confirmation.</div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Objective Display if available */}
          {selectedDraft.objective && (
            <div className="text-xs">
              <span className="text-slate-500 block text-[11px] mb-0.5 font-medium">Objective:</span>
              <div className="p-2 rounded bg-slate-900/60 border border-slate-800 text-slate-300 font-mono text-[11px]">
                {selectedDraft.objective}
              </div>
            </div>
          )}

          {/* Content Body Display */}
          <div className="space-y-3">
            {selectedDraft.type === SalesAssistantDraftType.EMAIL ? (
              <div className="space-y-2">
                <div>
                  <span className="text-slate-500 block text-[11px] mb-1 font-medium">Subject Line:</span>
                  <div
                    id="draft-email-subject"
                    className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs font-medium whitespace-pre-wrap break-words"
                  >
                    {selectedDraft.emailSubject || '(Empty subject)'}
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 block text-[11px] mb-1 font-medium">Email Body:</span>
                  <div
                    id="draft-email-body"
                    className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs leading-relaxed whitespace-pre-wrap break-words font-sans min-h-[120px]"
                  >
                    {selectedDraft.emailBody || '(Empty body)'}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <span className="text-slate-500 block text-[11px] mb-1 font-medium">Draft Content:</span>
                <div
                  id="draft-content"
                  className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs leading-relaxed whitespace-pre-wrap break-words font-sans min-h-[100px]"
                >
                  {selectedDraft.content || '(Empty content)'}
                </div>
              </div>
            )}
          </div>

          {/* Metadata & Review Attribution */}
          <div className="pt-3 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <div className="flex items-center gap-1.5">
              <User className="w-3 h-3 text-slate-400" />
              <span>
                Created by {selectedDraft.createdByUser?.name || 'User'} ({formatDate(selectedDraft.createdAt)})
              </span>
            </div>

            {selectedDraft.status === SalesAssistantDraftStatus.APPROVED && selectedDraft.approvedAt && (
              <div id="approved-attribution" className="text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>
                  Approved by {selectedDraft.approvedByUser?.name || 'Reviewer'} ({formatDate(selectedDraft.approvedAt)})
                </span>
              </div>
            )}

            {selectedDraft.status === SalesAssistantDraftStatus.REJECTED && selectedDraft.rejectedAt && (
              <div id="rejected-attribution" className="text-rose-400 flex items-center gap-1">
                <XCircle className="w-3 h-3" />
                <span>
                  Rejected by {selectedDraft.rejectedByUser?.name || 'Reviewer'} ({formatDate(selectedDraft.rejectedAt)})
                </span>
              </div>
            )}
          </div>

          {/* Review Actions (Approve / Reject) — only if DRAFT and user has SALES_ASSISTANT_REVIEW */}
          {selectedDraft.status === SalesAssistantDraftStatus.DRAFT && canReview && (
            <div id="draft-review-controls" className="pt-2 flex items-center justify-end gap-2.5">
              <button
                id="reject-draft-btn"
                type="button"
                disabled={isReviewing}
                onClick={() => setConfirmModal('reject')}
                className="px-3 py-1.5 text-xs font-semibold text-rose-300 hover:text-white bg-rose-950/40 hover:bg-rose-900 border border-rose-800/60 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
              >
                Reject Draft
              </button>

              <button
                id="approve-draft-btn"
                type="button"
                disabled={isReviewing}
                onClick={() => setConfirmModal('approve')}
                className="px-3.5 py-1.5 text-xs font-semibold text-emerald-200 bg-emerald-900/60 hover:bg-emerald-800 border border-emerald-700 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isReviewing ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Approve Draft</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Empty State */
        <div id="sales-assistant-empty-state" className="p-8 rounded-lg bg-slate-900/40 border border-slate-800/80 text-center space-y-2">
          <FileText className="w-8 h-8 text-slate-600 mx-auto" />
          <div className="text-xs text-slate-400 font-medium">
            {canGenerate
              ? 'No AI sales drafts have been created yet. Generate your first draft above.'
              : 'No AI sales drafts are available yet.'}
          </div>
          <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
            Drafts will be formatted for review with full provenance, safety warnings, and approval tracking.
          </p>
        </div>
      )}

      {/* History Section */}
      {drafts.length > 0 && (
        <div id="sales-assistant-history" className="space-y-3 pt-3 border-t border-slate-800/80">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-indigo-400" />
              <span>Draft History ({drafts.length})</span>
            </h3>
            <span className="text-[10px] text-slate-500">Sorted newest first</span>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {drafts.map((d) => {
              const isSelected = selectedDraft?.id === d.id;
              return (
                <div
                  key={d.id}
                  onClick={() => setSelectedDraft(d)}
                  className={`p-3 rounded-lg border text-xs cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-slate-900 border-indigo-500/80 shadow-sm shadow-indigo-500/10'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-200">
                        {formatSalesAssistantDraftTypeLabel(d.type)}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        ({formatSalesAssistantLanguageLabel(d.language)} • {formatSalesAssistantToneLabel(d.tone)})
                      </span>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${getSalesAssistantStatusBadgeClasses(
                        d.status
                      )}`}
                    >
                      {d.status}
                    </span>
                  </div>

                  <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500">
                    <span>{formatDate(d.createdAt)}</span>
                    {d.warnings && d.warnings.length > 0 && (
                      <span className="text-amber-400 font-medium flex items-center gap-1">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        <span>{d.warnings.length} warning{d.warnings.length > 1 ? 's' : ''}</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-4 shadow-xl">
            <h3 className="text-sm font-semibold text-slate-100">
              {confirmModal === 'approve' ? 'Approve this draft?' : 'Reject this draft?'}
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {confirmModal === 'approve'
                ? 'This marks the draft as reviewed and approved. It will not be sent automatically.'
                : 'The draft will be marked rejected and cannot be approved later.'}
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                disabled={isReviewing}
                className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                id={`confirm-${confirmModal}-btn`}
                onClick={() => handleReviewAction(confirmModal)}
                disabled={isReviewing}
                className={`px-3.5 py-1.5 text-xs font-semibold text-white rounded-lg transition-colors cursor-pointer ${
                  confirmModal === 'approve'
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : 'bg-rose-600 hover:bg-rose-500'
                }`}
              >
                {confirmModal === 'approve' ? 'Approve Draft' : 'Reject Draft'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
