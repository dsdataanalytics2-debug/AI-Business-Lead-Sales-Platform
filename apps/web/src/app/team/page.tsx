'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  UserPlus,
  Loader2,
  AlertCircle,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Users
} from 'lucide-react';
import {
  Permissions,
  Role,
  TeamSortBy,
  type TeamMemberSummary,
  type TeamMemberDetail,
  type CreateTeamMemberRequest,
  type UpdateTeamMemberRequest
} from '@leadmate/shared';
import { useAuth } from '@/lib/auth-context';
import { AppShell } from '@/components/layout/app-shell';
import { apiClient, ApiClientError } from '@/lib/api-client';
import {
  TeamFilterBar,
  type TeamFilterState
} from '@/components/team/team-filter-bar';
import { TeamMemberTable } from '@/components/team/team-member-table';
import { CreateMemberModal } from '@/components/team/create-member-modal';
import { EditMemberModal } from '@/components/team/edit-member-modal';
import { MemberDetailModal } from '@/components/team/member-detail-modal';
import { DeactivateConfirmModal } from '@/components/team/deactivate-confirm-modal';
import { getFriendlyTeamErrorMessage } from '@/lib/team/team-display';

const defaultFilters: TeamFilterState = {
  search: '',
  role: undefined,
  isActive: undefined,
  sortBy: TeamSortBy.CREATED_AT,
  sortOrder: 'desc'
};

