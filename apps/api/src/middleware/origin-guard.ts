import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { ForbiddenError } from '../lib/errors.js';

/**
 * Normalizes an origin string (removes trailing slashes and forces lowercase).
 */
function normalizeOrigin(urlStr: string): string {
  try {
    return new URL(urlStr).origin.toLowerCase();
  } catch {
    return urlStr.trim().toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Origin and Referer validation middleware for state-changing HTTP requests.
 *
 * Protects cookie-authenticated sessions against cross-site request forgery (CSRF).
 * - Enforced on state-changing methods: POST, PUT, PATCH, DELETE.
 * - Explicitly skips server-to-server webhook endpoints (which use cryptographic HMAC signature validation).
 * - Prefers Origin header; falls back to Referer origin.
 * - Blocks untrusted cross-origin requests with HTTP 403 Forbidden.
 */
export function originGuard(req: Request, _res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();

  // 1. Safe methods are always exempt
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  // 2. Explicitly exempt server-to-server webhook routes (Meta, Resend, etc.)
  // These use cryptographic HMAC-SHA256 signature verification rather than browser cookies.
  const path = req.originalUrl || req.path || '';
  if (path.startsWith('/api/v1/webhooks/') || path.startsWith('/webhooks/')) {
    return next();
  }

  const trustedOrigin = normalizeOrigin(env.APP_BASE_URL);

  const rawOrigin = req.headers['origin'] as string | undefined;
  const rawReferer = req.headers['referer'] as string | undefined;

  // 3. Evaluate Origin header if present
  if (rawOrigin) {
    const requestOrigin = normalizeOrigin(rawOrigin);
    if (requestOrigin !== trustedOrigin) {
      return next(new ForbiddenError('Cross-site request blocked: untrusted origin'));
    }
    return next();
  }

  // 4. Fallback to Referer header if Origin is absent
  if (rawReferer) {
    let refererOrigin: string;
    try {
      refererOrigin = normalizeOrigin(rawReferer);
    } catch {
      return next(new ForbiddenError('Cross-site request blocked: malformed referer'));
    }

    if (refererOrigin !== trustedOrigin) {
      return next(new ForbiddenError('Cross-site request blocked: untrusted referer'));
    }
    return next();
  }

  // 5. If neither Origin nor Referer is present (e.g. direct server-to-server or test execution):
  // Allowed to proceed; if a browser context is used with credentials, modern browsers always send Origin/Referer.
  return next();
}
