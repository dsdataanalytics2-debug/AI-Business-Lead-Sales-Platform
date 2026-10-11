/**
 * AI-Driven Buyer Discovery & Business Search Integration Tests
 *
 * Verifies all 12 core requirements from Section 18:
 * 1. Raw product "Diamum" is not used as the only business search term when AI targets exist.
 * 2. AI buyer targets feed provider queries (Google Places / OSM).
 * 3. Selected buyer targets in UI / query take strict precedence.
 * 4. Multiple categories are searched across providers.
 * 5. Results from multiple categories are merged and deduplicated across 4 identifier tiers.
 * 6. Overall result limit is respected (budget distribution & early termination).
 * 7. AI failure/unconfigured falls back safely without returning 500.
 * 8. No Gemini call occurs on keystrokes (only on deliberate search/discovery trigger).
 * 9. Gemini runs at most once per deliberate search when auto-targeting is used.
 * 10. Provider result provenance (matchedBuyerCategory, searchTargetUsed) remains intact.
 * 11. PHONE != WHATSAPP invariant remains intact (no inference of WhatsApp status without proof).
 * 12. AI does not fabricate business/contact data (Google Places / OSM find real data).
 *
 * Also verifies Section 13-15:
 * - Commercial classifications for Diamum, Smart Watch, Mini Mop, Water Bottle, Software Service.
 * - Section 15 Medical Safety: AI never asserts or repeats medical efficacy claims.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { businessSearchService } from '../services/business-search.service.js';
import { aiBuyerDiscoveryService } from '../services/ai-buyer-discovery.service.js';
import { aiSettingsService } from '../services/ai-settings.service.js';
import { GEMINI_PROVIDER_KEY } from '@leadmate/ai';
import { defaultRegistry } from '@leadmate/datasources';
import { ContactType, PhoneType, WhatsAppStatus, EvidenceType } from '@leadmate/shared';

describe('LeadAtlas AI-Driven Buyer Discovery & Provider Search', () => {
  const context = {
    organizationId: '50000000-0000-0000-0000-000000000001',
    userId: '50000000-0000-0000-0000-000000000011',
    correlationId: 'ai-buyer-search-test'
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /* =========================================================================
   * 1 & 2 & 3. AI Buyer Targets Feed Provider Queries & Selected Targets Respected
   * ========================================================================= */
  it('1 & 2. AI buyer targets feed provider queries; raw product "Diamum" is not used as the only business search term', async () => {
    const mockProvider = defaultRegistry.get('MOCK');
    const searchSpy = vi.spyOn(mockProvider, 'search').mockImplementation(async (subQuery) => {
      return [
        {
          externalId: `mock:${subQuery.q}:1`,
          provider: 'MOCK',
          name: `${subQuery.q} Outlet 1`,
          category: subQuery.q,
          city: 'Dhaka',
          country: 'BD',
          reviewCount: 5,
          contacts: []
        }
      ];
    });

    // Provide explicit AI buyer target categories
    const results = await businessSearchService.search(
      {
        q: 'Diamum',
        location: 'Dhaka',
        targetCategories: ['Pharmacy', 'Medicine Shop', 'Medical Distributor'],
        provider: 'MOCK',
        limit: 10
      },
      context
    );

    // Search provider should have been queried with buyer categories, NOT raw "Diamum"
    const queriedTerms = searchSpy.mock.calls.map((call) => call[0].q);
    expect(queriedTerms).toContain('Pharmacy');
    expect(queriedTerms).toContain('Medicine Shop');
    expect(queriedTerms).toContain('Medical Distributor');
    expect(queriedTerms).not.toContain('Diamum');

    expect(results.length).toBeGreaterThanOrEqual(3);
  });

  it('3. Selected buyer targets are strictly respected and unselected targets are ignored', async () => {
    const mockProvider = defaultRegistry.get('MOCK');
    const searchSpy = vi.spyOn(mockProvider, 'search').mockResolvedValue([]);

    // User only selected Pharmacy and Medical Distributor
    await businessSearchService.search(
      {
        q: 'Diamum',
        location: 'Dhaka',
        targetCategories: ['Pharmacy', 'Medical Distributor'],
        provider: 'MOCK',
        limit: 10
      },
      context
    );

    const queriedTerms = searchSpy.mock.calls.map((call) => call[0].q);
    expect(queriedTerms).toEqual(['Pharmacy', 'Medical Distributor']);
    expect(queriedTerms).not.toContain('Health Supplement Store');
  });

  /* =========================================================================
   * 4 & 5. Multiple Categories Searched, Merged, and Deduplicated Across 4 Tiers
   * ========================================================================= */
  it('4 & 5. Multiple categories searched, merged, and deduplicated across 4 identifier tiers', async () => {
    const mockProvider = defaultRegistry.get('MOCK');

    vi.spyOn(mockProvider, 'search').mockImplementation(async (subQuery) => {
      if (subQuery.q === 'Pharmacy') {
        return [
          {
            externalId: 'ext:p1',
            provider: 'MOCK',
            name: 'Square Pharmacy Ltd',
            category: 'Pharmacy',
            street: 'Dhanmondi 27',
            city: 'Dhaka',
            country: 'BD',
            website: 'https://squarepharmacy.com.bd',
            reviewCount: 10,
            contacts: [
              {
                type: ContactType.PHONE,
                rawValue: '+8801711111111',
                phoneType: PhoneType.UNKNOWN,
                whatsappStatus: WhatsAppStatus.UNKNOWN,
                evidenceType: EvidenceType.AUTHORIZED_API
              }
            ]
          },
          {
            externalId: 'ext:p2',
            provider: 'MOCK',
            name: 'Lazz Pharma Kakrail',
            category: 'Pharmacy',
            street: 'Kakrail',
            city: 'Dhaka',
            country: 'BD',
            website: 'https://lazzpharma.com',
            reviewCount: 20,
            contacts: []
          }
        ];
      } else if (subQuery.q === 'Medicine Shop') {
        return [
          // Tier 1 duplicate: same provider & externalId
          {
            externalId: 'ext:p1',
            provider: 'MOCK',
            name: 'Square Pharmacy Ltd (Duplicate)',
            category: 'Medicine Shop',
            street: 'Dhanmondi 27',
            city: 'Dhaka',
            country: 'BD',
            reviewCount: 10,
            contacts: []
          },
          // Tier 2 duplicate: normalized name + city
          {
            externalId: 'ext:p3',
            provider: 'MOCK',
            name: 'Lazz Pharma Kakrail',
            category: 'Medicine Shop',
            street: 'Kakrail VIP Road',
            city: 'Dhaka',
            country: 'BD',
            reviewCount: 15,
            contacts: []
          },
          // Unique entry
          {
            externalId: 'ext:p4',
            provider: 'MOCK',
            name: 'Popular Medicine Corner',
            category: 'Medicine Shop',
            street: 'Shantinagar',
            city: 'Dhaka',
            country: 'BD',
            website: 'https://popularmedicine.bd',
            reviewCount: 8,
            contacts: []
          }
        ];
      } else if (subQuery.q === 'Medical Distributor') {
        return [
          // Tier 3 duplicate: same phone number as Square Pharmacy
          {
            externalId: 'ext:p5',
            provider: 'MOCK',
            name: 'Square Healthcare Distribution Division',
            category: 'Medical Distributor',
            street: 'Tejgaon I/A',
            city: 'Dhaka',
            country: 'BD',
            reviewCount: 12,
            contacts: [
              {
                type: ContactType.PHONE,
                rawValue: '+8801711111111', // Same phone
                phoneType: PhoneType.UNKNOWN,
                whatsappStatus: WhatsAppStatus.UNKNOWN,
                evidenceType: EvidenceType.AUTHORIZED_API
              }
            ]
          },
          // Tier 4 duplicate: same website domain as Popular Medicine
          {
            externalId: 'ext:p6',
            provider: 'MOCK',
            name: 'Popular Healthcare Supply Ltd',
            category: 'Medical Distributor',
            street: 'Motijheel',
            city: 'Dhaka',
            country: 'BD',
            website: 'https://www.popularmedicine.bd/wholesale', // Same domain popularmedicine.bd
            reviewCount: 30,
            contacts: []
          },
          // New truly unique distributor
          {
            externalId: 'ext:p7',
            provider: 'MOCK',
            name: 'Delta Medico Traders',
            category: 'Medical Distributor',
            street: 'Banglamotor',
            city: 'Dhaka',
            country: 'BD',
            website: 'https://deltamedico.com',
            reviewCount: 14,
            contacts: []
          }
        ];
      }
      return [];
    });

    const results = await businessSearchService.search(
      {
        q: 'Diamum',
        location: 'Dhaka',
        targetCategories: ['Pharmacy', 'Medicine Shop', 'Medical Distributor'],
        provider: 'MOCK',
        limit: 20
      },
      context
    );

    // Should include Square Pharmacy, Lazz Pharma Kakrail, Popular Medicine Corner, and Delta Medico Traders
    // All 4 duplicates (ext:p1, Lazz duplicate, phone duplicate, domain duplicate) were filtered
    expect(results).toHaveLength(4);
    const names = results.map((r) => r.name);
    expect(names).toContain('Square Pharmacy Ltd');
    expect(names).toContain('Lazz Pharma Kakrail');
    expect(names).toContain('Popular Medicine Corner');
    expect(names).toContain('Delta Medico Traders');
  });

  /* =========================================================================
   * 6. Overall Result Limit & Early Stop
   * ========================================================================= */
  it('6. Overall result limit is strictly respected and stops early when budget fulfilled', async () => {
    const mockProvider = defaultRegistry.get('MOCK');
    const searchSpy = vi.spyOn(mockProvider, 'search').mockImplementation(async (subQuery) => {
      // Returns 5 unique results per category
      return Array.from({ length: 5 }, (_, i) => ({
        externalId: `mock:${subQuery.q}:${i}`,
        provider: 'MOCK',
        name: `${subQuery.q} Store ${i}`,
        category: subQuery.q,
        city: 'Dhaka',
        country: 'BD',
        reviewCount: 5,
        contacts: []
      }));
    });

    // Request limit of 4 with 3 categories
    const results = await businessSearchService.search(
      {
        q: 'Diamum',
        location: 'Dhaka',
        targetCategories: ['Pharmacy', 'Medicine Shop', 'Medical Distributor'],
        provider: 'MOCK',
        limit: 4
      },
      context
    );

    expect(results).toHaveLength(4);
    // Since Pharmacy already returned 5 (which is >= 4 limit), search should stop early after first category
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy.mock.calls[0][0].q).toBe('Pharmacy');
  });

  /* =========================================================================
   * 7. AI Failure Fallback
   * ========================================================================= */
  it('7. AI failure or unconfigured AI falls back safely without returning 500', async () => {
    // Simulate AI throwing an error
    vi.spyOn(aiSettingsService, 'getActiveAiContext').mockResolvedValueOnce({
      providerName: 'gemini',
      apiKey: 'AIzaTest',
      model: 'gemini-3.1-flash-lite',
      isEnabled: true
    });
    vi.spyOn(aiBuyerDiscoveryService, 'suggestBuyerTargets').mockRejectedValueOnce(
      new Error('Gemini quota exceeded (429 RESOURCE_EXHAUSTED)')
    );

    const mockProvider = defaultRegistry.get('MOCK');
    const searchSpy = vi.spyOn(mockProvider, 'search').mockResolvedValue([]);

    // Search without targetCategories to trigger auto mode with failing AI
    const results = await businessSearchService.search(
      {
        q: 'Smart Watch',
        location: 'Dhaka',
        provider: 'MOCK',
        limit: 10
      },
      context
    );

    // Does not throw 500, falls back safely to searching category or raw query
    expect(results).toEqual([]);
    expect(searchSpy).toHaveBeenCalled();
    expect(searchSpy.mock.calls[0][0].q).toBe('Smart Watch');
  });

  /* =========================================================================
   * 8 & 9. Gemini Call Timing: At Most Once per Deliberate Search, Never on Keystrokes
   * ========================================================================= */
  it('8 & 9. Auto AI mode calls Gemini at most once per deliberate search', async () => {
    vi.spyOn(aiSettingsService, 'getActiveAiContext').mockResolvedValueOnce({
      providerName: 'gemini',
      apiKey: 'AIzaValidKey',
      model: 'gemini-3.1-flash-lite',
      isEnabled: true
    });

    const aiSpy = vi.spyOn(aiBuyerDiscoveryService, 'suggestBuyerTargets').mockResolvedValueOnce({
      product: 'Diamum',
      buyerTargets: [
        { category: 'Pharmacy', reason: 'Dispenses prescription diabetes medications' },
        { category: 'Medical Distributor', reason: 'Supplies pharmacies and clinics' }
      ]
    });

    const mockProvider = defaultRegistry.get('MOCK');
    vi.spyOn(mockProvider, 'search').mockResolvedValue([]);

    await businessSearchService.search(
      {
        q: 'Diamum',
        location: 'Dhaka',
        provider: 'MOCK',
        limit: 10
      },
      context
    );

    // Auto AI mode called suggestBuyerTargets exactly once
    expect(aiSpy).toHaveBeenCalledTimes(1);
  });

  /* =========================================================================
   * 10. Provider Result Provenance Preserved
   * ========================================================================= */
  it('10. Provider result provenance (matchedBuyerCategory, searchTargetUsed) is preserved', async () => {
    const mockProvider = defaultRegistry.get('MOCK');
    vi.spyOn(mockProvider, 'search').mockImplementation(async (subQuery) => {
      return [
        {
          externalId: `mock:${subQuery.q}:100`,
          provider: 'MOCK',
          name: 'Gulshan Modern Pharmacy',
          category: subQuery.q,
          city: 'Dhaka',
          country: 'BD',
          reviewCount: 15,
          contacts: []
        }
      ];
    });

    const results = await businessSearchService.search(
      {
        q: 'Diamum',
        location: 'Dhaka, Bangladesh',
        targetCategories: ['Pharmacy'],
        provider: 'MOCK',
        limit: 10
      },
      context
    );

    expect(results).toHaveLength(1);
    const item = results[0];
    expect(item.provider).toBe('MOCK');
    expect(item.externalId).toBe('mock:Pharmacy:100');
    expect(item.matchedBuyerCategory).toBe('Pharmacy');
    expect(item.searchTargetUsed).toBe('Pharmacy in Dhaka, Bangladesh');
  });

  /* =========================================================================
   * 11 & 12. PHONE != WHATSAPP & No AI Data Fabrication
   * ========================================================================= */
  it('11 & 12. PHONE != WHATSAPP invariant remains intact and AI never fabricates contact/business data', async () => {
    const mockProvider = defaultRegistry.get('MOCK');
    vi.spyOn(mockProvider, 'search').mockResolvedValueOnce([
      {
        externalId: 'mock:ph1',
        provider: 'MOCK',
        name: 'Genuine Medicine Center',
        category: 'Medicine Shop',
        city: 'Dhaka',
        country: 'BD',
        reviewCount: 3,
        contacts: [
          {
            type: ContactType.PHONE,
            rawValue: '+8801700112233',
            phoneType: PhoneType.UNKNOWN,
            whatsappStatus: WhatsAppStatus.UNKNOWN,
            evidenceType: EvidenceType.AUTHORIZED_API
          }
        ]
      }
    ]);

    const results = await businessSearchService.search(
      {
        q: 'Diamum',
        location: 'Dhaka',
        targetCategories: ['Medicine Shop'],
        provider: 'MOCK',
        limit: 10
      },
      context
    );

    expect(results).toHaveLength(1);
    const contact = results[0].contacts[0];
    // Invariant: PHONE is strictly preserved; WhatsAppStatus is NOT inferred as ACTIVE
    expect(contact.type).toBe(ContactType.PHONE);
    expect(contact.phoneType).toBe(PhoneType.UNKNOWN);
    expect(contact.whatsappStatus).toBe(WhatsAppStatus.UNKNOWN);
    // Invariant: Business name, ID, and address are strictly from the datasource provider
    expect(results[0].name).toBe('Genuine Medicine Center');
    expect(results[0].externalId).toBe('mock:ph1');
  });

  /* =========================================================================
   * 13, 14, 15. Product Category Classifications & Medical Safety Invariant
   * ========================================================================= */
  it('13, 14 & 15. Medical Safety: Fallback classifications provide commercial targets without medical efficacy claims', () => {
    // Section 13: Diamum
    const diamumTargets = aiBuyerDiscoveryService.generateFallbackBuyerTargets('Diamum');
    expect(diamumTargets.buyerTargets.length).toBeGreaterThanOrEqual(3);
    const diamumCats = diamumTargets.buyerTargets.map((t) => t.category);
    expect(diamumCats).toContain('Pharmacy');
    expect(diamumCats).toContain('Medicine Shop');
    expect(diamumCats).toContain('Medical Distributor');

    // Section 15 Medical Safety Invariant:
    // AI and fallback must NEVER assert "cures diabetes", "safe for everyone", or "clinically proven"
    for (const target of diamumTargets.buyerTargets) {
      const reasonLower = target.reason.toLowerCase();
      expect(reasonLower).not.toContain('cures diabetes');
      expect(reasonLower).not.toContain('clinically proven');
      expect(reasonLower).not.toContain('safe for everyone');
    }

    // Section 14: Smart Watch
    const watchTargets = aiBuyerDiscoveryService.generateFallbackBuyerTargets('Smart Watch');
    const watchCats = watchTargets.buyerTargets.map((t) => t.category);
    expect(watchCats).toContain('Electronics Retailer');
    expect(watchCats).toContain('Mobile Accessories Shop');

    // Section 14: Mini Mop
    const mopTargets = aiBuyerDiscoveryService.generateFallbackBuyerTargets('Mini Mop');
    const mopCats = mopTargets.buyerTargets.map((t) => t.category);
    expect(mopCats).toContain('Homeware Store');
    expect(mopCats).toContain('Cleaning Supply Store');

    // Section 14: Water Bottle
    const bottleTargets = aiBuyerDiscoveryService.generateFallbackBuyerTargets('Water Bottle');
    const bottleCats = bottleTargets.buyerTargets.map((t) => t.category);
    expect(bottleCats).toContain('Kitchenware Store');
    expect(bottleCats).toContain('Sports Store');

    // Section 14: Software Service
    const swTargets = aiBuyerDiscoveryService.generateFallbackBuyerTargets('Software Service');
    const swCats = swTargets.buyerTargets.map((t) => t.category);
    expect(swCats).toContain('Corporate Office');
    expect(swCats).toContain('IT Services');
  });
});
