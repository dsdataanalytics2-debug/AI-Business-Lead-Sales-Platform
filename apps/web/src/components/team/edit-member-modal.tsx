'use client';

import React, { useState, useEffect } from 'react';
import { X, Edit2, Loader2, AlertCircle, Lock } from 'lucide-react';
import {
  Role,
  type TeamMemberSummary,
  type UpdateTeamMemberRequest
} from '@leadmate/shared';
import {
  ROLE_LABELS,
  getAllowedAssignableRoles,
  getFriendlyTeamErrorMessage
} from '@/lib/team/team-display';

interface EditMemberModalProps {
  isOpen: boolean;
  member: TeamMemberSummary | null;
  onClose: () => void;
  onSubmit: (userId: string, data: UpdateTeamMemberRequest) => Promise<void>;
  currentUserId?: string;
  actorRole?: Role | string;
}

export function EditMemberModal({
  isOpen,
  member,
  onClose,
  onSubmit,
  currentUserId,
  actorRole
}: EditMemberModalProps) {
  const allowedRoles = getAllowedAssignableRoles(actorRole);
  const isSelf = member?.id === currentUserId;

  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>(Role.SALES_EXECUTIVE);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Synchronize state when member changes
  useEffect(() => {
    if (member) {
      setName(member.name);
      setRole(member.role);
      setFieldErrors({});
      setServerError(null);
    }
  }, [member]);

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

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length < 2) {
      errors.name = 'Name must be at least 2 characters long';
    } else if (trimmedName.length > 100) {
      errors.name = 'Name must be at most 100 characters long';
    }

    if (!isSelf && !allowedRoles.includes(role)) {
      errors.role = 'You do not have permission to assign this role';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    if (!validate()) return;

    try {
      setIsSubmitting(true);
      const payload: UpdateTeamMemberRequest = {
        name: name.trim()
      };
      // Only include role if not self and role was changed
      if (!isSelf && role !== member.role) {
        payload.role = role;
      }

      await onSubmit(member.id, payload);
      onClose();
    } catch (err: unknown) {
      setServerError(getFriendlyTeamErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-member-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-indigo-950/60 text-indigo-400 border border-indigo-800/60">
              <Edit2 className="w-4 h-4" />
            </div>
            <div>
              <h2 id="edit-member-title" className="text-sm font-semibold text-slate-100">
                Edit Team Member
              </h2>
              <p className="text-[11px] text-slate-400">
                Update account information and role assignments
              </p>
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {serverError && (
            <div
              className="p-3 rounded-lg bg-red-950/50 border border-red-800/60 text-red-300 text-xs flex items-start gap-2"
              role="alert"
            >
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <span>{serverError}</span>
            </div>
          )}

          {/* Email (Read-Only Display) */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Email Address <span className="text-[10px] text-slate-500">(Immutable)</span>
            </label>
            <div className="flex items-center justify-between bg-slate-950/70 border border-slate-800/80 rounded-lg px-3 py-2 text-xs text-slate-400">
              <span>{member.email}</span>
              <Lock className="w-3.5 h-3.5 text-slate-600" />
            </div>
          </div>

          {/* Full Name */}
          <div>
            <label htmlFor="edit-member-name" className="block text-xs font-medium text-slate-300 mb-1">
              Full Name
            </label>
            <input
              id="edit-member-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              disabled={isSubmitting}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {fieldErrors.name && (
              <p className="mt-1 text-[11px] text-red-400">{fieldErrors.name}</p>
            )}
          </div>

          {/* Role Selection */}
          <div>
            <label htmlFor="edit-member-role" className="block text-xs font-medium text-slate-300 mb-1">
              Role
            </label>
            {isSelf ? (
              <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg px-3 py-2 text-xs text-slate-400 flex items-center justify-between">
                <span>{ROLE_LABELS[member.role]}</span>
                <span className="text-[10px] text-amber-500 font-mono">Self-role locked</span>
              </div>
            ) : (
              <select
                id="edit-member-role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                disabled={isSubmitting}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {allowedRoles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            )}
            {fieldErrors.role && (
              <p className="mt-1 text-[11px] text-red-400">{fieldErrors.role}</p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-sm shadow-indigo-600/30 disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save Changes</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
