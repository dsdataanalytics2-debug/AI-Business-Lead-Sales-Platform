import { describe, it, expect } from 'vitest';
import { WebsiteStatus, OnlinePresenceType } from '@leadmate/shared';
import {
  buildLeadListQuery,
  defaultLeadListFilters
} from '../lib/leads/lead-list-query.js';

describe('Lead List Query Builder (Pure Unit Tests)', () => {
  it('1. should return empty query object when default filters are provided', () => {
    const query = buildLeadListQuery(defaultLeadListFilters);
    expect(query).toEqual({
      limit: 20
    });
  });

  it('2. should map tri-state boolean filters accurately (ALL -> undefined, true -> true, false -> false)', () => {
    const allQuery = buildLeadListQuery({
      ...defaultLeadListFilters,
      hasPhone: 'ALL',
      hasEmail: 'ALL',
      hasWhatsApp: 'ALL'
    });
    expect(allQuery.hasPhone).toBeUndefined();
    expect(allQuery.hasEmail).toBeUndefined();
    expect(allQuery.hasWhatsApp).toBeUndefined();

    const trueQuery = buildLeadListQuery({
      ...defaultLeadListFilters,
      hasPhone: 'true',
      hasEmail: 'true',
      hasWhatsApp: 'true'
    });
    expect(trueQuery.hasPhone).toBe(true);
    expect(trueQuery.hasEmail).toBe(true);
    expect(trueQuery.hasWhatsApp).toBe(true);

    const falseQuery = buildLeadListQuery({
      ...defaultLeadListFilters,
      hasPhone: 'false',
      hasEmail: 'false',
      hasWhatsApp: 'false'
    });
    // Critical: false MUST NEVER be omitted!
    expect(falseQuery.hasPhone).toBe(false);
    expect(falseQuery.hasEmail).toBe(false);
    expect(falseQuery.hasWhatsApp).toBe(false);
  });

  it('3. should trim string fields and omit empty or whitespace-only inputs', () => {
    const query = buildLeadListQuery({
      ...defaultLeadListFilters,
      search: '  Dhaka Hospital  ',
      city: '  Dhaka  ',
      category: '   '
    });

    expect(query.search).toBe('Dhaka Hospital');
    expect(query.city).toBe('Dhaka');
    expect(query.category).toBeUndefined();
  });

  it('4. should map websiteStatus and onlinePresence enums, omitting ALL', () => {
    const enumQuery = buildLeadListQuery({
      ...defaultLeadListFilters,
      websiteStatus: WebsiteStatus.REACHABLE,
      onlinePresence: OnlinePresenceType.WEBSITE
    });

    expect(enumQuery.websiteStatus).toBe(WebsiteStatus.REACHABLE);
    expect(enumQuery.onlinePresence).toBe(OnlinePresenceType.WEBSITE);

    const allQuery = buildLeadListQuery({
      ...defaultLeadListFilters,
      websiteStatus: 'ALL',
      onlinePresence: 'ALL'
    });

    expect(allQuery.websiteStatus).toBeUndefined();
    expect(allQuery.onlinePresence).toBeUndefined();
  });

  it('5. should include cursor and custom limit when provided', () => {
    const cursor = '123e4567-e89b-12d3-a456-426614174000';
    const query = buildLeadListQuery(
      {
        ...defaultLeadListFilters,
        limit: 50
      },
      cursor
    );

    expect(query.cursor).toBe(cursor);
    expect(query.limit).toBe(50);
  });
});
