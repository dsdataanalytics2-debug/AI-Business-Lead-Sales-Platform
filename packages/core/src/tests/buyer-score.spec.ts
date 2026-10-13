import { describe, it, expect } from 'vitest';
import {
  computeBuyerScore,
  computeProductFit,
  computeCategoryMatch,
  computeLocationFit,
  computeContactability,
  computeSourceConfidence
} from '../scoring/buyer-score.js';

describe('Buyer Score Engine (0–100)', () => {
  const context = {
    productName: 'Mushroom Lamp',
    productCategory: 'Home & Living',
    targetMarket: 'Dhaka',
    primaryCategories: ['Lighting Store', 'Home Decor Store'],
    secondaryCategories: ['Interior Design Firm', 'Furniture Store', 'Gift Shop']
  };

  it('computes high score for an exact primary match with full contact info in target market', () => {
    const buyer = {
      businessName: 'Lumiere Lighting & Decor',
      category: 'Lighting Store',
      matchedBuyerCategory: 'Lighting Store',
      address: 'House 12, Road 4, Dhanmondi, Dhaka',
      city: 'Dhaka',
      phone: '+8801711223344',
      website: 'https://lumierebd.com',
      provider: 'GOOGLE_PLACES',
      externalBusinessId: 'places-123'
    };

    const result = computeBuyerScore(buyer, context);

    expect(result.buyerScore).toBeGreaterThanOrEqual(85);
    expect(result.breakdown.categoryMatch).toBe(100);
    expect(result.breakdown.locationFit).toBe(95);
    expect(result.breakdown.contactability).toBe(100);
    expect(result.breakdown.sourceConfidence).toBe(100);
    expect(result.advisoryNote).toContain('Strong commercial fit');
  });

  it('computes appropriate secondary category score with partial contact info', () => {
    const buyer = {
      businessName: 'Creative Interior Space',
      category: 'Interior Design Firm',
      matchedBuyerCategory: 'Interior Design Firm',
      address: 'Gulshan 2, Dhaka',
      city: 'Dhaka',
      phone: '+8801999888777',
      website: null,
      provider: 'OPENSTREETMAP',
      externalBusinessId: 'osm-456'
    };

    const result = computeBuyerScore(buyer, context);

    expect(result.breakdown.categoryMatch).toBe(82);
    expect(result.breakdown.contactability).toBe(75); // phone (40) + address (15) + baseline (20)
    expect(result.buyerScore).toBeGreaterThanOrEqual(70);
    expect(result.buyerScore).toBeLessThan(90);
  });

  it('scores low for an unrelated category with no phone in a different city', () => {
    const buyer = {
      businessName: 'General Hardware & Pipes',
      category: 'Hardware Store',
      address: 'Station Road, Sylhet',
      city: 'Sylhet',
      phone: null,
      website: null,
      provider: 'MOCK',
      externalBusinessId: 'mock-789'
    };

    const result = computeBuyerScore(buyer, context);

    expect(result.breakdown.categoryMatch).toBe(65);
    expect(result.breakdown.locationFit).toBe(60);
    expect(result.breakdown.contactability).toBe(35); // address (15) + baseline (20)
    expect(result.buyerScore).toBeLessThan(65);
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
      externalBusinessId: 'places-999'
    };

    const run1 = computeBuyerScore(buyer, context);
    const run2 = computeBuyerScore(buyer, context);

    expect(run1).toEqual(run2);
  });
});
