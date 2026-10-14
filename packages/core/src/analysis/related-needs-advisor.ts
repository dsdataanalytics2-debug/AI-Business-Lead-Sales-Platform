/**
 * AI Suggested Related Needs Advisor
 *
 * Implements deterministic prediction of related commercial inventory/stock needs
 * for candidate buyers based on product context and buyer classification.
 *
 * INVARIANTS:
 * - Advisory Prediction ONLY: Pure predictive heuristics based on product and buyer commercial categories.
 * - NEVER claims to be verified demand.
 * - Deterministic: Produces consistent recommendations for identical inputs.
 */

export interface RelatedNeedsInput {
  productName: string;
  productCategory?: string | null;
  buyerCategory?: string | null;
  matchedBuyerCategory?: string | null;
}

// Category-based related needs ontology mapping
const RELATED_NEEDS_CATALOG: Record<string, string[]> = {
  // Home decor & interior
  'home decor': ['Decorative Lighting', 'Wall Lamp', 'Rechargeable Light', 'Gift Items', 'Tabletop Accents'],
  'decor': ['Ambient Lighting', 'Bedside Lamps', 'Handcrafted Accents', 'Novelty Gifts'],
  'lighting': ['Table Lamps', 'LED Bedside Lights', 'Accent Lamps', 'Modern Luminaires', 'Desk Lamps'],
  'light': ['LED Luminaires', 'Decorative Bulbs', 'Rechargeable Lights', 'Mood Lighting'],
  'gift': ['Novelty Lights', 'Desk Accessories', 'Handmade Gifts', 'Decorative Pieces', 'Lifestyle Gadgets'],
  'furniture': ['Bedside Lighting', 'Accent Lamps', 'Living Room Decor', 'Console Table Lighting'],
  'interior': ['Architectural Mood Lighting', 'Decorative Fixtures', 'Boutique Home Accessories'],
  'hotel': ['Guestroom Nightlights', 'Lobby Accent Lighting', 'Hospitality Decor'],
  'restaurant': ['Dining Table Ambient Lamps', 'Atmosphere Lighting', 'Boutique Decor'],
  'cafe': ['Warm Ambient Lighting', 'Cordless Table Lights', 'Aesthetic Decor Items']
};

/**
 * Predicts advisory related commercial needs for a candidate buyer.
 */
export function deriveSuggestedRelatedNeeds(input: RelatedNeedsInput): string[] {
  const combinedBuyer = `${input.buyerCategory || ''} ${input.matchedBuyerCategory || ''}`.toLowerCase();
  const combinedProduct = `${input.productName || ''} ${input.productCategory || ''}`.toLowerCase();

  const suggested = new Set<string>();

  // 1. Check buyer category keywords in catalog
  for (const [key, needs] of Object.entries(RELATED_NEEDS_CATALOG)) {
    if (combinedBuyer.includes(key)) {
      for (const item of needs) {
        suggested.add(item);
      }
    }
  }

  // 2. Check product keywords in catalog
  for (const [key, needs] of Object.entries(RELATED_NEEDS_CATALOG)) {
    if (combinedProduct.includes(key)) {
      for (const item of needs) {
        suggested.add(item);
      }
    }
  }

  // 3. If specific matches found, return top 4-6
  if (suggested.size > 0) {
    return Array.from(suggested).slice(0, 5);
  }

  // 4. Fallback defaults for general retail/wholesale buyers
  if (combinedBuyer.includes('store') || combinedBuyer.includes('shop') || combinedBuyer.includes('retail')) {
    return ['Complementary Accessories', 'Fast-moving Shelf Items', 'Packaged Gift Merchandise'];
  }

  return ['Commercial Wholesale Stock', 'Category Accessories', 'Seasonal Inventory Items'];
}
