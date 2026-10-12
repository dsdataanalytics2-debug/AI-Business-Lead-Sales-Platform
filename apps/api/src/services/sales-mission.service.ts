/**
 * Sales Mission Service
 *
 * Implements end-to-end Sales Mission lifecycle:
 * DRAFT -> ANALYZING -> TARGETING -> DISCOVERING -> READY -> COMPLETED.
 *
 * INVARIANTS:
 * - Tenant isolation enforced on all queries (organizationId).
 * - Discovery delegates directly to authentic datasource providers via BusinessSearchService.
 * - ZERO automatic calls to Gemini / Google / OSM on reopen. Reopen uses stored state.
 * - PHONE != WHATSAPP: Discovered phones are stored as raw phone strings.
 */

import prisma, { Prisma } from '@leadmate/db';
import {
  type CreateSalesMissionInput,
  type UpdateSalesMissionInput,
  type ListSalesMissionsQuery,
  type SalesMissionDetailDto,
  type SalesMissionBuyerDto,
  type ProductDto,
  SalesMissionGoal,
  SalesMissionStatus,
  MissionBuyerStatus
} from '@leadmate/shared';
import { NotFoundError, BadRequestError } from '../lib/errors.js';
import { aiProductAnalysisService } from './ai-product-analysis.service.js';
import { businessSearchService } from './business-search.service.js';

export interface MissionRequestContext {
  organizationId: string;
  userId: string;
  correlationId?: string;
}

export class SalesMissionService {
  /**
   * Helper to format a product for inclusion in mission responses.
   */
  private serializeProduct(p: any): ProductDto | null {
    if (!p) return null;
    return {
      id: p.id,
      organizationId: p.organizationId,
      createdByUserId: p.createdByUserId,
      sourceType: p.sourceType,
      sourceProvider: p.sourceProvider,
      externalProductId: p.externalProductId,
      sku: p.sku,
      name: p.name,
      description: p.description,
      category: p.category,
      stockQuantity: p.stockQuantity,
      sellingPrice: p.sellingPrice ? Number(p.sellingPrice) : null,
      costPrice: p.costPrice ? Number(p.costPrice) : null,
      currency: p.currency,
      minimumOrderQuantity: p.minimumOrderQuantity,
      brand: p.brand,
      imageUrl: p.imageUrl,
      productUrl: p.productUrl,
      importedFrom: p.importedFrom,
      targetMarket: p.targetMarket,
      notes: p.notes,
      status: p.status,
      salesPriority: p.salesPriority,
      lastSyncedAt: p.lastSyncedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    };
  }

  /**
   * Helper to serialize a SalesMissionBuyer.
   */
  private serializeBuyer(b: any): SalesMissionBuyerDto {
    return {
      id: b.id,
      organizationId: b.organizationId,
      salesMissionId: b.salesMissionId,
      externalBusinessId: b.externalBusinessId,
      provider: b.provider,
      businessName: b.businessName,
      category: b.category,
      address: b.address,
      city: b.city,
      country: b.country,
      latitude: b.latitude,
      longitude: b.longitude,
      website: b.website,
      phone: b.phone,
      matchedBuyerCategory: b.matchedBuyerCategory,
      searchTargetUsed: b.searchTargetUsed,
      sourceData: b.sourceData,
      leadId: b.leadId,
      status: b.status,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt
    };
  }

  /**
   * Serializes full SalesMission entity with product and buyers.
   */
  private serializeMission(m: any, buyers: any[] = []): SalesMissionDetailDto {
    const formattedBuyers = buyers.map((b) => this.serializeBuyer(b));
    return {
      id: m.id,
      organizationId: m.organizationId,
      createdByUserId: m.createdByUserId,
      productId: m.productId,
      name: m.name,
      goal: m.goal,
      targetMarket: m.targetMarket,
      buyerType: m.buyerType,
      resultTarget: m.resultTarget,
      status: m.status,
      productAnalysisSnapshot: m.productAnalysisSnapshot,
      selectedBuyerTargets: m.selectedBuyerTargets,
      resultCount: m.resultCount || formattedBuyers.length,
      startedAt: m.startedAt,
      completedAt: m.completedAt,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      product: this.serializeProduct(m.product),
      buyers: formattedBuyers,
      buyerStats: {
        found: formattedBuyers.length,
        savedToCrm: formattedBuyers.filter((b) => b.status === MissionBuyerStatus.SAVED_TO_CRM).length
      }
    };
  }

