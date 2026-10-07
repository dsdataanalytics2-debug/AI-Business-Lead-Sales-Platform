import type { NormalizedOutreachWebhookEvent } from './webhook-event-processor.js';
import { OutreachErrorCode } from '@leadmate/shared';
import { RESEND_EMAIL_PROVIDER_NAME } from './resend-email-provider.js';

export interface ResendWebhookEventData {
  readonly id?: string;
  readonly email_id?: string;
  readonly from?: string;
  readonly to?: string[];
  readonly subject?: string;
  readonly created_at?: string;
  readonly bounce_type?: string;
  readonly bounce_sub_type?: string;
  readonly message?: string;
}

export interface ResendWebhookEventPayload {
  readonly id?: string;
  readonly type?: string;
  readonly created_at?: string;
  readonly data?: ResendWebhookEventData;
}

/**
 * Normalizes verified Resend Email webhook payloads into provider-neutral NormalizedOutreachWebhookEvent objects.
 *
 * Guarantees:
 * 1. Operates solely on terminal delivery status events ('email.delivered' -> 'DELIVERED', 'email.bounced' -> 'FAILED').
 * 2. Safely ignores non-terminal / analytics events ('email.sent', 'email.opened', 'email.clicked', 'email.complained') without failing.
 * 3. Derives deterministic eventId from stable provider fields (`resend:${event.id}` or `resend:${emailId}:${type}:${timestamp}`).
 * 4. Generates zero tenant IDs (tenant isolation is resolved authoritatively by Step 8 correlation engine).
 * 5. Sanitizes error codes and messages without storing raw vendor bodies, headers, or secrets.
 * 6. Supports both single-event payloads and batch event arrays.
 */
export function normalizeResendEmailWebhookPayload(
  payload: unknown
): NormalizedOutreachWebhookEvent[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const rawEvents: ResendWebhookEventPayload[] = Array.isArray(payload)
    ? (payload as ResendWebhookEventPayload[])
    : [payload as ResendWebhookEventPayload];

  const normalizedEvents: NormalizedOutreachWebhookEvent[] = [];

  for (const event of rawEvents) {
    if (!event || typeof event !== 'object') {
      continue;
    }

    const rawType = (event.type || '').trim().toLowerCase();
    const data = event.data;
    if (!data || typeof data !== 'object') {
      continue;
    }

    const providerMessageId = (data.email_id || data.id || '').trim();
    if (!providerMessageId) {
      continue;
    }

    // Process only supported M6 terminal states
    const isTerminal =
      rawType === 'email.delivered' ||
      rawType === 'email.bounced' ||
      rawType === 'email.failed' ||
      rawType === 'email.suppressed';

    if (!isTerminal) {
      // Safely ignore non-terminal / analytics events: email.sent, email.delivery_delayed, email.opened, email.clicked, email.complained
      continue;
    }

    const rawCreatedAt = event.created_at || data.created_at;
    const timestamp = rawCreatedAt ? new Date(rawCreatedAt) : new Date();
    const validTimestamp = isNaN(timestamp.getTime()) ? new Date() : timestamp;

    // Derive deterministic eventId
    let eventId: string;
    if (event.id && typeof event.id === 'string' && event.id.trim().length > 0) {
      eventId = `resend:${event.id.trim()}`;
    } else {
      eventId = `resend:${providerMessageId}:${rawType}:${validTimestamp.getTime()}`;
    }

    if (rawType === 'email.delivered') {
      normalizedEvents.push({
        providerName: RESEND_EMAIL_PROVIDER_NAME,
        eventId,
        providerMessageId,
        eventType: 'DELIVERED',
        timestamp: validTimestamp
      });
    } else if (rawType === 'email.bounced') {
      let safeErrorCode: string = OutreachErrorCode.OUTREACH_RECIPIENT_REJECTED;
      let safeErrorMessage = 'Recipient email address bounced';

      if (data.bounce_type) {
        safeErrorMessage = `Recipient email bounced: ${String(data.bounce_type)}`;
      }

      normalizedEvents.push({
        providerName: RESEND_EMAIL_PROVIDER_NAME,
        eventId,
        providerMessageId,
        eventType: 'FAILED',
        timestamp: validTimestamp,
        safeErrorCode,
        safeErrorMessage
      });
    } else if (rawType === 'email.failed') {
      const safeErrorCode: string = OutreachErrorCode.OUTREACH_DELIVERY_FAILED;
      const safeErrorMessage =
        data.message && typeof data.message === 'string' && data.message.trim().length > 0
          ? `Downstream delivery failure: ${data.message.trim()}`
          : 'Downstream delivery failure reported by Resend';

      normalizedEvents.push({
        providerName: RESEND_EMAIL_PROVIDER_NAME,
        eventId,
        providerMessageId,
        eventType: 'FAILED',
        timestamp: validTimestamp,
        safeErrorCode,
        safeErrorMessage
      });
    } else if (rawType === 'email.suppressed') {
      normalizedEvents.push({
        providerName: RESEND_EMAIL_PROVIDER_NAME,
        eventId,
        providerMessageId,
        eventType: 'FAILED',
        timestamp: validTimestamp,
        safeErrorCode: OutreachErrorCode.OUTREACH_RECIPIENT_REJECTED,
        safeErrorMessage: 'Recipient email address is suppressed'
      });
    }
  }

  return normalizedEvents;
}
