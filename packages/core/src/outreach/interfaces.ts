import { OutreachChannel } from '@leadmate/shared';

/**
 * Common base fields for all outreach delivery provider input payloads.
 * Contains only transport-relevant, server-vetted, immutable snapshot fields.
 *
 * STRICT EXCLUSION:
 * - NO raw SalesAssistantDraft entity
 * - NO Lead database model
 * - NO User database model
 * - NO Prisma/DB client
 * - NO HTTP request/response or caller session
 * - NO provider API keys, tokens, or credentials
 */
export interface BaseOutreachProviderSendInput {
  /** Internal unique delivery identifier */
  readonly deliveryId: string;

  /** Tenant organization ID for strict isolation */
  readonly organizationId: string;

  /** Normalized and vetted destination address (E.164 phone or normalized email) */
  readonly recipientNormalized: string;

  /**
   * Deterministic provider-level idempotency token derived from deliveryId.
   * Reused across retries so upstream provider can reject duplicate dispatches.
   */
  readonly providerIdempotencyToken: string;
}

/**
 * Transport input specifically for WhatsApp delivery.
 * Content is mandatory; subject and body are prohibited.
 */
export interface WhatsAppOutreachProviderSendInput extends BaseOutreachProviderSendInput {
  readonly channel: OutreachChannel.WHATSAPP | 'WHATSAPP';
  readonly content: string;
  readonly subject?: never;
  readonly body?: never;
}

/**
 * Transport input specifically for Email delivery.
 * Body is mandatory; subject is optional/present; content is prohibited.
 */
export interface EmailOutreachProviderSendInput extends BaseOutreachProviderSendInput {
  readonly channel: OutreachChannel.EMAIL | 'EMAIL';
  readonly body: string;
  readonly subject?: string | null;
  readonly content?: never;
}

/**
 * Discriminated union of all supported outreach delivery transport inputs.
 */
export type OutreachProviderSendInput =
  | WhatsAppOutreachProviderSendInput
  | EmailOutreachProviderSendInput;

/**
 * Typed result returned when an upstream provider accepts a message for transmission.
 *
 * NOTE: Upstream acceptance means the transport provider queued/accepted the message.
 * It does NOT guarantee physical delivery to the recipient device (handled via status webhooks in Step 7).
 * Persistence of this result in the local database is the calling worker's responsibility.
 */
export interface OutreachProviderSendResult {
  /** Identifier of the provider that handled delivery */
  readonly providerName: string;

  /** Unique message identifier assigned by the provider (deterministic in mocks) */
  readonly providerMessageId: string;

  /** Timestamp when upstream provider acknowledged acceptance */
  readonly acceptedAt: Date;
}

/**
 * Provider-agnostic interface for external outreach delivery transport.
 * LeadMate worker execution interacts exclusively with this interface.
 */
export interface OutreachDeliveryProvider {
  /** Unique canonical name of this provider */
  readonly name: string;

  /** Channel handled by this provider */
  readonly channel: OutreachChannel;

  /**
   * Transmits message payload to external provider network.
   * Throws OutreachDeliveryProviderError on failure.
   */
  send(input: OutreachProviderSendInput): Promise<OutreachProviderSendResult>;
}

/**
 * Configuration options for deterministic mock provider behavior.
 */
export type MockDeliveryOutcome =
  | 'SUCCESS'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'RECIPIENT_REJECTED'
  | 'CONTENT_REJECTED'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'CHANNEL_MISMATCH';

export interface MockDeliveryScenarioRule {
  /** Match rule on specific deliveryId */
  deliveryId?: string;

  /** Match rule on specific recipient */
  recipientNormalized?: string;

  /** Simulated outcome to produce when matched */
  outcome: MockDeliveryOutcome;

  /** Optional custom safe message to include in error */
  customErrorMessage?: string;
}

export interface MockDeliveryProviderOptions {
  /** Default outcome when no scenario rule matches (default: 'SUCCESS') */
  defaultOutcome?: MockDeliveryOutcome;

  /** Specific deterministic scenario overrides */
  scenarioRules?: MockDeliveryScenarioRule[];

  /**
   * Injectable deterministic clock function for acceptedAt timestamp.
   * Defaults to `() => new Date()` if omitted.
   */
  clock?: () => Date;
}
