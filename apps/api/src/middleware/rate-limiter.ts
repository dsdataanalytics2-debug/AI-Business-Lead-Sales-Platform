import { Request, Response, NextFunction } from 'express';
import { ErrorCodes } from '@leadmate/shared';
import { checkRateLimitDistributed, resetLocalRateLimiterState } from '../lib/redis.js';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const loginAttempts = new Map<string, RateLimitRecord>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX_ATTEMPTS = 5;

/**
 * Login rate limiter: 5 attempts per 15 minutes per IP.
 */
export function loginRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
  const now = Date.now();

  const record = loginAttempts.get(ip);

  if (!record || now > record.resetTime) {
    loginAttempts.set(ip, { count: 1, resetTime: now + LOGIN_WINDOW_MS });
    return next();
  }

  if (record.count >= LOGIN_MAX_ATTEMPTS) {
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

export function resetLoginRateLimiter(): void {
  loginAttempts.clear();
}

/**
 * Generic helper for distributed rate limiting with standardized 429 response.
 */
async function applyRateLimit(
  category: string,
  key: string,
  limit: number,
  windowSeconds: number,
  errorMessage: string,
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const result = await checkRateLimitDistributed(category, key, limit, windowSeconds);

  if (!result.allowed) {
    const now = Date.now();
    const retryAfterSeconds = Math.max(1, Math.ceil((result.resetTime - now) / 1000));
    res.setHeader('Retry-After', retryAfterSeconds.toString());
    res.status(429).json({
      error: {
        code: ErrorCodes.RATE_LIMITED,
        message: errorMessage,
        details: { retryAfterSeconds },
        requestId: req.id || 'unknown'
      }
    });
    return;
  }

  next();
}

/**
 * Legacy Online Presence Analysis rate limiter: 30 requests/min per user.
 */
export async function analyzeRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.user?.id || req.ip || 'anonymous';
  await applyRateLimit(
    'analyze-presence',
    key,
    30,
    60,
    'Rate limit exceeded for online presence analysis. Please try again later.',
    req,
    res,
    next
  );
}

export function resetAnalyzeRateLimiter(): void {
  resetLocalRateLimiterState();
}

/**
 * Legacy Sales Assistant Draft rate limiter: 30 requests/min per user.
 */
export async function salesAssistantRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.user?.id || req.ip || 'anonymous';
  await applyRateLimit(
    'sales-assistant-draft',
    key,
    30,
    60,
    'Rate limit exceeded for sales assistant draft generation. Please try again later.',
    req,
    res,
    next
  );
}

export function resetSalesAssistantRateLimiter(): void {
  resetLocalRateLimiterState();
}

/**
 * AI Product Analysis rate limiter: 20 requests/min per tenant.
 */
export async function aiProductAnalysisRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.user?.organizationId || req.ip || 'anonymous';
  await applyRateLimit(
    'ai-product-analysis',
    key,
    20,
    60,
    'Rate limit exceeded for AI product analysis. Please try again in a minute.',
    req,
    res,
    next
  );
}

/**
 * Buyer Discovery rate limiter: 15 requests/min per tenant.
 */
export async function buyerDiscoveryRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.user?.organizationId || req.ip || 'anonymous';
  await applyRateLimit(
    'buyer-discovery',
    key,
    15,
    60,
    'Rate limit exceeded for buyer discovery. Please try again in a minute.',
    req,
    res,
    next
  );
}

/**
 * Buyer Refresh (Find More Buyers) rate limiter: 15 requests/min per tenant.
 */
export async function buyerRefreshRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.user?.organizationId || req.ip || 'anonymous';
  await applyRateLimit(
    'buyer-refresh',
    key,
    15,
    60,
    'Rate limit exceeded for finding more buyers. Please try again in a minute.',
    req,
    res,
    next
  );
}

/**
 * Outreach Draft Generation rate limiter: 25 requests/min per user.
 */
export async function draftGenerationRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.user?.id || req.ip || 'anonymous';
  await applyRateLimit(
    'outreach-draft-gen',
    key,
    25,
    60,
    'Rate limit exceeded for outreach draft generation. Please try again in a minute.',
    req,
    res,
    next
  );
}

/**
 * Location Search rate limiter: 60 requests/min per user/IP.
 */
export async function locationSearchRateLimiter(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.user?.id || req.ip || req.socket.remoteAddress || '127.0.0.1';
  await applyRateLimit(
    'location-search',
    key,
    60,
    60,
    'Rate limit exceeded for location search. Please try again shortly.',
    req,
    res,
    next
  );
}

/**
 * Global helper to reset all local rate limiter state in tests.
 */
export function resetAllRateLimiters(): void {
  loginAttempts.clear();
  resetLocalRateLimiterState();
}
