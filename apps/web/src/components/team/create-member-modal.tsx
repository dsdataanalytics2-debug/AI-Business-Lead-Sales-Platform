'use client';

import React, { useState, useEffect } from 'react';
import { X, UserPlus, Loader2, AlertCircle } from 'lucide-react';
import { Role, type CreateTeamMemberRequest } from '@leadmate/shared';
import {
  ROLE_LABELS,
  getAllowedAssignableRoles,
  getFriendlyTeamErrorMessage
} from '@/lib/team/team-display';

interface CreateMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateTeamMemberRequest) => Promise<void>;
  actorRole?: Role | string;
}

export function CreateMemberModal({
  isOpen,
  onClose,
  onSubmit,
  actorRole
}: CreateMemberModalProps) {
  const allowedRoles = getAllowedAssignableRoles(actorRole);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(allowedRoles[0] || Role.SALES_EXECUTIVE);
  const [temporaryPassword, setTemporaryPassword] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Synchronize default role when allowed roles change
  useEffect(() => {
    if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
      setRole(allowedRoles[0]);
    }
  }, [allowedRoles, role]);

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

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName('');
      setEmail('');
      setTemporaryPassword('');
      setFieldErrors({});
      setServerError(null);
      if (allowedRoles.length > 0) {
        setRole(allowedRoles[0]);
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length < 2) {
      errors.name = 'Name must be at least 2 characters long';
    } else if (trimmedName.length > 100) {
      errors.name = 'Name must be at most 100 characters long';
    }

    const trimmedEmail = email.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!trimmedEmail || !emailRegex.test(trimmedEmail)) {
      errors.email = 'Please provide a valid email address';
    }

    if (!allowedRoles.includes(role)) {
      errors.role = 'You do not have permission to assign this role';
    }

    if (!temporaryPassword || temporaryPassword.length < 10) {
      errors.temporaryPassword = 'Temporary password must be at least 10 characters long';
    } else if (temporaryPassword.length > 128) {
      errors.temporaryPassword = 'Temporary password must be at most 128 characters long';
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
      await onSubmit({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role,
        temporaryPassword
      });
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
        aria-labelledby="create-member-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-indigo-950/60 text-indigo-400 border border-indigo-800/60">
              <UserPlus className="w-4 h-4" />
            </div>
            <div>
              <h2 id="create-member-title" className="text-sm font-semibold text-slate-100">
                Add Team Member
              </h2>
              <p className="text-[11px] text-slate-400">
                Create a new account with temporary credentials
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

          {/* Full Name */}
          <div>
            <label htmlFor="create-member-name" className="block text-xs font-medium text-slate-300 mb-1">
              Full Name
            </label>
            <input
              id="create-member-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sarah Connor"
              disabled={isSubmitting}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {fieldErrors.name && (
              <p className="mt-1 text-[11px] text-red-400">{fieldErrors.name}</p>
            )}
          </div>

          {/* Email Address */}
          <div>
            <label htmlFor="create-member-email" className="block text-xs font-medium text-slate-300 mb-1">
              Email Address
            </label>
            <input
              id="create-member-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sarah@company.com"
              disabled={isSubmitting}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {fieldErrors.email && (
              <p className="mt-1 text-[11px] text-red-400">{fieldErrors.email}</p>
            )}
          </div>

          {/* Role */}
          <div>
            <label htmlFor="create-member-role" className="block text-xs font-medium text-slate-300 mb-1">
              Role
            </label>
            <select
              id="create-member-role"
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
            {fieldErrors.role && (
              <p className="mt-1 text-[11px] text-red-400">{fieldErrors.role}</p>
            )}
          </div>

          {/* Temporary Password */}
          <div>
            <label htmlFor="create-member-password" className="block text-xs font-medium text-slate-300 mb-1">
              Temporary Password
            </label>
            <input
              id="create-member-password"
              type="password"
              value={temporaryPassword}
              onChange={(e) => setTemporaryPassword(e.target.value)}
              placeholder="Minimum 10 characters"
              autoComplete="new-password"
              disabled={isSubmitting}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {fieldErrors.temporaryPassword ? (
              <p className="mt-1 text-[11px] text-red-400">{fieldErrors.temporaryPassword}</p>
            ) : (
              <p className="mt-1 text-[10px] text-slate-500">
                Must be at least 10 characters long.
              </p>
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
                  <span>Creating...</span>
                </>
              ) : (
                <span>Create Member</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
