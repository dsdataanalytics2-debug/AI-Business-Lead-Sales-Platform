/**
 * Discovery Recommendation Engine
 *
 * Pure deterministic engine for synthesizing actionable targeting recommendations
 * from verified historical cohort performance.
 *
 * Rules:
 * - Minimum cohort size: N >= 5 meaningful contacted observations for conversion/reply recommendations.
 * - If N < 5, status is strictly INSUFFICIENT_DATA.
 * - No fabricated winners on sample sizes < 5 or ties.
 * - If fallback AI targeting suggestions are provided, they MUST NOT have historical rates attached.
 */

import type {
  DiscoveryRecommendationDto,
  RecommendationResponseDto,
  LearningCohortObservation
} from '@leadmate/shared';

export const MINIMUM_COHORT_OBSERVATIONS = 5;

export interface RecommenderInputOptions {
  cohorts: LearningCohortObservation[];
  targetProductId?: string;
  idealBuyerProfileFallback?: {
    primaryBuyerTypes?: string[];
    targetMarkets?: string[];
    recommendedPitchAngles?: string[];
  } | null;
}

export function generateDiscoveryRecommendations(
  options: RecommenderInputOptions
): RecommendationResponseDto {
  const { cohorts, idealBuyerProfileFallback } = options;
  const recommendations: DiscoveryRecommendationDto[] = [];

  // Group cohorts by dimension type
  const cohortsByType = new Map<string, LearningCohortObservation[]>();
  for (const c of cohorts) {
    const list = cohortsByType.get(c.dimensionType) || [];
    list.push(c);
    cohortsByType.set(c.dimensionType, list);
  }

  // 1. BUYER CATEGORY RECOMMENDATION
  const buyerCatCohorts = cohortsByType.get('BUYER_CATEGORY') || [];
  const qualifiedBuyerCats = buyerCatCohorts.filter(
    (c) => c.contactedBuyers >= MINIMUM_COHORT_OBSERVATIONS
  );

  if (qualifiedBuyerCats.length > 0) {
    // Sort by conversionRate descending, then interestRate, then contactedBuyers count
    qualifiedBuyerCats.sort((a, b) => {
      if (b.conversionRate !== a.conversionRate) return b.conversionRate - a.conversionRate;
      if (b.interestRate !== a.interestRate) return b.interestRate - a.interestRate;
      return b.contactedBuyers - a.contactedBuyers;
    });

    const best = qualifiedBuyerCats[0];
    const convPct = Math.round(best.conversionRate * 100);
    const intPct = Math.round(best.interestRate * 100);

    recommendations.push({
      id: `rec-buyer-cat-${best.dimensionValue.toLowerCase().replace(/\s+/g, '-')}`,
      recommendationType: 'BUYER_CATEGORY',
      recommendedValue: best.dimensionValue,
      status: 'READY',
      sampleSize: best.contactedBuyers,
      supportingMetrics: {
        contactedCount: best.contactedBuyers,
        conversionRate: best.conversionRate,
        interestRate: best.interestRate,
        wonCount: best.wonBuyers,
        buyersFound: best.buyersFound
      },
      reason: `Demonstrated ${convPct}% conversion rate and ${intPct}% interest rate across ${best.contactedBuyers} verified contacted buyers.`,
      disclaimer: `Advisory recommendation based on n=${best.contactedBuyers} contacted historical buyers. Market dynamics may vary.`,
      aiTargetingFallback: null
    });
  } else {
    // Insufficient data fallback
    const fallbackVal = idealBuyerProfileFallback?.primaryBuyerTypes?.[0] || 'Wholesale Buyers';
    recommendations.push({
      id: 'rec-buyer-cat-insufficient',
      recommendationType: 'BUYER_CATEGORY',
      recommendedValue: fallbackVal,
      status: 'INSUFFICIENT_DATA',
      sampleSize: buyerCatCohorts.reduce((acc, c) => acc + c.contactedBuyers, 0),
      supportingMetrics: {},
      reason: `Historical contacted cohort size is below minimum threshold (N < ${MINIMUM_COHORT_OBSERVATIONS}). Showing catalog suggestion.`,
      disclaimer: 'AI Targeting Suggestion: Prediction only — not verified commercial performance. No historical rates attached.',
      aiTargetingFallback: fallbackVal
    });
  }

  // 2. LOCATION RECOMMENDATION
  const locCohorts = cohortsByType.get('LOCATION') || [];
  const qualifiedLocs = locCohorts.filter(
    (c) => c.contactedBuyers >= MINIMUM_COHORT_OBSERVATIONS
  );

  if (qualifiedLocs.length > 0) {
    qualifiedLocs.sort((a, b) => {
      if (b.conversionRate !== a.conversionRate) return b.conversionRate - a.conversionRate;
      if (b.replyRate !== a.replyRate) return b.replyRate - a.replyRate;
      return b.contactedBuyers - a.contactedBuyers;
    });

    const best = qualifiedLocs[0];
    const convPct = Math.round(best.conversionRate * 100);
    const replyPct = Math.round(best.replyRate * 100);

    recommendations.push({
      id: `rec-loc-${best.dimensionValue.toLowerCase().replace(/\s+/g, '-')}`,
      recommendationType: 'LOCATION',
      recommendedValue: best.dimensionValue,
      status: 'READY',
      sampleSize: best.contactedBuyers,
      supportingMetrics: {
        contactedCount: best.contactedBuyers,
        conversionRate: best.conversionRate,
        replyRate: best.replyRate,
        wonCount: best.wonBuyers,
        buyersFound: best.buyersFound
      },
      reason: `Achieved ${convPct}% conversion rate and ${replyPct}% reply rate across ${best.contactedBuyers} contacted buyers in this territory.`,
      disclaimer: `Advisory recommendation based on n=${best.contactedBuyers} contacted buyers.`,
      aiTargetingFallback: null
    });
  } else {
    const fallbackLoc = idealBuyerProfileFallback?.targetMarkets?.[0] || 'Dhaka, Bangladesh';
    recommendations.push({
      id: 'rec-loc-insufficient',
      recommendationType: 'LOCATION',
      recommendedValue: fallbackLoc,
      status: 'INSUFFICIENT_DATA',
      sampleSize: locCohorts.reduce((acc, c) => acc + c.contactedBuyers, 0),
      supportingMetrics: {},
      reason: `Fewer than ${MINIMUM_COHORT_OBSERVATIONS} contacted buyer observations in any single location cohort.`,
      disclaimer: 'AI Targeting Suggestion: Suggested regional market. Requires empirical contact verification.',
      aiTargetingFallback: fallbackLoc
    });
  }

  // 3. SOURCE RECOMMENDATION
  const srcCohorts = cohortsByType.get('PRIMARY_SOURCE') || [];
  const qualifiedSources = srcCohorts.filter(
    (c) => c.contactedBuyers >= MINIMUM_COHORT_OBSERVATIONS
  );

  if (qualifiedSources.length > 0) {
    qualifiedSources.sort((a, b) => {
      if (b.conversionRate !== a.conversionRate) return b.conversionRate - a.conversionRate;
      if (b.contactabilityRate !== a.contactabilityRate) return b.contactabilityRate - a.contactabilityRate;
      return b.contactedBuyers - a.contactedBuyers;
    });

    const best = qualifiedSources[0];
    const convPct = Math.round(best.conversionRate * 100);
    const contactablePct = Math.round(best.contactabilityRate * 100);

    recommendations.push({
      id: `rec-source-${best.dimensionValue.toLowerCase().replace(/\s+/g, '-')}`,
      recommendationType: 'SOURCE',
      recommendedValue: best.dimensionValue,
      status: 'READY',
      sampleSize: best.contactedBuyers,
      supportingMetrics: {
        contactedCount: best.contactedBuyers,
        conversionRate: best.conversionRate,
        replyRate: best.replyRate,
        wonCount: best.wonBuyers,
        buyersFound: best.buyersFound
      },
      reason: `Highest converting primary discovery provider with ${convPct}% conversion and ${contactablePct}% contactability rate across ${best.contactedBuyers} contacted buyers.`,
      disclaimer: `Primary attribution credit basis with sample size n=${best.contactedBuyers}.`,
      aiTargetingFallback: null
    });
  } else {
    recommendations.push({
      id: 'rec-source-insufficient',
      recommendationType: 'SOURCE',
      recommendedValue: 'OpenStreetMap',
      status: 'INSUFFICIENT_DATA',
      sampleSize: srcCohorts.reduce((acc, c) => acc + c.contactedBuyers, 0),
      supportingMetrics: {},
      reason: `Insufficient verified outreach outcomes (N < ${MINIMUM_COHORT_OBSERVATIONS}) to rank primary discovery sources.`,
      disclaimer: 'Source suggestion based on default configured providers.',
      aiTargetingFallback: 'OpenStreetMap'
    });
  }

  // 4. PITCH ANGLE (Optional - only if historical pitch angle cohorts exist)
  const pitchCohorts = cohortsByType.get('PITCH_ANGLE') || [];
  const qualifiedPitches = pitchCohorts.filter(
    (c) => c.contactedBuyers >= MINIMUM_COHORT_OBSERVATIONS
  );

  if (qualifiedPitches.length > 0) {
    qualifiedPitches.sort((a, b) => b.conversionRate - a.conversionRate);
    const best = qualifiedPitches[0];
    recommendations.push({
      id: `rec-pitch-${best.dimensionValue.toLowerCase().replace(/\s+/g, '-')}`,
      recommendationType: 'PITCH_ANGLE',
      recommendedValue: best.dimensionValue,
      status: 'READY',
      sampleSize: best.contactedBuyers,
      supportingMetrics: {
        contactedCount: best.contactedBuyers,
        conversionRate: best.conversionRate,
        replyRate: best.replyRate,
        wonCount: best.wonBuyers
      },
      reason: `Historical pitch angle achieved highest engagement (${Math.round(best.conversionRate * 100)}% conversion).`,
      disclaimer: `Based on n=${best.contactedBuyers} verified responses.`,
      aiTargetingFallback: null
    });
  }

  const hasSufficientData = recommendations.some((r) => r.status === 'READY');

  return {
    recommendations,
    minimumCohortSize: MINIMUM_COHORT_OBSERVATIONS,
    evaluatedCohortsCount: cohorts.length,
    hasSufficientData
  };
}
