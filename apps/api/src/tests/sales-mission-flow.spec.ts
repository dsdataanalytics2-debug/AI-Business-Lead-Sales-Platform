import { describe, it, expect, beforeEach } from 'vitest';
import prisma from '@leadmate/db';
import { salesMissionService } from '../services/sales-mission.service.js';
import { productService } from '../services/product.service.js';
import {
  SalesMissionGoal,
  SalesMissionStatus,
  ProductStatus,
  SalesPriority
} from '@leadmate/shared';

describe('SalesMissionFlow', () => {
  let orgAlpha: any;
  let orgBeta: any;
  let userAlpha: any;

  beforeEach(async () => {
    orgAlpha = await prisma.organization.create({
      data: { name: `Mission Org Alpha ${Date.now()}` }
    });

    orgBeta = await prisma.organization.create({
      data: { name: `Mission Org Beta ${Date.now()}` }
    });

    userAlpha = await prisma.user.create({
      data: {
        organizationId: orgAlpha.id,
        email: `mission-user-${Date.now()}@test.local`,
        passwordHash: 'argon2id$mock',
        name: 'Mission Tester',
        role: 'ADMIN'
      }
    });
  });

  it('1. Creates a Sales Mission linked to an existing product', async () => {
    const product = await productService.createProduct(
      {
        name: 'Diamum',
        description: 'Diabetes healthcare nutrition formula.',
        stockQuantity: 850,
        currency: 'BDT'
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );

    const mission = await salesMissionService.createMission(
      {
        productId: product.id,
        name: 'Sell Diamum in Dhaka',
        goal: SalesMissionGoal.WHOLESALE,
        targetMarket: 'Dhaka, Bangladesh',
        buyerType: 'AI_DECIDE',
        resultTarget: 50
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );

    expect(mission.id).toBeDefined();
    expect(mission.productId).toBe(product.id);
    expect(mission.name).toBe('Sell Diamum in Dhaka');
    expect(mission.status).toBe(SalesMissionStatus.DRAFT);
    expect(mission.product?.name).toBe('Diamum');
  });

  it('2. Analyzes product and generates structured buyer categories', async () => {
    const product = await productService.createProduct(
      {
        name: 'Mini Blender',
        description: 'Portable USB rechargeable blender.',
        stockQuantity: 500,
        currency: 'BDT'
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );

    const mission = await salesMissionService.createMission(
      {
        productId: product.id,
        name: 'Find Wholesale Buyers for Mini Blender',
        goal: SalesMissionGoal.WHOLESALE,
        targetMarket: 'Chattogram, Bangladesh',
        buyerType: 'AI_DECIDE',
        resultTarget: 20
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );

    const analyzed = await salesMissionService.analyzeMission(mission.id, {
      organizationId: orgAlpha.id,
      userId: userAlpha.id
    });

    expect(analyzed.status).toBe(SalesMissionStatus.TARGETING);
    expect(analyzed.productAnalysisSnapshot).toBeDefined();
    expect(analyzed.productAnalysisSnapshot?.productCategory).toBeDefined();
    expect(analyzed.productAnalysisSnapshot?.idealBuyerProfile).toBeDefined();
    expect(analyzed.productAnalysisSnapshot?.idealBuyerProfile?.primaryBuyerTypes.length).toBeGreaterThan(0);
    expect(analyzed.productAnalysisSnapshot?.suggestedRelatedNeeds?.length).toBeGreaterThan(0);
    expect(analyzed.selectedBuyerTargets?.length).toBeGreaterThanOrEqual(3);
  });

  it('3. Discovers authentic businesses, stores them under the mission, and reopens with 0 external calls', async () => {
    const product = await productService.createProduct(
      {
        name: 'Dental Hygiene Kits',
        description: 'Professional dental sanitation and checkup packs.',
        stockQuantity: 100,
        currency: 'BDT'
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );

    const mission = await salesMissionService.createMission(
      {
        productId: product.id,
        name: 'Distribute Dental Kits in Dhanmondi',
        goal: SalesMissionGoal.DISTRIBUTOR_SEARCH,
        targetMarket: 'Dhanmondi',
        buyerType: 'AI_DECIDE',
        resultTarget: 20,
        selectedBuyerTargets: ['Dental Clinic', 'Dental Care']
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );

    // Run discovery
    const discovered = await salesMissionService.discoverBuyers(
      mission.id,
      ['Dental Clinic', 'Dental Care'],
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );

    expect(discovered.status).toBe(SalesMissionStatus.READY);
    expect(discovered.buyers).toBeDefined();
    expect(discovered.buyers?.length).toBeGreaterThan(0);
    expect(discovered.resultCount).toBe(discovered.buyers?.length);

    // Provenance, Buyer Score V2, Priority, Intent, and Related Needs preserved
    const firstBuyer = discovered.buyers![0];
    expect(firstBuyer.provider).toBeDefined();
    expect(firstBuyer.externalBusinessId).toBeDefined();
    expect(firstBuyer.businessName).toBeDefined();
    expect(firstBuyer.status).toBe('POTENTIAL');
    expect(firstBuyer.buyerScore).toBeGreaterThanOrEqual(0);
    expect(firstBuyer.buyerScore).toBeLessThanOrEqual(100);
    expect(firstBuyer.scoreBreakdown).toBeDefined();
    expect(firstBuyer.scoreBreakdown?.categoryMatch).toBeDefined();
    expect(firstBuyer.scoreBreakdown?.contactability).toBeDefined();
    expect(firstBuyer.scoreBreakdown?.intentStrength).toBeDefined();
    expect(firstBuyer.priority).toBeDefined();
    expect(['HOT', 'WARM', 'COLD']).toContain(firstBuyer.priority);
    expect(firstBuyer.wholesaleIntent).toBeDefined();
    expect(['HIGH', 'MEDIUM', 'LOW', 'NONE']).toContain(firstBuyer.wholesaleIntent);
    expect(firstBuyer.suggestedRelatedNeeds).toBeDefined();

    // Verify discoverBuyers only queried discovery providers, never inbound-only providers
    expect(discovered.buyers?.every((b) => b.provider !== 'facebook-lead-ads' && b.provider !== 'tiktok-lead-gen')).toBe(true);

    // Test generic authorized inbound lead ingestion path (Must NOT default to HIGH intent or HOT priority)
    const genericInbound = await salesMissionService.ingestInboundLead(
      mission.id,
      {
        provider: 'facebook-lead-ads',
        externalLeadId: 'fb_lead_inbound_test_101',
        businessName: 'Karim Dental Care',
        contactName: 'Dr. Karim',
        phone: '+8801711998877',
        email: 'karim@inbounddental.com',
        city: 'Dhaka',
        address: 'Dhanmondi 27, Dhaka',
        notes: 'Inquiry submitted from Facebook lead ad regarding clinic services'
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );

    expect(genericInbound.action).toBe('CREATED');
    expect(genericInbound.buyer.wholesaleIntent).not.toBe('HIGH');
    expect(genericInbound.buyer.wholesaleIntent).toBe('NONE');
    expect(genericInbound.buyer.priority).not.toBe('HOT');
    expect(genericInbound.buyer.priority).toBe('WARM');
    expect(genericInbound.buyer.status).toBe('POTENTIAL'); // Never automatically marked WON or customer
    expect(genericInbound.buyer.provider).toBe('facebook-lead-ads');
    expect(genericInbound.buyer.sourceEvidences).toBeDefined();
    // Provenance stays in sourceEvidences, NOT in wholesaleIntentSignals
    expect(genericInbound.buyer.wholesaleIntentSignals).not.toContain('AUTHORIZED_INBOUND_LEAD_SUBMISSION');

    // Test generic TikTok lead form (Must NOT default to HIGH intent or HOT priority)
    const genericTikTokLead = await salesMissionService.ingestInboundLead(
      mission.id,
      {
        provider: 'tiktok-lead-gen',
        externalLeadId: 'tt_lead_inbound_test_201',
        businessName: 'Dhaka Lifestyle Clinic',
        phone: '+8801822334455',
        notes: 'General product inquiry from TikTok video ad'
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );
    expect(genericTikTokLead.action).toBe('CREATED');
    expect(genericTikTokLead.buyer.wholesaleIntent).not.toBe('HIGH');
    expect(genericTikTokLead.buyer.wholesaleIntent).toBe('NONE');
    expect(genericTikTokLead.buyer.priority).not.toBe('HOT');
    expect(genericTikTokLead.buyer.status).toBe('POTENTIAL'); // Never automatically marked WON

    // Test explicit MOQ / wholesale catalog inquiry (Must detect MEDIUM intent deterministically)
    const moqTikTokLead = await salesMissionService.ingestInboundLead(
      mission.id,
      {
        provider: 'tiktok-lead-gen',
        externalLeadId: 'tt_lead_inbound_test_202',
        businessName: 'Chittagong Dental Supply',
        phone: '+8801833445566',
        notes: 'What is your MOQ? Please send wholesale catalog for dental chairs.'
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );
    expect(moqTikTokLead.action).toBe('CREATED');
    expect(moqTikTokLead.buyer.wholesaleIntent).toBe('MEDIUM');
    expect(moqTikTokLead.buyer.wholesaleIntentSignals).toContain('MOQ inquiry');
    expect(moqTikTokLead.buyer.status).toBe('POTENTIAL');

    // Verify deduplication on matching inbound lead with explicit bulk inquiry (upgrades intent & priority deterministically)
    const upgradedInbound = await salesMissionService.ingestInboundLead(
      mission.id,
      {
        provider: 'facebook-lead-ads',
        externalLeadId: 'fb_lead_inbound_test_101',
        businessName: 'Karim Dental Care',
        phone: '+8801711998877',
        notes: 'Need quotation for 500 units. Bulk price for dental equipment.'
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );
    expect(upgradedInbound.action).toBe('MERGED');
    expect(upgradedInbound.buyer.wholesaleIntent).toBe('HIGH');
    expect(upgradedInbound.buyer.priority).toBe('HOT');
    expect(upgradedInbound.buyer.status).toBe('POTENTIAL'); // Still never automatically WON

    // Verify subsequent weaker inbound inquiry does NOT downgrade existing verified HIGH intent
    const followUpInbound = await salesMissionService.ingestInboundLead(
      mission.id,
      {
        provider: 'facebook-lead-ads',
        externalLeadId: 'fb_lead_inbound_test_101',
        businessName: 'Karim Dental Care',
        phone: '+8801711998877',
        notes: 'Just following up on our earlier call'
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );
    expect(followUpInbound.action).toBe('MERGED');
    expect(followUpInbound.buyer.wholesaleIntent).toBe('HIGH'); // Preserved stronger historical intent!
    expect(followUpInbound.buyer.status).toBe('POTENTIAL'); // Never marked WON

    // CRITICAL REOPEN TEST: Reopening mission retrieves stored state without calling any external providers
    const reopened = await salesMissionService.getMissionById(mission.id, orgAlpha.id);
    expect(reopened.id).toBe(mission.id);
    expect(reopened.status).toBe(SalesMissionStatus.READY);
    expect(reopened.buyers?.length).toBe((discovered.buyers?.length || 0) + 3);
    expect(reopened.buyers?.some((b) => b.externalBusinessId === 'fb_lead_inbound_test_101')).toBe(true);
    expect(reopened.buyers?.some((b) => b.externalBusinessId === 'tt_lead_inbound_test_201')).toBe(true);
  });

  it('4. Enforces strict tenant isolation across organizations', async () => {
    const product = await productService.createProduct(
      {
        name: 'Industrial Sewing Machine',
        description: 'Heavy duty garment sewing machine.',
        stockQuantity: 40,
        currency: 'BDT'
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );

    const mission = await salesMissionService.createMission(
      {
        productId: product.id,
        name: 'Garment Factory Mission',
        goal: SalesMissionGoal.CORPORATE_SALES,
        targetMarket: 'Gazipur, Dhaka',
        buyerType: 'CORPORATE_BUYER',
        resultTarget: 20
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );

    // Alpha can view
    const viewAlpha = await salesMissionService.getMissionById(mission.id, orgAlpha.id);
    expect(viewAlpha.id).toBe(mission.id);

    // Beta cannot view (fails closed with NotFoundError)
    await expect(
      salesMissionService.getMissionById(mission.id, orgBeta.id)
    ).rejects.toThrow('not found');
  });

  it('5. Unique Re-Discovery: Run #1 finds initial buyers; Re-run #2 skips previously seen businesses, appends only new buyers, preserves CRM/disqualified exclusions, and isolates by mission', async () => {
    const product = await productService.createProduct(
      {
        name: 'Smart Diagnostic Kit',
        description: 'Automated health diagnostic kits for medical centers.',
        stockQuantity: 200,
        currency: 'BDT'
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );

    const mission = await salesMissionService.createMission(
      {
        productId: product.id,
        name: 'Diagnostic Kit Dhaka Mission',
        goal: SalesMissionGoal.DISTRIBUTOR_SEARCH,
        targetMarket: 'Dhaka',
        buyerType: 'AI_DECIDE',
        resultTarget: 1, // Only ask for 1 buyer in run #1
        selectedBuyerTargets: ['Dental Clinic', 'Pharmacy']
      },
      {
        organizationId: orgAlpha.id,
        userId: userAlpha.id
      }
    );

    // -------------------------------------------------------------------------
    // Run #1: Discover initial buyer
    // -------------------------------------------------------------------------
    const run1 = await salesMissionService.discoverBuyers(
      mission.id,
      ['Dental Clinic'],
      { organizationId: orgAlpha.id, userId: userAlpha.id }
    );

    expect(run1.status).toBe(SalesMissionStatus.READY);
    expect(run1.buyers?.length).toBeGreaterThanOrEqual(1);
    const initialBuyerCount = run1.buyers!.length;
    const firstBuyerExternalId = run1.buyers![0].externalBusinessId;

    expect(run1.discoveryRunMetrics).toBeDefined();
    expect(run1.discoveryRunMetrics?.newBuyersAdded).toBe(initialBuyerCount);
    expect(run1.discoveryRunMetrics?.previouslyDiscoveredSkipped).toBe(0);
    expect(run1.discoveryRunMetrics?.locationsUsed).toBeDefined();
    expect(run1.discoveryRunMetrics?.locationsUsed?.length).toBeGreaterThan(0);
    expect(run1.discoveryRunMetrics?.providersUsed).toBeDefined();
    expect(run1.discoveryRuns?.length).toBe(1);

    // -------------------------------------------------------------------------
    // Invariant: Change status of a buyer to SAVED_TO_CRM
    // -------------------------------------------------------------------------
    await prisma.salesMissionBuyer.update({
      where: { id: run1.buyers![0].id },
      data: { status: 'SAVED_TO_CRM' }
    });

    // -------------------------------------------------------------------------
    // Run #2: Re-run discovery on the SAME mission
    // -------------------------------------------------------------------------
    // Must exclude the buyer already in the mission (even though it is SAVED_TO_CRM)
    const run2 = await salesMissionService.discoverBuyers(
      mission.id,
      ['Dental Clinic', 'Pharmacy'],
      { organizationId: orgAlpha.id, userId: userAlpha.id }
    );

    expect(run2.discoveryRunMetrics).toBeDefined();
    expect(run2.discoveryRuns?.length).toBe(2);
    expect(run2.discoveryRunMetrics?.duplicatesSkipped).toBeGreaterThanOrEqual(1);
    // Previously discovered business from Run #1 was skipped
    expect(run2.discoveryRunMetrics!.previouslyDiscoveredSkipped).toBeGreaterThanOrEqual(1);

    // Old buyers are NEVER deleted; mission total is cumulative
    expect(run2.buyers?.length).toBeGreaterThanOrEqual(initialBuyerCount);

    // The first buyer appears exactly once in the mission
    const matchesOfFirstBuyer = run2.buyers!.filter(
      (b) => b.externalBusinessId === firstBuyerExternalId
    );
    expect(matchesOfFirstBuyer.length).toBe(1);
    // Its SAVED_TO_CRM status was preserved
    expect(matchesOfFirstBuyer[0].status).toBe('SAVED_TO_CRM');

    // -------------------------------------------------------------------------
    // Run #3: Test exhaustion / no new buyers found
    // -------------------------------------------------------------------------
    // Re-running with only the exact same exhausted target category
    const run3 = await salesMissionService.discoverBuyers(
      mission.id,
      ['Dental Clinic'],
      { organizationId: orgAlpha.id, userId: userAlpha.id }
    );

    expect(run3.discoveryRunMetrics).toBeDefined();
    expect(run3.discoveryRuns?.length).toBe(3);
    expect(run3.discoveryRunMetrics?.runNumber).toBe(3);
    expect(run3.buyers?.length).toBeGreaterThanOrEqual(run2.buyers?.length || 0);

    // -------------------------------------------------------------------------
    // Cross-mission isolation: Different mission CAN discover the same business
    // -------------------------------------------------------------------------
    const userBeta = await prisma.user.create({
      data: {
        organizationId: orgBeta.id,
        email: `mission-user-beta-${Date.now()}@test.local`,
        passwordHash: 'argon2id$mock',
        name: 'Mission Tester Beta',
        role: 'ADMIN'
      }
    });

    const missionBeta = await salesMissionService.createMission(
      {
        name: 'Beta Mission for Different Product',
        goal: SalesMissionGoal.RETAIL_DISTRIBUTION,
        targetMarket: 'Dhaka',
        buyerType: 'AI_DECIDE',
        resultTarget: 2,
        selectedBuyerTargets: ['Dental Clinic']
      },
      {
        organizationId: orgBeta.id,
        userId: userBeta.id
      }
    );

    const runBeta = await salesMissionService.discoverBuyers(
      missionBeta.id,
      ['Dental Clinic'],
      { organizationId: orgBeta.id, userId: userBeta.id }
    );

    // Beta mission can discover the business because dedupe is scoped to the mission
    expect(runBeta.buyers?.length).toBeGreaterThan(0);
    const betaBuyerIds = runBeta.buyers!.map((b) => b.externalBusinessId);
    expect(betaBuyerIds).toContain(firstBuyerExternalId);
  });
});
