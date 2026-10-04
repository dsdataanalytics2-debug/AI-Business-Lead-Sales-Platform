import { Request, Response, NextFunction } from 'express';
import { ErrorCodes } from '@leadmate/shared';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const loginAttempts = new Map<string, RateLimitRecord>();

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

export function loginRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
  const now = Date.now();

  const record = loginAttempts.get(ip);

  if (!record || now > record.resetTime) {
    loginAttempts.set(ip, { count: 1, resetTime: now + WINDOW_MS });
    return next();
  }

  if (record.count >= MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);
    res.setHeader('Retry-After', retryAfterSeconds.toString());
    res.status(429).json({
      error: {
        code: ErrorCodes.RATE_LIMITED,
        message: 'Too many login attempts. Please try again in 15 minutes.',
        details: { retryAfterSeconds },
        requestId: req.id || 'unknown'
      }
    });
    return;
  }

  record.count += 1;
  next();
}

/**
 * Helper to clear rate limiter state for tests.
 */
export function resetLoginRateLimiter(): void {
  loginAttempts.clear();
}

const analyzeAttempts = new Map<string, RateLimitRecord>();

const ANALYZE_WINDOW_MS = 60 * 1000; // 60 seconds (1 minute)
const ANALYZE_MAX_ATTEMPTS = 30; // 30 requests per minute

export function analyzeRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const userId = req.user?.id;
  if (!userId) {
    return next();
  }

  const now = Date.now();
  const record = analyzeAttempts.get(userId);

  if (!record || now > record.resetTime) {
    analyzeAttempts.set(userId, { count: 1, resetTime: now + ANALYZE_WINDOW_MS });
    return next();
  }

  if (record.count >= ANALYZE_MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);
    res.setHeader('Retry-After', retryAfterSeconds.toString());
    res.status(429).json({
      error: {
        code: ErrorCodes.RATE_LIMITED,
        message: 'Rate limit exceeded for online presence analysis. Please try again later.',
        details: { retryAfterSeconds },
        requestId: req.id || 'unknown'
      }
    });
    return;
  }

  record.count += 1;
  next();
}

/**
 * Helper to clear analyze rate limiter state for tests.
 */
export function resetAnalyzeRateLimiter(): void {
  analyzeAttempts.clear();
}

const salesAssistantAttempts = new Map<string, RateLimitRecord>();

const SALES_ASSISTANT_WINDOW_MS = 60 * 1000; // 60 seconds (1 minute)
const SALES_ASSISTANT_MAX_ATTEMPTS = 30; // 30 requests per minute

export function salesAssistantRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const userId = req.user?.id;
  if (!userId) {
    return next();
  }

  const now = Date.now();
  const record = salesAssistantAttempts.get(userId);

  if (!record || now > record.resetTime) {
    salesAssistantAttempts.set(userId, { count: 1, resetTime: now + SALES_ASSISTANT_WINDOW_MS });
    return next();
  }

  if (record.count >= SALES_ASSISTANT_MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);
    res.setHeader('Retry-After', retryAfterSeconds.toString());
    res.status(429).json({
      error: {
        code: ErrorCodes.RATE_LIMITED,
        message: 'Rate limit exceeded for sales assistant draft generation. Please try again later.',
        details: { retryAfterSeconds },
        requestId: req.id || 'unknown'
      }
    });
    return;
  }

  record.count += 1;
  next();
}

/**
 * Helper to clear sales assistant rate limiter state for tests.
 */
export function resetSalesAssistantRateLimiter(): void {
  salesAssistantAttempts.clear();
}
