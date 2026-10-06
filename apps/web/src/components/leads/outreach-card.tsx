'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Send,
  Mail,
  MessageSquare,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  FileText,
  ShieldCheck,
  ShieldAlert,
  Info
} from 'lucide-react';
import {
  OutreachChannel,
  OutreachDeliveryStatus,
  SalesAssistantDraftType,
  SalesAssistantDraftStatus,
  type SalesAssistantDraftSummary,
  type OutreachDeliverySummary,
  type LeadDetail,
  getAllowedOutreachChannelsForDraftType,
  isOutreachChannelCompatible
} from '@leadmate/shared';
import { apiClient } from '@/lib/api-client';
import { formatDate } from '@/lib/format-date';
import {
  formatOutreachStatusLabel,
  formatOutreachStatusDescription,
  getOutreachStatusBadgeClasses,
  formatOutreachChannelLabel,
  resolveRecipientCandidates,
  classifyOutreachError,
  type RecipientCandidate,
  type ClassifiedOutreachError
} from '@/lib/leads/outreach-display';
import { formatSalesAssistantDraftTypeLabel } from '@/lib/leads/sales-assistant-display';
import { OutreachDeliveryModal } from './outreach-delivery-modal';

export interface OutreachCardProps {
  lead: LeadDetail;
  canRead?: boolean;
  canSend?: boolean;
  approvedDrafts?: SalesAssistantDraftSummary[];
  initialDeliveries?: OutreachDeliverySummary[];
  onDeliveryRequested?: (delivery: OutreachDeliverySummary) => void;
}

