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
  /** Decrypted API key if required by provider */
  apiKey?: string;
  /** Custom endpoint URL if configured */
  endpointUrl?: string;
  /** Request abort signal for timeout or cancellation */
  signal?: AbortSignal;
  /** Correlation identifier for request tracing */
  correlationId?: string;
}

/**
 * Standard provider capability and descriptive metadata.
 */
export interface ProviderMetadata {
  key: string;
  displayName: string;
  description: string;
  requiresCredential: boolean;
  supportsBuyerSearch: boolean;
  supportsContactEnrichment: boolean;
  supportsConnectionTest: boolean;
  costType: 'FREE' | 'PAID' | 'HYBRID';
}

/**
 * Standard pluggable datasource provider interface.
 *
 * Implemented by deterministic mock providers and external API providers
 * (e.g. OpenStreetMap, Google Places).
 */
export interface DataSourceProvider {
  /** Unique, stable provider identifier (e.g., 'mock', 'openstreetmap', 'google-places') */
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

  /**
   * Tests provider connection and credentials without broad data scans.
   */
  testConnection?(
    apiKey?: string
  ): Promise<{ connected: boolean; message: string }>;
}
