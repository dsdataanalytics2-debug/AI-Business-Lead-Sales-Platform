/**
 * Centralized AI Provider Error Classes
 */

export class AIProviderError extends Error {
  public readonly provider: string;
  public readonly code: string;
  public readonly isRetryable: boolean;

  constructor(provider: string, code: string, message: string, isRetryable = false) {
    super(message);
    this.name = 'AIProviderError';
    this.provider = provider;
    this.code = code;
    this.isRetryable = isRetryable;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AIAuthError extends AIProviderError {
  constructor(provider: string, message = 'AI API key is missing or invalid') {
    super(provider, 'INVALID_API_KEY', message, false);
    this.name = 'AIAuthError';
  }
}

export class AIQuotaError extends AIProviderError {
  constructor(provider: string, message = 'AI provider quota or rate limit exceeded') {
    super(provider, 'QUOTA_EXCEEDED', message, true);
    this.name = 'AIQuotaError';
  }
}

export class AIModelUnavailableError extends AIProviderError {
  constructor(provider: string, model: string, message?: string) {
    super(
      provider,
      'MODEL_NOT_AVAILABLE',
      message || `Model '${model}' is not available or not supported on provider '${provider}'`,
      false
    );
    this.name = 'AIModelUnavailableError';
  }
}

export class AIStructuredOutputError extends AIProviderError {
  constructor(provider: string, message = 'AI response did not conform to the expected structured schema') {
    super(provider, 'INVALID_STRUCTURED_OUTPUT', message, false);
    this.name = 'AIStructuredOutputError';
  }
}
