import { OutreachChannel } from '@leadmate/shared';
import type {
  OutreachDeliveryProvider,
  OutreachProviderSendInput,
  OutreachProviderSendResult,
  MockDeliveryProviderOptions,
  MockDeliveryOutcome
} from './interfaces.js';
import {
  OutreachDeliveryProviderError,
  OutreachProviderErrorCode
} from './errors.js';

export const MOCK_EMAIL_PROVIDER_NAME = 'MOCK_EMAIL';

/**
 * Deterministic, offline mock provider for Email outreach delivery.
 * Emulates upstream transactional email service (SES/SendGrid/SMTP) behavior
 * without network dependencies, vendor credentials, or sleeps.
 *
 * CRITICAL INVARIANTS:
 * - NO live SMTP/HTTP connections
 * - NO vendor credentials or environment tokens
 * - Receives pre-vetted normalized email recipient snapshot
 * - Returns deterministic providerMessageId keyed by deliveryId
 * - Injected clock support for deterministic acceptedAt verification
 */
export class MockEmailDeliveryProvider implements OutreachDeliveryProvider {
  public readonly name = MOCK_EMAIL_PROVIDER_NAME;
  public readonly channel = OutreachChannel.EMAIL;

  private readonly defaultOutcome: MockDeliveryOutcome;
  private readonly scenarioRules: NonNullable<MockDeliveryProviderOptions['scenarioRules']>;
  private readonly clock: () => Date;

  constructor(options: MockDeliveryProviderOptions = {}) {
    this.defaultOutcome = options.defaultOutcome ?? 'SUCCESS';
    this.scenarioRules = options.scenarioRules ?? [];
    this.clock = options.clock ?? (() => new Date());
  }

  /**
   * Deterministically dispatches Email message according to configured scenario rules.
   */
  public async send(input: OutreachProviderSendInput): Promise<OutreachProviderSendResult> {
    // 1. Defensive input validation
    this.validateInput(input);

    // 2. Resolve simulated outcome
    const outcome = this.resolveOutcome(input);

    // 3. Handle simulated outcomes
    if (outcome !== 'SUCCESS') {
      this.throwSimulatedError(outcome, input);
    }

    // 4. Deterministic success acknowledgment
    return {
      providerName: this.name,
      providerMessageId: `mock-email:${input.deliveryId}`,
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
        safeMessage: `Channel mismatch: MockEmailDeliveryProvider only accepts EMAIL dispatches (received ${String(input.channel)})`,
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

    const emailInput = input as { body?: unknown };
    if (!emailInput.body || typeof emailInput.body !== 'string' || emailInput.body.trim().length === 0) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.INVALID_INPUT,
        safeMessage: 'Email dispatches require non-empty body',
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

  private resolveOutcome(input: OutreachProviderSendInput): MockDeliveryOutcome {
    for (const rule of this.scenarioRules) {
      if (rule.deliveryId && rule.deliveryId === input.deliveryId) {
        return rule.outcome;
      }
      if (rule.recipientNormalized && rule.recipientNormalized === input.recipientNormalized) {
        return rule.outcome;
      }
    }
    return this.defaultOutcome;
  }

  private throwSimulatedError(outcome: MockDeliveryOutcome, input: OutreachProviderSendInput): never {
    const matchedRule = this.scenarioRules.find(
      (r) =>
        (r.deliveryId && r.deliveryId === input.deliveryId) ||
        (r.recipientNormalized && r.recipientNormalized === input.recipientNormalized)
    );

    const customMsg = matchedRule?.customErrorMessage;

    switch (outcome) {
      case 'TIMEOUT':
        throw new OutreachDeliveryProviderError({
          code: OutreachProviderErrorCode.PROVIDER_TIMEOUT,
          safeMessage: customMsg ?? 'Mock Email upstream provider connection timed out',
          retryable: true,
          providerName: this.name
        });
      case 'UNAVAILABLE':
        throw new OutreachDeliveryProviderError({
          code: OutreachProviderErrorCode.PROVIDER_UNAVAILABLE,
          safeMessage: customMsg ?? 'Mock Email provider service is temporarily unavailable',
          retryable: true,
          providerName: this.name
        });
      case 'RATE_LIMITED':
        throw new OutreachDeliveryProviderError({
          code: OutreachProviderErrorCode.PROVIDER_RATE_LIMITED,
          safeMessage: customMsg ?? 'Mock Email outbound message rate limit exceeded',
          retryable: true,
          providerName: this.name
        });
      case 'RECIPIENT_REJECTED':
        throw new OutreachDeliveryProviderError({
          code: OutreachProviderErrorCode.RECIPIENT_REJECTED,
          safeMessage: customMsg ?? 'Recipient email address bounced or is unroutable',
          retryable: false,
          providerName: this.name
        });
      case 'CONTENT_REJECTED':
        throw new OutreachDeliveryProviderError({
          code: OutreachProviderErrorCode.CONTENT_REJECTED,
          safeMessage: customMsg ?? 'Email message content rejected by spam filters',
          retryable: false,
          providerName: this.name
        });
      case 'INVALID_PROVIDER_RESPONSE':
        throw new OutreachDeliveryProviderError({
          code: OutreachProviderErrorCode.INVALID_PROVIDER_RESPONSE,
          safeMessage: customMsg ?? 'Upstream email provider returned an invalid response',
          retryable: false,
          providerName: this.name
        });
      case 'CHANNEL_MISMATCH':
        throw new OutreachDeliveryProviderError({
          code: OutreachProviderErrorCode.CHANNEL_MISMATCH,
          safeMessage: customMsg ?? 'Channel mismatch: MockEmailDeliveryProvider only accepts EMAIL dispatches',
          retryable: false,
          providerName: this.name
        });
      default:
        throw new OutreachDeliveryProviderError({
          code: OutreachProviderErrorCode.DELIVERY_FAILED,
          safeMessage: customMsg ?? `Mock Email provider simulated error: ${outcome}`,
          retryable: false,
          providerName: this.name
        });
    }
  }
}
