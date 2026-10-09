/**
 * Datasource Provider Registry
 *
 * Manages registered datasource provider instances with safe lookup,
 * capability metadata, and error handling.
 */

import type { DataSourceProvider, ProviderMetadata } from './types.js';
import { UnknownProviderError } from './errors.js';
import { MockDataSourceProvider } from './providers/mock-provider.js';
import { CsvDataSourceProvider, CSV_PROVIDER_KEY } from './providers/csv-provider.js';
import { OpenStreetMapProvider, OPENSTREETMAP_PROVIDER_KEY } from './providers/openstreetmap-provider.js';
import { GooglePlacesProvider, GOOGLE_PLACES_PROVIDER_KEY } from './providers/google-places-provider.js';

export const BUILTIN_PROVIDER_METADATA: Record<string, ProviderMetadata> = {
  mock: {
    key: 'mock',
    displayName: 'Mock Provider (Standard)',
    description: 'Deterministic local business discovery fixtures for development, testing, and offline use.',
    requiresCredential: false,
    supportsBuyerSearch: true,
    supportsContactEnrichment: true,
    supportsConnectionTest: true,
    costType: 'FREE'
  },
  csv: {
    key: 'csv',
    displayName: 'CSV File Provider',
    description: 'Import and search structured business databases from local CSV spreadsheets.',
    requiresCredential: false,
    supportsBuyerSearch: true,
    supportsContactEnrichment: true,
    supportsConnectionTest: true,
    costType: 'FREE'
  },
  openstreetmap: {
    key: 'openstreetmap',
    displayName: 'OpenStreetMap (Overpass)',
    description: 'First free live buyer discovery provider via global OpenStreetMap Overpass API.',
    requiresCredential: false,
    supportsBuyerSearch: true,
    supportsContactEnrichment: true,
    supportsConnectionTest: true,
    costType: 'FREE'
  },
  'google-places': {
    key: 'google-places',
    displayName: 'Google Places API (New)',
    description: 'Live verified business discovery, high-accuracy geocoding, and official business details via Google Places API (New).',
    requiresCredential: true,
    supportsBuyerSearch: true,
    supportsContactEnrichment: true,
    supportsConnectionTest: true,
    costType: 'PAID'
  }
};

export class DataSourceRegistry {
  private readonly providers = new Map<string, DataSourceProvider>();
  private readonly metadataMap = new Map<string, ProviderMetadata>();

  constructor() {
    // Register built-in metadata
    for (const [key, meta] of Object.entries(BUILTIN_PROVIDER_METADATA)) {
      this.metadataMap.set(key.toLowerCase(), meta);
    }

    // Automatically register built-in providers
    this.register(new MockDataSourceProvider());
    this.register(new CsvDataSourceProvider());
    this.register(new OpenStreetMapProvider());
    this.register(new GooglePlacesProvider());
  }

  /**
   * Normalizes provider key for case-insensitive lookup (e.g. 'GOOGLE_PLACES' -> 'google-places').
   */
  private normalizeKey(name: string): string {
    const raw = (name || '').trim().toLowerCase().replace(/_/g, '-');
    return raw;
  }

  /**
   * Registers a datasource provider instance.
   */
  public register(provider: DataSourceProvider, metadata?: ProviderMetadata): void {
    const key = this.normalizeKey(provider.name);
    this.providers.set(key, provider);
    if (metadata) {
      this.metadataMap.set(key, metadata);
    }
  }

  /**
   * Checks if a provider is registered.
   */
  public has(name: string): boolean {
    if (!name || typeof name !== 'string') return false;
    return this.providers.has(this.normalizeKey(name));
  }

  /**
   * Retrieves a registered provider by name.
   * Throws UnknownProviderError if the provider is not registered.
   */
  public get(name: string): DataSourceProvider {
    if (!name || typeof name !== 'string') {
      throw new UnknownProviderError(String(name));
    }
    const key = this.normalizeKey(name);
    const provider = this.providers.get(key);
    if (!provider) {
      throw new UnknownProviderError(name);
    }
    return provider;
  }

  /**
   * Retrieves provider metadata.
   */
  public getMetadata(name: string): ProviderMetadata | undefined {
    if (!name || typeof name !== 'string') return undefined;
    return this.metadataMap.get(this.normalizeKey(name));
  }

  /**
   * Returns list of all registered provider metadata.
   */
  public getAllMetadata(): ProviderMetadata[] {
    return Array.from(this.metadataMap.values());
  }

  /**
   * Lists all registered provider names and keys.
   */
  public list(): string[] {
    const names = Array.from(this.providers.values()).map((p) => p.name);
    const keys = Array.from(this.providers.keys());
    return Array.from(new Set([...names, ...keys]));
  }
}

/** Global default registry instance */
export const defaultRegistry = new DataSourceRegistry();

/** Convenience helper to get a provider from the default registry */
export function getProvider(name: string): DataSourceProvider {
  return defaultRegistry.get(name);
}

/** Convenience helper to check if a provider exists in the default registry */
export function hasProvider(name: string): boolean {
  return defaultRegistry.has(name);
}

/** Convenience helper to list all registered providers in the default registry */
export function listProviders(): string[] {
  return defaultRegistry.list();
}

/** Convenience helper to register a provider in the default registry */
export function registerProvider(provider: DataSourceProvider, metadata?: ProviderMetadata): void {
  defaultRegistry.register(provider, metadata);
}
