import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@leadmate/shared';
import { AppError } from '../lib/errors.js';
import { logger } from './logger.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const requestId = req.id || 'unknown';

  // 1. Handle Zod validation errors
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
      code: issue.code
    }));

    res.status(422).json({
      error: {
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Input validation failed',
        details,
        requestId
      }
    });
    return;
  }

  // 2. Handle Custom App Errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId
      }
    });
    return;
  }

  // 3. Handle Unexpected Server Errors
  logger.error({ err, requestId }, 'Unhandled server error');

  res.status(500).json({
    error: {
      code: ErrorCodes.INTERNAL_ERROR,
      message: 'An internal server error occurred',
      details: process.env.NODE_ENV === 'development' && err instanceof Error ? { stack: err.stack } : {},
      requestId
    }
  });
}