  /**
   * Creates a new Sales Mission.
   */
  async createMission(
    input: CreateSalesMissionInput,
    context: MissionRequestContext
  ): Promise<SalesMissionDetailDto> {
    const trimmedName = input.name.trim();
    const trimmedMarket = input.targetMarket.trim();

    if (!trimmedName || !trimmedMarket) {
      throw new BadRequestError('Mission name and target market are required');
    }

    let linkedProduct: any = null;
    if (input.productId) {
      linkedProduct = await prisma.product.findFirst({
        where: {
          id: input.productId,
          organizationId: context.organizationId
        }
      });

      if (!linkedProduct) {
        throw new NotFoundError(`Product "${input.productId}" not found in organization`);
      }
    }

    const created = await prisma.salesMission.create({
      data: {
        organizationId: context.organizationId,
        createdByUserId: context.userId,
        productId: linkedProduct ? linkedProduct.id : null,
        name: trimmedName,
        goal: input.goal || SalesMissionGoal.WHOLESALE,
        targetMarket: trimmedMarket,
        buyerType: input.buyerType || 'AI_DECIDE',
        resultTarget: input.resultTarget || 50,
        status: SalesMissionStatus.DRAFT,
        productAnalysisSnapshot: input.productAnalysisSnapshot ? (input.productAnalysisSnapshot as any) : undefined,
        selectedBuyerTargets: input.selectedBuyerTargets ? (input.selectedBuyerTargets as any) : undefined
      },
      include: {
        product: true
      }
    });

    try {
      await prisma.auditLog.create({
        data: {
          organizationId: context.organizationId,
          userId: context.userId,
          action: 'sales_mission.created',
          entityType: 'SalesMission',
          entityId: created.id,
          after: {
            name: created.name,
            targetMarket: created.targetMarket,
            goal: created.goal
          }
        }
      });
    } catch {
      // Non-blocking
    }

    return this.serializeMission(created, []);
  }

  /**
   * Retrieves mission details by ID without calling any external providers.
   */
  async getMissionById(id: string, organizationId: string): Promise<SalesMissionDetailDto> {
    const mission = await prisma.salesMission.findFirst({
      where: {
        id,
        organizationId
      },
      include: {
        product: true,
        buyers: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!mission) {
      throw new NotFoundError(`Sales Mission "${id}" not found`);
    }

    return this.serializeMission(mission, mission.buyers || []);
  }

  /**
   * Lists sales missions for a tenant.
   */
  async listMissions(
    query: ListSalesMissionsQuery,
    organizationId: string
  ): Promise<{
    missions: SalesMissionDetailDto[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(50, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.SalesMissionWhereInput = {
      organizationId
    };

    if (query.productId) {
      where.productId = query.productId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { targetMarket: { contains: q, mode: 'insensitive' } }
      ];
    }

    const [missions, total] = await Promise.all([
      prisma.salesMission.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          product: true,
          buyers: {
            select: { id: true, status: true }
          }
        }
      }),
      prisma.salesMission.count({ where })
    ]);

    return {
      missions: missions.map((m) => this.serializeMission(m, m.buyers || [])),
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1
    };
  }

  /**
   * Executes AI product analysis for a mission and stores the snapshot.
   */
  async analyzeMission(
    missionId: string,
    context: MissionRequestContext
  ): Promise<SalesMissionDetailDto> {
    const mission = await prisma.salesMission.findFirst({
      where: {
        id: missionId,
        organizationId: context.organizationId
      },
      include: {
        product: true,
        buyers: true
      }
    });

    if (!mission) {
      throw new NotFoundError(`Sales Mission "${missionId}" not found`);
    }

    const productName = mission.product ? mission.product.name : mission.name;
    const productDesc = mission.product ? mission.product.description : mission.name;

    await prisma.salesMission.update({
      where: { id: missionId },
      data: { status: SalesMissionStatus.ANALYZING }
    });

    const analysis = await aiProductAnalysisService.analyzeProductForBuyerDiscovery(
      {
        productName,
        productDescription: productDesc,
        category: mission.product?.category || undefined,
        goal: mission.goal,
        targetMarket: mission.targetMarket,
        buyerType: mission.buyerType
      },
      context
    );

    const updated = await prisma.salesMission.update({
      where: { id: missionId },
      data: {
        status: SalesMissionStatus.TARGETING,
        productAnalysisSnapshot: analysis as any,
        selectedBuyerTargets: analysis.searchTerms
      },
      include: {
        product: true,
        buyers: true
      }
    });

    return this.serializeMission(updated, updated.buyers || []);
  }

