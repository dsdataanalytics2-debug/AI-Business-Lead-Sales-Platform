/**
 * Domain error classes for @leadmate/datasources
 */

export class DataSourceError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'DATA_SOURCE_ERROR') {
    super(message);
    this.name = 'DataSourceError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnknownProviderError extends DataSourceError {
  public readonly providerName: string;

  constructor(providerName: string) {
    super(`Unknown datasource provider: "${providerName}"`, 'UNKNOWN_PROVIDER');
    this.name = 'UnknownProviderError';
    this.providerName = providerName;
  }
}

export class ProviderUnavailableError extends DataSourceError {
  public readonly providerName: string;

  constructor(providerName: string, reason?: string) {
    super(
      `Datasource provider "${providerName}" is unavailable${reason ? `: ${reason}` : ''}`,
      'PROVIDER_UNAVAILABLE'
    );
    this.name = 'ProviderUnavailableError';
    this.providerName = providerName;
  }
}

export class InvalidQueryError extends DataSourceError {
  constructor(message: string) {
    super(message, 'INVALID_QUERY');
    this.name = 'InvalidQueryError';
  }
}

export class ProviderAuthError extends DataSourceError {
  public readonly providerName: string;

  constructor(providerName: string, reason?: string) {
    super(
      `Datasource provider "${providerName}" authorization failed${reason ? `: ${reason}` : ''}`,
      'PROVIDER_AUTH_ERROR'
    );
    this.name = 'ProviderAuthError';
    this.providerName = providerName;
  }
}

export class ProviderRateLimitError extends DataSourceError {
  public readonly providerName: string;

  constructor(providerName: string, reason?: string) {
    super(
      `Datasource provider "${providerName}" rate limit or quota exceeded${reason ? `: ${reason}` : ''}`,
      'PROVIDER_RATE_LIMIT'
    );
    this.name = 'ProviderRateLimitError';
    this.providerName = providerName;
  }
}

export class ProviderTimeoutError extends DataSourceError {
  public readonly providerName: string;

  constructor(providerName: string, reason?: string) {
    super(
      `Datasource provider "${providerName}" request timed out${reason ? `: ${reason}` : ''}`,
      'PROVIDER_TIMEOUT'
    );
    this.name = 'ProviderTimeoutError';
    this.providerName = providerName;
  }
}
