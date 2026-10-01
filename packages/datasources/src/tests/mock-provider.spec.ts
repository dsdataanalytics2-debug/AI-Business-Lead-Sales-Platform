import { describe, it, expect } from 'vitest';
import {
  ContactType,
  PhoneType,
  WhatsAppStatus,
  EvidenceType,
  businessSearchResultSchema
} from '@leadmate/shared';
import {
  getProvider,
  hasProvider,
  listProviders,
  UnknownProviderError,
  MockDataSourceProvider,
  MOCK_PROVIDER_NAME,
  MOCK_BUSINESS_FIXTURES
} from '../index.js';

describe('M1 Step 5: Datasource Provider Contract & Mock Provider Tests', () => {
  const provider = new MockDataSourceProvider();

  // 1. registry returns mock provider
  it('1. registry returns mock provider', () => {
    expect(hasProvider('MOCK')).toBe(true);
    expect(hasProvider('mock')).toBe(true);
    const resolved = getProvider('MOCK');
    expect(resolved).toBeInstanceOf(MockDataSourceProvider);
    expect(resolved.name).toBe(MOCK_PROVIDER_NAME);
    expect(listProviders()).toContain('MOCK');
  });

  // 2. unknown provider fails safely
  it('2. unknown provider fails safely with UnknownProviderError', () => {
    expect(hasProvider('UNKNOWN_ABC')).toBe(false);
    expect(() => getProvider('UNKNOWN_ABC')).toThrow(UnknownProviderError);
  });

  // 3. exactly 10 fixtures exist
  it('3. exactly 10 fixtures exist', () => {
    expect(MOCK_BUSINESS_FIXTURES).toHaveLength(10);
  });

  // 4. every fixture has stable unique externalId
  it('4. every fixture has stable unique externalId', () => {
    const ids = MOCK_BUSINESS_FIXTURES.map((f) => f.externalId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(10);

    for (const id of ids) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(id.startsWith('mock-')).toBe(true);
      // Ensure IDs are deterministic, lowercase slug-like strings
      expect(id).toMatch(/^mock-[a-z0-9-]+$/);
    }
  });

  // 5. repeated search returns deterministic results
  it('5. repeated search returns deterministic results (identical results & exact order)', async () => {
    const query = { q: 'Dental', location: 'Dhaka', limit: 10 };
    const res1 = await provider.search(query);
    const res2 = await provider.search(query);

    expect(res1).toEqual(res2);
    expect(res1.map((r) => r.externalId)).toEqual(res2.map((r) => r.externalId));
  });

  // 6. search by business name
  it('6. search by business name', async () => {
    const results = await provider.search({
      q: 'Surma Valley Tea',
      location: 'Sylhet'
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('Mock Surma Valley Tea House');
    expect(results[0].externalId).toBe('mock-sylhet-tea-zindabazar-004');
  });

  // 7. search by category
  it('7. search by category', async () => {
    const results = await provider.search({
      q: 'Dental',
      location: 'Dhaka',
      category: 'Dental Clinic'
    });
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (const r of results) {
      expect(r.category).toBe('Dental Clinic');
    }
  });

  // 8. search by Dhaka city
  it('8. search by Dhaka city', async () => {
    const results = await provider.search({
      q: 'Dental',
      location: 'Dhaka'
    });
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (const r of results) {
      expect(r.city).toBe('Dhaka');
    }
  });

  // 9. search Chittagong/Chattogram fixture
  it('9. search Chittagong/Chattogram fixture (handles city aliases)', async () => {
    const resultsChattogram = await provider.search({
      q: 'Steel',
      location: 'Chattogram'
    });
    expect(resultsChattogram.length).toBe(1);
    expect(resultsChattogram[0].externalId).toBe('mock-ctg-steel-agrabad-003');

    // Also handles alias 'Chittagong'
    const resultsChittagong = await provider.search({
      q: 'Steel',
      location: 'Chittagong'
    });
    expect(resultsChittagong.length).toBe(1);
    expect(resultsChittagong[0].externalId).toBe('mock-ctg-steel-agrabad-003');
  });

  // 10. search Sylhet fixture
  it('10. search Sylhet fixture', async () => {
    const results = await provider.search({
      q: 'Tea',
      location: 'Sylhet'
    });
    expect(results.length).toBe(1);
    expect(results[0].city).toBe('Sylhet');
    expect(results[0].externalId).toBe('mock-sylhet-tea-zindabazar-004');
  });

  // 11. locality filter works
  it('11. locality filter works', async () => {
    const resultsGulshan = await provider.search({
      q: 'Dental',
      location: 'Gulshan-1'
    });
    expect(resultsGulshan.length).toBe(1);
    expect(resultsGulshan[0].locality).toBe('Gulshan-1');
    expect(resultsGulshan[0].externalId).toBe('mock-dhaka-dental-gulshan-001');

    const resultsDhanmondi = await provider.search({
      q: 'Dental',
      location: 'Dhanmondi'
    });
    expect(resultsDhanmondi.length).toBe(1);
    expect(resultsDhanmondi[0].locality).toBe('Dhanmondi');
    expect(resultsDhanmondi[0].externalId).toBe('mock-dhaka-dental-dhanmondi-002');
  });

  // 12. limit is respected
  it('12. limit is respected', async () => {
    const results = await provider.search({
      q: 'Dental',
      location: 'Dhaka',
      limit: 1
    });
    expect(results).toHaveLength(1);
  });

  // 13. unknown search produces empty results
  it('13. unknown search produces empty results', async () => {
    const results = await provider.search({
      q: 'NonExistentXYZ999',
      location: 'Dhaka'
    });
    expect(results).toHaveLength(0);
  });

  // 14. resolve known externalId
  it('14. resolve known externalId succeeds exactly', async () => {
    const result = await provider.resolveByExternalId('mock-dhaka-dental-gulshan-001');
    expect(result).not.toBeNull();
    expect(result?.externalId).toBe('mock-dhaka-dental-gulshan-001');
    expect(result?.name).toBe('Mock Dhaka Dental Care Gulshan');
    expect(result?.provider).toBe(MOCK_PROVIDER_NAME);
  });

  // 15. resolve unknown externalId => null
  it('15. resolve unknown externalId => null', async () => {
    const result = await provider.resolveByExternalId('mock-unknown-id-999');
    expect(result).toBeNull();
  });

  // 16. external ID resolution is exact (rejects whitespace, case mismatch, partial)
  it('16. external ID resolution rejects whitespace, wrong case, and partial IDs', async () => {
    // A. Leading/trailing whitespace must return null
    const resultWithSpaces = await provider.resolveByExternalId(' mock-dhaka-dental-gulshan-001 ');
    expect(resultWithSpaces).toBeNull();

    // B. Uppercase/wrong case must return null (strict exact string equality)
    const resultUpperCase = await provider.resolveByExternalId('MOCK-DHAKA-DENTAL-GULSHAN-001');
    expect(resultUpperCase).toBeNull();

    // C. Partial substring must return null
    const partialResult = await provider.resolveByExternalId('mock-dhaka-dental-gulshan');
    expect(partialResult).toBeNull();
  });

  // 17. no website fixture exists
  it('17. no website fixture exists', () => {
    const fixture = MOCK_BUSINESS_FIXTURES.find((f) => f.externalId === 'mock-dhaka-bakery-mirpur-005');
    expect(fixture).toBeDefined();
    expect(fixture?.website).toBeUndefined();
    expect(fixture?.name).toBe('Mock Bengal Bakes Mirpur');
  });

  // 18. Facebook-only fixture exists
  it('18. Facebook-only fixture exists with fictional social URL', () => {
    const fixture = MOCK_BUSINESS_FIXTURES.find((f) => f.externalId === 'mock-dhaka-handicrafts-uttara-007');
    expect(fixture).toBeDefined();
    expect(fixture?.name).toBe('Mock Bengal Crafts Uttara');
    expect(fixture?.website).toBeUndefined();
    expect(fixture?.sourceUrl).toBe('https://facebook.com/mockbengalcraftsuttara');
  });

  // 19. landline fixture exists
  it('19. landline fixture exists', () => {
    const fixture = MOCK_BUSINESS_FIXTURES.find((f) => f.externalId === 'mock-dhaka-legal-motijheel-008');
    expect(fixture).toBeDefined();
    expect(fixture?.contacts[0]?.phoneType).toBe(PhoneType.LANDLINE);
    expect(fixture?.contacts[0]?.rawValue).toBe('029876543');
  });

  // 20. invalid-phone fixture exists
  it('20. invalid-phone fixture exists', () => {
    const fixture = MOCK_BUSINESS_FIXTURES.find((f) => f.externalId === 'mock-dhaka-repair-farmgate-009');
    expect(fixture).toBeDefined();
    expect(fixture?.contacts[0]?.phoneType).toBe(PhoneType.UNKNOWN);
    expect(fixture?.contacts[0]?.rawValue).toBe('01234567890');
  });

  // 21. no-phone fixture exists
  it('21. no-phone fixture exists', () => {
    const fixture = MOCK_BUSINESS_FIXTURES.find((f) => f.externalId === 'mock-dhaka-gallery-shahbagh-010');
    expect(fixture).toBeDefined();
    expect(fixture?.contacts).toHaveLength(0);
  });

  // 22. Bengali-digit phone fixture exists
  it('22. Bengali-digit phone fixture exists', () => {
    const fixture = MOCK_BUSINESS_FIXTURES.find((f) => f.externalId === 'mock-ctg-steel-agrabad-003');
    expect(fixture).toBeDefined();
    expect(fixture?.contacts[0]?.rawValue).toBe('০১৮১-১০০০০০৩');
  });

  // 23. shared-domain separate branches exist
  it('23. shared-domain separate branches exist', () => {
    const branch1 = MOCK_BUSINESS_FIXTURES.find((f) => f.externalId === 'mock-dhaka-dental-gulshan-001');
    const branch2 = MOCK_BUSINESS_FIXTURES.find((f) => f.externalId === 'mock-dhaka-dental-dhanmondi-002');
    expect(branch1).toBeDefined();
    expect(branch2).toBeDefined();
    expect(branch1?.website).toBe('https://dhakadental.example.com/gulshan');
    expect(branch2?.website).toBe('https://dhakadental.example.com/dhanmondi');
  });

  // 24. normal PHONE does not imply WhatsApp
  it('24. normal PHONE does not imply WhatsApp', () => {
    const phoneFixtures = MOCK_BUSINESS_FIXTURES.filter(
      (f) => f.contacts.some((c) => c.type === ContactType.PHONE)
    );
    expect(phoneFixtures.length).toBeGreaterThan(0);
    for (const fixture of phoneFixtures) {
      for (const contact of fixture.contacts) {
        if (contact.type === ContactType.PHONE) {
          expect(contact.whatsappStatus).toBe(WhatsAppStatus.UNKNOWN);
        }
      }
    }
  });

  // 25. explicit public WhatsApp fixture preserves PUBLICLY_LISTED
  it('25. explicit public WhatsApp fixture preserves PUBLICLY_LISTED', () => {
    const fixture = MOCK_BUSINESS_FIXTURES.find((f) => f.externalId === 'mock-dhaka-fashion-banani-006');
    expect(fixture).toBeDefined();
    expect(fixture?.contacts[0]?.type).toBe(ContactType.WHATSAPP);
    expect(fixture?.contacts[0]?.whatsappStatus).toBe(WhatsAppStatus.PUBLICLY_LISTED);
    expect(fixture?.contacts[0]?.evidenceType).toBe(EvidenceType.WA_ME_LINK);
  });

  // 26. no fixture outputs WhatsApp CONFIRMED
  it('26. no fixture outputs WhatsApp CONFIRMED', () => {
    for (const fixture of MOCK_BUSINESS_FIXTURES) {
      for (const contact of fixture.contacts) {
        expect(contact.whatsappStatus).not.toBe(WhatsAppStatus.CONFIRMED);
      }
    }
  });

  // 27. provenance/provider identity present
  it('27. provenance/provider identity present', () => {
    for (const fixture of MOCK_BUSINESS_FIXTURES) {
      expect(fixture.provider).toBe(MOCK_PROVIDER_NAME);
      expect(fixture.externalId).toBeDefined();
      expect(fixture.country).toBe('BD');
      if (fixture.sourceUrl) {
        expect(typeof fixture.sourceUrl).toBe('string');
      }
    }
  });

  // 28. raw metadata is minimized
  it('28. raw metadata is minimized (no secrets, tokens, or dump properties)', () => {
    for (const fixture of MOCK_BUSINESS_FIXTURES) {
      const keys = Object.keys(fixture);
      expect(keys).not.toContain('apiKey');
      expect(keys).not.toContain('secret');
      expect(keys).not.toContain('token');
      expect(keys).not.toContain('internalId');
      expect(keys).not.toContain('headers');
    }
  });

  // 29. fixtures contain no random/generated runtime IDs
  it('29. fixtures contain no random/generated runtime IDs', () => {
    for (const fixture of MOCK_BUSINESS_FIXTURES) {
      // Must not match standard random UUID regex
      expect(fixture.externalId).not.toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(fixture.externalId.startsWith('mock-')).toBe(true);
    }
  });

  // 30. provider performs no network access
  it('30. provider performs no network access (instant in-memory resolution)', async () => {
    const start = Date.now();
    const results = await provider.search({ q: 'Dental', location: 'Dhaka' });
    const duration = Date.now() - start;

    expect(results.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(100); // Pure in-memory execution takes < 100ms
  });

  // 31. search results satisfy approved shared schema
  it('31. search results satisfy approved shared schema', async () => {
    const results = await provider.search({ q: 'Dental', location: 'Dhaka' });
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      const parseResult = businessSearchResultSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    }
  });

  // 32. resolved result satisfies approved shared schema
  it('32. resolved result satisfies approved shared schema', async () => {
    for (const fixture of MOCK_BUSINESS_FIXTURES) {
      const resolved = await provider.resolveByExternalId(fixture.externalId);
      expect(resolved).not.toBeNull();
      const parseResult = businessSearchResultSchema.safeParse(resolved);
      expect(parseResult.success).toBe(true);
    }
  });

  // 33. Fixture immutability: mutations to returned results do not modify canonical fixtures
  it('33. Fixture immutability: mutations to returned results do not modify canonical fixtures', async () => {
    const original = await provider.resolveByExternalId('mock-dhaka-dental-gulshan-001');
    expect(original).not.toBeNull();

    // Mutate the returned copy
    if (original) {
      (original as any).name = 'MUTATED NAME';
      (original.contacts[0] as any).rawValue = '99999999999';
    }

    // Resolve again and verify original fixture is intact
    const fresh = await provider.resolveByExternalId('mock-dhaka-dental-gulshan-001');
    expect(fresh?.name).toBe('Mock Dhaka Dental Care Gulshan');
    expect(fresh?.contacts[0]?.rawValue).toBe('01711000001');
  });
});
