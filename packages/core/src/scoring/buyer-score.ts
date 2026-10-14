/**
 * Pure Buyer Scoring Domain Engine (0–100)
 *
 * Implements deterministic advisory scoring for commercial wholesale buyer candidates.
 *
 * Components (0–100 each):
 * 1. Product Fit: Alignment between buyer characteristics and product keywords/category.
 * 2. Buyer Category Match: Direct alignment with primary vs secondary buyer categories.
 * 3. Location Fit: Alignment with target market and sub-area bounds.
 * 4. Contactability: Concrete presence of verified public business contacts (phone, website, address).
 * 5. Source Confidence: Data provenance quality and completeness (baseline for directory providers).
 *
 * INVARIANTS:
 * - Pure function: Zero side effects, zero network calls, zero LLMs.
 * - Deterministic: Same inputs always produce identical scores and breakdowns.
 * - Advisory: Scores are decision-support indicators, never autonomous facts.
 * - PHONE != WHATSAPP: Contactability evaluates phone presence without WhatsApp inference.
 */

export interface BuyerCandidateInput {
  businessName: string;
  category?: string | null;
  matchedBuyerCategory?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  website?: string | null;
  provider?: string | null;
  externalBusinessId?: string | null;
  sourceEvidences?: Array<{ sourceType?: string; sourceName?: string }> | null;
  enrichedContacts?: Array<{ type?: string; value?: string }> | null;
}

export interface ProductContextInput {
  productName: string;
  productDescription?: string | null;
  productCategory?: string | null;
  targetMarket: string;
  primaryCategories?: string[];
  secondaryCategories?: string[];
}

export interface BuyerScoreBreakdown {
  productFit: number;
  categoryMatch: number;
  locationFit: number;
  contactability: number;
  sourceConfidence: number;
}

export interface BuyerScoreResult {
  buyerScore: number;
  breakdown: BuyerScoreBreakdown;
  advisoryNote: string;
}

/**
 * Normalizes text for keyword matching.
 */
function clean(str?: string | null): string {
  return (str || '').toLowerCase().trim();
}

/**
 * Computes Product Fit (0–100)
 */
export function computeProductFit(
  buyer: BuyerCandidateInput,
  context: ProductContextInput
): number {
  const prodName = clean(context.productName);
  const prodCat = clean(context.productCategory);
  const buyerName = clean(buyer.businessName);
  const buyerCat = clean(buyer.category || buyer.matchedBuyerCategory);

  if (!prodName && !prodCat) return 60;

  // Extract distinct meaningful keywords from product name (length >= 3)
  const prodTokens = prodName
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/gi, ''))
    .filter((t) => t.length >= 3);

  let tokenHits = 0;
  for (const token of prodTokens) {
    if (buyerName.includes(token) || buyerCat.includes(token)) {
      tokenHits++;
    }
  }

  // Check category alignment
  const categoryAligned =
    Boolean(prodCat) && (buyerCat.includes(prodCat) || buyerName.includes(prodCat));

  if (tokenHits >= 2 || (tokenHits >= 1 && categoryAligned)) {
    return 95;
  }
  if (tokenHits >= 1 || categoryAligned) {
    return 88;
  }

  // Check if buyer category matches any primary target
  const primaryMatch = (context.primaryCategories || []).some((pc) => {
    const c = clean(pc);
    return c && (buyerCat.includes(c) || buyerName.includes(c));
  });
  if (primaryMatch) {
    return 82;
  }

  // Check secondary category match
  const secondaryMatch = (context.secondaryCategories || []).some((sc) => {
    const c = clean(sc);
    return c && (buyerCat.includes(c) || buyerName.includes(c));
  });
  if (secondaryMatch) {
    return 74;
  }

  return 60;
}

/**
 * Computes Buyer Category Match (0–100)
 */
export function computeCategoryMatch(
  buyer: BuyerCandidateInput,
  context: ProductContextInput
): number {
  const buyerCat = clean(buyer.matchedBuyerCategory || buyer.category);
  const primary = (context.primaryCategories || []).map(clean).filter(Boolean);
  const secondary = (context.secondaryCategories || []).map(clean).filter(Boolean);

  if (!buyerCat) {
    return 55;
  }

  // Check exact or substring match in primary categories
  const isPrimary = primary.some((p) => buyerCat === p || buyerCat.includes(p) || p.includes(buyerCat));
  if (isPrimary) {
    return 100;
  }

  // Check exact or substring match in secondary categories
  const isSecondary = secondary.some((s) => buyerCat === s || buyerCat.includes(s) || s.includes(buyerCat));
  if (isSecondary) {
    return 82;
  }

  // If buyer has a category but outside explicit targets
  return 65;
}

/**
 * Computes Location Fit (0–100)
 */
