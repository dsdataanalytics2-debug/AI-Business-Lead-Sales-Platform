import { describe, it, expect, vi } from 'vitest';
import {
  GooglePlacesProvider,
  GOOGLE_PLACES_PROVIDER_KEY,
  type GooglePlaceRawItem
} from '../providers/google-places-provider.js';
import {
  ContactType,
  PhoneType,
  WhatsAppStatus,
  EvidenceType
} from '@leadmate/shared';
import {
  ProviderAuthError,
  ProviderRateLimitError
} from '../errors.js';

describe('Google Places Provider (New API)', () => {
  const samplePlace: GooglePlaceRawItem = {
    id: 'ChIJ2134567890abcdef',
    displayName: { text: 'Apollo Diagnostic Lab' },
    formattedAddress: 'Plot 35, Block B, Bashundhara R/A, Dhaka',
    nationalPhoneNumber: '01711223344',
    websiteUri: 'https://apollodiagnostic.bd',
    rating: 4.6,
    userRatingCount: 142,
    primaryType: 'medical_lab',
    location: { latitude: 23.815, longitude: 90.427 },
    addressComponents: [
      { longText: 'Dhaka', shortText: 'Dhaka', types: ['locality'] },
      { longText: 'Bangladesh', shortText: 'BD', types: ['country'] }
    ]
  };

  it('1. Normalizes Google Place item correctly', () => {
    const provider = new GooglePlacesProvider();
    const result = provider.normalizePlace(samplePlace);

    expect(result.externalId).toBe('google:ChIJ2134567890abcdef');
    expect(result.provider).toBe(GOOGLE_PLACES_PROVIDER_KEY);
    expect(result.name).toBe('Apollo Diagnostic Lab');
    expect(result.category).toBe('Medical Lab');
    expect(result.address).toBe('Plot 35, Block B, Bashundhara R/A, Dhaka');
    expect(result.city).toBe('Dhaka');
    expect(result.country).toBe('BD');
    expect(result.latitude).toBe(23.815);
    expect(result.longitude).toBe(90.427);
    expect(result.website).toBe('https://apollodiagnostic.bd');
    expect(result.rating).toBe(4.6);
    expect(result.reviewCount).toBe(142);
  });

  it('2. Enforces PHONE != WHATSAPP invariant strictly', () => {
    const provider = new GooglePlacesProvider();
    const result = provider.normalizePlace(samplePlace);

    expect(result.contacts).toHaveLength(1);
    const contact = result.contacts[0];
    expect(contact.type).toBe(ContactType.PHONE);
    expect(contact.rawValue).toBe('01711223344');
    expect(contact.whatsappStatus).toBe(WhatsAppStatus.UNKNOWN);
    expect(contact.evidenceType).toBe(EvidenceType.AUTHORIZED_API);
  });

  it('3. Requires API key to search and throws ProviderAuthError when missing', async () => {
    const provider = new GooglePlacesProvider();
    await expect(
      provider.search({ q: 'Hospital', location: 'Dhaka' }, { apiKey: '' })
    ).rejects.toThrowError(ProviderAuthError);
  });

  it('4. Searches via mocked fetch without making external network calls', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [samplePlace]
      })
    });

    const provider = new GooglePlacesProvider({ fetch: mockFetch as any });
    const results = await provider.search(
      { q: 'Hospital', location: 'Dhaka' },
      { apiKey: 'fake-test-google-key-12345' }
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Apollo Diagnostic Lab');
  });

  it('5. Handles authentication failure (401/403) with safe error redaction', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: { message: 'API key not valid. Please pass a valid API key=SECRET12345' }
      })
    });

    const provider = new GooglePlacesProvider({ fetch: mockFetch as any });
    let error: any;
    try {
      await provider.search(
        { q: 'Hospital', location: 'Dhaka' },
        { apiKey: 'bad-key-xyz' }
      );
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(ProviderAuthError);
    // Secret in error message must be redacted!
    expect(error.message).not.toContain('SECRET12345');
    expect(error.message).toContain('REDACTED');
  });

  it('6. Handles quota / rate limit (429)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        error: { message: 'Quota exceeded for Places API' }
      })
    });

    const provider = new GooglePlacesProvider({ fetch: mockFetch as any });
    await expect(
      provider.search(
        { q: 'Hospital', location: 'Dhaka' },
        { apiKey: 'valid-key' }
      )
    ).rejects.toThrowError(ProviderRateLimitError);
  });

  it('7. Tests connection safely with testConnection() without data harvesting', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [] })
    });

    const provider = new GooglePlacesProvider({ fetch: mockFetch as any });
    const result = await provider.testConnection('test-key-12345');

    expect(result.connected).toBe(true);
    expect(result.message).toContain('connected successfully');
  });
});
