import { OutreachChannel } from '@leadmate/shared';
import type {
  OutreachDeliveryProvider,
  OutreachProviderSendInput,
  OutreachProviderSendResult
} from './interfaces.js';
import {
  OutreachDeliveryProviderError,
  OutreachProviderErrorCode
} from './errors.js';

export const META_WHATSAPP_PROVIDER_NAME = 'META_WHATSAPP';
export const DEFAULT_META_WHATSAPP_API_VERSION = 'v22.0';
export const DEFAULT_META_WHATSAPP_TIMEOUT_MS = 10000;
export const DEFAULT_META_WHATSAPP_BASE_URL = 'https://graph.facebook.com';

export interface MetaWhatsAppProviderConfig {
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly apiVersion?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

export type MetaWhatsAppFetchFn = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export interface MetaWhatsAppDeliveryProviderOptions {
  readonly config: MetaWhatsAppProviderConfig;
  readonly fetchFn?: MetaWhatsAppFetchFn;
  readonly clock?: () => Date;
}

/**
 * Validates Meta WhatsApp configuration fail-closed.
 * Throws an Error on missing/invalid mandatory parameters without leaking any credentials.
 */
export function validateMetaWhatsAppConfig(config: MetaWhatsAppProviderConfig): void {
  if (!config) {
    throw new Error('Meta WhatsApp configuration is required');
  }

  if (
    !config.accessToken ||
    typeof config.accessToken !== 'string' ||
    config.accessToken.trim().length === 0
  ) {
    throw new Error(
      'Meta WhatsApp configuration error: accessToken is required and cannot be empty'
    );
  }

  if (
    !config.phoneNumberId ||
    typeof config.phoneNumberId !== 'string' ||
    config.phoneNumberId.trim().length === 0
  ) {
    throw new Error(
      'Meta WhatsApp configuration error: phoneNumberId is required and cannot be empty'
    );
  }

  if (config.timeoutMs !== undefined && (typeof config.timeoutMs !== 'number' || config.timeoutMs <= 0)) {
    throw new Error(
      'Meta WhatsApp configuration error: timeoutMs must be a positive integer if provided'
    );
  }
}

/**
 * Production outbound transport provider adapter for Meta WhatsApp Cloud API.
 *
 * Adheres strictly to the OutreachDeliveryProvider contract:
 * - Operates solely on server-validated, immutable snapshot inputs
 * - Strictly preserves the PHONE != WHATSAPP invariant
 * - Translates raw Meta errors into canonical OutreachProviderErrorCode taxonomy
 * - Never leaks access tokens, secrets, or raw vendor payloads in errors or return values
 * - Validates successful responses by requiring an accepted message identifier (wamid)
 */
export class MetaWhatsAppDeliveryProvider implements OutreachDeliveryProvider {
  public readonly name = META_WHATSAPP_PROVIDER_NAME;
  public readonly channel = OutreachChannel.WHATSAPP;

  private readonly config: MetaWhatsAppProviderConfig;
  private readonly fetchFn: MetaWhatsAppFetchFn;
  private readonly clock: () => Date;

  constructor(options: MetaWhatsAppDeliveryProviderOptions) {
    validateMetaWhatsAppConfig(options.config);
    this.config = {
      ...options.config,
      apiVersion: options.config.apiVersion ?? DEFAULT_META_WHATSAPP_API_VERSION,
      baseUrl: (options.config.baseUrl ?? DEFAULT_META_WHATSAPP_BASE_URL).replace(/\/+$/, ''),
      timeoutMs: options.config.timeoutMs ?? DEFAULT_META_WHATSAPP_TIMEOUT_MS
    };
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.clock = options.clock ?? (() => new Date());
  }

