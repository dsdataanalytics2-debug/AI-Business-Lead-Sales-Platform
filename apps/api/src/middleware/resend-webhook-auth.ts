import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

export interface VerifyResendSignatureOptions {
  webhookSecret?: string;
  toleranceSeconds?: number;
  clock?: () => Date;
}

export const DEFAULT_SVIX_TOLERANCE_SECONDS = 300; // 5 minutes

/**
 * Validates Svix / Resend webhook signature using the raw request body and secret.
 *
 * Headers required:
 * - svix-id
 * - svix-timestamp
 * - svix-signature (format: "v1,<base64_sig> [v1,<base64_sig_2>]")
 *
 * Uses constant-time buffer comparison to prevent timing attacks.
 */
export function verifyResendWebhookSignature(
  headers: {
    id?: string | string[];
    timestamp?: string | string[];
    signature?: string | string[];
  },
  rawBody: Buffer | string | undefined,
  webhookSecret: string,
  options: { toleranceSeconds?: number; clock?: () => Date } = {}
): boolean {
  const svixId = Array.isArray(headers.id) ? headers.id[0] : headers.id;
  const svixTimestamp = Array.isArray(headers.timestamp) ? headers.timestamp[0] : headers.timestamp;
  const svixSignature = Array.isArray(headers.signature) ? headers.signature[0] : headers.signature;

  if (!svixId || !svixTimestamp || !svixSignature || !rawBody || !webhookSecret) {
    return false;
  }

  // Verify timestamp tolerance (default: 300 seconds)
  const timestampNum = parseInt(svixTimestamp, 10);
  if (isNaN(timestampNum)) {
    return false;
  }

  const nowSeconds = Math.floor((options.clock ? options.clock() : new Date()).getTime() / 1000);
  const tolerance = options.toleranceSeconds ?? DEFAULT_SVIX_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - timestampNum) > tolerance) {
    return false;
  }

  // Decode secret: Svix secrets usually start with "whsec_"
  let secretKey: Buffer;
  try {
    if (webhookSecret.startsWith('whsec_')) {
      secretKey = Buffer.from(webhookSecret.slice(6), 'base64');
    } else {
      secretKey = Buffer.from(webhookSecret, 'base64');
      if (secretKey.length === 0) {
        secretKey = Buffer.from(webhookSecret, 'utf8');
      }
    }
  } catch {
    secretKey = Buffer.from(webhookSecret, 'utf8');
  }

  // Signed payload: "${svixId}.${svixTimestamp}.${rawBody}"
  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const toSign = Buffer.concat([
    Buffer.from(`${svixId}.${svixTimestamp}.`, 'utf8'),
    bodyBuffer
  ]);

  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(toSign);
  const calculatedBase64 = hmac.digest('base64');
  const calculatedBuf = Buffer.from(calculatedBase64, 'utf8');

  // svixSignature may contain multiple space-separated signatures: "v1,sig1 v1,sig2"
  const passedSignatures = svixSignature.split(' ');
  for (const versionedSig of passedSignatures) {
    const parts = versionedSig.split(',');
    if (parts.length === 2 && parts[0] === 'v1') {
      const candidateSig = parts[1].trim();
      const candidateBuf = Buffer.from(candidateSig, 'utf8');
      if (
        candidateBuf.length === calculatedBuf.length &&
        crypto.timingSafeEqual(candidateBuf, calculatedBuf)
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Express middleware for verifying Resend Email webhook requests.
 */
export function resendWebhookSignatureMiddleware(
  options: VerifyResendSignatureOptions = {}
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const webhookSecret = options.webhookSecret ?? env.RESEND_WEBHOOK_SECRET;

    if (!webhookSecret) {
      res.status(503).json({
        error: {
          code: 'OUTREACH_PROVIDER_UNAVAILABLE',
          message: 'Resend webhook verification is not configured'
        }
      });
      return;
    }

    const svixId = req.header('svix-id');
    const svixTimestamp = req.header('svix-timestamp');
    const svixSignature = req.header('svix-signature');

    const rawBody: Buffer | string | undefined = Buffer.isBuffer(req.body)
      ? req.body
      : typeof req.body === 'string'
      ? req.body
      : (req as any).rawBody;

    if (!svixId || !svixTimestamp || !svixSignature || !rawBody) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing Resend webhook signature, timestamp, id, or body'
        }
      });
      return;
    }

    const isValid = verifyResendWebhookSignature(
      {
        id: svixId,
        timestamp: svixTimestamp,
        signature: svixSignature
      },
      rawBody,
      webhookSecret,
      {
        toleranceSeconds: options.toleranceSeconds,
        clock: options.clock
      }
    );

    if (!isValid) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid Resend webhook signature or timestamp expired'
        }
      });
      return;
    }

    next();
  };
}
