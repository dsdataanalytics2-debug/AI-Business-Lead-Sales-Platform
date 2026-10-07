import express, { Router, Request, Response, NextFunction } from 'express';
import {
  OutreachWebhookEventProcessor,
  normalizeMetaWhatsAppWebhookPayload
} from '@leadmate/core';
import { env } from '../config/env.js';
import { metaWhatsAppWebhookSignatureMiddleware } from '../middleware/meta-webhook-auth.js';

export const META_WEBHOOK_BODY_LIMIT = '256kb';

export interface MetaWhatsAppWebhookRouterOptions {
  processor?: OutreachWebhookEventProcessor;
  verifyToken?: string;
  appSecret?: string;
}

/**
 * Creates the dedicated Meta WhatsApp webhook router exposing:
 * - GET  /api/v1/webhooks/meta/whatsapp (Hub verification challenge)
 * - POST /api/v1/webhooks/meta/whatsapp (Signed delivery status ingestion)
 */
export function createMetaWhatsAppWebhookRouter(
  options: MetaWhatsAppWebhookRouterOptions = {}
): Router {
  const router = Router();
  const processor = options.processor ?? new OutreachWebhookEventProcessor();
  const signatureMiddleware = metaWhatsAppWebhookSignatureMiddleware({
    appSecret: options.appSecret
  });

  /**
   * GET /api/v1/webhooks/meta/whatsapp
   *
   * Handles Meta's webhook verification challenge handshake.
   * Query params:
   * - hub.mode: 'subscribe'
   * - hub.verify_token: token configured in Meta App Dashboard
   * - hub.challenge: numeric challenge string to echo back
   */
  router.get('/', (req: Request, res: Response): void => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const activeVerifyToken = options.verifyToken ?? env.META_WHATSAPP_VERIFY_TOKEN;

    if (!activeVerifyToken) {
      res.status(503).json({
        error: {
          code: 'OUTREACH_PROVIDER_UNAVAILABLE',
          message: 'Meta webhook verify token not configured'
        }
      });
      return;
    }

    if (mode === 'subscribe' && token === activeVerifyToken && typeof challenge === 'string') {
      res.status(200).send(challenge);
      return;
    }

    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Invalid webhook verification token or mode'
      }
    });
  });

  /**
   * POST /api/v1/webhooks/meta/whatsapp
   *
   * Ingests delivery receipts from Meta WhatsApp Cloud API.
   * Flow:
   * 1. Route-scoped raw buffer reading with explicit 256kb body limit
   * 2. X-Hub-Signature-256 verification BEFORE any JSON parsing
   * 3. JSON parsing only on verified bytes (safe 400 on malformed JSON)
   * 4. Normalization and Step 8 domain processing
   */
  router.post(
    '/',
    express.raw({ type: 'application/json', limit: META_WEBHOOK_BODY_LIMIT }),
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

        const normalizedEvents = normalizeMetaWhatsAppWebhookPayload(parsedBody);

        // Process all supported normalized events through Step 8 processor
        for (const event of normalizedEvents) {
          await processor.processEvent(event);
        }

        // Always acknowledge Meta with 200 OK once verified and parsed
        res.status(200).json({ status: 'EVENT_RECEIVED' });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}

export const metaWhatsAppWebhookRouter = createMetaWhatsAppWebhookRouter();
