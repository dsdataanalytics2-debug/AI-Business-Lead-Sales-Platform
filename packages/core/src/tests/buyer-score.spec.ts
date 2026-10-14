import { describe, it, expect } from 'vitest';
import {
  computeBuyerScore,
  computeBuyerPriority,
  computeIntentStrength,
  computeProductFit,
  computeCategoryMatch,
  computeLocationFit,
  computeContactability,
  computeSourceConfidence
} from '../scoring/buyer-score.js';

describe('Buyer Score Engine V2 (0–100) & Priority Classification', () => {
  const context = {
    productName: 'Mushroom Lamp',
    productCategory: 'Home & Living',
    targetMarket: 'Dhaka',
    primaryCategories: ['Lighting Store', 'Home Decor Store'],
    secondaryCategories: ['Interior Design Firm', 'Furniture Store', 'Gift Shop']
  };

  it('computes Buyer Score V2 with all 6 components and assigns HOT priority for high score + intent + contactability', () => {
    const buyer = {
      businessName: 'Lumiere Lighting & Decor',
      category: 'Lighting Store',
      matchedBuyerCategory: 'Lighting Store',
      address: 'House 12, Road 4, Dhanmondi, Dhaka',
      city: 'Dhaka',
      phone: '+8801711223344',
      website: 'https://lumierebd.com',
      provider: 'GOOGLE_PLACES',
      externalBusinessId: 'places-123',
      wholesaleIntent: 'HIGH' as const,
      sourceEvidences: [
        {
          sourceType: 'COMPANY_WEBSITE',
          sourceName: 'Lumiere Website',
          snippet: 'Open inquiry for bulk wholesale price tiers on decorative lamps',
          evidenceType: 'WEBSITE_CONTACTS'
        },
        {
          sourceType: 'GOOGLE_PLACES',
          sourceName: 'Google Places API',
          evidenceType: 'PLACES_DETAIL'
        },
        {
          sourceType: 'OPENSTREETMAP',
          sourceName: 'OpenStreetMap',
          evidenceType: 'NODE'
        }
      ]
    };

    const result = computeBuyerScore(buyer, context);

    expect(result.buyerScore).toBeGreaterThanOrEqual(80);
    expect(result.breakdown.categoryMatch).toBe(100);
    expect(result.breakdown.locationFit).toBe(95);
    expect(result.breakdown.contactability).toBe(100);
    expect(result.breakdown.sourceConfidence).toBeGreaterThanOrEqual(90);
    expect(result.breakdown.intentStrength).toBe(100);
    expect(result.priority).toBe('HOT');
    expect(result.advisoryNote).toContain('Strong commercial fit');
  });

  it('assigns WARM priority for qualified buyer with no explicit intent signals (No-Evidence = NONE)', () => {
    const buyer = {
      businessName: 'Creative Interior Space',
      category: 'Interior Design Firm',
      matchedBuyerCategory: 'Interior Design Firm',
      address: 'Gulshan 2, Dhaka',
      city: 'Dhaka',
      phone: '+8801999888777',
      website: null,
      provider: 'OPENSTREETMAP',
      externalBusinessId: 'osm-456',
      wholesaleIntent: 'NONE' as const
    };

    const result = computeBuyerScore(buyer, context);

    expect(result.breakdown.categoryMatch).toBe(82);
    expect(result.breakdown.contactability).toBe(75);
    expect(result.breakdown.intentStrength).toBe(0); // Intent is NONE
    expect(result.buyerScore).toBeGreaterThanOrEqual(50);
    expect(result.priority).toBe('WARM');
  });

  it('assigns COLD priority for unrelated category or uncontactable business', () => {
    const buyer = {
      businessName: 'General Hardware & Pipes',
      category: 'Hardware Store',
      address: 'Station Road, Sylhet',
      city: 'Sylhet',
      phone: null,
      website: null,
      provider: 'MOCK',
      externalBusinessId: 'mock-789',
      wholesaleIntent: 'NONE' as const
    };

    const result = computeBuyerScore(buyer, context);

    expect(result.breakdown.categoryMatch).toBe(65);
    expect(result.breakdown.locationFit).toBe(60);
    expect(result.breakdown.contactability).toBe(35);
    expect(result.breakdown.intentStrength).toBe(0);
    expect(result.priority).toBe('COLD');
  });

  describe('Deterministic Priority Matrix (HOT / WARM / COLD)', () => {
    it('evaluates HOT: score >= 70, strong intent, contactable (>= 50)', () => {
      expect(computeBuyerPriority(75, 'HIGH', 80)).toBe('HOT');
      expect(computeBuyerPriority(70, 'MEDIUM', 50)).toBe('HOT');
    });

    it('evaluates WARM: high score without intent, or moderate score', () => {
      expect(computeBuyerPriority(85, 'NONE', 100)).toBe('WARM'); // High score but no intent
      expect(computeBuyerPriority(55, 'LOW', 60)).toBe('WARM');
    });

    it('evaluates COLD: low score (< 45) or uncontactable (< 30)', () => {
      expect(computeBuyerPriority(40, 'HIGH', 80)).toBe('COLD'); // Weak fit
      expect(computeBuyerPriority(80, 'HIGH', 20)).toBe('COLD'); // Uncontactable
    });
  });

  it('maintains pure determinism across multiple runs', () => {
    const buyer = {
      businessName: 'Nordic Lamp Gallery',
      category: 'Home Decor Store',
      matchedBuyerCategory: 'Home Decor Store',
      address: 'Banani, Dhaka',
      city: 'Dhaka',
      phone: '+8801811223344',
      website: 'https://nordiclamp.com',
      provider: 'GOOGLE_PLACES',
      externalBusinessId: 'places-999',
      wholesaleIntent: 'MEDIUM' as const
    };

    const run1 = computeBuyerScore(buyer, context);
    const run2 = computeBuyerScore(buyer, context);

    expect(run1).toEqual(run2);
    expect(run1.priority).toBe('HOT');
  });
});
