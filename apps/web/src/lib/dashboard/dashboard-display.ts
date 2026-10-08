import { Role } from '@leadmate/shared';
import { ApiClientError } from '../api-client';

export interface DashboardAssigneeOption {
  id: string;
  name: string;
  role: Role;
  isActive: boolean;
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
