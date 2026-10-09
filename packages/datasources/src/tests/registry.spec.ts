import { describe, it, expect } from 'vitest';
import {
  DataSourceRegistry,
  defaultRegistry,
  getProvider,
  hasProvider,
  listProviders,
  UnknownProviderError
} from '../index.js';

describe('DataSourceRegistry & Capability Metadata', () => {
  it('1. Initializes default registry with 4 built-in providers: mock, csv, openstreetmap, google-places', () => {
    const providers = listProviders();
    expect(providers).toContain('mock');
    expect(providers).toContain('csv');
    expect(providers).toContain('openstreetmap');
    expect(providers).toContain('google-places');
  });

  it('2. Resolves providers case-insensitively and with hyphen/underscore normalization', () => {
    expect(hasProvider('MOCK')).toBe(true);
    expect(hasProvider('mock')).toBe(true);
    expect(hasProvider('openstreetmap')).toBe(true);
    expect(hasProvider('OPENSTREETMAP')).toBe(true);
    expect(hasProvider('google-places')).toBe(true);
    expect(hasProvider('GOOGLE_PLACES')).toBe(true);

    const osm = getProvider('OPENSTREETMAP');
    expect(osm.name).toBe('openstreetmap');

    const google = getProvider('GOOGLE_PLACES');
    expect(google.name).toBe('google-places');
  });

  it('3. Throws UnknownProviderError on unregistered provider name', () => {
    expect(() => defaultRegistry.get('unknown-provider-xyz')).toThrowError(UnknownProviderError);
    expect(hasProvider('unknown-provider-xyz')).toBe(false);
  });

  it('4. Provides capability metadata for all built-in providers', () => {
    const osmMeta = defaultRegistry.getMetadata('openstreetmap');
    expect(osmMeta).toBeDefined();
    expect(osmMeta?.key).toBe('openstreetmap');
    expect(osmMeta?.costType).toBe('FREE');
    expect(osmMeta?.requiresCredential).toBe(false);
    expect(osmMeta?.supportsBuyerSearch).toBe(true);

    const googleMeta = defaultRegistry.getMetadata('google-places');
    expect(googleMeta).toBeDefined();
    expect(googleMeta?.key).toBe('google-places');
    expect(googleMeta?.costType).toBe('PAID');
    expect(googleMeta?.requiresCredential).toBe(true);
    expect(googleMeta?.supportsConnectionTest).toBe(true);

    const allMeta = defaultRegistry.getAllMetadata();
    expect(allMeta.length).toBeGreaterThanOrEqual(4);
  });
});
