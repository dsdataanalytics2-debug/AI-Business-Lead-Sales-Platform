import express, { Router, Request, Response, NextFunction } from 'express';
import {
  OutreachWebhookEventProcessor,
  normalizeResendEmailWebhookPayload
} from '@leadmate/core';
import { env } from '../config/env.js';
import { resendWebhookSignatureMiddleware } from '../middleware/resend-webhook-auth.js';

export const RESEND_WEBHOOK_BODY_LIMIT = '256kb';

export interface ResendEmailWebhookRouterOptions {
  processor?: OutreachWebhookEventProcessor;
  webhookSecret?: string;
  toleranceSeconds?: number;
  clock?: () => Date;
}

/**
 * Creates the dedicated Resend Email webhook router exposing:
 * - POST /api/v1/webhooks/resend/email (Signed delivery receipt ingestion via Svix headers)
 */
export function createResendEmailWebhookRouter(
  options: ResendEmailWebhookRouterOptions = {}
): Router {
  const router = Router();
  const processor = options.processor ?? new OutreachWebhookEventProcessor();
  const signatureMiddleware = resendWebhookSignatureMiddleware({
    webhookSecret: options.webhookSecret,
    toleranceSeconds: options.toleranceSeconds,
    clock: options.clock
  });

  /**
   * POST /api/v1/webhooks/resend/email
   *
   * Ingests delivery receipts from Resend Transactional Email API.
   * Flow:
   * 1. Route-scoped raw buffer reading with explicit 256kb body limit
   * 2. Svix signature verification BEFORE any JSON parsing
   * 3. JSON parsing only on verified bytes (safe 400 on malformed JSON)
   * 4. Normalization and Step 8 domain processing
   */
  router.post(
    '/',
    express.raw({ type: 'application/json', limit: RESEND_WEBHOOK_BODY_LIMIT }),
    signatureMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        // Parse JSON strictly AFTER signature verification
        let parsedBody: unknown;
        try {
          const rawBuffer = Buffer.isBuffer(req.body)
            ? req.body
            : Buffer.from(typeof req.body === 'string' ? req.body : '', 'utf8');
          parsedBody = JSON.parse(rawBuffer.toString('utf8'));
        } catch {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Malformed JSON payload in webhook body',
              requestId: req.id
            }
          });
          return;
        }

        const events = normalizeResendEmailWebhookPayload(parsedBody);

        if (events.length === 0) {
          res.status(200).json({
            status: 'EVENT_IGNORED',
            message: 'No actionable delivery status changes found in payload'
          });
          return;
        }

        for (const event of events) {
          await processor.processEvent(event);
        }

        res.status(200).json({
          status: 'EVENT_RECEIVED',
          count: events.length
        });
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  return router;
}

export const resendEmailWebhookRouter = createResendEmailWebhookRouter();
