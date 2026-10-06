'use client';

import React, { useEffect } from 'react';
import {
  Send,
  X,
  AlertTriangle,
  Loader2,
  Mail,
  MessageSquare,
  ShieldCheck,
  FileText
} from 'lucide-react';
import {
  OutreachChannel,
  SalesAssistantDraftType,
  type SalesAssistantDraftSummary
} from '@leadmate/shared';
import {
  OUTREACH_DISPATCH_DISCLAIMER,
  formatOutreachChannelLabel,
  type ClassifiedOutreachError
} from '@/lib/leads/outreach-display';
import { formatSalesAssistantDraftTypeLabel } from '@/lib/leads/sales-assistant-display';

export interface OutreachDeliveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  draft: SalesAssistantDraftSummary;
  channel: OutreachChannel;
  recipientMasked: string;
  isSubmitting: boolean;
  error?: ClassifiedOutreachError | null;
}

export function OutreachDeliveryModal({
  isOpen,
  onClose,
  onConfirm,
  draft,
  channel,
  recipientMasked,
  isSubmitting,
  error
}: OutreachDeliveryModalProps) {
  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const isEmail = channel === OutreachChannel.EMAIL;
  const contentPreview = draft.type === SalesAssistantDraftType.EMAIL
    ? draft.emailBody || draft.content
    : draft.content;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="outreach-modal-title"
    >
      <div className="relative w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-950/60 border border-indigo-800/60 text-indigo-400">
              <Send className="w-4 h-4" />
            </div>
            <div>
              <h3 id="outreach-modal-title" className="text-sm font-semibold text-white">
                Confirm Outreach Delivery Request
              </h3>
              <p className="text-[11px] text-slate-400">
                Review approved message details before requesting delivery
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Dispatch Notice / Disclaimer */}
          <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-300 text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <p className="leading-relaxed text-[11px]">
              {OUTREACH_DISPATCH_DISCLAIMER}
            </p>
          </div>

          {/* Error Banner */}
          {error && (
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

          {/* Delivery Parameters Summary Grid */}
          <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs">
            <div>
              <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-500 block">
                Channel
              </span>
              <div className="mt-1 flex items-center gap-1.5 text-slate-200 font-medium">
                {isEmail ? (
                  <Mail className="w-3.5 h-3.5 text-sky-400" />
                ) : (
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span>{formatOutreachChannelLabel(channel)}</span>
              </div>
            </div>

            <div>
              <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-500 block">
                Recipient
              </span>
              <div className="mt-1 font-mono text-slate-200 font-medium">
                {recipientMasked}
              </div>
            </div>

            <div>
              <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-500 block">
                Approved Draft Type
              </span>
              <div className="mt-1 text-slate-300 flex items-center gap-1.5">
                <FileText className="w-3 h-3 text-indigo-400" />
                <span>{formatSalesAssistantDraftTypeLabel(draft.type)}</span>
              </div>
            </div>

            <div>
              <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-500 block">
                Approval Verification
              </span>
              <div className="mt-1 text-emerald-400 flex items-center gap-1 font-medium">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Human Approved</span>
              </div>
            </div>
          </div>

          {/* Email Subject if present */}
          {isEmail && draft.emailSubject && (
            <div className="space-y-1">
              <span className="text-[11px] font-semibold text-slate-400 block">
                Subject
              </span>
              <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 text-xs text-slate-200 font-medium">
                {draft.emailSubject}
              </div>
            </div>
          )}

          {/* Exact Approved Content Preview */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400 block">
                Approved Content Snapshot
              </span>
              <span className="text-[10px] text-slate-500">
                Exact text to be sent
              </span>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs leading-relaxed whitespace-pre-wrap font-sans max-h-48 overflow-y-auto">
              {contentPreview}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/60 flex items-center justify-end gap-2.5">
          <button
            type="button"
            id="outreach-cancel-btn"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            id="outreach-confirm-btn"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-md shadow-indigo-600/20 transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Submitting Request...</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Confirm Delivery Request</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
