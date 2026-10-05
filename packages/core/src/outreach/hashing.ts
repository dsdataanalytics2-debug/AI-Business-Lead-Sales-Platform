import { createHash } from 'crypto';
import { OutreachChannel } from '@leadmate/shared';

export interface ApprovedDraftSnapshotPayload {
  readonly channel: OutreachChannel;
  readonly subject?: string | null;
  readonly body?: string | null;
  readonly content?: string | null;
}

/**
 * Computes canonical deterministic SHA-256 hash of the approved draft transport content.
 *
 * Guarantees:
 * - Represents ONLY outbound transport content (channel, subject, body, content)
 * - Strict exclusion of tenant/lead/draft/contact IDs, recipient, timestamps, and metadata
 * - Stable lexicographical property serialization
 * - Pure UTF-8 encoding
 */
export function computeApprovedDraftSnapshotHash(payload: ApprovedDraftSnapshotPayload): string {
  const canonicalObject = {
    body: payload.body ?? null,
    channel: payload.channel,
    content: payload.content ?? null,
    subject: payload.subject ?? null
  };

  const canonicalJson = JSON.stringify(canonicalObject);
  return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}

export interface RequestFingerprintPayload {
  readonly organizationId: string;
  readonly leadId: string;
  readonly draftId: string;
  readonly channel: OutreachChannel;
  readonly recipientNormalized: string;
  readonly recipientContactId?: string | null;
}

/**
 * Computes deterministic SHA-256 fingerprint representing the semantic identity
 * of an outreach delivery dispatch request.
 *
 * Used for idempotency validation:
 * - Same key + same fingerprint = safe replay
 * - Same key + different fingerprint = OUTREACH_IDEMPOTENCY_KEY_REUSED error
 */
export function computeRequestFingerprint(payload: RequestFingerprintPayload): string {
  const canonicalObject = {
    channel: payload.channel,
    draftId: payload.draftId,
    leadId: payload.leadId,
    organizationId: payload.organizationId,
    recipientContactId: payload.recipientContactId ?? null,
    recipientNormalized: payload.recipientNormalized
  };

  const canonicalJson = JSON.stringify(canonicalObject);
  return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}
