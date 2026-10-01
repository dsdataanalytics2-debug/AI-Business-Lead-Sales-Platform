import { ErrorCode, ErrorCodes, ERROR_CODE_TO_HTTP_STATUS } from '@leadmate/shared';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown> | Array<unknown>;

  constructor(code: ErrorCode, message: string, statusCode?: number, details?: Record<string, unknown> | Array<unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode ?? ERROR_CODE_TO_HTTP_STATUS[code] ?? 500;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', details?: Record<string, unknown>) {
    super(ErrorCodes.UNAUTHENTICATED, message, 401, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions to perform this action', details?: Record<string, unknown>) {
    super(ErrorCodes.FORBIDDEN, message, 403, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Requested resource not found', details?: Record<string, unknown>) {
    super(ErrorCodes.NOT_FOUND, message, 404, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', details?: Record<string, unknown>) {
    super(ErrorCodes.CONFLICT, message, 409, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: Record<string, unknown> | Array<unknown>) {
    super(ErrorCodes.VALIDATION_ERROR, message, 422, details);
  }
}
