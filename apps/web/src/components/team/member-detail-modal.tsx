'use client';

import React, { useEffect } from 'react';
import {
  X,
  User,
  Mail,
  Calendar,
  Clock,
  Shield,
  Activity,
  Edit2,
  CheckCircle2,
  UserX
} from 'lucide-react';
import {
  Role,
  type TeamMemberDetail,
  type TeamMemberSummary
} from '@leadmate/shared';
import { formatDate } from '@/lib/format-date';
import {
  formatRoleLabel,
  formatStatusLabel,
  ROLE_BADGE_CLASSES,
  getStatusBadgeClass,
  canActorMutateTarget
} from '@/lib/team/team-display';

interface MemberDetailModalProps {
  isOpen: boolean;
  member: TeamMemberDetail | TeamMemberSummary | null;
  onClose: () => void;
  onEdit?: (member: TeamMemberSummary) => void;
  onActivate?: (member: TeamMemberSummary) => void;
  onDeactivate?: (member: TeamMemberSummary) => void;
  currentUserId?: string;
  currentUserRole?: Role | string;
  hasUsersManage: boolean;
}

export function MemberDetailModal({
  isOpen,
  member,
  onClose,
  onEdit,
  onActivate,
  onDeactivate,
  currentUserId,
  currentUserRole,
  hasUsersManage
}: MemberDetailModalProps) {
  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !member) return null;

  const isSelf = member.id === currentUserId;
  const isManageable = canActorMutateTarget(
    currentUserRole,
    currentUserId,
    member.role,
    member.id,
    hasUsersManage
  );

  const updatedDate = 'updatedAt' in member ? member.updatedAt : member.createdAt;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-detail-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-indigo-400">
              {member.name ? member.name[0].toUpperCase() : 'U'}
            </div>
            <div>
              <h2 id="member-detail-title" className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
                <span>{member.name}</span>
                {isSelf && (
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-800/60">
                    You
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-slate-400">{member.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5">
          {/* Status and Role Badges */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${
                ROLE_BADGE_CLASSES[member.role] || 'bg-slate-800 text-slate-300'
              }`}
            >
              <Shield className="w-3 h-3 mr-1" />
              {formatRoleLabel(member.role)}
            </span>
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusBadgeClass(
                member.isActive
              )}`}
            >
              <Activity className="w-3 h-3 mr-1" />
              {formatStatusLabel(member.isActive)}
            </span>
          </div>

          {/* Workload Metric Cards */}
          <div>
            <h3 className="text-xs font-semibold text-slate-300 mb-2.5 uppercase tracking-wider text-[10px]">
              Sales Workload Summary
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 shadow-sm">
                <span className="text-[11px] text-slate-400 block mb-1">Assigned Leads</span>
                <span className="text-lg font-bold font-mono text-slate-100">
                  {member.workload.assignedLeadsCount}
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">Total owned in tenant</span>
              </div>

              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 shadow-sm">
                <span className="text-[11px] text-slate-400 block mb-1">Active Pipeline</span>
                <span className="text-lg font-bold font-mono text-indigo-400">
                  {member.workload.activeLeadsCount}
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">Leads not WON / LOST</span>
              </div>

              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 shadow-sm">
                <span className="text-[11px] text-slate-400 block mb-1">Pending Follow-ups</span>
                <span className="text-lg font-bold font-mono text-slate-200">
                  {member.workload.pendingFollowUpsCount}
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">Scheduled tasks</span>
              </div>

              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 shadow-sm">
                <span className="text-[11px] text-slate-400 block mb-1">Overdue Follow-ups</span>
                <span
                  className={`text-lg font-bold font-mono ${
                    member.workload.overdueFollowUpsCount > 0 ? 'text-amber-400' : 'text-slate-400'
                  }`}
                >
                  {member.workload.overdueFollowUpsCount}
                </span>
                <span className="text-[10px] text-slate-500 block mt-0.5">Requires attention</span>
              </div>
            </div>
          </div>

          {/* Timestamps */}
          <div className="pt-3 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-xs text-slate-400">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span>Created {formatDate(member.createdAt)}</span>
            </div>
            <div className="flex items-center gap-1.5 justify-end">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span>Updated {formatDate(updatedDate)}</span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
          >
            Close
          </button>

          {hasUsersManage && isManageable && (
            <div className="flex items-center gap-2">
              {onEdit && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onEdit(member as TeamMemberSummary);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:text-white bg-indigo-950/60 border border-indigo-800/60 rounded-lg transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
              )}

              {onActivate && !member.isActive && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onActivate(member as TeamMemberSummary);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-300 bg-emerald-950/60 border border-emerald-800/60 rounded-lg transition-colors"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Activate</span>
                </button>
              )}

              {onDeactivate && member.isActive && !isSelf && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onDeactivate(member as TeamMemberSummary);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-300 bg-red-950/60 border border-red-800/60 rounded-lg transition-colors"
                >
                  <UserX className="w-3.5 h-3.5" />
                  <span>Deactivate</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
