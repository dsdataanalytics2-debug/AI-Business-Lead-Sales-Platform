import {
  ApiErrorResponse,
  ApiSuccessResponse,
  AuthUser,
  Permission,
  DuplicateAction,
  type BusinessSearchResult,
  type SaveLeadRequest
} from '@leadmate/shared';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly requestId?: string;

  constructor(code: string, message: string, statusCode: number, details?: unknown, requestId?: string) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.requestId = requestId;
  }
}

export interface AuthSessionData {
  user: AuthUser;
  permissions: Permission[];
}

export interface BusinessSearchQueryParams {
  q: string;
  location: string;
  category?: string;
  limit?: number;
  provider?: string;
}

export interface SaveLeadResponse {
  action: DuplicateAction;
  leadId: string;
  matchReason?: string;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${path}`;

  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  // Strictly enforce httpOnly cookie credentials inclusion
  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include'
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    if (data && (data as ApiErrorResponse).error) {
      const { code, message, details, requestId } = (data as ApiErrorResponse).error;
      throw new ApiClientError(code, message, res.status, details, requestId);
    }
    throw new ApiClientError('HTTP_ERROR', res.statusText || 'An error occurred', res.status);
  }

  return ((data as ApiSuccessResponse<T>)?.data !== undefined ? (data as ApiSuccessResponse<T>).data : data) as T;
}

export const apiClient = {
  auth: {
    login: (email: string, password: string): Promise<AuthSessionData> =>
      request<AuthSessionData>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      }),
    logout: (): Promise<{ success: boolean }> =>
      request<{ success: boolean }>('/auth/logout', {
        method: 'POST'
      }),
    me: (): Promise<AuthSessionData> =>
      request<AuthSessionData>('/auth/me', {
        method: 'GET'
      })
  },
  businessSearch: {
    search: (params: BusinessSearchQueryParams): Promise<BusinessSearchResult[]> => {
      const searchParams = new URLSearchParams();
      searchParams.set('q', params.q);
      searchParams.set('location', params.location);
      if (params.category) searchParams.set('category', params.category);
      if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
      if (params.provider) searchParams.set('provider', params.provider);

      return request<BusinessSearchResult[]>(`/business-search?${searchParams.toString()}`, {
        method: 'GET'
      });
    },
    saveLead: (input: SaveLeadRequest): Promise<SaveLeadResponse> =>
      request<SaveLeadResponse>('/business-search/save-lead', {
        method: 'POST',
        body: JSON.stringify(input)
      })
  }
};
