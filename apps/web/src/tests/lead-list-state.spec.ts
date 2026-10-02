import { describe, it, expect } from 'vitest';
import { WebsiteStatus, OnlinePresenceType, type LeadSummary } from '@leadmate/shared';
import {
  leadListReducer,
  initialLeadListState,
  type LeadListState
} from '../lib/leads/lead-list-state.js';

const mockLead = (id: string, name: string): LeadSummary => ({
  id,
  name,
  normalizedName: name.toLowerCase(),
  category: 'Clinic',
  locality: 'Banani',
  city: 'Dhaka',
  region: 'Dhaka',
  country: 'Bangladesh',
  primaryPhone: '+8801711000001',
  primaryEmail: 'info@lead.com',
  website: 'https://lead.com',
  websiteStatus: WebsiteStatus.REACHABLE,
  onlinePresenceType: OnlinePresenceType.WEBSITE,
  rating: 4.5,
  reviewCount: 10,
  primarySource: 'GOOGLE_MAPS',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

describe('Lead List State Reducer (Pure Unit Tests)', () => {
  it('1. should set generation and enter loading state on APPLY_FILTERS', () => {
    const s1 = leadListReducer(initialLeadListState, { type: 'APPLY_FILTERS', generation: 1 });

    expect(s1.generation).toBe(1);
    expect(s1.isLoading).toBe(true);
    expect(s1.leads).toEqual([]);
    expect(s1.error).toBeNull();
  });

  it('2. should accept initial fetch success matching current generation', () => {
    const s1: LeadListState = {
      ...initialLeadListState,
      generation: 2,
      isLoading: true
    };

    const leadA = mockLead('lead-1', 'Alpha Clinic');
    const s2 = leadListReducer(s1, {
      type: 'FETCH_INITIAL_SUCCESS',
      payload: {
        generation: 2,
        leads: [leadA],
        nextCursor: 'cursor-123',
        total: 1,
        hasMore: true
      }
    });

    expect(s2.isLoading).toBe(false);
    expect(s2.hasLoaded).toBe(true);
    expect(s2.leads).toHaveLength(1);
    expect(s2.leads[0].id).toBe('lead-1');
    expect(s2.nextCursor).toBe('cursor-123');
    expect(s2.total).toBe(1);
    expect(s2.hasMore).toBe(true);
  });

  it('3. should discard stale initial fetch success from an older generation', () => {
    const s1: LeadListState = {
      ...initialLeadListState,
      generation: 3,
      isLoading: true,
      leads: []
    };

    const staleLead = mockLead('stale-lead', 'Stale Clinic');
    const s2 = leadListReducer(s1, {
      type: 'FETCH_INITIAL_SUCCESS',
      payload: {
        generation: 2, // Older generation!
        leads: [staleLead],
        nextCursor: 'stale-cursor',
        total: 99,
        hasMore: false
      }
    });

    expect(s2).toBe(s1);
    expect(s2.leads).toEqual([]);
    expect(s2.isLoading).toBe(true);
  });

  it('4. should discard stale initial fetch error from an older generation', () => {
    const s1: LeadListState = {
      ...initialLeadListState,
      generation: 4,
      isLoading: true,
      error: null
    };

    const s2 = leadListReducer(s1, {
      type: 'FETCH_INITIAL_ERROR',
      payload: {
        generation: 3, // Stale!
        error: { message: 'Old error' }
      }
    });

    expect(s2).toBe(s1);
    expect(s2.error).toBeNull();
  });

  it('5. should correctly handle React StrictMode double effect execution scenario', () => {
    // Under StrictMode, effect runs once (gen 1), then runs again (gen 2) on the same initial closure.
    const s0 = initialLeadListState;
    const s1 = leadListReducer(s0, { type: 'APPLY_FILTERS', generation: 1 });
    expect(s1.generation).toBe(1);
    expect(s1.isLoading).toBe(true);

    const s2 = leadListReducer(s1, { type: 'APPLY_FILTERS', generation: 2 });
    expect(s2.generation).toBe(2);
    expect(s2.isLoading).toBe(true);

    // Stale response from first invocation (generation 1) arrives -> MUST BE DISCARDED
    const leadGen1 = mockLead('lead-stale', 'Stale Lead');
    const s3 = leadListReducer(s2, {
      type: 'FETCH_INITIAL_SUCCESS',
      payload: {
        generation: 1,
        leads: [leadGen1],
        nextCursor: null,
        total: 1,
        hasMore: false
      }
    });
    expect(s3).toBe(s2);
    expect(s3.leads).toEqual([]);
    expect(s3.isLoading).toBe(true);

    // Fresh response from second invocation (generation 2) arrives -> MUST BE ACCEPTED
    const leadGen2 = mockLead('lead-fresh', 'Fresh Lead');
    const s4 = leadListReducer(s3, {
      type: 'FETCH_INITIAL_SUCCESS',
      payload: {
        generation: 2,
        leads: [leadGen2],
        nextCursor: 'cursor-gen2',
        total: 1,
        hasMore: true
      }
    });
    expect(s4.isLoading).toBe(false);
    expect(s4.hasLoaded).toBe(true);
    expect(s4.leads).toHaveLength(1);
    expect(s4.leads[0].id).toBe('lead-fresh');
    expect(s4.nextCursor).toBe('cursor-gen2');
  });

  it('6. should discard Load More started in gen 2 and arriving after APPLY_FILTERS gen 3', () => {
    // Current state is at gen 2 with ready leads
    const s2: LeadListState = {
      ...initialLeadListState,
      generation: 2,
      leads: [mockLead('lead-1', 'Lead 1')],
      nextCursor: 'cursor-gen2',
      hasMore: true,
      hasLoaded: true
    };

    // User clicks Load More (started in gen 2)
    const s2LoadingMore = leadListReducer(s2, { type: 'LOAD_MORE_START' });
    expect(s2LoadingMore.isLoadingMore).toBe(true);

    // While load more is in-flight, user changes filters (advancing to gen 3)
    const s3 = leadListReducer(s2LoadingMore, { type: 'APPLY_FILTERS', generation: 3 });
    expect(s3.generation).toBe(3);
    expect(s3.isLoading).toBe(true);
    expect(s3.leads).toEqual([]);

    // Stale Load More response from gen 2 arrives -> MUST BE DISCARDED
    const s4 = leadListReducer(s3, {
      type: 'LOAD_MORE_SUCCESS',
      payload: {
        generation: 2,
        leads: [mockLead('lead-2', 'Lead 2')],
        nextCursor: 'cursor-gen2-page2',
        total: 2,
        hasMore: false
      }
    });
    expect(s4).toBe(s3);
    expect(s4.leads).toEqual([]);
    expect(s4.generation).toBe(3);
  });

  it('7. should deduplicate leads by id when appending pages via LOAD_MORE_SUCCESS', () => {
    const lead1 = mockLead('lead-1', 'Alpha Clinic');
    const lead2 = mockLead('lead-2', 'Beta Clinic');
    const duplicateLead2 = mockLead('lead-2', 'Beta Clinic Duplicate');
    const lead3 = mockLead('lead-3', 'Gamma Clinic');

    const s1: LeadListState = {
      ...initialLeadListState,
      generation: 1,
      leads: [lead1, lead2],
      nextCursor: 'cursor-1',
      hasMore: true,
      isLoadingMore: true
    };

    const s2 = leadListReducer(s1, {
      type: 'LOAD_MORE_SUCCESS',
      payload: {
        generation: 1,
        leads: [duplicateLead2, lead3],
        nextCursor: 'cursor-2',
        total: 3,
        hasMore: false
      }
    });

    expect(s2.isLoadingMore).toBe(false);
    expect(s2.leads).toHaveLength(3);
    expect(s2.leads.map((l) => l.id)).toEqual(['lead-1', 'lead-2', 'lead-3']);
    expect(s2.nextCursor).toBe('cursor-2');
    expect(s2.hasMore).toBe(false);
  });

  it('8. should keep existing rows and set inline loadMoreError on LOAD_MORE_ERROR', () => {
    const lead1 = mockLead('lead-1', 'Alpha Clinic');

    const s1: LeadListState = {
      ...initialLeadListState,
      generation: 1,
      leads: [lead1],
      nextCursor: 'cursor-1',
      hasMore: true,
      isLoadingMore: true
    };

    const s2 = leadListReducer(s1, {
      type: 'LOAD_MORE_ERROR',
      payload: {
        generation: 1,
        error: { message: 'Failed to fetch next page', code: 'TIMEOUT', requestId: 'req-123' }
      }
    });

    expect(s2.isLoadingMore).toBe(false);
    expect(s2.leads).toHaveLength(1);
    expect(s2.leads[0].id).toBe('lead-1');
    expect(s2.loadMoreError).toEqual({
      message: 'Failed to fetch next page',
      code: 'TIMEOUT',
      requestId: 'req-123'
    });
  });
});