  public async send(input: OutreachProviderSendInput): Promise<OutreachProviderSendResult> {
    this.validateInput(input);

    const whatsAppInput = input as { content: string };
    const apiVersion = this.config.apiVersion;
    const phoneNumberId = encodeURIComponent(this.config.phoneNumberId);
    const url = `${this.config.baseUrl}/${apiVersion}/${phoneNumberId}/messages`;

    // Normalize recipient phone number for Meta Graph API (strip leading '+')
    const toPhone = input.recipientNormalized.replace(/^\+/, '');

    const requestPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toPhone,
      type: 'text',
      text: {
        preview_url: false,
        body: whatsAppInput.content
      }
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
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal
      });
    } catch (fetchErr: unknown) {
      if (controller.signal.aborted) {
        throw new OutreachDeliveryProviderError({
          code: OutreachProviderErrorCode.PROVIDER_TIMEOUT,
          safeMessage: 'Meta WhatsApp Cloud API connection timed out',
          retryable: true,
          providerName: this.name,
          cause: fetchErr
        });
      }

      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.PROVIDER_UNAVAILABLE,
        safeMessage: 'Meta WhatsApp Cloud API network transport failure',
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
        safeMessage: 'Meta WhatsApp Cloud API returned an unparseable response payload',
        retryable: false,
        providerName: this.name,
        cause: parseErr
      });
    }

    const providerMessageId = parsedBody?.messages?.[0]?.id;
    if (!providerMessageId || typeof providerMessageId !== 'string' || providerMessageId.trim().length === 0) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.INVALID_PROVIDER_RESPONSE,
        safeMessage: 'Meta WhatsApp response missing accepted message identifier',
        retryable: false,
        providerName: this.name
      });
    }

    return {
      providerName: this.name,
      providerMessageId,
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

    if (input.channel !== OutreachChannel.WHATSAPP) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.CHANNEL_MISMATCH,
        safeMessage: `Channel mismatch: MetaWhatsAppDeliveryProvider only accepts WHATSAPP dispatches (received ${String(input.channel)})`,
        retryable: false,
        providerName: this.name
      });
    }

    if (!input.recipientNormalized || typeof input.recipientNormalized !== 'string' || input.recipientNormalized.trim().length === 0) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.INVALID_INPUT,
        safeMessage: 'recipientNormalized is required and must be a non-empty string',
        retryable: false,
        providerName: this.name
      });
    }

    const whatsAppInput = input as { content?: unknown };
    if (!whatsAppInput.content || typeof whatsAppInput.content !== 'string' || whatsAppInput.content.trim().length === 0) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.INVALID_INPUT,
        safeMessage: 'WhatsApp dispatches require non-empty content',
        retryable: false,
        providerName: this.name
      });
    }

    if (!input.providerIdempotencyToken || typeof input.providerIdempotencyToken !== 'string' || input.providerIdempotencyToken.trim().length === 0) {
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
      structuredError = json?.error;
    } catch {
      // Body not JSON
    }

    const httpStatus = response.status;
    const metaCode = structuredError?.code;
    const metaSubcode = structuredError?.error_subcode;

    // Rate Limiting (HTTP 429 or Meta code 4 / 80007 / 130429 / 131056)
    if (httpStatus === 429 || metaCode === 4 || metaCode === 80007 || metaCode === 130429 || metaCode === 131056) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.PROVIDER_RATE_LIMITED,
        safeMessage: 'Meta WhatsApp outbound rate limit exceeded',
        retryable: true,
        providerName: this.name
      });
    }

    // Upstream Server Errors (HTTP 5xx)
    if (httpStatus >= 500) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.PROVIDER_UNAVAILABLE,
        safeMessage: 'Meta WhatsApp Cloud API service is temporarily unavailable',
        retryable: true,
        providerName: this.name
      });
    }

    // Recipient Rejected (e.g. Meta codes 131026: Message undeliverable, 131051: Unsupported phone number, 100 with subcode 33: Phone number not registered)
    if (
      metaCode === 131026 ||
      metaCode === 131051 ||
      metaSubcode === 131051 ||
      (metaCode === 100 && metaSubcode === 33)
    ) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.RECIPIENT_REJECTED,
        safeMessage: 'Recipient phone number is invalid or not registered on WhatsApp',
        retryable: false,
        providerName: this.name
      });
    }

    // Content Rejected / Policy / Template outside customer window
    // (e.g. Meta code 131047: Re-engagement message / 24-hour window closed, 131048: Spam rate limit)
    if (metaCode === 131047 || metaCode === 131048 || metaCode === 368) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.CONTENT_REJECTED,
        safeMessage: 'Message rejected by WhatsApp messaging window or policy constraints',
        retryable: false,
        providerName: this.name
      });
    }

    // Auth / Configuration / Permissions (HTTP 401 / 403 or Meta code 190 / 200)
    // Map safely to DELIVERY_FAILED or PROVIDER_UNAVAILABLE without leaking credential details
    if (httpStatus === 401 || httpStatus === 403 || metaCode === 190 || metaCode === 200) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.DELIVERY_FAILED,
        safeMessage: 'Meta WhatsApp Cloud API authorization or configuration error',
        retryable: false,
        providerName: this.name
      });
    }

    // Generic client or unknown errors
    throw new OutreachDeliveryProviderError({
      code: OutreachProviderErrorCode.DELIVERY_FAILED,
      safeMessage: `Meta WhatsApp Cloud API rejected request with status ${httpStatus}`,
      retryable: false,
      providerName: this.name
    });
  }
}
