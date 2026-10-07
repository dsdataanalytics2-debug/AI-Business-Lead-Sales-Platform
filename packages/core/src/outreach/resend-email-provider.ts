import { OutreachChannel } from '@leadmate/shared';
import type {
  OutreachDeliveryProvider,
  OutreachProviderSendInput,
  OutreachProviderSendResult,
  EmailOutreachProviderSendInput
} from './interfaces.js';
import {
  OutreachDeliveryProviderError,
  OutreachProviderErrorCode
} from './errors.js';

export const RESEND_EMAIL_PROVIDER_NAME = 'RESEND_EMAIL';
export const DEFAULT_RESEND_API_BASE_URL = 'https://api.resend.com';
export const DEFAULT_RESEND_TIMEOUT_MS = 10000;

export interface ResendEmailProviderConfig {
  readonly apiKey: string;
  readonly fromEmail: string;
  readonly fromName?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

export type ResendEmailFetchFn = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export interface ResendEmailDeliveryProviderOptions {
  readonly config: ResendEmailProviderConfig;
  readonly fetchFn?: ResendEmailFetchFn;
  readonly clock?: () => Date;
}

/**
 * Validates Resend Email configuration fail-closed.
 * Throws an Error on missing/invalid mandatory parameters without leaking any credentials.
 */
export function validateResendEmailConfig(config: ResendEmailProviderConfig): void {
  if (!config) {
    throw new Error('Resend Email configuration is required');
  }

  if (
    !config.apiKey ||
    typeof config.apiKey !== 'string' ||
    config.apiKey.trim().length === 0
  ) {
    throw new Error(
      'Resend Email configuration error: apiKey is required and cannot be empty'
    );
  }

  if (
    !config.fromEmail ||
    typeof config.fromEmail !== 'string' ||
    config.fromEmail.trim().length === 0 ||
    !config.fromEmail.includes('@')
  ) {
    throw new Error(
      'Resend Email configuration error: fromEmail is required and must be a valid email address'
    );
  }

  if (
    config.timeoutMs !== undefined &&
    (typeof config.timeoutMs !== 'number' || config.timeoutMs <= 0)
  ) {
    throw new Error(
      'Resend Email configuration error: timeoutMs must be a positive integer if provided'
    );
  }
}

/**
 * Production outbound transport provider adapter for Resend Transactional Email API.
 *
 * Adheres strictly to the OutreachDeliveryProvider contract:
 * - Operates solely on server-validated, immutable snapshot inputs
 * - Strictly enforces EMAIL channel invariant
 * - Translates raw Resend errors into canonical OutreachProviderErrorCode taxonomy
 * - Never leaks API keys, authorization headers, or sensitive recipient PII in errors
 * - Validates successful responses by requiring an accepted message identifier (id)
 * - Passes deterministic providerIdempotencyToken via standard Idempotency-Key header:
 *   - Idempotency-Key is supported on POST /emails
 *   - Key length complies with standard HTTP header length (UUID / 36 chars fits easily)
 *   - Resend retains idempotency keys for approximately 24 hours (not indefinite)
 *   - Same key + same payload returns original email response
 *   - Same key + different payload is rejected (invalid_idempotent_request)
 *   - Concurrent same-key requests return HTTP 409 conflict and require retry
 */
export class ResendEmailDeliveryProvider implements OutreachDeliveryProvider {
  public readonly name = RESEND_EMAIL_PROVIDER_NAME;
  public readonly channel = OutreachChannel.EMAIL;

  private readonly config: ResendEmailProviderConfig;
  private readonly fetchFn: ResendEmailFetchFn;
  private readonly clock: () => Date;

  constructor(options: ResendEmailDeliveryProviderOptions) {
    validateResendEmailConfig(options.config);
    this.config = {
      ...options.config,
      baseUrl: (options.config.baseUrl ?? DEFAULT_RESEND_API_BASE_URL).replace(/\/+$/, ''),
      timeoutMs: options.config.timeoutMs ?? DEFAULT_RESEND_TIMEOUT_MS
    };
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.clock = options.clock ?? (() => new Date());
  }

