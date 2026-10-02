import {
  type LeadListQuery,
  type WebsiteStatus,
  type OnlinePresenceType
} from '@leadmate/shared';

export type TriStateBoolean = 'ALL' | 'true' | 'false';

export interface LeadListFilterState {
  search: string;
  city: string;
  category: string;
  websiteStatus: string;
  onlinePresence: string;
  hasPhone: TriStateBoolean;
  hasEmail: TriStateBoolean;
  hasWhatsApp: TriStateBoolean;
  limit?: number;
}

export const defaultLeadListFilters: LeadListFilterState = {
  search: '',
  city: '',
  category: '',
  websiteStatus: 'ALL',
  onlinePresence: 'ALL',
  hasPhone: 'ALL',
  hasEmail: 'ALL',
  hasWhatsApp: 'ALL',
  limit: 20
};

/**
 * Builds a query object suitable for Lead API list query parameters.
 * - Tri-state 'ALL' | 'true' | 'false' correctly maps to undefined | true | false.
 * - Note: 'false' is NEVER omitted and strictly passed as false.
 * - Trims strings and omits empty strings.
 */
export function buildLeadListQuery(
  filters: LeadListFilterState,
  cursor?: string | null
): Partial<LeadListQuery> {
  const query: Partial<LeadListQuery> = {};

  const search = filters.search?.trim();
  if (search) {
    query.search = search;
  }

  const city = filters.city?.trim();
  if (city) {
    query.city = city;
  }

  const category = filters.category?.trim();
  if (category) {
    query.category = category;
  }

  if (filters.websiteStatus && filters.websiteStatus !== 'ALL') {
    query.websiteStatus = filters.websiteStatus as WebsiteStatus;
  }

  if (filters.onlinePresence && filters.onlinePresence !== 'ALL') {
    query.onlinePresence = filters.onlinePresence as OnlinePresenceType;
  }

  if (filters.hasPhone === 'true') {
    query.hasPhone = true;
  } else if (filters.hasPhone === 'false') {
    query.hasPhone = false;
  }

  if (filters.hasEmail === 'true') {
    query.hasEmail = true;
  } else if (filters.hasEmail === 'false') {
    query.hasEmail = false;
  }

  if (filters.hasWhatsApp === 'true') {
    query.hasWhatsApp = true;
  } else if (filters.hasWhatsApp === 'false') {
    query.hasWhatsApp = false;
  }

  if (filters.limit !== undefined && filters.limit > 0) {
    query.limit = filters.limit;
  }

  if (cursor) {
    query.cursor = cursor;
  }

  return query;
}
