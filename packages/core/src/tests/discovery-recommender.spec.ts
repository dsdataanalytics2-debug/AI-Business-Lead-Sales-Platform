import { describe, it, expect } from 'vitest';
import {
  generateDiscoveryRecommendations,
  MINIMUM_COHORT_OBSERVATIONS
} from '../analytics/discovery-recommender.js';
import type { LearningCohortObservation } from '@leadmate/shared';

describe('DiscoveryRecommender', () => {
  const createMockCohort = (
    overrides: Partial<LearningCohortObservation> = {}
  ): LearningCohortObservation => ({
    dimensionKey: 'BUYER_CATEGORY:Wholesale Supermarkets',
    dimensionType: 'BUYER_CATEGORY',
    dimensionValue: 'Wholesale Supermarkets',
    observationCount: 10,
    buyersFound: 10,
    contactableBuyers: 10,
    contactedBuyers: 10,
    buyersReplied: 5,
    interestedBuyers: 4,
    negotiatingBuyers: 3,
    wonBuyers: 2,
    lostBuyers: 1,
    replyRate: 0.5,
    interestRate: 0.8,
    conversionRate: 0.2,
    contactabilityRate: 1.0,
    dealValueByCurrency: { BDT: 150000 },
    averageDealValueByCurrency: { BDT: 75000 },
    ...overrides
  });

  describe('Insufficient Data Guard (N < 5)', () => {
    it('returns INSUFFICIENT_DATA when cohort contacted buyers is less than 5', () => {
      const smallCohort = createMockCohort({
        dimensionType: 'BUYER_CATEGORY',
        dimensionValue: 'Boutique Retailers',
        contactedBuyers: 3, // N = 3 < 5
        wonBuyers: 3,
        conversionRate: 1.0
      });

      const res = generateDiscoveryRecommendations({
        cohorts: [smallCohort],
        idealBuyerProfileFallback: {
          primaryBuyerTypes: ['Suggested General Stores']
        }
      });

      const buyerCatRec = res.recommendations.find(
        (r) => r.recommendationType === 'BUYER_CATEGORY'
      );
      expect(buyerCatRec).toBeDefined();
      expect(buyerCatRec?.status).toBe('INSUFFICIENT_DATA');
      expect(buyerCatRec?.sampleSize).toBe(3);
      expect(buyerCatRec?.supportingMetrics).toEqual({});
      expect(buyerCatRec?.aiTargetingFallback).toBe('Suggested General Stores');
      // Must not attach historical 100% rate to an unverified small sample
      expect(buyerCatRec?.reason).toContain(`below minimum threshold (N < ${MINIMUM_COHORT_OBSERVATIONS})`);
      expect(res.hasSufficientData).toBe(false);
    });

    it('does not treat 5 discovered-but-never-contacted buyers as sufficient conversion evidence', () => {
      const discoveredOnlyCohort = createMockCohort({
        dimensionType: 'BUYER_CATEGORY',
        dimensionValue: 'Online Resellers',
        buyersFound: 8,
        contactableBuyers: 6,
        contactedBuyers: 0, // Never contacted!
        wonBuyers: 0
      });

      const res = generateDiscoveryRecommendations({
        cohorts: [discoveredOnlyCohort]
      });

      const buyerCatRec = res.recommendations.find(
        (r) => r.recommendationType === 'BUYER_CATEGORY'
      );
      expect(buyerCatRec?.status).toBe('INSUFFICIENT_DATA');
    });
  });

  describe('Sufficient Data Cohort (N >= 5)', () => {
    it('returns READY recommendation with sample size and supporting metrics when N >= 5', () => {
      const robustCohort = createMockCohort({
        dimensionType: 'BUYER_CATEGORY',
        dimensionValue: 'Department Stores',
        contactedBuyers: 12, // N = 12 >= 5
        buyersReplied: 6,
        interestedBuyers: 5,
        wonBuyers: 3,
        conversionRate: 0.25,
        interestRate: 0.833
      });

      const res = generateDiscoveryRecommendations({
        cohorts: [robustCohort]
      });

      const buyerCatRec = res.recommendations.find(
        (r) => r.recommendationType === 'BUYER_CATEGORY'
      );
      expect(buyerCatRec).toBeDefined();
      expect(buyerCatRec?.status).toBe('READY');
      expect(buyerCatRec?.recommendedValue).toBe('Department Stores');
      expect(buyerCatRec?.sampleSize).toBe(12);
      expect(buyerCatRec?.supportingMetrics.conversionRate).toBe(0.25);
      expect(buyerCatRec?.supportingMetrics.contactedCount).toBe(12);
      expect(buyerCatRec?.reason).toContain('25% conversion rate');
      expect(buyerCatRec?.disclaimer).toContain('n=12');
      expect(res.hasSufficientData).toBe(true);
    });

    it('ranks and picks the highest converting qualified cohort when multiple cohorts exist', () => {
      const cohortA = createMockCohort({
        dimensionKey: 'LOCATION:Chittagong',
        dimensionType: 'LOCATION',
        dimensionValue: 'Chittagong',
        contactedBuyers: 10,
        wonBuyers: 1,
        conversionRate: 0.1,
        replyRate: 0.3
      });

      const cohortB = createMockCohort({
        dimensionKey: 'LOCATION:Dhaka',
        dimensionType: 'LOCATION',
        dimensionValue: 'Dhaka',
        contactedBuyers: 15,
        wonBuyers: 6,
        conversionRate: 0.4,
        replyRate: 0.6
      });

      const res = generateDiscoveryRecommendations({
        cohorts: [cohortA, cohortB]
      });

      const locRec = res.recommendations.find((r) => r.recommendationType === 'LOCATION');
      expect(locRec?.status).toBe('READY');
      expect(locRec?.recommendedValue).toBe('Dhaka');
      expect(locRec?.sampleSize).toBe(15);
      expect(locRec?.supportingMetrics.conversionRate).toBe(0.4);
    });
  });
});