  public async send(input: OutreachProviderSendInput): Promise<OutreachProviderSendResult> {
    this.validateInput(input);

    const emailInput = input as EmailOutreachProviderSendInput;
    const url = `${this.config.baseUrl}/emails`;

    const formattedFrom = this.config.fromName && this.config.fromName.trim().length > 0
      ? `${this.config.fromName.trim()} <${this.config.fromEmail.trim()}>`
      : this.config.fromEmail.trim();

    const requestPayload = {
      from: formattedFrom,
      to: [input.recipientNormalized.trim()],
      subject: emailInput.subject && emailInput.subject.trim().length > 0
        ? emailInput.subject
        : 'No Subject',
      text: emailInput.body
    };

    let response: Response;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs);

    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': input.providerIdempotencyToken
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal
      });
    } catch (fetchErr: unknown) {
      if (controller.signal.aborted) {
        throw new OutreachDeliveryProviderError({
          code: OutreachProviderErrorCode.PROVIDER_TIMEOUT,
          safeMessage: 'Resend Email API connection timed out',
          retryable: true,
          providerName: this.name,
          cause: fetchErr
        });
      }

      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.PROVIDER_UNAVAILABLE,
        safeMessage: 'Resend Email API network transport failure',
        retryable: true,
        providerName: this.name,
        cause: fetchErr
      });
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    let parsedBody: any;
    try {
      parsedBody = await response.json();
    } catch (parseErr) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.INVALID_PROVIDER_RESPONSE,
        safeMessage: 'Resend Email API returned an unparseable response payload',
        retryable: false,
        providerName: this.name,
        cause: parseErr
      });
    }

    const providerMessageId = parsedBody?.id;
    if (
      !providerMessageId ||
      typeof providerMessageId !== 'string' ||
      providerMessageId.trim().length === 0
    ) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.INVALID_PROVIDER_RESPONSE,
        safeMessage: 'Resend Email API response missing accepted message identifier',
        retryable: false,
        providerName: this.name
      });
    }

    return {
      providerName: this.name,
      providerMessageId: providerMessageId.trim(),
      acceptedAt: this.clock()
    };
  }

  private validateInput(input: OutreachProviderSendInput): void {
    if (!input.deliveryId || typeof input.deliveryId !== 'string' || input.deliveryId.trim().length === 0) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.INVALID_INPUT,
        safeMessage: 'deliveryId is required and must be a non-empty string',
        retryable: false,
        providerName: this.name
      });
    }

    if (input.channel !== OutreachChannel.EMAIL) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.CHANNEL_MISMATCH,
        safeMessage: `Channel mismatch: ResendEmailDeliveryProvider only accepts EMAIL dispatches (received ${String(input.channel)})`,
        retryable: false,
        providerName: this.name
      });
    }

    if (
      !input.recipientNormalized ||
      typeof input.recipientNormalized !== 'string' ||
      input.recipientNormalized.trim().length === 0 ||
      !input.recipientNormalized.includes('@')
    ) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.INVALID_INPUT,
        safeMessage: 'recipientNormalized is required and must be a valid email address',
        retryable: false,
        providerName: this.name
      });
    }

    const emailInput = input as { body?: unknown };
    if (!emailInput.body || typeof emailInput.body !== 'string' || emailInput.body.trim().length === 0) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.INVALID_INPUT,
        safeMessage: 'Email dispatches require non-empty body',
        retryable: false,
        providerName: this.name
      });
    }

    if (
      !input.providerIdempotencyToken ||
      typeof input.providerIdempotencyToken !== 'string' ||
      input.providerIdempotencyToken.trim().length === 0
    ) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.INVALID_INPUT,
        safeMessage: 'providerIdempotencyToken is required and must be a non-empty string',
        retryable: false,
        providerName: this.name
      });
    }
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    let structuredError: any = null;
    try {
      const json: any = await response.json();
      structuredError = json;
    } catch {
      // Body not JSON
    }

    const httpStatus = response.status;
    const errorName = typeof structuredError?.name === 'string' ? structuredError.name.toLowerCase() : '';
    const errorMessage = typeof structuredError?.message === 'string' ? structuredError.message.toLowerCase() : '';

    // Rate Limiting (HTTP 429)
    if (httpStatus === 429 || errorName.includes('rate_limit')) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.PROVIDER_RATE_LIMITED,
        safeMessage: 'Resend outbound email rate limit exceeded',
        retryable: true,
        providerName: this.name
      });
    }

    // Idempotency Conflicts (HTTP 409)
    if (httpStatus === 409) {
      if (
        errorName.includes('concurrent') ||
        errorMessage.includes('concurrent') ||
        errorMessage.includes('in progress')
      ) {
        throw new OutreachDeliveryProviderError({
          code: OutreachProviderErrorCode.PROVIDER_RATE_LIMITED,
          safeMessage: 'Concurrent Resend idempotent request in progress; retryable',
          retryable: true,
          providerName: this.name
        });
      }

      // invalid_idempotent_request or payload mismatch on reused key: non-retryable
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.DELIVERY_FAILED,
        safeMessage: 'Resend idempotency key reused with mismatched payload',
        retryable: false,
        providerName: this.name
      });
    }

    // Upstream Server Errors (HTTP 5xx)
    if (httpStatus >= 500) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.PROVIDER_UNAVAILABLE,
        safeMessage: 'Resend Email API service is temporarily unavailable',
        retryable: true,
        providerName: this.name
      });
    }

    // Recipient Rejected (HTTP 422 with recipient issues: invalid email, suppressed address, unroutable)
    if (
      httpStatus === 422 &&
      (errorMessage.includes('to') ||
        errorMessage.includes('recipient') ||
        errorMessage.includes('invalid_to_address') ||
        errorMessage.includes('invalid email') ||
        errorName.includes('invalid_recipient'))
    ) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.RECIPIENT_REJECTED,
        safeMessage: 'Recipient email address bounced or is unroutable',
        retryable: false,
        providerName: this.name
      });
    }

    // Content Rejected (HTTP 422 with content/policy issues: spam, blocked content, attachment policy)
    if (
      httpStatus === 422 &&
      (errorMessage.includes('spam') ||
        errorMessage.includes('blocked') ||
        errorMessage.includes('policy') ||
        errorMessage.includes('content') ||
        errorName.includes('content_rejected'))
    ) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.CONTENT_REJECTED,
        safeMessage: 'Email message rejected by provider content or policy constraints',
        retryable: false,
        providerName: this.name
      });
    }

    // Sender Domain / Verification Rejected (HTTP 422 or 403 where sending domain or from address is unverified)
    if (
      (httpStatus === 422 || httpStatus === 403) &&
      (errorMessage.includes('domain') ||
        errorMessage.includes('verify') ||
        errorMessage.includes('from') ||
        errorMessage.includes('sender'))
    ) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.DELIVERY_FAILED,
        safeMessage: 'Resend sender domain or from address verification failure',
        retryable: false,
        providerName: this.name
      });
    }

    // Auth / Configuration / Permissions (HTTP 401 / 403)
    if (httpStatus === 401 || httpStatus === 403) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.DELIVERY_FAILED,
        safeMessage: 'Resend Email API authorization or configuration error',
        retryable: false,
        providerName: this.name
      });
    }

    // Generic client or unknown errors
    throw new OutreachDeliveryProviderError({
      code: OutreachProviderErrorCode.DELIVERY_FAILED,
      safeMessage: `Resend Email API rejected request with status ${httpStatus}`,
      retryable: false,
      providerName: this.name
    });
  }
}
