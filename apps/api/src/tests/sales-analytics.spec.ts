import { describe, it, expect, beforeEach } from 'vitest';
import prisma from '@leadmate/db';
import { salesAnalyticsService } from '../services/sales-analytics.service.js';
import { SalesMissionGoal, SalesMissionStatus } from '@leadmate/shared';

describe('SalesAnalyticsService Integration & Tenant Isolation', () => {
  let orgA: any;
  let userA: any;
  let productA: any;
  let missionA: any;

  let orgB: any;
  let userB: any;
  let productB: any;

  beforeEach(async () => {
    // Tenant A
    orgA = await prisma.organization.create({
      data: { name: `Tenant A Org ${Date.now()}` }
    });

    userA = await prisma.user.create({
      data: {
        organizationId: orgA.id,
        email: `user-a-${Date.now()}@tenant-a.local`,
        passwordHash: 'dummy',
        name: 'User A',
        role: 'ADMIN'
      }
    });

    productA = await prisma.product.create({
      data: {
        organizationId: orgA.id,
        name: 'Acoustic Desk Lamp',
        category: 'Office Lighting',
        description: 'Modern sound-absorbing LED desk lamp',
        currency: 'BDT',
        sellingPrice: 4500
      }
    });

    missionA = await prisma.salesMission.create({
      data: {
        organizationId: orgA.id,
        createdByUserId: userA.id,
        productId: productA.id,
        name: 'Desk Lamp Wholesale Outreach',
        goal: SalesMissionGoal.WHOLESALE,
        targetMarket: 'Dhaka',
        buyerType: 'AI_DECIDE',
        resultTarget: 20,
        status: SalesMissionStatus.READY,
        productAnalysisSnapshot: {
          productCategory: 'Office Lighting',
          idealBuyerProfile: {
            primaryBuyerTypes: ['Office Supply Distributors'],
            targetMarkets: ['Dhaka'],
            recommendedPitchAngles: ['B2B bulk discounts']
          }
        }
      }
    });

    // Tenant B (for cross-tenant leakage testing)
    orgB = await prisma.organization.create({
      data: { name: `Tenant B Org ${Date.now()}` }
    });

    userB = await prisma.user.create({
      data: {
        organizationId: orgB.id,
        email: `user-b-${Date.now()}@tenant-b.local`,
        passwordHash: 'dummy',
        name: 'User B',
        role: 'ADMIN'
      }
    });

    productB = await prisma.product.create({
      data: {
        organizationId: orgB.id,
        name: 'Tenant B Secret Product',
        category: 'Confidential',
        description: 'Tenant B secret stock',
        currency: 'USD',
        sellingPrice: 100
      }
    });
  });

  describe('Empty State Handling', () => {
    it('returns clean zeroed metrics for empty organization without errors or NaN', async () => {
      const kpis = await salesAnalyticsService.getDashboardKpis(orgB.id);

      expect(kpis.uniqueBuyers).toBe(0);
      expect(kpis.contactableBuyers).toBe(0);
      expect(kpis.contactedBuyers).toBe(0);
      expect(kpis.repliedBuyers).toBe(0);
      expect(kpis.wonBuyers).toBe(0);
      expect(kpis.replyRate).toBe(0);
      expect(kpis.conversionRate).toBe(0);
      expect(kpis.contactabilityRate).toBe(0);
      expect(kpis.wonValueByCurrency).toEqual({});
      expect(kpis.averageDealValueByCurrency).toEqual({});
    });
  });

  describe('Approval != Contacted Denominator Verification', () => {
    it('ensures APPROVED draft buyer does NOT enter reply rate denominator until actually contacted', async () => {
      // Buyer 1: Has approved draft but conversionStage is DISCOVERED (not contacted)
      const b1 = await prisma.salesMissionBuyer.create({
        data: {
          organizationId: orgA.id,
          salesMissionId: missionA.id,
          externalBusinessId: 'ext-b1',
          provider: 'openstreetmap',
          businessName: 'Uncontacted Buyer with Approved Draft',
          conversionStage: 'DISCOVERED',
          phone: '+8801700000001'
        }
      });

      await prisma.outreachDraft.create({
        data: {
          organizationId: orgA.id,
          salesMissionBuyerId: b1.id,
          salesMissionId: missionA.id,
          channel: 'EMAIL',
          status: 'APPROVED',
          body: 'Approved email draft body'
        }
      });

      // Buyer 2: Actually CONTACTED
      const b2 = await prisma.salesMissionBuyer.create({
        data: {
          organizationId: orgA.id,
          salesMissionId: missionA.id,
          externalBusinessId: 'ext-b2',
          provider: 'openstreetmap',
          businessName: 'Actually Contacted Buyer',
          conversionStage: 'CONTACTED',
          phone: '+8801700000002'
        }
      });

      // Buyer 3: Actually REPLIED with interested response
      const b3 = await prisma.salesMissionBuyer.create({
        data: {
          organizationId: orgA.id,
          salesMissionId: missionA.id,
          externalBusinessId: 'ext-b3',
          provider: 'openstreetmap',
          businessName: 'Replied Buyer',
          conversionStage: 'REPLIED',
          phone: '+8801700000003'
        }
      });

      await prisma.buyerInteraction.create({
        data: {
          organizationId: orgA.id,
          salesMissionBuyerId: b3.id,
          direction: 'INBOUND',
          channel: 'EMAIL',
          content: 'What is your MOQ and pricing for wholesale?',
          classification: 'PRICE_REQUEST'
        }
      });

      const kpis = await salesAnalyticsService.getDashboardKpis(orgA.id);

      expect(kpis.uniqueBuyers).toBe(3);
      // Denominator MUST ONLY BE 2 (b2 and b3), NOT 3! b1 has approved draft but was NOT contacted.
      expect(kpis.contactedBuyers).toBe(2);
      expect(kpis.repliedBuyers).toBe(1);
      // Reply rate = 1 replied / 2 contacted = 0.5 (Never 1 / 3 = 0.33)
      expect(kpis.replyRate).toBe(0.5);
      expect(kpis.interestedBuyers).toBe(1);
      expect(kpis.interestRate).toBe(1.0); // 1 interested / 1 replied
    });
  });

  describe('Currency-Safe Revenue and Multi-Source Attribution', () => {
    it('groups revenue by currency and attributes conversions only to primary source', async () => {
      // BDT deal on Google Places (assisted by OSM)
      await prisma.salesMissionBuyer.create({
        data: {
          organizationId: orgA.id,
          salesMissionId: missionA.id,
          externalBusinessId: 'ext-won-bdt',
          provider: 'google-places', // PRIMARY
          businessName: 'Chittagong Lighting Hub',
          conversionStage: 'WON',
          conversionWonEvidence: {
            dealValue: 120000,
            currency: 'BDT',
            closedAt: new Date().toISOString(),
            notes: 'Verified wholesale purchase order 20 units'
          },
          sourceEvidences: [
            { provider: 'google-places' },
            { provider: 'openstreetmap' } // ASSISTED
          ]
        }
      });

      // USD deal on OpenStreetMap
      await prisma.salesMissionBuyer.create({
        data: {
          organizationId: orgA.id,
          salesMissionId: missionA.id,
          externalBusinessId: 'ext-won-usd',
          provider: 'openstreetmap', // PRIMARY
          businessName: 'Global Exporters Ltd',
          conversionStage: 'WON',
          conversionWonEvidence: {
            dealValue: 2000,
            currency: 'USD',
            closedAt: new Date().toISOString(),
            notes: 'Verified international sample order'
          }
        }
      });

      const kpis = await salesAnalyticsService.getDashboardKpis(orgA.id);
      // Multi-currency safety: BDT and USD MUST NOT be combined!
      expect(kpis.wonValueByCurrency).toEqual({
        BDT: 120000,
        USD: 2000
      });

      // Source analytics
      const sources = await salesAnalyticsService.getSourceEffectiveness(orgA.id);
      const gp = sources.find((s) => s.provider === 'google-places')!;
      const osm = sources.find((s) => s.provider === 'openstreetmap')!;

      // GP is primary for BDT deal
      expect(gp.primaryBuyersFound).toBe(1);
      expect(gp.wonBuyers).toBe(1);
      expect(gp.wonValueByCurrency.BDT).toBe(120000);
      expect(gp.assistedBuyerCount).toBe(0);

      // OSM is primary for USD deal, and assisted for GP deal
      expect(osm.primaryBuyersFound).toBe(1);
      expect(osm.wonBuyers).toBe(1);
      expect(osm.wonValueByCurrency.USD).toBe(2000);
      expect(osm.wonValueByCurrency.BDT).toBeUndefined(); // Did NOT steal BDT deal!
      expect(osm.assistedBuyerCount).toBe(1); // Credited as assisted
    });
  });

  describe('Discovery Recommendations & Sample-Size Guard (N >= 5)', () => {
    it('returns INSUFFICIENT_DATA when contacted cohort size is < 5', async () => {
      // Create 3 contacted buyers (N=3 < 5)
      for (let i = 1; i <= 3; i++) {
        await prisma.salesMissionBuyer.create({
          data: {
            organizationId: orgA.id,
            salesMissionId: missionA.id,
            externalBusinessId: `ext-cohort-${i}`,
            provider: 'openstreetmap',
            businessName: `Buyer Cohort ${i}`,
            matchedBuyerCategory: 'Office Distributors',
            city: 'Dhaka',
            conversionStage: 'CONTACTED'
          }
        });
      }

      const recs = await salesAnalyticsService.getRecommendations(orgA.id, productA.id);
      expect(recs.hasSufficientData).toBe(false);

      const buyerCatRec = recs.recommendations.find((r) => r.recommendationType === 'BUYER_CATEGORY');
      expect(buyerCatRec?.status).toBe('INSUFFICIENT_DATA');
      expect(buyerCatRec?.aiTargetingFallback).toBeDefined();
    });

    it('returns READY recommendation when cohort size is >= 5', async () => {
      // Create 5 contacted buyers for 'Office Supply Distributors' with 2 WON deals
      for (let i = 1; i <= 5; i++) {
        await prisma.salesMissionBuyer.create({
          data: {
            organizationId: orgA.id,
            salesMissionId: missionA.id,
            externalBusinessId: `ext-robust-${i}`,
            provider: 'openstreetmap',
            businessName: `Robust Buyer ${i}`,
            matchedBuyerCategory: 'Office Supply Distributors',
            city: 'Dhaka',
            conversionStage: i <= 2 ? 'WON' : 'CONTACTED',
            conversionWonEvidence: i <= 2 ? {
              dealValue: 50000,
              currency: 'BDT',
              closedAt: new Date().toISOString(),
              notes: 'Order closed'
            } : undefined
          }
        });
      }

      const recs = await salesAnalyticsService.getRecommendations(orgA.id, productA.id);
      expect(recs.hasSufficientData).toBe(true);

      const buyerCatRec = recs.recommendations.find((r) => r.recommendationType === 'BUYER_CATEGORY');
      expect(buyerCatRec?.status).toBe('READY');
      expect(buyerCatRec?.recommendedValue).toBe('Office Supply Distributors');
      expect(buyerCatRec?.sampleSize).toBe(5);
      expect(buyerCatRec?.supportingMetrics.conversionRate).toBe(0.4); // 2 / 5
    });
  });

  describe('Tenant Isolation Safeguards', () => {
    it('prevents Tenant B from viewing Tenant A product analytics', async () => {
      // Tenant B tries to query Tenant A's product
      await expect(
        salesAnalyticsService.getProductAnalytics(orgB.id, productA.id)
      ).rejects.toThrow(/not found in organization/);
    });

    it('ensures Tenant B dashboard does not leak Tenant A data', async () => {
      // Add data to Tenant A
      await prisma.salesMissionBuyer.create({
        data: {
          organizationId: orgA.id,
          salesMissionId: missionA.id,
          externalBusinessId: 'ext-leak-test',
          provider: 'openstreetmap',
          businessName: 'Tenant A Exclusive Buyer',
          conversionStage: 'WON',
          conversionWonEvidence: { dealValue: 99999, currency: 'BDT', closedAt: new Date(), notes: 'Secret deal' }
        }
      });

      const tenantBKpis = await salesAnalyticsService.getDashboardKpis(orgB.id);
      expect(tenantBKpis.uniqueBuyers).toBe(0);
      expect(tenantBKpis.wonBuyers).toBe(0);
      expect(tenantBKpis.wonValueByCurrency).toEqual({});
    });
  });
});