export default function TeamPage() {
  const { user, isAuthenticated, isLoading: isAuthLoading, hasPermission } = useAuth();
  const router = useRouter();

  const canReadTeam = hasPermission(Permissions.USERS_READ);
  const canManageTeam = hasPermission(Permissions.USERS_MANAGE);

  // Filter state
  const [filters, setFilters] = useState<TeamFilterState>(defaultFilters);
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');

  // Pagination state
  const [page, setPage] = useState<number>(1);
  const limit = 10;
  const [total, setTotal] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);

  // Data & loading state
  const [members, setMembers] = useState<TeamMemberSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [editingMember, setEditingMember] = useState<TeamMemberSummary | null>(null);
  const [detailMember, setDetailMember] = useState<TeamMemberDetail | TeamMemberSummary | null>(null);
  const [deactivatingMember, setDeactivatingMember] = useState<TeamMemberSummary | null>(null);
  const [isDeactivating, setIsDeactivating] = useState<boolean>(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  // Monotonic generation counter & AbortController ref to prevent query races
  const generationRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Auth gate
  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthLoading, isAuthenticated, router]);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(filters.search.trim());
      setPage(1); // Reset page on search change
    }, 350);
    return () => clearTimeout(handler);
  }, [filters.search]);

  // Fetch team members with query race protection
  const fetchMembers = useCallback(async () => {
    if (!isAuthenticated || !canReadTeam) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    generationRef.current += 1;
    const currentGeneration = generationRef.current;

    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient.team.listMembers(
        {
          page,
          limit,
          search: debouncedSearch || undefined,
          role: filters.role,
          isActive: filters.isActive,
          sortBy: filters.sortBy,
          sortOrder: filters.sortOrder
        },
        { signal: abortController.signal }
      );

      // Discard stale responses from out-of-order generation
      if (currentGeneration !== generationRef.current) return;

      setMembers(response.items);
      setTotal(response.pagination.total);
      setTotalPages(response.pagination.totalPages);
    } catch (err: unknown) {
      if (abortController.signal.aborted) return;
      if (currentGeneration !== generationRef.current) return;
      setError(getFriendlyTeamErrorMessage(err));
    } finally {
      if (currentGeneration === generationRef.current) {
        setIsLoading(false);
      }
    }
  }, [isAuthenticated, canReadTeam, page, limit, debouncedSearch, filters.role, filters.isActive, filters.sortBy, filters.sortOrder]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // Notification banner dismiss timer
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Filter handlers
  const handleFilterChange = (newFilters: Partial<TeamFilterState>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
    setPage(1);
  };

  const handleResetFilters = () => {
    setFilters(defaultFilters);
    setDebouncedSearch('');
    setPage(1);
  };

  const isFiltered = Boolean(
    filters.search.trim() ||
      filters.role ||
      filters.isActive !== undefined ||
      filters.sortBy !== TeamSortBy.CREATED_AT ||
      filters.sortOrder !== 'desc'
  );

  // Action handlers
  const handleCreateMember = async (data: CreateTeamMemberRequest) => {
    await apiClient.team.createMember(data);
    setNotification({
      type: 'success',
      message: 'Team member created successfully.'
    });
    fetchMembers();
  };

  const handleUpdateMember = async (userId: string, data: UpdateTeamMemberRequest) => {
    const updated = await apiClient.team.updateMember(userId, data);
    setNotification({
      type: 'success',
      message: 'Team member updated successfully.'
    });
    // If detail modal is open for this member, refresh it
    if (detailMember && detailMember.id === userId) {
      setDetailMember(updated);
    }
    fetchMembers();
  };

  const handleActivateMember = async (member: TeamMemberSummary) => {
    try {
      const res = await apiClient.team.activateMember(member.id);
      setNotification({
        type: 'success',
        message: res.message || 'Member activated successfully.'
      });
      if (detailMember && detailMember.id === member.id) {
        setDetailMember(res.member);
      }
      fetchMembers();
    } catch (err: unknown) {
      setNotification({
        type: 'error',
        message: getFriendlyTeamErrorMessage(err)
      });
    }
  };

  const handleOpenDeactivateModal = (member: TeamMemberSummary) => {
    setDeactivatingMember(member);
    setDeactivateError(null);
  };

  const handleConfirmDeactivate = async () => {
    if (!deactivatingMember) return;
    try {
      setIsDeactivating(true);
      setDeactivateError(null);
      const res = await apiClient.team.deactivateMember(deactivatingMember.id);
      setNotification({
        type: 'success',
        message: res.message || 'Member deactivated successfully.'
      });
      if (detailMember && detailMember.id === deactivatingMember.id) {
        setDetailMember(res.member);
      }
      setDeactivatingMember(null);
      fetchMembers();
    } catch (err: unknown) {
      setDeactivateError(getFriendlyTeamErrorMessage(err));
    } finally {
      setIsDeactivating(false);
    }
  };

  const handleViewMember = async (member: TeamMemberSummary) => {
    // Show summary immediately in modal while loading fresh detail
    setDetailMember(member);
    try {
      const freshDetail = await apiClient.team.getMember(member.id);
      setDetailMember(freshDetail);
    } catch {
      // Retain existing summary if detail fetch fails
    }
  };

  // 1. Loading screen while authenticating
  if (isAuthLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      </AppShell>
    );
  }

  // 2. Permission gate: Access Denied for users lacking USERS_READ
  if (!canReadTeam) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto my-12 p-8 bg-slate-900 border border-slate-800 rounded-2xl text-center space-y-4 shadow-xl">
          <div className="w-12 h-12 mx-auto rounded-xl bg-red-950/60 border border-red-800/60 flex items-center justify-center text-red-400">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-100">Access Restricted</h1>
            <p className="text-xs text-slate-400 mt-1">
              You do not have permission to view or manage team members. Please contact an organization administrator.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-400" />
              <span>Team Management</span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Manage team members, roles, access status, and sales workload.
            </p>
          </div>

          {canManageTeam && (
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-sm shadow-indigo-600/30 transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              <span>Add Member</span>
            </button>
          )}
        </div>

        {/* Notification Toast / Banner */}
        {notification && (
          <div
            className={`p-3.5 rounded-xl border text-xs flex items-center justify-between transition-all ${
              notification.type === 'success'
                ? 'bg-emerald-950/50 border-emerald-800/60 text-emerald-300'
                : 'bg-red-950/50 border-red-800/60 text-red-300'
            }`}
            role="status"
          >
            <div className="flex items-center gap-2">
              {notification.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              )}
              <span>{notification.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setNotification(null)}
              className="text-slate-400 hover:text-slate-200 text-xs px-2 py-0.5"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Filter Bar */}
        <TeamFilterBar
          filters={filters}
          onFilterChange={handleFilterChange}
          onReset={handleResetFilters}
          isFiltered={isFiltered}
        />

        {/* Error Banner */}
        {error && (
          <div
            className="p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-xs flex items-center justify-between"
            role="alert"
          >
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={fetchMembers}
              className="px-3 py-1 bg-red-900/60 hover:bg-red-900 text-white rounded-md text-xs font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading Skeleton */}
        {isLoading ? (
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-8 text-center space-y-3">
            <Loader2 className="w-6 h-6 text-indigo-500 animate-spin mx-auto" />
            <p className="text-xs text-slate-400 font-medium">Loading team members...</p>
          </div>
        ) : members.length === 0 ? (
          /* Empty States */
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-12 text-center space-y-3 shadow-sm">
            <div className="w-12 h-12 mx-auto rounded-full bg-slate-800 flex items-center justify-center text-slate-500">
              <Users className="w-6 h-6" />
            </div>
            <h2 className="text-sm font-semibold text-slate-200">
              {isFiltered ? 'No team members match your filters.' : 'No team members found.'}
            </h2>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {isFiltered
                ? 'Try adjusting your search criteria or reset filters to see all organization members.'
                : 'Get started by inviting members to collaborate on sales leads and workflows.'}
            </p>
            {isFiltered ? (
              <button
                type="button"
                onClick={handleResetFilters}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
              >
                Reset Filters
              </button>
            ) : (
              canManageTeam && (
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(true)}
                  className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors shadow-sm"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Add First Member</span>
                </button>
              )
            )}
          </div>
        ) : (
          /* Main Members Table & Pagination */
          <div className="space-y-4">
            <TeamMemberTable
              members={members}
              currentUserId={user?.id}
              currentUserRole={user?.role}
              hasUsersManage={canManageTeam}
              onViewMember={handleViewMember}
              onEditMember={(m) => setEditingMember(m)}
              onActivateMember={handleActivateMember}
              onDeactivateMember={handleOpenDeactivateModal}
            />

            {/* Pagination Controls */}
            <div className="flex items-center justify-between px-2 text-xs text-slate-400">
              <div>
                Showing <span className="font-medium text-slate-200">{members.length}</span> of{' '}
                <span className="font-medium text-slate-200">{total}</span> members
              </div>

              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Previous</span>
                  </button>

                  <span className="px-2 py-1 text-slate-300 font-mono text-xs">
                    Page {page} of {totalPages}
                  </span>

                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    aria-label="Next page"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modals */}
        <CreateMemberModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onSubmit={handleCreateMember}
          actorRole={user?.role}
        />

        <EditMemberModal
          isOpen={Boolean(editingMember)}
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onSubmit={handleUpdateMember}
          currentUserId={user?.id}
          actorRole={user?.role}
        />

        <MemberDetailModal
          isOpen={Boolean(detailMember)}
          member={detailMember}
          onClose={() => setDetailMember(null)}
          onEdit={(m) => {
            setDetailMember(null);
            setEditingMember(m);
          }}
          onActivate={handleActivateMember}
          onDeactivate={handleOpenDeactivateModal}
          currentUserId={user?.id}
          currentUserRole={user?.role}
          hasUsersManage={canManageTeam}
        />

        <DeactivateConfirmModal
          isOpen={Boolean(deactivatingMember)}
          member={deactivatingMember}
          onClose={() => {
            setDeactivatingMember(null);
            setDeactivateError(null);
          }}
          onConfirm={handleConfirmDeactivate}
          isSubmitting={isDeactivating}
          error={deactivateError}
        />
      </div>
    </AppShell>
  );
}
