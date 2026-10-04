/**
 * Normalized provider error codes for AI Sales Assistant providers.
 * Provider-neutral, safe for API and service layer consumption.
 */
export const SalesAssistantProviderErrorCode = {
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  INVALID_PROVIDER_RESPONSE: 'INVALID_PROVIDER_RESPONSE',
  GENERATION_FAILED: 'GENERATION_FAILED'
} as const;

export type SalesAssistantProviderErrorCode =
  (typeof SalesAssistantProviderErrorCode)[keyof typeof SalesAssistantProviderErrorCode];

/**
 * Normalized safe error thrown by sales assistant providers.
 * Contains ZERO secrets, raw provider responses, auth tokens, or stack leaks.
 */
export class SalesAssistantProviderError extends Error {
  public readonly code: SalesAssistantProviderErrorCode;
  public readonly safeMessage: string;
  public readonly retryable: boolean;

  constructor(
    code: SalesAssistantProviderErrorCode,
    safeMessage: string,
    retryable = false
  ) {
    super(safeMessage);
    this.name = 'SalesAssistantProviderError';
    this.code = code;
    this.safeMessage = safeMessage;
    this.retryable = retryable;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
