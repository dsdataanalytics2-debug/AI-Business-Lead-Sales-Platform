import { describe, it, expect, vi } from 'vitest';
import {
  OpenStreetMapProvider,
  OPENSTREETMAP_PROVIDER_KEY,
  type OsmElementRaw
} from '../providers/openstreetmap-provider.js';
import {
  ContactType,
  PhoneType,
  WhatsAppStatus,
  EvidenceType
} from '@leadmate/shared';
import {
  ProviderRateLimitError,
  InvalidQueryError
} from '../errors.js';

describe('OpenStreetMap / Overpass Provider', () => {
  const sampleElement: OsmElementRaw = {
    type: 'node',
    id: 987654321,
    lat: 23.7925,
    lon: 90.4078,
    tags: {
      name: 'Gulshan Dental Surgery',
      amenity: 'dentist',
      'addr:street': 'Road 11',
      'addr:housenumber': 'House 42',
      'addr:city': 'Dhaka',
      'addr:country': 'BD',
      website: 'https://gulshandental.com.bd',
      phone: '+8801712345678'
    }
  };

  it('1. Normalizes OSM element to BusinessSearchResult with exact field mapping', () => {
    const provider = new OpenStreetMapProvider();
    const result = provider.normalizeElement(sampleElement);

    expect(result.externalId).toBe('osm:node/987654321');
    expect(result.provider).toBe(OPENSTREETMAP_PROVIDER_KEY);
    expect(result.name).toBe('Gulshan Dental Surgery');
    expect(result.category).toBe('dentist');
    expect(result.address).toBe('House 42, Road 11, Dhaka');
    expect(result.city).toBe('Dhaka');
    expect(result.country).toBe('BD');
    expect(result.latitude).toBe(23.7925);
    expect(result.longitude).toBe(90.4078);
    expect(result.website).toBe('https://gulshandental.com.bd');
    expect(result.sourceUrl).toBe('https://www.openstreetmap.org/node/987654321');
  });

  it('2. Enforces PHONE != WHATSAPP invariant strictly (never infers WhatsApp)', () => {
    const provider = new OpenStreetMapProvider();
    const result = provider.normalizeElement(sampleElement);

    expect(result.contacts).toHaveLength(1);
    const contact = result.contacts[0];
    expect(contact.type).toBe(ContactType.PHONE);
    expect(contact.rawValue).toBe('+8801712345678');
    expect(contact.phoneType).toBe(PhoneType.UNKNOWN);
    // CRITICAL INVARIANT: WhatsApp status MUST remain UNKNOWN
    expect(contact.whatsappStatus).toBe(WhatsAppStatus.UNKNOWN);
    expect(contact.evidenceType).toBe(EvidenceType.LISTING_FIELD);
  });

  it('3. Preserves null/undefined for missing fields without inventing data', () => {
    const sparseElement: OsmElementRaw = {
      type: 'way',
      id: 11223344,
      tags: {
        name: 'Dhaka Bakery Corner'
      }
    };

    const provider = new OpenStreetMapProvider();
    const result = provider.normalizeElement(sparseElement);

    expect(result.website).toBeUndefined();
    expect(result.contacts).toHaveLength(0);
    expect(result.address).toBeUndefined();
    expect(result.rating).toBeUndefined();
    expect(result.reviewCount).toBe(0);
  });

  it('4. Searches via mock fetch without making real external calls', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        elements: [sampleElement]
      })
    });

    const provider = new OpenStreetMapProvider({ fetch: mockFetch as any });
    const results = await provider.search({ q: 'Dental Clinic', location: 'Dhaka', limit: 5 });

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Gulshan Dental Surgery');
    expect(results[0].provider).toBe(OPENSTREETMAP_PROVIDER_KEY);
  });

  it('5. Throws InvalidQueryError on empty search query', async () => {
    const provider = new OpenStreetMapProvider();
    await expect(provider.search({ q: '   ', location: 'Dhaka' })).rejects.toThrowError(
      InvalidQueryError
    );
  });

  it('6. Handles Overpass rate limit (HTTP 429) cleanly with ProviderRateLimitError', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429
    });

    const provider = new OpenStreetMapProvider({ fetch: mockFetch as any });
    await expect(
      provider.search({ q: 'Restaurant', location: 'Dhaka' })
    ).rejects.toThrowError(ProviderRateLimitError);
  });

  it('7. Tests connection using testConnection() method', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true
    });

    const provider = new OpenStreetMapProvider({ fetch: mockFetch as any });
    const conn = await provider.testConnection();

    expect(conn.connected).toBe(true);
    expect(conn.message).toContain('reachable');
  });
});
