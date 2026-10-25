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
import { FacebookBusinessProvider, FACEBOOK_BUSINESS_PROVIDER_KEY } from './providers/facebook-business-provider.js';
import { FacebookLeadAdsProvider, FACEBOOK_LEAD_ADS_PROVIDER_KEY } from './providers/facebook-lead-ads-provider.js';
import { TikTokBusinessProvider, TIKTOK_BUSINESS_PROVIDER_KEY } from './providers/tiktok-business-provider.js';
import { TikTokLeadGenProvider, TIKTOK_LEAD_GEN_PROVIDER_KEY } from './providers/tiktok-lead-gen-provider.js';
import { PublicDirectoryProvider, PUBLIC_DIRECTORY_PROVIDER_KEY } from './providers/public-directory-provider.js';
import { PublicRfqProvider, PUBLIC_RFQ_PROVIDER_KEY } from './providers/public-rfq-provider.js';

export const BUILTIN_PROVIDER_METADATA: Record<string, ProviderMetadata> = {
  mock: {
    key: 'mock',
    displayName: 'Mock Provider (Standard)',
    description: 'Deterministic local business discovery fixtures for development, testing, and offline use.',
    requiresCredential: false,
    supportsBuyerSearch: true,
    supportsContactEnrichment: true,
    supportsConnectionTest: true,
    costType: 'FREE',
    capabilities: ['DISCOVERY', 'ENRICHMENT']
  },
  csv: {
    key: 'csv',
    displayName: 'CSV File Provider',
    description: 'Import and search structured business databases from local CSV spreadsheets.',
    requiresCredential: false,
    supportsBuyerSearch: true,
    supportsContactEnrichment: true,
    supportsConnectionTest: true,
    costType: 'FREE',
    capabilities: ['DISCOVERY']
  },
  openstreetmap: {
    key: 'openstreetmap',
    displayName: 'OpenStreetMap (Overpass)',
    description: 'First free live buyer discovery provider via global OpenStreetMap Overpass API.',
    requiresCredential: false,
    supportsBuyerSearch: true,
    supportsContactEnrichment: true,
    supportsConnectionTest: true,
    costType: 'FREE',
    capabilities: ['DISCOVERY']
  },
  'google-places': {
    key: 'google-places',
    displayName: 'Google Places API (New)',
    description: 'Live verified business discovery, high-accuracy geocoding, and official business details via Google Places API (New).',
    requiresCredential: true,
    supportsBuyerSearch: true,
    supportsContactEnrichment: true,
    supportsConnectionTest: true,
    costType: 'PAID',
    capabilities: ['DISCOVERY']
  },
  'facebook-business': {
    key: 'facebook-business',
    displayName: 'Facebook Business Pages & Metadata',
    description: 'Authorized connected Facebook business accounts, page metadata, and owned asset details.',
    requiresCredential: true,
    supportsBuyerSearch: false,
    supportsContactEnrichment: true,
    supportsConnectionTest: true,
    costType: 'FREE',
    capabilities: ['OWNED_ASSET']
  },
  'facebook-lead-ads': {
    key: 'facebook-lead-ads',
    displayName: 'Facebook Lead Ads & Inbound Signals',
    description: 'Ingest authorized commercial lead forms and inbound buyer inquiries from connected Facebook Pages.',
    requiresCredential: true,
    supportsBuyerSearch: false,
    supportsContactEnrichment: false,
    supportsConnectionTest: true,
    costType: 'FREE',
    capabilities: ['INBOUND_LEADS']
  },
  'facebook-messenger': {
    key: 'facebook-messenger',
    displayName: 'Facebook Messenger & Page Signals',
    description: 'Inbound buyer messaging signals and direct commercial inquiries from connected Facebook Page inbox.',
    requiresCredential: true,
    supportsBuyerSearch: false,
    supportsContactEnrichment: false,
    supportsConnectionTest: true,
    costType: 'FREE',
    capabilities: ['MESSAGING_SIGNAL']
  },
  'tiktok-business': {
    key: 'tiktok-business',
    displayName: 'TikTok Business Profile & Metadata',
    description: 'Authorized TikTok commercial business accounts, advertiser profiles, and owned asset details.',
    requiresCredential: true,
    supportsBuyerSearch: false,
    supportsContactEnrichment: true,
    supportsConnectionTest: true,
    costType: 'FREE',
    capabilities: ['OWNED_ASSET']
  },
  'tiktok-lead-gen': {
    key: 'tiktok-lead-gen',
    displayName: 'TikTok Lead Generation Inbound',
    description: 'Ingest authorized wholesale buyer leads from connected TikTok Lead Generation advertising campaigns.',
    requiresCredential: true,
    supportsBuyerSearch: false,
    supportsContactEnrichment: false,
    supportsConnectionTest: true,
    costType: 'FREE',
    capabilities: ['INBOUND_LEADS']
  },
  'company-website': {
    key: 'company-website',
    displayName: 'Company Website (Public Domain)',
    description: 'Direct corporate website verification, structured contact extraction, and commercial validation.',
    requiresCredential: false,
    supportsBuyerSearch: false,
    supportsContactEnrichment: true,
    supportsConnectionTest: true,
    costType: 'FREE',
    capabilities: ['ENRICHMENT']
  },
  'public-directory': {
    key: 'public-directory',
    displayName: 'Public Trade & Yellow Pages Directory',
    description: 'Comprehensive commercial listings, yellow pages, and wholesale trade directories.',
    requiresCredential: false,
    supportsBuyerSearch: true,
    supportsContactEnrichment: true,
    supportsConnectionTest: true,
    costType: 'FREE',
    capabilities: ['DISCOVERY']
  },
  'public-rfq': {
    key: 'public-rfq',
    displayName: 'Public Procurement & RFQ Notices',
    description: 'Authorized public procurement portals, open tender notices, and institutional buyer solicitations.',
    requiresCredential: false,
    supportsBuyerSearch: true,
    supportsContactEnrichment: true,
    supportsConnectionTest: true,
    costType: 'FREE',
    capabilities: ['DISCOVERY', 'PROCUREMENT']
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
    this.register(new FacebookBusinessProvider());
    this.register(new FacebookLeadAdsProvider());
    this.register(new TikTokBusinessProvider());
    this.register(new TikTokLeadGenProvider());
    this.register(new PublicDirectoryProvider());
    this.register(new PublicRfqProvider());
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
