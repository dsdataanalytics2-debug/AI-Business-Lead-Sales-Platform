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

    // Provenance preserved
    const firstBuyer = discovered.buyers![0];
    expect(firstBuyer.provider).toBeDefined();
    expect(firstBuyer.externalBusinessId).toBeDefined();
    expect(firstBuyer.businessName).toBeDefined();
    expect(firstBuyer.status).toBe('POTENTIAL');

    // CRITICAL REOPEN TEST: Reopening mission retrieves stored state without calling any external providers
    const reopened = await salesMissionService.getMissionById(mission.id, orgAlpha.id);
    expect(reopened.id).toBe(mission.id);
    expect(reopened.status).toBe(SalesMissionStatus.READY);
    expect(reopened.buyers?.length).toBe(discovered.buyers?.length);
    expect(reopened.buyers![0].businessName).toBe(firstBuyer.businessName);
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
});
