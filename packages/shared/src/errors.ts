export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  SUPPRESSED_CONTACT: 'SUPPRESSED_CONTACT',
  SOURCE_NOT_APPROVED: 'SOURCE_NOT_APPROVED',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  RATE_LIMITED: 'RATE_LIMITED',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface ApiErrorDetail {
  field?: string;
  message: string;
  [key: string]: unknown;
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown> | ApiErrorDetail[] | unknown;
  requestId: string;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
}

export interface ApiSuccessResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export const ERROR_CODE_TO_HTTP_STATUS: Record<ErrorCode, number> = {
  [ErrorCodes.VALIDATION_ERROR]: 422,
  [ErrorCodes.UNAUTHENTICATED]: 401,
  [ErrorCodes.FORBIDDEN]: 403,
  [ErrorCodes.NOT_FOUND]: 404,
  [ErrorCodes.CONFLICT]: 409,
  [ErrorCodes.SUPPRESSED_CONTACT]: 409,
  [ErrorCodes.SOURCE_NOT_APPROVED]: 400,
  [ErrorCodes.BUDGET_EXCEEDED]: 400,
  [ErrorCodes.RATE_LIMITED]: 429,
  [ErrorCodes.EXTERNAL_SERVICE_ERROR]: 502,
  [ErrorCodes.INTERNAL_ERROR]: 500
};
