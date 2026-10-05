import { z } from 'zod';
import {
  OutreachChannel,
  OutreachDeliveryStatus,
  OutreachErrorCode,
  SalesAssistantDraftType
} from '../enums.js';

/* =========================================================
 * M6 Step 1: Automated Outreach & Delivery Schemas & Contracts
 *
 * Provider-agnostic, persistence-agnostic shared contracts.
 * External network transport, persistence, BullMQ queues,
 * and live provider adapters belong to later steps.
 * ========================================================= */

/* ---------------------------------------------------------
 * Idempotency Key Contract
 * --------------------------------------------------------- */

/**
 * Allowed characters: alphanumeric, '.', '_', ':', '-'
 * Matches standard UUIDs, prefixed tokens, and safe client-generated identifiers.
 * Case-sensitive; must not be mutated or lowercased automatically.
 */
export const OUTREACH_IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9._:-]+$/;

export const outreachIdempotencyKeySchema = z
  .string({
    required_error: 'Idempotency-Key header is required',
    invalid_type_error: 'Idempotency-Key must be a string'
  })
  .min(8, 'Idempotency-Key must be at least 8 characters')
  .max(128, 'Idempotency-Key cannot exceed 128 characters')
  .regex(
    OUTREACH_IDEMPOTENCY_KEY_REGEX,
    'Idempotency-Key contains invalid characters (allowed: alphanumeric, ., _, :, -)'
  );

export type OutreachIdempotencyKey = z.infer<typeof outreachIdempotencyKeySchema>;

/* ---------------------------------------------------------
 * Send / Dispatch Request Contract
 * --------------------------------------------------------- */

/**
 * Canonical dispatch request body for POST /api/v1/leads/:id/outreach.
 * Strict: rejects unknown properties, internal statuses, raw destinations,
 * message bodies, prompts, provider configs, or idempotency keys (which belong in headers).
 */
export const sendOutreachDeliveryRequestSchema = z
  .object({
    draftId: z.string().uuid('Draft ID must be a valid UUID'),
    channel: z.nativeEnum(OutreachChannel, {
      errorMap: () => ({ message: 'Channel must be WHATSAPP or EMAIL' })
    }),
    recipientContactId: z.string().uuid('Recipient contact ID must be a valid UUID').optional()
  })
  .strict();

export type SendOutreachDeliveryRequest = z.infer<typeof sendOutreachDeliveryRequestSchema>;

/* ---------------------------------------------------------
 * Draft / Channel Compatibility Rules
 * --------------------------------------------------------- */

/**
 * Canonical mapping between M5 approved draft types and permitted M6 delivery channels.
 * - WHATSAPP -> WHATSAPP only
 * - EMAIL -> EMAIL only
 * - PROPOSAL -> EMAIL only (dispatches exact approved snapshot)
 * - FOLLOW_UP -> WHATSAPP or EMAIL (requires explicit user channel selection; no auto-default)
 * - CALL_SCRIPT -> Not dispatchable through generic OutreachDelivery (voice calls deferred)
 */
export const ALLOWED_CHANNELS_FOR_DRAFT_TYPE: Record<
  SalesAssistantDraftType,
  readonly OutreachChannel[]
> = {
  [SalesAssistantDraftType.WHATSAPP]: [OutreachChannel.WHATSAPP],
  [SalesAssistantDraftType.EMAIL]: [OutreachChannel.EMAIL],
  [SalesAssistantDraftType.PROPOSAL]: [OutreachChannel.EMAIL],
  [SalesAssistantDraftType.FOLLOW_UP]: [OutreachChannel.WHATSAPP, OutreachChannel.EMAIL],
  [SalesAssistantDraftType.CALL_SCRIPT]: []
} as const;

/**
 * Returns allowed delivery channels for a given SalesAssistantDraftType.
 */
export function getAllowedOutreachChannelsForDraftType(
  draftType: SalesAssistantDraftType
): readonly OutreachChannel[] {
  return ALLOWED_CHANNELS_FOR_DRAFT_TYPE[draftType] ?? [];
}

/**
 * Checks whether a draft type is compatible with the requested delivery channel.
 */
export function isOutreachChannelCompatible(
  draftType: SalesAssistantDraftType,
  channel: OutreachChannel
): boolean {
  const allowed = ALLOWED_CHANNELS_FOR_DRAFT_TYPE[draftType];
  return allowed ? (allowed as readonly OutreachChannel[]).includes(channel) : false;
}

/* ---------------------------------------------------------
 * Recipient Masking Utility
 * --------------------------------------------------------- */

/**
 * Masks a normalized recipient phone number or email address for safe public display.
 * - E.164 phone numbers (e.g. +8801712345678): preserves prefix and last 4 digits (+88017****5678)
 * - Standard local phone (e.g. 01712345678): preserves prefix and last 4 digits (017****5678)
 * - Email addresses (e.g. lead@example.com): masks middle of user part (l***d@example.com)
 * - Short strings: masks middle safely without leaking PII.
 */
