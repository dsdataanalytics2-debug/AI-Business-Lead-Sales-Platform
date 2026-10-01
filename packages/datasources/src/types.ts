/**
 * Types and interfaces for datasource providers
 */

import type {
  BusinessSearchQuery,
  BusinessSearchResult,
  DiscoveredContact
} from '@leadmate/shared';

export type BusinessSearchInput = {
  q: string;
  location: string;
  category?: string;
  limit?: number;
  cursor?: string;
};

export type { BusinessSearchQuery, BusinessSearchResult, DiscoveredContact };

/**
 * Execution context passed to provider search and resolution methods.
 */
export interface ProviderContext {
  /** Tenant organization ID if available */
  organizationId?: string;
  /** Request abort signal for timeout or cancellation */
  signal?: AbortSignal;
  /** Correlation identifier for request tracing */
  correlationId?: string;
}

/**
 * Standard pluggable datasource provider interface.
 *
 * Implemented by deterministic mock providers and future external API providers
 * (e.g. Google Places, authorized business directories).
 */
export interface DataSourceProvider {
  /** Unique, stable provider identifier (e.g., 'MOCK', 'GOOGLE_PLACES') */
  readonly name: string;

  /**
   * Searches businesses based on query parameters.
   *
   * @param query - Business search query parameters
   * @param context - Optional execution context
   * @returns List of matching business preview results
   */
  search(
    query: BusinessSearchInput,
    context?: ProviderContext
  ): Promise<BusinessSearchResult[]>;

  /**
   * Resolves the authoritative business record from the provider by its stable external ID.
   *
   * @param externalId - Provider's stable external identifier
   * @param context - Optional execution context
   * @returns Authoritative BusinessSearchResult or null if not found
   */
  resolveByExternalId(
    externalId: string,
    context?: ProviderContext
  ): Promise<BusinessSearchResult | null>;
}
