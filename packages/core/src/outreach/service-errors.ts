import { OutreachErrorCode } from '@leadmate/shared';

export type OutreachServiceErrorCode =
  | OutreachErrorCode
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'QUEUE_ERROR';

export interface OutreachServiceErrorOptions {
  code: OutreachServiceErrorCode;
  message: string;
  statusCode?: number;
  cause?: unknown;
}

function getDefaultStatusCode(code: OutreachServiceErrorCode): number {
  switch (code) {
    case OutreachErrorCode.OUTREACH_IDEMPOTENCY_KEY_REUSED:
    case OutreachErrorCode.OUTREACH_DRAFT_NOT_APPROVED:
    case OutreachErrorCode.OUTREACH_DELIVERY_IN_FLIGHT:
      return 409;
    case OutreachErrorCode.OUTREACH_RECIPIENT_INVALID:
    case OutreachErrorCode.OUTREACH_RECIPIENT_SUPPRESSED:
    case OutreachErrorCode.OUTREACH_CHANNEL_INCOMPATIBLE:
    case OutreachErrorCode.OUTREACH_RECIPIENT_REJECTED:
    case OutreachErrorCode.OUTREACH_CONTENT_REJECTED:
      return 422;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'INVALID_INPUT':
      return 400;
    case OutreachErrorCode.OUTREACH_PROVIDER_RATE_LIMITED:
      return 429;
    case OutreachErrorCode.OUTREACH_PROVIDER_BAD_GATEWAY:
      return 502;
    case OutreachErrorCode.OUTREACH_PROVIDER_UNAVAILABLE:
      return 503;
    case OutreachErrorCode.OUTREACH_PROVIDER_TIMEOUT:
      return 504;
    case 'QUEUE_ERROR':
    case OutreachErrorCode.OUTREACH_DELIVERY_FAILED:
    default:
      return 500;
  }
}

/**
 * Domain error thrown by OutreachDeliveryService.
 */
export class OutreachServiceError extends Error {
  public readonly code: OutreachServiceErrorCode;
  public readonly statusCode: number;
  public readonly cause?: unknown;

  constructor(options: OutreachServiceErrorOptions) {
    super(options.message);
    this.name = 'OutreachServiceError';
    this.code = options.code;
    this.statusCode = options.statusCode ?? getDefaultStatusCode(options.code);
    this.cause = options.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode
    };
  }
}
