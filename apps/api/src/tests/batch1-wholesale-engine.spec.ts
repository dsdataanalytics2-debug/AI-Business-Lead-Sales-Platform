import { describe, it, expect, beforeEach } from 'vitest';
import prisma from '@leadmate/db';
import { salesMissionService } from '../services/sales-mission.service.js';
import { productService } from '../services/product.service.js';
import { SalesMissionGoal, SalesMissionStatus } from '@leadmate/shared';

describe('Batch 1 — Advanced Wholesale Sales Engine', () => {
  let org: any;
  let user: any;

  beforeEach(async () => {
    org = await prisma.organization.create({
      data: { name: `Batch1 Test Org ${Date.now()}` }
    });

    user = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `batch1-${Date.now()}@wholesale.test`,
        passwordHash: 'argon2id$mock',
        name: 'Wholesale Operator',
        role: 'ADMIN'
      }
    });
  });

  it('verifies complete Batch 1 workflow: Run #1, Buyer Score, Deep Coverage, Run #2 Find More Buyers, and Run History persistence', async () => {
    // 1. Create a product with wholesale context
    const product = await productService.createProduct(
      {
        name: 'Professional Healthcare & Hygiene Pack',
        description: 'Commercial wholesale sanitation and hygiene packs for clinics and commercial stores.',
        category: 'Healthcare',
        stockQuantity: 1500,
        currency: 'BDT'
      },
      { organizationId: org.id, userId: user.id }
    );

    // 2. Create mission with primary & secondary targets in Dhaka matching mock directories
    const mission = await salesMissionService.createMission(
      {
        productId: product.id,
        name: 'Wholesale Hygiene Pack Distribution',
        goal: SalesMissionGoal.WHOLESALE,
        targetMarket: 'Dhaka',
        buyerType: 'AI_DECIDE',
        resultTarget: 2,
        selectedBuyerTargets: ['Dental Clinic', 'Bakery & Sweets', 'Handicrafts & Gifts', 'Fashion & Clothing']
      },
      { organizationId: org.id, userId: user.id }
    );

    expect(mission.id).toBeDefined();

    // -------------------------------------------------------------------------
    // Execution Run #1: Initial Discovery (Primary Targets)
    // -------------------------------------------------------------------------
    const run1Result = await salesMissionService.discoverBuyers(
      mission.id,
      ['Dental Clinic'],
      { organizationId: org.id, userId: user.id }
    );

    expect(run1Result.status).toBe(SalesMissionStatus.READY);
    expect(run1Result.buyers).toBeDefined();
    expect(run1Result.buyers!.length).toBeGreaterThan(0);

    const run1BuyerCount = run1Result.buyers!.length;
    const run1BuyerIds = new Set(run1Result.buyers!.map((b) => b.externalBusinessId));

    // Verify Buyer Score 0–100 & Score Breakdown on Run #1 buyers
    for (const buyer of run1Result.buyers!) {
      expect(buyer.buyerScore).toBeDefined();
      expect(buyer.buyerScore).toBeGreaterThanOrEqual(0);
      expect(buyer.buyerScore).toBeLessThanOrEqual(100);

      expect(buyer.scoreBreakdown).toBeDefined();
      expect(buyer.scoreBreakdown!.productFit).toBeGreaterThanOrEqual(0);
      expect(buyer.scoreBreakdown!.categoryMatch).toBeGreaterThanOrEqual(0);
      expect(buyer.scoreBreakdown!.locationFit).toBeGreaterThanOrEqual(0);
      expect(buyer.scoreBreakdown!.contactability).toBeGreaterThanOrEqual(0);
      expect(buyer.scoreBreakdown!.sourceConfidence).toBeGreaterThanOrEqual(0);
    }

    // Verify Discovery Run History for Run #1
    expect(run1Result.discoveryRuns).toBeDefined();
    expect(run1Result.discoveryRuns!.length).toBe(1);
    const run1Metrics = run1Result.discoveryRuns![0];
    expect(run1Metrics.runNumber).toBe(1);
    expect(run1Metrics.newBuyersAdded).toBe(run1BuyerCount);
    expect(run1Metrics.targetsUsed).toBeDefined();
    expect(run1Metrics.targetsUsed!.length).toBeGreaterThan(0);
    expect(run1Metrics.locationsUsed).toBeDefined();
    expect(run1Metrics.locationsUsed!.length).toBeGreaterThan(0);
    expect(run1Metrics.providersUsed).toBeDefined();
    expect(run1Metrics.searchedCombinations).toBeDefined();

    const run1SearchedCombos = new Set(run1Metrics.searchedCombinations!);

    // -------------------------------------------------------------------------
    // Execution Run #2: Smart Find More Buyers (Next Best Combinations)
    // -------------------------------------------------------------------------
    const run2Result = await salesMissionService.discoverBuyers(
      mission.id,
      undefined, // Use existing approved targets so engine automatically advances to next combinations
      { organizationId: org.id, userId: user.id }
    );

    expect(run2Result.discoveryRuns).toBeDefined();
    expect(run2Result.discoveryRuns!.length).toBe(2);

    const run2Metrics = run2Result.discoveryRuns![1];
    expect(run2Metrics.runNumber).toBe(2);
    expect(run2Metrics.searchedCombinations).toBeDefined();

    // Invariant: Previously searched combinations are NOT repeated
    for (const combo of run2Metrics.searchedCombinations!) {
      expect(run1SearchedCombos.has(combo)).toBe(false);
    }

    // Invariant: Bounded execution (at most 2-3 combinations per run)
    expect(run2Metrics.searchedCombinations!.length).toBeLessThanOrEqual(3);

    // Invariant: Cumulative buyers list preserves Run #1 and appends only unique buyers
    expect(run2Result.buyers!.length).toBeGreaterThanOrEqual(run1BuyerCount);

    const allBuyerIds = run2Result.buyers!.map((b) => b.externalBusinessId);
    const uniqueBuyerIds = new Set(allBuyerIds);
    expect(allBuyerIds.length).toBe(uniqueBuyerIds.size); // Zero duplicate rows

    // -------------------------------------------------------------------------
    // Reopen Verification: Mission reload from DB preserves scores & run history
    // -------------------------------------------------------------------------
    const reloaded = await salesMissionService.getMissionById(mission.id, org.id);
    expect(reloaded.id).toBe(mission.id);
    expect(reloaded.buyers?.length).toBe(run2Result.buyers?.length);
    expect(reloaded.discoveryRuns?.length).toBe(2);
    expect(reloaded.buyers![0].buyerScore).toBeDefined();
    expect(reloaded.buyers![0].scoreBreakdown).toBeDefined();
  });
});