  /**
   * Discovers real buyers using existing Business Search providers and stores results.
   */
  async discoverBuyers(
    missionId: string,
    targetCategoriesOverride?: string[],
    context?: MissionRequestContext
  ): Promise<SalesMissionDetailDto> {
    const mission = await prisma.salesMission.findFirst({
      where: {
        id: missionId,
        organizationId: context?.organizationId
      },
      include: {
        product: true
      }
    });

    if (!mission) {
      throw new NotFoundError(`Sales Mission "${missionId}" not found`);
    }

    // Determine target categories
    let activeCategories: string[] = [];
    if (targetCategoriesOverride && targetCategoriesOverride.length > 0) {
      activeCategories = targetCategoriesOverride.slice(0, 5);
    } else if (mission.selectedBuyerTargets && Array.isArray(mission.selectedBuyerTargets)) {
      activeCategories = (mission.selectedBuyerTargets as string[]).slice(0, 5);
    } else {
      // Analyze first if missing
      const analysis = await aiProductAnalysisService.analyzeProductForBuyerDiscovery(
        {
          productName: mission.product ? mission.product.name : mission.name,
          productDescription: mission.product ? mission.product.description : mission.name,
          category: mission.product?.category || undefined,
          goal: mission.goal,
          targetMarket: mission.targetMarket,
          buyerType: mission.buyerType
        },
        context!
      );
      activeCategories = analysis.searchTerms.slice(0, 5);
    }

    await prisma.salesMission.update({
      where: { id: missionId },
      data: {
        status: SalesMissionStatus.DISCOVERING,
        selectedBuyerTargets: activeCategories,
        startedAt: mission.startedAt || new Date()
      }
    });

    // Delegate to authentic Business Search engine (OpenStreetMap / Google Places)
    const searchQuery = mission.product ? mission.product.name : mission.name;
    const searchResults = await businessSearchService.search(
      {
        q: searchQuery,
        location: mission.targetMarket,
        limit: mission.resultTarget || 50,
        provider: process.env.NODE_ENV === 'test' ? 'MOCK' : 'AUTO',
        targetCategories: activeCategories,
        buyerType: mission.buyerType !== 'AI_DECIDE' ? (mission.buyerType as any) : undefined
      },
      {
        organizationId: mission.organizationId,
        userId: context?.userId || mission.createdByUserId,
        correlationId: context?.correlationId || `mission-${mission.id}`
      }
    );

    // Persist discovered buyers
    for (const item of searchResults) {
      try {
        await prisma.salesMissionBuyer.upsert({
          where: {
            salesMissionId_provider_externalBusinessId: {
              salesMissionId: mission.id,
              provider: item.provider,
              externalBusinessId: item.externalId
            }
          },
          update: {
            businessName: item.name,
            category: item.category || null,
            address: item.address || null,
            city: item.city || null,
            country: item.country || 'BD',
            latitude: item.latitude || null,
            longitude: item.longitude || null,
            website: item.website || null,
            phone: item.contacts?.find((c) => c.type === 'PHONE')?.rawValue || null,
            matchedBuyerCategory: item.matchedBuyerCategory || null,
            searchTargetUsed: item.searchTargetUsed || null,
            sourceData: item as any
          },
          create: {
            organizationId: mission.organizationId,
            salesMissionId: mission.id,
            externalBusinessId: item.externalId,
            provider: item.provider,
            businessName: item.name,
            category: item.category || null,
            address: item.address || null,
            city: item.city || null,
            country: item.country || 'BD',
            latitude: item.latitude || null,
            longitude: item.longitude || null,
            website: item.website || null,
            phone: item.contacts?.find((c) => c.type === 'PHONE')?.rawValue || null,
            matchedBuyerCategory: item.matchedBuyerCategory || null,
            searchTargetUsed: item.searchTargetUsed || null,
            sourceData: item as any,
            status: MissionBuyerStatus.POTENTIAL
          }
        });
      } catch (err) {
        // Safe item skip if duplicate error occurs
        console.warn('Failed to upsert mission buyer:', err);
      }
    }

    const allBuyers = await prisma.salesMissionBuyer.findMany({
      where: {
        salesMissionId: mission.id,
        organizationId: mission.organizationId
      },
      orderBy: { createdAt: 'desc' }
    });

    const updated = await prisma.salesMission.update({
      where: { id: missionId },
      data: {
        status: SalesMissionStatus.READY,
        resultCount: allBuyers.length,
        completedAt: new Date()
      },
      include: {
        product: true
      }
    });

    return this.serializeMission(updated, allBuyers);
  }

  /**
   * Links a mission buyer to a saved CRM Lead.
   */
  async markBuyerSavedToCrm(
    missionId: string,
    buyerId: string,
    leadId: string,
    organizationId: string
  ): Promise<void> {
    await prisma.salesMissionBuyer.updateMany({
      where: {
        id: buyerId,
        salesMissionId: missionId,
        organizationId
      },
      data: {
        status: MissionBuyerStatus.SAVED_TO_CRM,
        leadId
      }
    });
  }
}

export const salesMissionService = new SalesMissionService();
