'use client';

import React from 'react';
import {
  Eye,
  Edit2,
  CheckCircle2,
  UserX,
  Clock,
  CheckCircle,
  AlertTriangle,
  FolderOpen
} from 'lucide-react';
import {
  Role,
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

interface TeamMemberTableProps {
  members: TeamMemberSummary[];
  currentUserId?: string;
  currentUserRole?: Role | string;
  hasUsersManage: boolean;
  onViewMember: (member: TeamMemberSummary) => void;
  onEditMember: (member: TeamMemberSummary) => void;
  onActivateMember: (member: TeamMemberSummary) => void;
  onDeactivateMember: (member: TeamMemberSummary) => void;
}

export function TeamMemberTable({
  members,
  currentUserId,
  currentUserRole,
  hasUsersManage,
  onViewMember,
  onEditMember,
  onActivateMember,
  onDeactivateMember
}: TeamMemberTableProps) {
  return (
    <div className="space-y-4">
      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto bg-slate-900/90 border border-slate-800 rounded-xl shadow-sm">
        <table className="w-full text-left text-xs border-collapse min-w-[840px]">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-medium">
              <th className="py-3 px-4">Member</th>
              <th className="py-3 px-4">Role</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-center">Assigned Leads</th>
              <th className="py-3 px-4 text-center">Active Leads</th>
              <th className="py-3 px-4 text-center">Pending Follow-ups</th>
              <th className="py-3 px-4 text-center">Overdue</th>
              <th className="py-3 px-4">Created</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {members.map((member) => {
              const isSelf = member.id === currentUserId;
              const isManageable = canActorMutateTarget(
                currentUserRole,
                currentUserId,
                member.role,
                member.id,
                hasUsersManage
              );

              return (
                <tr
                  key={member.id}
                  className="hover:bg-slate-850/50 transition-colors group"
                >
                  {/* Member Name & Email */}
                  <td className="py-3.5 px-4">
                    <div className="font-medium text-slate-200 flex items-center gap-1.5">
                      <span>{member.name}</span>
                      {isSelf && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-800/60">
                          You
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400">{member.email}</div>
                  </td>

                  {/* Role */}
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                        ROLE_BADGE_CLASSES[member.role] || 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {formatRoleLabel(member.role)}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${getStatusBadgeClass(
                        member.isActive
                      )}`}
                    >
                      {formatStatusLabel(member.isActive)}
                    </span>
                  </td>

                  {/* Workload: Assigned Leads */}
                  <td className="py-3.5 px-4 text-center font-mono text-slate-300">
                    {member.workload.assignedLeadsCount}
                  </td>

                  {/* Workload: Active Leads */}
                  <td className="py-3.5 px-4 text-center font-mono text-slate-300">
                    {member.workload.activeLeadsCount}
                  </td>

                  {/* Workload: Pending Follow-ups */}
                  <td className="py-3.5 px-4 text-center font-mono text-slate-300">
                    {member.workload.pendingFollowUpsCount}
                  </td>

                  {/* Workload: Overdue Follow-ups */}
                  <td className="py-3.5 px-4 text-center font-mono">
                    {member.workload.overdueFollowUpsCount > 0 ? (
                      <span className="text-amber-400 font-semibold">
                        {member.workload.overdueFollowUpsCount}
                      </span>
                    ) : (
                      <span className="text-slate-500">0</span>
                    )}
                  </td>

                  {/* Created Date */}
                  <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap text-[11px]">
                    {formatDate(member.createdAt)}
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 px-4 text-right whitespace-nowrap">
                    <div className="inline-flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onViewMember(member)}
                        className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors"
                        title="View member details"
                        aria-label={`View ${member.name}`}
                      >
                        <Eye className="w-4 h-4" />
                      </button>

                      {hasUsersManage && isManageable && (
                        <button
                          type="button"
                          onClick={() => onEditMember(member)}
                          className="p-1.5 text-slate-400 hover:text-indigo-300 hover:bg-slate-800 rounded-md transition-colors"
                          title="Edit member"
                          aria-label={`Edit ${member.name}`}
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}

                      {hasUsersManage && isManageable && !member.isActive && (
                        <button
                          type="button"
                          onClick={() => onActivateMember(member)}
                          className="p-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 rounded-md transition-colors"
                          title="Activate member"
                          aria-label={`Activate ${member.name}`}
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      )}

                      {hasUsersManage && isManageable && member.isActive && !isSelf && (
                        <button
                          type="button"
                          onClick={() => onDeactivateMember(member)}
                          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-950/40 rounded-md transition-colors"
                          title="Deactivate member"
                          aria-label={`Deactivate ${member.name}`}
                        >
                          <UserX className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {members.map((member) => {
          const isSelf = member.id === currentUserId;
          const isManageable = canActorMutateTarget(
            currentUserRole,
            currentUserId,
            member.role,
            member.id,
            hasUsersManage
          );

          return (
            <div
              key={member.id}
              className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-sm"
            >
              {/* Header: Name, Badges & Self Indicator */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-100 text-sm flex items-center gap-1.5">
                    <span>{member.name}</span>
                    {isSelf && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-800/60">
                        You
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400">{member.email}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                      ROLE_BADGE_CLASSES[member.role] || 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {formatRoleLabel(member.role)}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${getStatusBadgeClass(
                      member.isActive
                    )}`}
                  >
                    {formatStatusLabel(member.isActive)}
                  </span>
                </div>
              </div>

              {/* Workload 2x2 Grid */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800 text-xs">
                <div className="bg-slate-950/50 p-2 rounded-lg border border-slate-800/60">
                  <span className="text-[10px] text-slate-500 block">Assigned Leads</span>
                  <span className="font-mono text-slate-200 font-medium">
                    {member.workload.assignedLeadsCount}
                  </span>
                </div>
                <div className="bg-slate-950/50 p-2 rounded-lg border border-slate-800/60">
                  <span className="text-[10px] text-slate-500 block">Active Leads</span>
                  <span className="font-mono text-slate-200 font-medium">
                    {member.workload.activeLeadsCount}
                  </span>
                </div>
                <div className="bg-slate-950/50 p-2 rounded-lg border border-slate-800/60">
                  <span className="text-[10px] text-slate-500 block">Pending Tasks</span>
                  <span className="font-mono text-slate-200 font-medium">
                    {member.workload.pendingFollowUpsCount}
                  </span>
                </div>
                <div className="bg-slate-950/50 p-2 rounded-lg border border-slate-800/60">
                  <span className="text-[10px] text-slate-500 block">Overdue Tasks</span>
                  <span
                    className={`font-mono font-medium ${
                      member.workload.overdueFollowUpsCount > 0 ? 'text-amber-400' : 'text-slate-400'
                    }`}
                  >
                    {member.workload.overdueFollowUpsCount}
                  </span>
                </div>
              </div>

              {/* Actions Footer */}
              <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                <div className="text-[10px] text-slate-500">
                  Joined {formatDate(member.createdAt)}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onViewMember(member)}
                    className="px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 rounded-md transition-colors"
                  >
                    View
                  </button>

                  {hasUsersManage && isManageable && (
                    <button
                      type="button"
                      onClick={() => onEditMember(member)}
                      className="px-2.5 py-1 text-xs font-medium text-indigo-300 hover:text-white bg-indigo-950/60 border border-indigo-800/60 rounded-md transition-colors"
                    >
                      Edit
                    </button>
                  )}

                  {hasUsersManage && isManageable && !member.isActive && (
                    <button
                      type="button"
                      onClick={() => onActivateMember(member)}
                      className="px-2.5 py-1 text-xs font-medium text-emerald-300 bg-emerald-950/60 border border-emerald-800/60 rounded-md transition-colors"
                    >
                      Activate
                    </button>
                  )}

                  {hasUsersManage && isManageable && member.isActive && !isSelf && (
                    <button
                      type="button"
                      onClick={() => onDeactivateMember(member)}
                      className="px-2.5 py-1 text-xs font-medium text-red-300 bg-red-950/60 border border-red-800/60 rounded-md transition-colors"
                    >
                      Deactivate
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
