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
