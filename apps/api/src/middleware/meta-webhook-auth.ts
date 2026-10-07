import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

export interface VerifyMetaSignatureOptions {
  appSecret?: string;
}

/**
 * Validates Meta's X-Hub-Signature-256 header using the raw request body and app secret.
 * Uses constant-time buffer comparison to prevent timing attacks.
 */
export function verifyMetaSignatureHeader(
  signatureHeader: string | undefined,
  rawBody: Buffer | string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader || !rawBody || !appSecret) {
    return false;
  }

  // Header format: sha256=<hex>
  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) {
    return false;
  }

  const expectedSignatureHex = signatureHeader.slice(prefix.length).trim();
  if (expectedSignatureHex.length !== 64) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', appSecret);
  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  hmac.update(bodyBuffer);
  const calculatedHex = hmac.digest('hex');

  try {
    const expectedBuf = Buffer.from(expectedSignatureHex, 'hex');
    const calculatedBuf = Buffer.from(calculatedHex, 'hex');
    if (expectedBuf.length !== calculatedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuf, calculatedBuf);
  } catch {
    return false;
  }
}

/**
 * Express middleware for verifying Meta WhatsApp webhook requests.
 */
export function metaWhatsAppWebhookSignatureMiddleware(
  options: VerifyMetaSignatureOptions = {}
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const appSecret = options.appSecret ?? env.META_WHATSAPP_APP_SECRET;

    if (!appSecret) {
      res.status(503).json({
        error: {
          code: 'OUTREACH_PROVIDER_UNAVAILABLE',
          message: 'Meta WhatsApp webhook verification is not configured'
        }
      });
      return;
    }

    const signatureHeader = req.header('x-hub-signature-256');
    const rawBody: Buffer | string | undefined = Buffer.isBuffer(req.body)
      ? req.body
      : typeof req.body === 'string'
      ? req.body
      : (req as any).rawBody;

    if (!signatureHeader || !rawBody) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing Meta webhook signature or body'
        }
      });
      return;
    }

    const isValid = verifyMetaSignatureHeader(signatureHeader, rawBody, appSecret);
    if (!isValid) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid Meta webhook signature'
        }
      });
      return;
    }

    next();
  };
}
