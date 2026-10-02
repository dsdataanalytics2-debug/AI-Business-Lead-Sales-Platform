import { describe, it, expect } from 'vitest';
import { WebsiteStatus, OnlinePresenceType, type LeadDetail } from '@leadmate/shared';
import { ApiClientError } from '../lib/api-client.js';
import {
  leadDetailReducer,
  initialLeadDetailState,
  classifyLeadDetailError,
  type LeadDetailState
} from '../lib/leads/lead-detail-state.js';

const mockDetail = (id: string, name: string): LeadDetail => ({
  id,
  name,
  normalizedName: name.toLowerCase(),
  category: 'Clinic',
  description: 'Specialist medical center',
  address: '123 Main St',
  locality: 'Banani',
  city: 'Dhaka',
  region: 'Dhaka',
  country: 'BD',
  latitude: 23.79,
  longitude: 90.40,
  website: 'https://lead.com',
  websiteStatus: WebsiteStatus.REACHABLE,
  onlinePresenceType: OnlinePresenceType.WEBSITE,
  rating: 4.8,
  reviewCount: 42,
  primarySource: 'GOOGLE_MAPS',
  contacts: [],
  sources: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

describe('Lead Detail State Reducer & Error Classifier (Pure Unit Tests)', () => {
  describe('leadDetailReducer', () => {
    it('1. should transition to loading state on FETCH_START', () => {
      const s1 = leadDetailReducer(initialLeadDetailState, {
        type: 'FETCH_START',
        leadId: 'lead-1',
        requestId: 1
      });

      expect(s1).toEqual({
        status: 'loading',
        requestId: 1
      });
    });

    it('2. should transition to ready state on FETCH_SUCCESS with matching requestId', () => {
      const s1: LeadDetailState = { status: 'loading', requestId: 1 };
      const lead = mockDetail('lead-1', 'Dhaka Medical');

      const s2 = leadDetailReducer(s1, {
        type: 'FETCH_SUCCESS',
        payload: { lead, requestId: 1 }
      });

      expect(s2.status).toBe('ready');
      if (s2.status === 'ready') {
        expect(s2.lead.id).toBe('lead-1');
        expect(s2.isRefreshing).toBe(false);
        expect(s2.refreshWarning).toBeNull();
        expect(s2.requestId).toBe(1);
      }
    });

    it('3. should transition to notFound state on FETCH_ERROR with 404', () => {
      const s1: LeadDetailState = { status: 'loading', requestId: 1 };

      const s2 = leadDetailReducer(s1, {
        type: 'FETCH_ERROR',
        payload: {
          error: { message: 'Lead not found.', statusCode: 404, code: 'NOT_FOUND' },
          requestId: 1
        }
      });

      expect(s2).toEqual({
        status: 'notFound',
        requestId: 1
      });
    });

    it('4. should transition to error state (and NOT notFound) for 401, 403, 500, or network error', () => {
      const s1: LeadDetailState = { status: 'loading', requestId: 1 };

      // 401 Unauthorized
      const s401 = leadDetailReducer(s1, {
        type: 'FETCH_ERROR',
        payload: {
          error: { message: 'Session expired', statusCode: 401, code: 'UNAUTHORIZED' },
          requestId: 1
        }
      });
      expect(s401.status).toBe('error');
      if (s401.status === 'error') {
        expect(s401.statusCode).toBe(401);
        expect(s401.code).toBe('UNAUTHORIZED');
      }

      // 403 Forbidden
      const s403 = leadDetailReducer(s1, {
        type: 'FETCH_ERROR',
        payload: {
          error: { message: 'Forbidden', statusCode: 403, code: 'FORBIDDEN' },
          requestId: 1
        }
      });
      expect(s403.status).toBe('error');
      if (s403.status === 'error') {
        expect(s403.statusCode).toBe(403);
      }

      // 500 Internal Server Error
      const s500 = leadDetailReducer(s1, {
        type: 'FETCH_ERROR',
        payload: {
          error: { message: 'Server crashed', statusCode: 500, code: 'INTERNAL_ERROR' },
          requestId: 1
        }
      });
      expect(s500.status).toBe('error');

      // Network error (no statusCode)
      const sNetwork = leadDetailReducer(s1, {
        type: 'FETCH_ERROR',
        payload: {
          error: { message: 'Network disconnected' },
          requestId: 1
        }
      });
      expect(sNetwork.status).toBe('error');
    });

    it('5. should discard stale responses when requestId does not match', () => {
      const s1: LeadDetailState = { status: 'loading', requestId: 2 };
      const staleLead = mockDetail('lead-old', 'Stale Lead');

      const s2 = leadDetailReducer(s1, {
        type: 'FETCH_SUCCESS',
        payload: { lead: staleLead, requestId: 1 }
      });
      expect(s2).toBe(s1);
      expect(s2.status).toBe('loading');

      const s3 = leadDetailReducer(s1, {
        type: 'FETCH_ERROR',
        payload: {
          error: { message: 'Stale error', statusCode: 500 },
          requestId: 1
        }
      });
      expect(s3).toBe(s1);
    });

    it('6. should ignore late response from old lead after leadId change resets to new requestId', () => {
      // User navigates from lead-1 (req 1) to lead-2 (req 2)
      const sLoadingLead2 = leadDetailReducer(initialLeadDetailState, {
        type: 'FETCH_START',
        leadId: 'lead-2',
        requestId: 2
      });

      // Late response from lead-1 arrives (req 1)
      const lateLead1 = mockDetail('lead-1', 'Lead 1');
      const sAfterLate = leadDetailReducer(sLoadingLead2, {
        type: 'FETCH_SUCCESS',
        payload: { lead: lateLead1, requestId: 1 }
      });

      // Must remain in loading state for lead-2
      expect(sAfterLate.status).toBe('loading');
      expect(sAfterLate.requestId).toBe(2);
    });

    it('7. should preserve lead on silent refresh failure and set refreshWarning', () => {
      const lead = mockDetail('lead-1', 'Dhaka Medical');
      const sReady: LeadDetailState = {
        status: 'ready',
        lead,
        isRefreshing: true,
        refreshWarning: null,
        requestId: 1
      };

      const sAfterFail = leadDetailReducer(sReady, {
        type: 'REFRESH_ERROR',
        payload: { warning: 'Saved, but could not refresh. Retry.' }
      });

      expect(sAfterFail.status).toBe('ready');
      if (sAfterFail.status === 'ready') {
        expect(sAfterFail.lead.id).toBe('lead-1');
        expect(sAfterFail.isRefreshing).toBe(false);
        expect(sAfterFail.refreshWarning).toBe('Saved, but could not refresh. Retry.');
      }
    });

    it('8. should update lead and clear refreshWarning on silent refresh success', () => {
      const lead = mockDetail('lead-1', 'Dhaka Medical');
      const updatedLead = mockDetail('lead-1', 'Dhaka Medical Updated');
      const sReadyWithWarning: LeadDetailState = {
        status: 'ready',
        lead,
        isRefreshing: true,
        refreshWarning: 'Previous warning',
        requestId: 1
      };

      const sSuccess = leadDetailReducer(sReadyWithWarning, {
        type: 'REFRESH_SUCCESS',
        payload: { lead: updatedLead }
      });

      expect(sSuccess.status).toBe('ready');
      if (sSuccess.status === 'ready') {
        expect(sSuccess.lead.name).toBe('Dhaka Medical Updated');
        expect(sSuccess.isRefreshing).toBe(false);
        expect(sSuccess.refreshWarning).toBeNull();
      }
    });
  });

  describe('classifyLeadDetailError', () => {
    it('correctly classifies ApiClientError with 404 as notFound', () => {
      const err = new ApiClientError('NOT_FOUND', 'Record missing', 404);
      const res = classifyLeadDetailError(err);
      expect(res.isNotFound).toBe(true);
      expect(res.message).toBe('Lead not found.');
      expect(res.statusCode).toBe(404);
    });

    it('correctly classifies ApiClientError with 401/403/500/422 as non-404 error with preserved details', () => {
      const err422 = new ApiClientError(
        'VALIDATION_FAILED',
        'Invalid input format',
        422,
        { field: 'website', reason: 'invalid_url' },
        'req-abc'
      );
      const res422 = classifyLeadDetailError(err422);
      expect(res422.isNotFound).toBe(false);
      expect(res422.statusCode).toBe(422);
      expect(res422.code).toBe('VALIDATION_FAILED');
      expect(res422.details).toEqual({ field: 'website', reason: 'invalid_url' });

      const err500 = new ApiClientError('INTERNAL_ERROR', 'Database down', 500);
      const res500 = classifyLeadDetailError(err500);
      expect(res500.isNotFound).toBe(false);
      expect(res500.statusCode).toBe(500);
    });

    it('correctly classifies standard JS errors / network failures', () => {
      const netErr = new Error('Failed to fetch');
      const res = classifyLeadDetailError(netErr);
      expect(res.isNotFound).toBe(false);
      expect(res.message).toContain('Unable to connect to lead service');
    });
  });
});
