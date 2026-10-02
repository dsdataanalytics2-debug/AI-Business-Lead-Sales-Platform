import { type LeadDetail } from '@leadmate/shared';
import { ApiClientError } from '../api-client.js';

export type LeadDetailState =
  | {
      status: 'loading';
      requestId: number;
    }
  | {
      status: 'ready';
      lead: LeadDetail;
      isRefreshing: boolean;
      refreshWarning: string | null;
      requestId: number;
    }
  | {
      status: 'notFound';
      requestId: number;
    }
  | {
      status: 'error';
      message: string;
      code?: string;
      requestId: number;
      statusCode?: number;
      details?: Record<string, unknown>;
    };

export const initialLeadDetailState: LeadDetailState = {
  status: 'loading',
  requestId: 0
};

export type LeadDetailAction =
  | { type: 'FETCH_START'; leadId: string; requestId: number }
  | { type: 'FETCH_SUCCESS'; payload: { lead: LeadDetail; requestId: number } }
  | {
      type: 'FETCH_ERROR';
      payload: {
        error: {
          message: string;
          code?: string;
          statusCode?: number;
          details?: Record<string, unknown>;
        };
        requestId: number;
      };
    }
  | { type: 'REFRESH_START' }
  | { type: 'REFRESH_SUCCESS'; payload: { lead: LeadDetail } }
  | { type: 'REFRESH_ERROR'; payload: { warning: string } }
  | { type: 'CLEAR_REFRESH_WARNING' };

/**
 * Pure reducer managing lead detail page state transitions, request ID sequencing,
 * and non-destructive silent refresh behavior.
 */
export function leadDetailReducer(
  state: LeadDetailState,
  action: LeadDetailAction
): LeadDetailState {
  switch (action.type) {
    case 'FETCH_START': {
      return {
        status: 'loading',
        requestId: action.requestId
      };
    }

    case 'FETCH_SUCCESS': {
      if (action.payload.requestId !== state.requestId) {
        // Discard stale response from prior or superseded request
        return state;
      }
      return {
        status: 'ready',
        lead: action.payload.lead,
        isRefreshing: false,
        refreshWarning: null,
        requestId: action.payload.requestId
      };
    }

    case 'FETCH_ERROR': {
      if (action.payload.requestId !== state.requestId) {
        // Discard stale error from superseded request
        return state;
      }
      if (
        action.payload.error.statusCode === 404 ||
        action.payload.error.code === 'NOT_FOUND'
      ) {
        return {
          status: 'notFound',
          requestId: action.payload.requestId
        };
      }
      return {
        status: 'error',
        message: action.payload.error.message,
        code: action.payload.error.code,
        statusCode: action.payload.error.statusCode,
        details: action.payload.error.details,
        requestId: action.payload.requestId
      };
    }

    case 'REFRESH_START': {
      if (state.status !== 'ready') return state;
      return {
        ...state,
        isRefreshing: true
      };
    }

    case 'REFRESH_SUCCESS': {
      if (state.status !== 'ready') return state;
      return {
        ...state,
        isRefreshing: false,
        refreshWarning: null,
        lead: action.payload.lead
      };
    }

    case 'REFRESH_ERROR': {
      if (state.status !== 'ready') return state;
      return {
        ...state,
        isRefreshing: false,
        refreshWarning: action.payload.warning
      };
    }

    case 'CLEAR_REFRESH_WARNING': {
      if (state.status !== 'ready') return state;
      return {
        ...state,
        refreshWarning: null
      };
    }

    default:
      return state;
  }
}

/**
 * Classifies an unknown error into structured lead detail error details.
 */
export function classifyLeadDetailError(err: unknown): {
  isNotFound: boolean;
  message: string;
  code?: string;
  statusCode?: number;
  details?: Record<string, unknown>;
} {
  if (err instanceof ApiClientError) {
    const isNotFound = err.statusCode === 404 || err.code === 'NOT_FOUND';
    return {
      isNotFound,
      message: isNotFound ? 'Lead not found.' : err.message || 'Failed to retrieve lead details.',
      code: err.code,
      statusCode: err.statusCode,
      details: err.details as Record<string, unknown> | undefined
    };
  }

  return {
    isNotFound: false,
    message: 'Unable to connect to lead service. Please check your network and try again.'
  };
}
