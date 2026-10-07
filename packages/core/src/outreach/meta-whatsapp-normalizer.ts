import type { NormalizedOutreachWebhookEvent } from './webhook-event-processor.js';
import { OutreachErrorCode } from '@leadmate/shared';
import { META_WHATSAPP_PROVIDER_NAME } from './meta-whatsapp-provider.js';

export interface MetaWebhookStatusObject {
  readonly id: string; // WhatsApp message ID (wamid)
  readonly status: 'delivered' | 'failed' | 'sent' | 'read' | string;
  readonly timestamp: string | number;
  readonly recipient_id?: string;
  readonly errors?: Array<{
    readonly code: number;
    readonly title?: string;
    readonly message?: string;
    readonly error_data?: {
      readonly details?: string;
    };
  }>;
}

export interface MetaWebhookChangeValue {
  readonly messaging_product?: string;
  readonly metadata?: {
    readonly display_phone_number?: string;
    readonly phone_number_id?: string;
  };
  readonly statuses?: MetaWebhookStatusObject[];
  readonly messages?: any[];
}

export interface MetaWebhookEntry {
  readonly id?: string;
  readonly changes?: Array<{
    readonly field?: string;
    readonly value?: MetaWebhookChangeValue;
  }>;
}

export interface MetaWebhookPayload {
  readonly object?: string;
  readonly entry?: MetaWebhookEntry[];
}

/**
 * Normalizes verified Meta WhatsApp webhook status payloads into provider-neutral NormalizedOutreachWebhookEvent objects.
 *
 * Guarantees:
 * 1. Operates solely on delivery status events ('delivered' -> 'DELIVERED', 'failed' -> 'FAILED').
 * 2. Safely ignores non-terminal/intermediate events ('sent', 'read', customer inbound messages) without failing.
 * 3. Derives deterministic eventId from stable provider fields (`meta-wa:${messageId}:${status}:${timestamp}`).
 * 4. Generates zero tenant IDs (`organizationId = null`), preventing tenant spoofing.
 * 5. Sanitizes error codes and messages into safe canonical classifications without storing raw vendor bodies.
 */
export function normalizeMetaWhatsAppWebhookPayload(
  payload: unknown
): NormalizedOutreachWebhookEvent[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const p = payload as MetaWebhookPayload;
  if (!Array.isArray(p.entry)) {
    return [];
  }

  const normalizedEvents: NormalizedOutreachWebhookEvent[] = [];

  for (const entry of p.entry) {
    if (!Array.isArray(entry?.changes)) continue;

    for (const change of entry.changes) {
      if (change?.field && change.field !== 'messages') {
        continue;
      }

      const value = change?.value;
      if (!value || !Array.isArray(value.statuses)) continue;

      for (const statusObj of value.statuses) {
        if (!statusObj || typeof statusObj.id !== 'string' || statusObj.id.trim().length === 0) {
          continue;
        }

        const rawStatus = (statusObj.status || '').toLowerCase();
        if (rawStatus !== 'delivered' && rawStatus !== 'failed') {
          // 'sent', 'read', or unknown status: safely ignore per M6 delivery contract
          continue;
        }

        const providerMessageId = statusObj.id;
        const rawTimestamp = statusObj.timestamp;
        const timestampMs =
          typeof rawTimestamp === 'number'
            ? rawTimestamp * 1000
            : typeof rawTimestamp === 'string' && /^\d+$/.test(rawTimestamp)
            ? parseInt(rawTimestamp, 10) * 1000
            : Date.now();
        const eventTimestamp = new Date(timestampMs);

        // Deterministic eventId keyed by messageId + status + timestamp
        const eventId = `meta-wa:${providerMessageId}:${rawStatus}:${rawTimestamp || timestampMs}`;

        if (rawStatus === 'delivered') {
          normalizedEvents.push({
            providerName: META_WHATSAPP_PROVIDER_NAME,
            eventId,
            providerMessageId,
            eventType: 'DELIVERED',
            timestamp: eventTimestamp
          });
        } else if (rawStatus === 'failed') {
          const firstError = Array.isArray(statusObj.errors) && statusObj.errors.length > 0
            ? statusObj.errors[0]
            : undefined;

          let safeErrorCode: string = OutreachErrorCode.OUTREACH_DELIVERY_FAILED;
          let safeErrorMessage = 'Downstream delivery failure reported by Meta WhatsApp';

          if (firstError?.code) {
            const errCode = firstError.code;
            if (errCode === 131026 || errCode === 131051 || errCode === 131052) {
              safeErrorCode = OutreachErrorCode.OUTREACH_RECIPIENT_REJECTED;
              safeErrorMessage = 'Recipient number unreachable or cannot receive WhatsApp message';
            } else if (errCode === 131047 || errCode === 131048 || errCode === 131053) {
              safeErrorCode = OutreachErrorCode.OUTREACH_CONTENT_REJECTED;
              safeErrorMessage = 'Message delivery blocked by WhatsApp messaging window or policy';
            } else if (errCode === 4 || errCode === 130429 || errCode === 131056) {
              safeErrorCode = OutreachErrorCode.OUTREACH_PROVIDER_RATE_LIMITED;
              safeErrorMessage = 'Delivery failed due to upstream rate limits';
            }
          }

          normalizedEvents.push({
            providerName: META_WHATSAPP_PROVIDER_NAME,
            eventId,
            providerMessageId,
            eventType: 'FAILED',
            timestamp: eventTimestamp,
            safeErrorCode,
            safeErrorMessage
          });
        }
      }
    }
  }

  return normalizedEvents;
}
