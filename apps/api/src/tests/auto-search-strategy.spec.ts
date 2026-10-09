import { describe, it, expect, vi, beforeEach } from 'vitest';
import { businessSearchService } from '../services/business-search.service.js';
import { defaultRegistry } from '@leadmate/datasources';
import { ContactType, PhoneType, WhatsAppStatus, EvidenceType } from '@leadmate/shared';

describe('Free-First AUTO Search Strategy & Data Provenance', () => {
  const context = {
    organizationId: '00000000-0000-0000-0000-00000000000a',
    userId: '00000000-0000-0000-0000-000000000001',
    correlationId: 'test-auto-search'
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. AUTO strategy queries OpenStreetMap first (Free-First invariant)', async () => {
    const osmProvider = defaultRegistry.get('OPENSTREETMAP');
    const googleProvider = defaultRegistry.get('GOOGLE_PLACES');

    const osmSpy = vi.spyOn(osmProvider, 'search').mockResolvedValueOnce([
      {
        externalId: 'osm:node/12345',
        provider: 'openstreetmap',
        name: 'Dhanmondi Dental Studio',
        category: 'dentist',
        city: 'Dhaka',
        country: 'BD',
        reviewCount: 0,
        contacts: [
          {
            type: ContactType.PHONE,
            rawValue: '+8801700000000',
            phoneType: PhoneType.UNKNOWN,
            whatsappStatus: WhatsAppStatus.UNKNOWN,
            evidenceType: EvidenceType.AUTHORIZED_API
          }
        ]
      }
    ]);

    const googleSpy = vi.spyOn(googleProvider, 'search');

    const results = await businessSearchService.search(
      { q: 'Dental Clinic', location: 'Dhaka', provider: 'AUTO', limit: 10 },
      context
    );

    // OSM must be queried
    expect(osmSpy).toHaveBeenCalledOnce();
    // Google must NOT be queried because OSM returned usable free results!
    expect(googleSpy).not.toHaveBeenCalled();

    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe('openstreetmap');
    expect(results[0].name).toBe('Dhanmondi Dental Studio');
  });

  it('2. Enforces PHONE != WHATSAPP invariant strictly in all search results', async () => {
    const osmProvider = defaultRegistry.get('OPENSTREETMAP');
    vi.spyOn(osmProvider, 'search').mockResolvedValueOnce([
      {
        externalId: 'osm:node/998877',
        provider: 'openstreetmap',
        name: 'Gulshan Hardware',
        category: 'hardware',
        city: 'Dhaka',
        country: 'BD',
        reviewCount: 0,
        contacts: [
          {
            type: ContactType.PHONE,
            rawValue: '01711223344',
            phoneType: PhoneType.UNKNOWN,
            whatsappStatus: WhatsAppStatus.UNKNOWN,
            evidenceType: EvidenceType.AUTHORIZED_API
          }
        ]
      }
    ]);

    const results = await businessSearchService.search(
      { q: 'Hardware', location: 'Dhaka', provider: 'AUTO', limit: 10 },
      context
    );

    expect(results[0].contacts).toHaveLength(1);
    expect(results[0].contacts[0].type).toBe(ContactType.PHONE);
    // CRITICAL: whatsappStatus MUST NOT be inferred as active or confirmed
    expect(results[0].contacts[0].whatsappStatus).toBe(WhatsAppStatus.UNKNOWN);
  });

  it('3. Falls back safely to Mock fixtures when offline or 0 OSM results and no Google key', async () => {
    const osmProvider = defaultRegistry.get('OPENSTREETMAP');
    vi.spyOn(osmProvider, 'search').mockResolvedValueOnce([]);

    const results = await businessSearchService.search(
      { q: 'Dental', location: 'Dhaka', provider: 'AUTO', limit: 10 },
      context
    );

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].provider).toBe('MOCK');
  });
});
