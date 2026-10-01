import { ApiErrorResponse, ApiSuccessResponse, AuthUser, Permission } from '@leadmate/shared';

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
  }
};