export function computeLocationFit(
  buyer: BuyerCandidateInput,
  context: ProductContextInput
): number {
  const target = clean(context.targetMarket);
  const buyerCity = clean(buyer.city);
  const buyerAddress = clean(buyer.address);

  if (!target) return 75;

  // Exact target match in city or address
  if (buyerCity === target || (buyerAddress && buyerAddress.includes(target))) {
    return 95;
  }

  // If target is in city or address contains city
  if (buyerCity && target.includes(buyerCity)) {
    return 90;
  }

  // If address contains any word from target market
  const targetWords = target.split(/\s+/).filter((w) => w.length >= 3);
  const hasWordMatch = targetWords.some((w) => buyerAddress.includes(w) || buyerCity.includes(w));
  if (hasWordMatch) {
    return 85;
  }

  // If location is provided but different
  if (buyerCity || buyerAddress) {
    return 60;
  }

  // Unspecified location
  return 50;
}

/**
 * Computes Contactability (0–100)
 * Evaluates public reachability without inferring WhatsApp.
 */
export function computeContactability(buyer: BuyerCandidateInput): number {
  let score = 20; // baseline for identified business entity

  if (buyer.phone && buyer.phone.trim().length >= 6) {
    score += 40;
  }
  if (buyer.website && buyer.website.trim().length >= 4) {
    score += 25;
  }
  if (buyer.address && buyer.address.trim().length >= 5) {
    score += 15;
  }

  return Math.min(score, 100);
}

/**
 * Classifies numeric source confidence into canonical categorical level.
 */
export function getSourceConfidenceLevel(
  score: number
): 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW' {
  if (score >= 90) return 'VERY_HIGH';
  if (score >= 80) return 'HIGH';
  if (score >= 65) return 'MEDIUM';
  return 'LOW';
}

/**
 * Computes Source Confidence (0–100)
 * Evaluates multi-source provenance:
 * - Single directory source: MEDIUM (65–75)
 * - Directory + Company Website: HIGH (85)
 * - Directory + Website + Social / Multi-Source: VERY_HIGH (95)
 */
export function computeSourceConfidence(buyer: BuyerCandidateInput): number {
  // If structured source evidences exist, evaluate multi-source provenance
  if (buyer.sourceEvidences && Array.isArray(buyer.sourceEvidences) && buyer.sourceEvidences.length > 0) {
    const distinctTypes = new Set<string>();
    for (const ev of buyer.sourceEvidences) {
      if (ev.sourceType) {
        distinctTypes.add(ev.sourceType.toUpperCase().trim());
      } else if (ev.sourceName) {
        distinctTypes.add(ev.sourceName.toUpperCase().trim());
      }
    }

    if (distinctTypes.size >= 3) {
      return 95; // VERY_HIGH: 3+ independent sources (e.g., Google Places + Website + Social)
    }
    if (distinctTypes.size === 2) {
      return 85; // HIGH: 2 verified sources (e.g., Directory + Company Website)
    }
    // Single source with evidence
    if (buyer.phone && buyer.website) {
      return 78;
    }
    return 70; // MEDIUM: verified single source
  }

  // Fallback heuristic for single-source discovery records
  let score = 65; // baseline known provider listing

  if (buyer.externalBusinessId) {
    score += 15;
  }
  if (buyer.provider && buyer.provider.toLowerCase() !== 'mock') {
    score += 10;
  }
  if (buyer.phone && buyer.website) {
    score += 10;
  }

  return Math.min(score, 100);
}

/**
 * Computes the overall composite Buyer Score (0–100) and structured breakdown.
 *
 * Weightings:
 * - Product Fit: 30%
 * - Category Match: 25%
 * - Contactability: 20%
 * - Location Fit: 15%
 * - Source Confidence: 10%
 */
export function computeBuyerScore(
  buyer: BuyerCandidateInput,
  context: ProductContextInput
): BuyerScoreResult {
  const productFit = computeProductFit(buyer, context);
  const categoryMatch = computeCategoryMatch(buyer, context);
  const locationFit = computeLocationFit(buyer, context);
  const contactability = computeContactability(buyer);
  const sourceConfidence = computeSourceConfidence(buyer);

  const rawWeightedScore =
    productFit * 0.3 +
    categoryMatch * 0.25 +
    contactability * 0.2 +
    locationFit * 0.15 +
    sourceConfidence * 0.1;

  const buyerScore = Math.min(100, Math.max(0, Math.round(rawWeightedScore)));

  const breakdown: BuyerScoreBreakdown = {
    productFit,
    categoryMatch,
    locationFit,
    contactability,
    sourceConfidence
  };

  let advisoryNote = 'Standard buyer fit';
  if (buyerScore >= 85) {
    advisoryNote = 'Strong commercial fit with high contactability';
  } else if (buyerScore >= 70) {
    advisoryNote = 'Moderate wholesale fit; review contact details';
  } else {
    advisoryNote = 'Low match or incomplete business profile';
  }

  return {
    buyerScore,
    breakdown,
    advisoryNote
  };
}
