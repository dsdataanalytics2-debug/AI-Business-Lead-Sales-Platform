import { type LeadSummary } from '@leadmate/shared';

export interface LeadListError {
  message: string;
  code?: string;
  requestId?: string;
  statusCode?: number;
}

export interface LeadListState {
  generation: number;
  leads: LeadSummary[];
  nextCursor: string | null;
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: LeadListError | null;
  loadMoreError: LeadListError | null;
  hasLoaded: boolean;
}

export const initialLeadListState: LeadListState = {
  generation: 0,
  leads: [],
  nextCursor: null,
  total: 0,
  hasMore: false,
  isLoading: false,
  isLoadingMore: false,
  error: null,
  loadMoreError: null,
  hasLoaded: false
};

export type LeadListAction =
  | { type: 'APPLY_FILTERS'; generation: number }
  | {
      type: 'FETCH_INITIAL_SUCCESS';
      payload: {
        generation: number;
        leads: LeadSummary[];
        nextCursor: string | null;
        total: number;
        hasMore: boolean;
      };
    }
  | {
      type: 'FETCH_INITIAL_ERROR';
      payload: {
        generation: number;
        error: LeadListError;
      };
    }
  | { type: 'LOAD_MORE_START' }
  | {
      type: 'LOAD_MORE_SUCCESS';
      payload: {
        generation: number;
        leads: LeadSummary[];
        nextCursor: string | null;
        total: number;
        hasMore: boolean;
      };
    }
  | {
      type: 'LOAD_MORE_ERROR';
      payload: {
        generation: number;
        error: LeadListError;
      };
    };

/**
 * Pure reducer managing lead list state transitions, generation tracking, and pagination deduplication.
 */
export function leadListReducer(state: LeadListState, action: LeadListAction): LeadListState {
  switch (action.type) {
    case 'APPLY_FILTERS': {
      return {
        ...state,
        generation: action.generation,
        isLoading: true,
        isLoadingMore: false,
        error: null,
        loadMoreError: null,
        leads: [],
        nextCursor: null,
        hasMore: false
      };
    }

    case 'FETCH_INITIAL_SUCCESS': {
      if (action.payload.generation !== state.generation) {
        // Discard stale response from prior generation
        return state;
      }
      return {
        ...state,
        isLoading: false,
        hasLoaded: true,
        leads: action.payload.leads,
        nextCursor: action.payload.nextCursor,
        total: action.payload.total,
        hasMore: action.payload.hasMore,
        error: null
      };
    }

    case 'FETCH_INITIAL_ERROR': {
      if (action.payload.generation !== state.generation) {
        // Discard stale error from prior generation
        return state;
      }
      return {
        ...state,
        isLoading: false,
        hasLoaded: true,
        leads: [],
        nextCursor: null,
        hasMore: false,
        error: action.payload.error
      };
    }

    case 'LOAD_MORE_START': {
      return {
        ...state,
        isLoadingMore: true,
        loadMoreError: null
      };
    }

    case 'LOAD_MORE_SUCCESS': {
      if (action.payload.generation !== state.generation) {
        // Discard stale load-more response if generation changed
        return state;
      }
      // Deduplicate by Lead.id on append
      const existingIds = new Set(state.leads.map((l) => l.id));
      const newItems = action.payload.leads.filter((l) => !existingIds.has(l.id));

      return {
        ...state,
        isLoadingMore: false,
        leads: [...state.leads, ...newItems],
        nextCursor: action.payload.nextCursor,
        total: action.payload.total,
        hasMore: action.payload.hasMore,
        loadMoreError: null
      };
    }

    case 'LOAD_MORE_ERROR': {
      if (action.payload.generation !== state.generation) {
        // Discard stale load-more error
        return state;
      }
      // Preserve existing leads and set inline loadMoreError
      return {
        ...state,
        isLoadingMore: false,
        loadMoreError: action.payload.error
      };
    }

    default:
      return state;
  }
}
