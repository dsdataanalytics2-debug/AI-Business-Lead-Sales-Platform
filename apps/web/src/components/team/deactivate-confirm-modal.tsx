'use client';

import React, { useEffect } from 'react';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
import { type TeamMemberSummary } from '@leadmate/shared';
import { formatRoleLabel } from '@/lib/team/team-display';

interface DeactivateConfirmModalProps {
  isOpen: boolean;
  member: TeamMemberSummary | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isSubmitting: boolean;
  error?: string | null;
}

export function DeactivateConfirmModal({
  isOpen,
  member,
  onClose,
  onConfirm,
  isSubmitting,
  error
}: DeactivateConfirmModalProps) {
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

  if (!isOpen || !member) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deactivate-confirm-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-red-950/60 text-red-400 border border-red-800/60">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h2 id="deactivate-confirm-title" className="text-sm font-semibold text-slate-100">
                Deactivate Member
              </h2>
              <p className="text-[11px] text-slate-400">Confirm member account deactivation</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4">
          {error && (
            <div
              className="p-3 rounded-lg bg-red-950/50 border border-red-800/60 text-red-300 text-xs flex items-start gap-2"
              role="alert"
            >
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <p className="text-xs text-slate-300 leading-relaxed">
            Are you sure you want to deactivate{' '}
            <strong className="text-slate-100">{member.name}</strong> ({member.email},{' '}
            {formatRoleLabel(member.role)})?
          </p>

          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs text-slate-400">
            <div className="flex items-start gap-2">
              <span className="text-indigo-400 font-bold">•</span>
              <span>The member will no longer be able to sign in or access tenant data.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-indigo-400 font-bold">•</span>
              <span>Historical assignments (leads and follow-ups) remain preserved in the organization.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-indigo-400 font-bold">•</span>
              <span>Leads will not be automatically unassigned or reassigned.</span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/50 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg shadow-sm shadow-red-600/30 disabled:opacity-50 transition-colors"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Deactivating...</span>
              </>
            ) : (
              <span>Deactivate Member</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
