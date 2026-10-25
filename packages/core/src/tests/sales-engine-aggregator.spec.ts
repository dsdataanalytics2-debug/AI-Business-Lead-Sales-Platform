import { describe, it, expect } from 'vitest';
import {
  computeDashboardKpis,
  computeSourceEffectiveness,
  computeProductAnalytics,
  aggregateLearningLoopCohorts,
  isBuyerContactable,
  isBuyerContacted,
  hasBuyerReplied,
  isBuyerInterested,
  type BuyerAnalyticsRecord
} from '../analytics/sales-engine-aggregator.js';

describe('SalesEngineAggregator', () => {
  const createMockBuyer = (overrides: Partial<BuyerAnalyticsRecord> = {}): BuyerAnalyticsRecord => ({
    id: 'buyer-1',
    organizationId: 'org-1',
    salesMissionId: 'mission-1',
    externalBusinessId: 'ext-1',
    provider: 'openstreetmap',
    businessName: 'Apex Wholesale Mart',
    conversionStage: 'DISCOVERED',
    ...overrides
  });

  describe('Contactability (Strict PHONE != WHATSAPP)', () => {
    it('recognizes verified phone or website as contactable', () => {
      expect(isBuyerContactable(createMockBuyer({ phone: '+8801711000000' }))).toBe(true);
      expect(isBuyerContactable(createMockBuyer({ website: 'https://apexmart.com' }))).toBe(true);
    });

    it('requires whatsappStatus = EXPLICIT_VERIFIED for WhatsApp contactability', () => {
      // Unverified whatsapp does NOT count
      expect(isBuyerContactable(createMockBuyer({ whatsappStatus: 'NOT_VERIFIED' }))).toBe(false);
      expect(isBuyerContactable(createMockBuyer({ whatsappStatus: 'UNCHECKED' }))).toBe(false);
      // EXPLICIT_VERIFIED counts
      expect(isBuyerContactable(createMockBuyer({ whatsappStatus: 'EXPLICIT_VERIFIED' }))).toBe(true);
    });

    it('returns false when no legitimate contact channel exists', () => {
      expect(isBuyerContactable(createMockBuyer())).toBe(false);
    });
  });

  describe('Approval != Contacted (Reply Rate Denominator)', () => {
    it('does NOT count APPROVED drafts as contacted buyers', () => {
      const buyerWithApprovedDraft = createMockBuyer({
        id: 'buyer-approved-only',
        conversionStage: 'DISCOVERED',
        outreachDrafts: [{ channel: 'EMAIL', status: 'APPROVED' }]
      });

      expect(isBuyerContacted(buyerWithApprovedDraft)).toBe(false);

      const kpis = computeDashboardKpis([buyerWithApprovedDraft], 1, 1);
      expect(kpis.contactedBuyers).toBe(0);
      expect(kpis.replyRate).toBe(0); // Zero denominator = 0, no NaN
    });

    it('counts buyers with actual contact evidence (conversionStage >= CONTACTED or outbound interaction)', () => {
      const buyerContacted = createMockBuyer({
        id: 'buyer-contacted',
        conversionStage: 'CONTACTED'
      });
      const buyerWithOutbound = createMockBuyer({
        id: 'buyer-outbound',
        conversionStage: 'DISCOVERED',
        interactions: [{ direction: 'OUTBOUND', channel: 'EMAIL' }]
      });

      expect(isBuyerContacted(buyerContacted)).toBe(true);
      expect(isBuyerContacted(buyerWithOutbound)).toBe(true);
    });

    it('calculates reply rate strictly as buyers with inbound reply / contacted buyers', () => {
      const b1 = createMockBuyer({ id: 'b1', conversionStage: 'CONTACTED' });
      const b2 = createMockBuyer({
        id: 'b2',
        conversionStage: 'REPLIED',
        interactions: [{ direction: 'INBOUND', channel: 'EMAIL', classification: 'INTERESTED' }]
      });
      const b3Uncontacted = createMockBuyer({ id: 'b3', conversionStage: 'DISCOVERED' });

      const kpis = computeDashboardKpis([b1, b2, b3Uncontacted], 1, 1);
      expect(kpis.uniqueBuyers).toBe(3);
      expect(kpis.contactedBuyers).toBe(2); // b1 and b2
      expect(kpis.repliedBuyers).toBe(1); // b2
      expect(kpis.replyRate).toBe(0.5); // 1 / 2
    });
  });

  describe('Interest & Conversion Rates', () => {
    it('calculates interest rate using qualifying categories on unique replied buyers', () => {
      const b1 = createMockBuyer({
        id: 'b1',
        conversionStage: 'REPLIED',
        interactions: [{ direction: 'INBOUND', channel: 'EMAIL', classification: 'PRICE_REQUEST' }]
      });
      const b2 = createMockBuyer({
        id: 'b2',
        conversionStage: 'REPLIED',
        interactions: [{ direction: 'INBOUND', channel: 'EMAIL', classification: 'NOT_INTERESTED' }]
      });

      const kpis = computeDashboardKpis([b1, b2], 1, 1);
      expect(kpis.repliedBuyers).toBe(2);
      expect(kpis.interestedBuyers).toBe(1);
      expect(kpis.interestRate).toBe(0.5);
    });

    it('calculates verified WON conversion rate against contacted denominator', () => {
      const b1 = createMockBuyer({
        id: 'b1',
        conversionStage: 'WON',
        conversionWonEvidence: { dealValue: 50000, currency: 'BDT' }
      });
      const b2 = createMockBuyer({ id: 'b2', conversionStage: 'CONTACTED' });

      const kpis = computeDashboardKpis([b1, b2], 1, 1);
      expect(kpis.contactedBuyers).toBe(2);
      expect(kpis.wonBuyers).toBe(1);
      expect(kpis.conversionRate).toBe(0.5);
    });
  });

  describe('Currency & Revenue Safety', () => {
    it('groups won revenues by currency without summing BDT and USD together', () => {
      const b1 = createMockBuyer({
        id: 'b1',
        conversionStage: 'WON',
        conversionWonEvidence: { dealValue: 120000, currency: 'BDT' }
      });
      const b2 = createMockBuyer({
        id: 'b2',
        conversionStage: 'WON',
        conversionWonEvidence: { dealValue: 2000, currency: 'USD' }
      });

      const kpis = computeDashboardKpis([b1, b2], 1, 1);
      expect(kpis.wonValueByCurrency).toEqual({
        BDT: 120000,
        USD: 2000
      });
      expect(kpis.averageDealValueByCurrency).toEqual({
        BDT: 120000,
        USD: 2000
      });
    });

    it('computes AOV per currency accurately across multiple deals', () => {
      const b1 = createMockBuyer({
        id: 'b1',
        conversionStage: 'WON',
        conversionWonEvidence: { dealValue: 100000, currency: 'BDT' }
      });
      const b2 = createMockBuyer({
        id: 'b2',
        conversionStage: 'WON',
        conversionWonEvidence: { dealValue: 200000, currency: 'BDT' }
      });
      const b3 = createMockBuyer({
        id: 'b3',
        conversionStage: 'WON',
        conversionWonEvidence: { dealValue: 5000, currency: 'USD' }
      });

      const kpis = computeDashboardKpis([b1, b2, b3], 1, 1);
      expect(kpis.wonValueByCurrency.BDT).toBe(300000);
      expect(kpis.averageDealValueByCurrency.BDT).toBe(150000); // 300000 / 2
      expect(kpis.wonValueByCurrency.USD).toBe(5000);
      expect(kpis.averageDealValueByCurrency.USD).toBe(5000);
    });
  });

  describe('Multi-Source Attribution', () => {
    it('credits primary source for won and deal value, and secondary as assisted only', () => {
      const multiSourceWonBuyer = createMockBuyer({
        id: 'b-multi-1',
        provider: 'google-places', // PRIMARY
        conversionStage: 'WON',
        conversionWonEvidence: { dealValue: 75000, currency: 'BDT' },
        sourceEvidences: [
          { provider: 'google-places' },
          { provider: 'openstreetmap' }, // ASSISTED
          { provider: 'company-website' } // ASSISTED
        ]
      });

      const effectiveness = computeSourceEffectiveness([multiSourceWonBuyer]);

      const gp = effectiveness.find((e) => e.provider === 'google-places')!;
      expect(gp.primaryBuyersFound).toBe(1);
      expect(gp.wonBuyers).toBe(1);
      expect(gp.wonValueByCurrency.BDT).toBe(75000);
      expect(gp.assistedBuyerCount).toBe(0);

      const osm = effectiveness.find((e) => e.provider === 'openstreetmap')!;
      expect(osm.primaryBuyersFound).toBe(0);
      expect(osm.wonBuyers).toBe(0); // Must NOT get WON credit
      expect(osm.assistedBuyerCount).toBe(1); // Receives assisted credit

      const web = effectiveness.find((e) => e.provider === 'company-website')!;
      expect(web.primaryBuyersFound).toBe(0);
      expect(web.wonBuyers).toBe(0);
      expect(web.assistedBuyerCount).toBe(1);
      expect(web.sourceType).toBe('ENRICHMENT');

      const fbLead = effectiveness.find((e) => e.provider === 'facebook-lead-ads')!;
      expect(fbLead.sourceType).toBe('INBOUND_LEADS');
      expect(fbLead.inboundLeadsCount).toBe(0);
    });

    it('honestly reports NOT_CONFIGURED status for unconfigured providers without artificial conclusions', () => {
      const effectiveness = computeSourceEffectiveness([], {
        'facebook-business': 'NOT_CONFIGURED',
        'tiktok-business': 'NOT_CONFIGURED'
      });

      const fb = effectiveness.find((e) => e.provider === 'facebook-business')!;
      expect(fb.status).toBe('NOT_CONFIGURED');
      expect(fb.statusMessage).toContain('not configured');
      expect(fb.primaryBuyersFound).toBe(0);
      expect(fb.sourceType).toBe('ENRICHMENT');
    });
  });

  describe('Learning Loop Cohort Aggregator', () => {
    it('groups historical buyer records across categories, locations, and wholesale intent', () => {
      const b1 = createMockBuyer({
        id: 'b1',
        matchedBuyerCategory: 'Hardware Wholesalers',
        city: 'Dhaka',
        wholesaleIntent: 'HIGH',
        conversionStage: 'WON',
        conversionWonEvidence: { dealValue: 80000, currency: 'BDT' }
      });
      const b2 = createMockBuyer({
        id: 'b2',
        matchedBuyerCategory: 'Hardware Wholesalers',
        city: 'Dhaka',
        wholesaleIntent: 'HIGH',
        conversionStage: 'CONTACTED'
      });

      const cohorts = aggregateLearningLoopCohorts([b1, b2]);

      const catCohort = cohorts.find(
        (c) => c.dimensionType === 'BUYER_CATEGORY' && c.dimensionValue === 'Hardware Wholesalers'
      );
      expect(catCohort).toBeDefined();
      expect(catCohort?.buyersFound).toBe(2);
      expect(catCohort?.contactedBuyers).toBe(2);
      expect(catCohort?.wonBuyers).toBe(1);
      expect(catCohort?.conversionRate).toBe(0.5);

      const locCohort = cohorts.find(
        (c) => c.dimensionType === 'LOCATION' && c.dimensionValue === 'Dhaka'
      );
      expect(locCohort).toBeDefined();
      expect(locCohort?.buyersFound).toBe(2);

      const intentCohort = cohorts.find(
        (c) => c.dimensionType === 'WHOLESALE_INTENT' && c.dimensionValue === 'HIGH'
      );
      expect(intentCohort).toBeDefined();
    });
  });
});
