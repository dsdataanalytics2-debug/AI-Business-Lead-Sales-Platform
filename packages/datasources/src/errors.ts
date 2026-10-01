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