export function OutreachCard({
  lead,
  canRead = true,
  canSend = false,
  approvedDrafts,
  initialDeliveries,
  onDeliveryRequested
}: OutreachCardProps) {
  const [deliveries, setDeliveries] = useState<OutreachDeliverySummary[]>(
    initialDeliveries !== undefined ? initialDeliveries : []
  );
  const [isLoading, setIsLoading] = useState<boolean>(initialDeliveries === undefined);
  const [draftsList, setDraftsList] = useState<SalesAssistantDraftSummary[]>(
    approvedDrafts !== undefined ? approvedDrafts : []
  );

  // Form / Selection State
  const [selectedDraftId, setSelectedDraftId] = useState<string>('');
  const [selectedChannel, setSelectedChannel] = useState<OutreachChannel | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string>('');

  // Modal & Request State
  const [isConfirmOpen, setIsConfirmOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [activeIdempotencyKey, setActiveIdempotencyKey] = useState<string | null>(null);
  const [error, setError] = useState<ClassifiedOutreachError | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'info'; message: string } | null>(
    null
  );
  const [expandedDeliveryId, setExpandedDeliveryId] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedback = (type: 'success' | 'info', message: string) => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    setFeedback({ type, message });
    feedbackTimerRef.current = setTimeout(() => {
      setFeedback(null);
    }, 4000);
  };

  // Fetch delivery history
  const fetchDeliveries = useCallback(async () => {
    if (!lead?.id || !canRead) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsLoading(true);
    try {
      const res = await apiClient.leads.listOutreachDeliveries(lead.id, {
        signal: abortController.signal
      });
      if (isMountedRef.current) {
        setDeliveries(res.deliveries || []);
      }
    } catch (err) {
      if (isMountedRef.current) {
        const classified = classifyOutreachError(err);
        setError(classified);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [lead?.id, canRead]);

  // Fetch approved drafts if not provided
  const fetchApprovedDrafts = useCallback(async () => {
    if (!lead?.id || approvedDrafts !== undefined || !canRead) return;
    try {
      const allDrafts = await apiClient.leads.listSalesAssistantDrafts(lead.id);
      if (isMountedRef.current) {
        const onlyApproved = allDrafts.filter(
          (d) => d.status === SalesAssistantDraftStatus.APPROVED
        );
        setDraftsList(onlyApproved);
      }
    } catch {
      // Ignored for secondary fetch
    }
  }, [lead?.id, approvedDrafts, canRead]);

  useEffect(() => {
    isMountedRef.current = true;
    if (initialDeliveries === undefined) {
      fetchDeliveries();
    }
    if (approvedDrafts === undefined) {
      fetchApprovedDrafts();
    }
    return () => {
      isMountedRef.current = false;
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchDeliveries, fetchApprovedDrafts, initialDeliveries, approvedDrafts]);

  // Update drafts when prop changes
  useEffect(() => {
    if (approvedDrafts !== undefined) {
      const onlyApproved = approvedDrafts.filter(
        (d) => d.status === SalesAssistantDraftStatus.APPROVED
      );
      setDraftsList(onlyApproved);
    }
  }, [approvedDrafts]);

  // Eligible approved drafts only (status === APPROVED and type !== CALL_SCRIPT)
  const eligibleApprovedDrafts = draftsList.filter(
    (d) => d.status === SalesAssistantDraftStatus.APPROVED
  );

  // Synchronize selection when draft changes
  const selectedDraft = eligibleApprovedDrafts.find((d) => d.id === selectedDraftId) || null;

  useEffect(() => {
    if (!selectedDraft) {
      setSelectedChannel(null);
      setSelectedContactId('');
      return;
    }

    const allowedChannels = getAllowedOutreachChannelsForDraftType(selectedDraft.type);
    if (allowedChannels.length === 1) {
      // Auto-set single compatible channel (WHATSAPP, EMAIL, PROPOSAL)
      setSelectedChannel(allowedChannels[0]);
    } else if (allowedChannels.length > 1) {
      // FOLLOW_UP requires explicit user selection; reset if not valid
      if (selectedChannel && !allowedChannels.includes(selectedChannel)) {
        setSelectedChannel(null);
      }
    } else {
      // CALL_SCRIPT has 0 allowed channels
      setSelectedChannel(null);
    }
  }, [selectedDraft, selectedChannel]);

  // Resolve recipient candidates for currently selected channel
  const recipientCandidates: RecipientCandidate[] = selectedChannel
    ? resolveRecipientCandidates(lead, selectedChannel)
    : [];

  // Auto-select first recipient if exactly 1 candidate and not already set
  useEffect(() => {
    if (recipientCandidates.length === 1 && !selectedContactId) {
      setSelectedContactId(recipientCandidates[0].contactId || '');
    } else if (
      recipientCandidates.length > 0 &&
      selectedContactId &&
      !recipientCandidates.some((c) => (c.contactId || '') === selectedContactId)
    ) {
      setSelectedContactId(recipientCandidates[0].contactId || '');
    }
  }, [recipientCandidates, selectedContactId]);

  // Resolve masked recipient label for confirmation modal
  const selectedRecipient =
    recipientCandidates.find((c) => (c.contactId || '') === selectedContactId) ||
    recipientCandidates[0] ||
    null;
  const chosenRecipientMasked = selectedRecipient ? selectedRecipient.maskedLabel : '—';

  // Handle opening confirmation modal
  const handleOpenConfirmModal = () => {
    if (!selectedDraft || !selectedChannel || recipientCandidates.length === 0) return;
    setError(null);
    // Generate fresh idempotency key for this intentional dispatch action
    const newKey = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `outreach-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    setActiveIdempotencyKey(newKey);
    setIsConfirmOpen(true);
  };

  // Handle confirming delivery request
  const handleConfirmDelivery = async () => {
    if (!selectedDraft || !selectedChannel || isSubmitting || !activeIdempotencyKey) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const delivery = await apiClient.leads.sendOutreachDelivery(
        lead.id,
        {
          draftId: selectedDraft.id,
          channel: selectedChannel,
          recipientContactId: selectedRecipient?.contactId || undefined
        },
        activeIdempotencyKey
      );

      if (isMountedRef.current) {
        setIsConfirmOpen(false);
        showFeedback(
          'success',
          `Outreach request submitted: ${formatOutreachStatusDescription(delivery.status)}`
        );
        onDeliveryRequested?.(delivery);
        // Refresh delivery history once
        fetchDeliveries();
      }
    } catch (err) {
      if (isMountedRef.current) {
        const classified = classifyOutreachError(err);
        setError(classified);
        // If not a retryable queue failure, do not maintain stale key
        if (!classified.isRetryableQueueError) {
          setActiveIdempotencyKey(null);
        }
      }
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div className="p-5 rounded-xl bg-slate-950/70 border border-slate-800 shadow-md space-y-6">
      {/* Card Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-indigo-950/60 border border-indigo-800/50 text-indigo-400">
            <Send className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white tracking-tight flex items-center gap-2">
              <span>Automated Outreach & Delivery</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-slate-400 font-mono">
                M6
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Dispatch approved sales assistant messages with verified recipients and idempotency guards
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => fetchDeliveries()}
          disabled={isLoading}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
          title="Refresh delivery history"
          aria-label="Refresh delivery history"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Temporary Feedback Banner */}
      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center gap-2 shadow-sm ${
            feedback.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300'
              : 'bg-indigo-950/40 border-indigo-800/50 text-indigo-300'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Global Error Banner (Outside Modal) */}
      {error && !isConfirmOpen && (
        <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
          <div className="space-y-0.5">
            <p className="font-semibold text-xs">{error.message}</p>
            {error.requestId && (
              <p className="text-[10px] text-rose-400/80 font-mono">
                Request ID: {error.requestId}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Section 1: Dispatch Controls (Approved Drafts Only) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-indigo-400" />
            <span>Request Delivery</span>
          </h3>

          {!canSend && (
            <span className="text-[11px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 flex items-center gap-1">
              <ShieldAlert className="w-3 h-3 text-amber-400" />
              <span>Read-only Mode</span>
            </span>
          )}
        </div>

        {!canSend ? (
          <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 text-center text-xs text-slate-400 space-y-1">
            <p className="font-medium text-slate-300">Outreach dispatch restricted</p>
            <p className="text-[11px] text-slate-500">
              Only authorized managers or representatives assigned to this lead may initiate delivery requests.
            </p>
          </div>
        ) : eligibleApprovedDrafts.length === 0 ? (
          <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 text-center text-xs text-slate-500 space-y-1">
            <p className="text-slate-400 font-medium">No approved drafts available for delivery</p>
            <p className="text-[11px]">
              Generate a sales assistant draft and approve it above before requesting delivery.
            </p>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
            {/* Draft Selector */}
            <div className="space-y-1.5">
              <label
                htmlFor="outreach-draft-select"
                className="text-xs font-medium text-slate-300 block"
              >
                Select Approved Draft
              </label>
              <select
                id="outreach-draft-select"
                value={selectedDraftId}
                onChange={(e) => setSelectedDraftId(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
              >
                <option value="">-- Choose an approved draft --</option>
                {eligibleApprovedDrafts.map((draft) => (
                  <option key={draft.id} value={draft.id}>
                    [{formatSalesAssistantDraftTypeLabel(draft.type)}] - Approved on{' '}
                    {draft.approvedAt ? formatDate(draft.approvedAt) : 'Recent'}
                  </option>
                ))}
              </select>
            </div>

            {selectedDraft && (
              <>
                {/* Draft Summary & Compatibility */}
                {selectedDraft.type === SalesAssistantDraftType.CALL_SCRIPT ? (
                  <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/40 text-amber-300 text-xs flex items-center gap-2">
                    <Info className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      Call script — generic message delivery is not available for phone scripts.
                    </span>
                  </div>
                ) : (
                  <>
                    {/* Channel Selection */}
                    <div className="space-y-1.5">
                      <span className="text-xs font-medium text-slate-300 block">
                        Delivery Channel
                      </span>
                      {selectedDraft.type === SalesAssistantDraftType.FOLLOW_UP ? (
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            id="channel-select-whatsapp"
                            onClick={() => setSelectedChannel(OutreachChannel.WHATSAPP)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 cursor-pointer ${
                              selectedChannel === OutreachChannel.WHATSAPP
                                ? 'bg-emerald-950/70 border-emerald-600 text-emerald-300'
                                : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                            <span>WhatsApp</span>
                          </button>

                          <button
                            type="button"
                            id="channel-select-email"
                            onClick={() => setSelectedChannel(OutreachChannel.EMAIL)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 cursor-pointer ${
                              selectedChannel === OutreachChannel.EMAIL
                                ? 'bg-sky-950/70 border-sky-600 text-sky-300'
                                : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <Mail className="w-3.5 h-3.5 text-sky-400" />
                            <span>Email</span>
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5">
                            {selectedChannel === OutreachChannel.WHATSAPP ? (
                              <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Mail className="w-3.5 h-3.5 text-sky-400" />
                            )}
                            <span>{selectedChannel ? formatOutreachChannelLabel(selectedChannel) : 'None'}</span>
                          </span>
                          <span className="text-[11px] text-slate-500">
                            (Locked by {formatSalesAssistantDraftTypeLabel(selectedDraft.type)} draft type)
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Recipient Selection */}
                    {selectedChannel && (
                      <div className="space-y-1.5">
                        <span className="text-xs font-medium text-slate-300 block">
                          Verified Recipient Destination
                        </span>

                        {recipientCandidates.length === 0 ? (
                          <div className="p-2.5 rounded-lg bg-rose-950/30 border border-rose-800/40 text-rose-300 text-xs flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                            <span>
                              No verified {formatOutreachChannelLabel(selectedChannel)} contact available on this lead.
                            </span>
                          </div>
                        ) : recipientCandidates.length === 1 ? (
                          <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 text-xs font-mono flex items-center justify-between">
                            <span>{recipientCandidates[0].maskedLabel}</span>
                            <span className="text-[10px] text-emerald-400 font-sans font-medium flex items-center gap-1">
                              <ShieldCheck className="w-3 h-3" />
                              <span>{recipientCandidates[0].contactId ? 'Verified CRM Contact' : 'Lead Primary Email'}</span>
                            </span>
                          </div>
                        ) : (
                          <select
                            id="outreach-recipient-select"
                            value={selectedContactId}
                            onChange={(e) => setSelectedContactId(e.target.value)}
                            className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 font-mono transition-colors"
                          >
                            {recipientCandidates.map((cand, idx) => (
                              <option key={cand.contactId || idx} value={cand.contactId || ''}>
                                {cand.maskedLabel} {cand.isPrimary ? '(Primary)' : ''}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}

                    {/* Action Trigger */}
                    <div className="pt-2 flex items-center justify-between border-t border-slate-800">
                      <span className="text-[11px] text-slate-500">
                        Dispatch requires human review and explicit confirmation.
                      </span>

                      <button
                        type="button"
                        id="outreach-open-confirm-btn"
                        onClick={handleOpenConfirmModal}
                        disabled={
                          !selectedDraft ||
                          !selectedChannel ||
                          recipientCandidates.length === 0 ||
                          !isOutreachChannelCompatible(selectedDraft.type, selectedChannel)
                        }
                        className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-sm shadow-indigo-500/20 transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Request Delivery</span>
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Section 2: Delivery History */}
      <div className="space-y-3 pt-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-indigo-400" />
          <span>Delivery History ({deliveries.length})</span>
        </h3>

        {isLoading ? (
          <div className="p-6 rounded-xl bg-slate-900/40 border border-slate-800/80 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
            <span>Loading outreach delivery history...</span>
          </div>
        ) : deliveries.length === 0 ? (
          <div className="p-6 rounded-xl bg-slate-900/40 border border-slate-800/80 text-center text-xs text-slate-500">
            No delivery requests recorded for this lead yet.
          </div>
        ) : (
          <div className="space-y-2">
            {deliveries.map((delivery) => {
              const isExpanded = expandedDeliveryId === delivery.id;
              return (
                <div
                  key={delivery.id}
                  className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition-all text-xs space-y-2"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {/* Status Badge */}
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${getOutreachStatusBadgeClasses(
                          delivery.status
                        )}`}
                      >
                        {formatOutreachStatusLabel(delivery.status)}
                      </span>

                      {/* Channel Badge */}
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-medium flex items-center gap-1">
                        {delivery.channel === OutreachChannel.WHATSAPP ? (
                          <MessageSquare className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Mail className="w-3 h-3 text-sky-400" />
                        )}
                        <span>{formatOutreachChannelLabel(delivery.channel)}</span>
                      </span>

                      {/* Recipient */}
                      <span className="font-mono text-slate-200 font-medium">
                        {delivery.recipientMasked}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
                      <span>{formatDate(delivery.requestedAt || delivery.createdAt)}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedDeliveryId(isExpanded ? null : delivery.id)
                        }
                        className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
                        aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Delivery Detail */}
                  {isExpanded && (
                    <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span>State Description:</span>
                        <span className="text-slate-200 font-medium">
                          {formatOutreachStatusDescription(delivery.status)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Attempt Count:</span>
                        <span className="font-mono text-slate-300">{delivery.attemptCount}</span>
                      </div>
                      {delivery.sentAt && (
                        <div className="flex items-center justify-between">
                          <span>Sent at:</span>
                          <span className="text-slate-300">{formatDate(delivery.sentAt)}</span>
                        </div>
                      )}
                      {delivery.deliveredAt && (
                        <div className="flex items-center justify-between">
                          <span>Delivered at:</span>
                          <span className="text-emerald-400 font-medium">
                            {formatDate(delivery.deliveredAt)}
                          </span>
                        </div>
                      )}
                      {delivery.failedAt && (
                        <div className="flex items-center justify-between">
                          <span>Failed at:</span>
                          <span className="text-rose-400 font-medium">
                            {formatDate(delivery.failedAt)}
                          </span>
                        </div>
                      )}
                      {delivery.safeLastErrorMessage && (
                        <div className="p-2 rounded bg-rose-950/30 border border-rose-800/40 text-rose-300 text-[11px] mt-1">
                          {delivery.safeLastErrorMessage}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {selectedDraft && selectedChannel && (
        <OutreachDeliveryModal
          isOpen={isConfirmOpen}
          onClose={() => {
            if (!isSubmitting) setIsConfirmOpen(false);
          }}
          onConfirm={handleConfirmDelivery}
          draft={selectedDraft}
          channel={selectedChannel}
          recipientMasked={chosenRecipientMasked}
          isSubmitting={isSubmitting}
          error={error}
        />
      )}
    </div>
  );
}
