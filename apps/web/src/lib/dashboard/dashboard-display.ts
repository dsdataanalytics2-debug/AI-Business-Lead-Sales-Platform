import { Role, type SalesTeamPerformanceMember } from '@leadmate/shared';
import { ApiClientError } from '../api-client';

export interface DashboardAssigneeOption {
  id: string;
  name: string;
  role: Role;
  isActive: boolean;
}

export type TeamPerformanceSortField =
  | 'name'
  | 'activeLeads'
  | 'pendingFollowUps'
  | 'overdueFollowUps'
  | 'leadsCreated'
  | 'cohortWon'
  | 'cohortConversionRate'
  | 'outreachSent'
  | 'resolvedDeliverySuccessRate';

export type SortDirection = 'asc' | 'desc';

export type TeamStatusFilter = 'all' | 'active' | 'inactive';

export interface TeamWorkloadSummary {
  totalActiveLeads: number;
  totalPendingFollowUps: number;
  totalOverdueFollowUps: number;
}

export function calculateTeamCurrentWorkload(
  members: SalesTeamPerformanceMember[]
): TeamWorkloadSummary {
  let totalActiveLeads = 0;
  let totalPendingFollowUps = 0;
  let totalOverdueFollowUps = 0;

  for (const member of members) {
    totalActiveLeads += member.currentWorkload.activeLeads;
    totalPendingFollowUps += member.currentWorkload.pendingFollowUps;
    totalOverdueFollowUps += member.currentWorkload.overdueFollowUps;
  }

  return {
    totalActiveLeads,
    totalPendingFollowUps,
    totalOverdueFollowUps
  };
}

export function filterTeamMembers(
  members: SalesTeamPerformanceMember[],
  searchQuery: string,
  statusFilter: TeamStatusFilter
): SalesTeamPerformanceMember[] {
  const query = searchQuery.trim().toLowerCase();

  return members.filter((member) => {
    // Status filter
    if (statusFilter === 'active' && !member.isActive) return false;
    if (statusFilter === 'inactive' && member.isActive) return false;

    // Search query over name and role
    if (query) {
      const nameMatch = member.name.toLowerCase().includes(query);
      const roleMatch = member.role.toLowerCase().includes(query);
      if (!nameMatch && !roleMatch) return false;
    }

    return true;
  });
}

export function sortTeamMembers(
  members: SalesTeamPerformanceMember[],
  field: TeamPerformanceSortField = 'name',
  direction: SortDirection = 'asc'
): SalesTeamPerformanceMember[] {
  const sorted = [...members];

  sorted.sort((a, b) => {
    let comparison = 0;

    switch (field) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'activeLeads':
        comparison = a.currentWorkload.activeLeads - b.currentWorkload.activeLeads;
        break;
      case 'pendingFollowUps':
        comparison = a.currentWorkload.pendingFollowUps - b.currentWorkload.pendingFollowUps;
        break;
      case 'overdueFollowUps':
        comparison = a.currentWorkload.overdueFollowUps - b.currentWorkload.overdueFollowUps;
        break;
      case 'leadsCreated':
        comparison = a.periodPerformance.leadsCreated - b.periodPerformance.leadsCreated;
        break;
      case 'cohortWon':
        comparison = a.periodPerformance.cohortWon - b.periodPerformance.cohortWon;
        break;
      case 'cohortConversionRate':
        comparison = a.periodPerformance.cohortConversionRate - b.periodPerformance.cohortConversionRate;
        break;
      case 'outreachSent':
        comparison = a.periodPerformance.outreachSent - b.periodPerformance.outreachSent;
        break;
      case 'resolvedDeliverySuccessRate':
        comparison = a.periodPerformance.resolvedDeliverySuccessRate - b.periodPerformance.resolvedDeliverySuccessRate;
        break;
      default:
        comparison = a.name.localeCompare(b.name);
    }

    // Tie-breaker: neutral alphabetical order by name
    if (comparison === 0 && field !== 'name') {
      comparison = a.name.localeCompare(b.name);
    }

    return direction === 'asc' ? comparison : -comparison;
  });

  return sorted;
}

export function deriveAssigneeOptions(
  existingOptions: DashboardAssigneeOption[],
  members: Array<{ userId: string; name: string; role: Role; isActive: boolean }>
): DashboardAssigneeOption[] {
  const map = new Map<string, DashboardAssigneeOption>();
  for (const opt of existingOptions) {
    map.set(opt.id, opt);
  }
  for (const member of members) {
    map.set(member.userId, {
      id: member.userId,
      name: member.name,
      role: member.role,
      isActive: member.isActive
    });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function formatAssigneeLabel(member: DashboardAssigneeOption): string {
  return `${member.name}${!member.isActive ? ' — Inactive' : ''}`;
}

export function mergeAvailableSources(
  existingSources: string[],
  newSources: string[],
  selectedSource?: string
): string[] {
  const set = new Set<string>([...existingSources, ...newSources]);
  if (selectedSource) {
    set.add(selectedSource);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function formatPercentage(value: number): string {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return '0.0%';
  }
  return `${value.toFixed(1)}%`;
}

export function formatFriendlySource(source: string): string {
  if (!source || source.toUpperCase() === 'UNKNOWN') {
    return 'Unknown';
  }
  // Convert GOOGLE_MAPS -> Google Maps, WEBSITE -> Website, etc.
  return source
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function getFriendlyDashboardErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.statusCode === 401) {
      return 'Please log in to view the sales dashboard.';
    }
    if (error.statusCode === 403) {
      return 'You do not have permission to view sales reports.';
    }
    if (error.statusCode === 404) {
      return 'Selected team member is unavailable.';
    }
    if (error.statusCode === 422) {
      return 'Invalid filter criteria. Please verify date parameters or inputs.';
    }
    if (error.statusCode >= 500) {
      return 'Server error while calculating sales metrics. Please try again later.';
    }
    return error.message || 'Failed to load dashboard analytics.';
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return '';
    }
    return error.message;
  }

  return 'An unexpected error occurred while loading dashboard metrics.';
}
