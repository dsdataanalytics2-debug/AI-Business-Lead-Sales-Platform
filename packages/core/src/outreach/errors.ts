import { OutreachErrorCode } from '@leadmate/shared';

/**
 * Internal delivery provider error codes.
 * Kept strictly partitioned from public OutreachErrorCode and M5 AI provider codes.
 */
export const OutreachProviderErrorCode = {
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  RECIPIENT_REJECTED: 'RECIPIENT_REJECTED',
  CONTENT_REJECTED: 'CONTENT_REJECTED',
  INVALID_PROVIDER_RESPONSE: 'INVALID_PROVIDER_RESPONSE',
  CHANNEL_MISMATCH: 'CHANNEL_MISMATCH',
  INVALID_INPUT: 'INVALID_INPUT',
  DELIVERY_FAILED: 'DELIVERY_FAILED'
} as const;

export type OutreachProviderErrorCode =
  (typeof OutreachProviderErrorCode)[keyof typeof OutreachProviderErrorCode];

/**
 * Canonical retryability classification matrix.
 * Transient infrastructure/network errors are retryable by background workers.
 * Semantic rejections, client faults, channel mismatches, and data errors are strictly non-retryable.
 */
export const RETRYABLE_PROVIDER_ERROR_CODES: ReadonlySet<OutreachProviderErrorCode> = new Set([
  OutreachProviderErrorCode.PROVIDER_TIMEOUT,
  OutreachProviderErrorCode.PROVIDER_UNAVAILABLE,
  OutreachProviderErrorCode.PROVIDER_RATE_LIMITED
]);

export interface OutreachDeliveryProviderErrorOptions {
  code: OutreachProviderErrorCode;
  safeMessage: string;
  retryable?: boolean;
  providerName?: string;
  cause?: unknown;
}

/**
 * Specialized error class thrown by outreach delivery providers.
 * Contains sanitized, safe diagnostic messaging suitable for persistence
 * and public translation without leaking credentials, tokens, or raw vendor payloads.
 */
export class OutreachDeliveryProviderError extends Error {
  public readonly code: OutreachProviderErrorCode;
  public readonly safeMessage: string;
  public readonly retryable: boolean;
  public readonly providerName?: string;
  public readonly cause?: unknown;

  constructor(options: OutreachDeliveryProviderErrorOptions) {
    super(options.safeMessage);
    this.name = 'OutreachDeliveryProviderError';
    this.code = options.code;
    this.safeMessage = options.safeMessage;
    this.retryable = options.retryable ?? RETRYABLE_PROVIDER_ERROR_CODES.has(options.code);
    this.providerName = options.providerName;
    this.cause = options.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Safe serialization representation for structured logging.
   * Strictly excludes raw stack traces, vendor response headers, or sensitive causes.
   */
  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      safeMessage: this.safeMessage,
      retryable: this.retryable,
      ...(this.providerName ? { providerName: this.providerName } : {})
    };
  }
}

/**
 * Deterministic mapping helper converting internal provider errors
 * to canonical public OutreachErrorCode values.
 *
 * Guaranteed to never parse unstructured error strings.
 */
export function mapProviderErrorToPublicErrorCode(error: unknown): OutreachErrorCode {
  if (error instanceof OutreachDeliveryProviderError) {
    switch (error.code) {
      case OutreachProviderErrorCode.PROVIDER_TIMEOUT:
        return OutreachErrorCode.OUTREACH_PROVIDER_TIMEOUT;
      case OutreachProviderErrorCode.PROVIDER_UNAVAILABLE:
        return OutreachErrorCode.OUTREACH_PROVIDER_UNAVAILABLE;
      case OutreachProviderErrorCode.PROVIDER_RATE_LIMITED:
        return OutreachErrorCode.OUTREACH_PROVIDER_RATE_LIMITED;
      case OutreachProviderErrorCode.RECIPIENT_REJECTED:
        return OutreachErrorCode.OUTREACH_RECIPIENT_REJECTED;
      case OutreachProviderErrorCode.CONTENT_REJECTED:
        return OutreachErrorCode.OUTREACH_CONTENT_REJECTED;
      case OutreachProviderErrorCode.INVALID_PROVIDER_RESPONSE:
        return OutreachErrorCode.OUTREACH_PROVIDER_BAD_GATEWAY;
      case OutreachProviderErrorCode.CHANNEL_MISMATCH:
        return OutreachErrorCode.OUTREACH_CHANNEL_INCOMPATIBLE;
      case OutreachProviderErrorCode.INVALID_INPUT:
      case OutreachProviderErrorCode.DELIVERY_FAILED:
      default:
        return OutreachErrorCode.OUTREACH_DELIVERY_FAILED;
    }
  }

  return OutreachErrorCode.OUTREACH_DELIVERY_FAILED;
}