export function maskRecipient(recipient: string): string {
  if (!recipient || recipient.trim().length === 0) {
    return '***';
  }
  const trimmed = recipient.trim();

  // Email masking
  if (trimmed.includes('@')) {
    const parts = trimmed.split('@');
    if (parts.length === 2 && parts[0] && parts[1]) {
      const user = parts[0];
      const domain = parts[1];
      if (user.length <= 2) {
        return `${user[0]}***@${domain}`;
      }
      return `${user[0]}***${user[user.length - 1]}@${domain}`;
    }
  }

  // E.164 phone masking (e.g. +8801712345678)
  if (trimmed.startsWith('+') && trimmed.length >= 10) {
    const prefix = trimmed.slice(0, 6);
    const suffix = trimmed.slice(-4);
    return `${prefix}****${suffix}`;
  }

  // Local phone masking (e.g. 01712345678)
  if (trimmed.length >= 8) {
    const prefix = trimmed.slice(0, 3);
    const suffix = trimmed.slice(-4);
    return `${prefix}****${suffix}`;
  }

  // Short fallback
  return `${trimmed.slice(0, 1)}***`;
}

/* ---------------------------------------------------------
 * Public Outreach Delivery DTOs
 * --------------------------------------------------------- */

/**
 * Safe public summary of an OutreachDelivery record.
 * Data minimization: strictly excludes recipientNormalized, snapshotContent,
 * snapshotSubject, snapshotBody, approvedDraftSnapshotHash, providerMessageId,
 * provider credentials/raw metadata, authorization headers, and idempotencyKey.
 */
export const outreachDeliverySummarySchema = z
  .object({
    id: z.string().uuid(),
    leadId: z.string().uuid(),
    draftId: z.string().uuid(),
    channel: z.nativeEnum(OutreachChannel),
    status: z.nativeEnum(OutreachDeliveryStatus),
    recipientMasked: z.string().min(1),
    recipientContactId: z.string().uuid().nullable().optional(),
    attemptCount: z.number().int().nonnegative(),
    lastErrorCode: z
      .nativeEnum(OutreachErrorCode)
      .nullable()
      .optional(),
    safeLastErrorMessage: z.string().max(500).nullable().optional(),
    requestedAt: z.union([z.date(), z.string()]),
    queuedAt: z.union([z.date(), z.string()]).nullable().optional(),
    sentAt: z.union([z.date(), z.string()]).nullable().optional(),
    deliveredAt: z.union([z.date(), z.string()]).nullable().optional(),
    failedAt: z.union([z.date(), z.string()]).nullable().optional(),
    cancelledAt: z.union([z.date(), z.string()]).nullable().optional(),
    createdAt: z.union([z.date(), z.string()]),
    updatedAt: z.union([z.date(), z.string()])
  })
  .strict();

export type OutreachDeliverySummary = z.infer<typeof outreachDeliverySummarySchema>;

export const outreachDeliveryResponseSchema = outreachDeliverySummarySchema;
export type OutreachDeliveryResponse = z.infer<typeof outreachDeliveryResponseSchema>;

export const outreachDeliveryListResponseSchema = z
  .object({
    deliveries: z.array(outreachDeliverySummarySchema),
    total: z.number().int().nonnegative()
  })
  .strict();

export type OutreachDeliveryListResponse = z.infer<typeof outreachDeliveryListResponseSchema>;

/* ---------------------------------------------------------
 * Cancellation & Parameter Schemas
 * --------------------------------------------------------- */

/**
 * Empty strict body for cancel endpoint (POST /api/v1/leads/:id/outreach/:deliveryId/cancel).
 */
export const cancelOutreachDeliveryRequestSchema = z.object({}).strict().optional();
export type CancelOutreachDeliveryRequest = z.infer<typeof cancelOutreachDeliveryRequestSchema>;

export const outreachLeadIdParamSchema = z
  .object({
    id: z.string().uuid('Invalid lead ID')
  })
  .strict();
export type OutreachLeadIdParam = z.infer<typeof outreachLeadIdParamSchema>;

export const outreachDeliveryIdParamSchema = z
  .object({
    deliveryId: z.string().uuid('Invalid delivery ID')
  })
  .strict();
export type OutreachDeliveryIdParam = z.infer<typeof outreachDeliveryIdParamSchema>;

export const outreachDeliveryParamsSchema = z
  .object({
    id: z.string().uuid('Invalid lead ID'),
    deliveryId: z.string().uuid('Invalid delivery ID')
  })
  .strict();
export type OutreachDeliveryParams = z.infer<typeof outreachDeliveryParamsSchema>;

/* ---------------------------------------------------------
 * List Query Schema
 * --------------------------------------------------------- */

export const listOutreachDeliveriesQuerySchema = z
  .object({
    status: z.nativeEnum(OutreachDeliveryStatus).optional(),
    channel: z.nativeEnum(OutreachChannel).optional()
  })
  .strict();
export type ListOutreachDeliveriesQuery = z.infer<typeof listOutreachDeliveriesQuerySchema>;

/* ---------------------------------------------------------
 * Normalized Request Fingerprint Input Type
 * --------------------------------------------------------- */

/**
 * Fields that participate in idempotency equality checking.
 */
export interface OutreachRequestFingerprintInput {
  leadId: string;
  draftId: string;
  channel: OutreachChannel;
  recipientContactId?: string | null;
}
