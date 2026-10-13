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
  type DiscoveryRunMetrics,
  type ProductDto,
  type BusinessSearchResult,
  SalesMissionGoal,
  SalesMissionStatus,
  MissionBuyerStatus
} from '@leadmate/shared';
import {
  normalizeBusinessName,
  normalizeWebsite,
  normalizePhone
} from '@leadmate/core';
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
   * Generates strong deduplication keys across the 4-tier deduplication hierarchy:
   * 1. provider + externalId
   * 2. normalized business name + normalized location/address
   * 3. verified phone if present
   * 4. canonical website domain if present
   */
  public extractDedupeKeys(item: {
    provider?: string | null;
    externalBusinessId?: string | null;
    externalId?: string | null;
    businessName?: string | null;
    name?: string | null;
    address?: string | null;
    locality?: string | null;
    city?: string | null;
    phone?: string | null;
    contacts?: Array<{ type: string; rawValue: string }> | null;
    website?: string | null;
  }): string[] {
    const keys: string[] = [];

    // 1. Provider + externalBusinessId / externalId
    const provider = item.provider?.toUpperCase().trim();
    const externalId = (item.externalBusinessId || item.externalId)?.trim().toLowerCase();
    if (provider && externalId) {
      keys.push(`provider:${provider}:${externalId}`);
    }

    // 2. Normalized business name + address / locality / city
    const rawName = item.businessName || item.name || '';
    const normName = normalizeBusinessName(rawName);
    if (normName) {
      const locKey = normalizeBusinessName(item.address || item.locality || item.city || '');
      if (locKey) {
        keys.push(`name_loc:${normName}:${locKey}`);
      } else {
        keys.push(`name:${normName}`);
      }
    }

    // 3. Verified / Found phone number
    if (item.phone) {
      const normPhone = normalizePhone(item.phone);
      if (normPhone.isValid && normPhone.normalizedValue) {
        keys.push(`phone:${normPhone.normalizedValue}`);
      }
    }
    if (item.contacts && item.contacts.length > 0) {
      for (const c of item.contacts) {
        if (c.type === 'PHONE' || c.type === 'WHATSAPP') {
          const normPhone = normalizePhone(c.rawValue);
          if (normPhone.isValid && normPhone.normalizedValue) {
            keys.push(`phone:${normPhone.normalizedValue}`);
          }
        }
      }
    }

    // 4. Normalized website domain
    if (item.website) {
      const normWeb = normalizeWebsite(item.website);
      if (normWeb.isValid && normWeb.normalizedDomain) {
        keys.push(`domain:${normWeb.normalizedDomain.toLowerCase()}`);
      }
    }

    return keys;
  }

  /**
   * Helper to serialize a SalesMissionBuyer.
   */
  private serializeBuyer(b: any, isNew = false): SalesMissionBuyerDto {
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
      isNew: isNew || Boolean(b.isNew),
      createdAt: b.createdAt,
      updatedAt: b.updatedAt
    };
  }

  /**
   * Serializes full SalesMission entity with product, buyers, and discovery metrics.
   */
  private serializeMission(
    m: any,
    buyers: any[] = [],
    newlyCreatedIds?: Set<string>,
    discoveryMetrics?: DiscoveryRunMetrics | null
  ): SalesMissionDetailDto {
    const formattedBuyers = buyers.map((b) =>
      this.serializeBuyer(b, newlyCreatedIds ? newlyCreatedIds.has(b.id) : false)
    );
    const existingSnapshot = (m.productAnalysisSnapshot as any) || {};
    const fallbackMetrics = discoveryMetrics !== undefined
      ? discoveryMetrics
      : (existingSnapshot?.latestRunMetrics || null);

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
      },
      discoveryRunMetrics: fallbackMetrics
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
   *
   * UNIQUE RE-DISCOVERY CONTRACT:
   * 1. Existing buyers (POTENTIAL, SAVED_TO_CRM, DISQUALIFIED) form the exclusion set across 4 tiers:
   *    - provider + externalId
   *    - normalized name + location
   *    - phone
   *    - domain
   * 2. Searches across approved AI buyer targets/search terms until resultTarget NEW buyers are reached
   *    or all approved queries are exhausted.
   * 3. Previous buyers are NEVER deleted or overwritten. New buyers are appended.
   * 4. Accurate run metrics (newBuyersAdded, previouslyDiscoveredSkipped, providerDuplicatesSkipped)
   *    are tracked and persisted in discovery runs history.
   * 5. Newly added buyers are flagged with isNew: true.
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

    // 1. Load all existing buyers for this mission to build exclusion set
    const existingBuyers = await prisma.salesMissionBuyer.findMany({
      where: {
        salesMissionId: mission.id,
        organizationId: mission.organizationId
      }
    });

    const existingExclusionKeys = new Set<string>();
    for (const b of existingBuyers) {
      const keys = this.extractDedupeKeys({
        provider: b.provider,
        externalBusinessId: b.externalBusinessId,
        businessName: b.businessName,
        address: b.address,
        city: b.city,
        phone: b.phone,
        website: b.website
      });
      for (const k of keys) {
        existingExclusionKeys.add(k);
      }
    }

    // 2. Determine pool of approved candidate categories
    const approvedTargets: string[] = [];
    if (targetCategoriesOverride && targetCategoriesOverride.length > 0) {
      approvedTargets.push(...targetCategoriesOverride.map((s) => s.trim()).filter(Boolean));
    }
    if (Array.isArray(mission.selectedBuyerTargets)) {
      approvedTargets.push(...(mission.selectedBuyerTargets as string[]).map((s) => s.trim()).filter(Boolean));
    }
    const snapshot = mission.productAnalysisSnapshot as any;
    if (snapshot) {
      if (Array.isArray(snapshot.searchTerms)) {
        approvedTargets.push(...snapshot.searchTerms.map((s: any) => String(s).trim()).filter(Boolean));
      }
      if (Array.isArray(snapshot.buyerTargets)) {
        approvedTargets.push(
          ...snapshot.buyerTargets.map((b: any) => String(b.category || b.name || '').trim()).filter(Boolean)
        );
      }
    }

    let candidateCategories = Array.from(new Set(approvedTargets));
    if (candidateCategories.length === 0) {
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
      candidateCategories = analysis.searchTerms;
    }

    await prisma.salesMission.update({
      where: { id: missionId },
      data: {
        status: SalesMissionStatus.DISCOVERING,
        selectedBuyerTargets: candidateCategories.slice(0, 5),
        startedAt: mission.startedAt || new Date()
      }
    });

    const targetNewCount = mission.resultTarget || 20;
    const newDiscoveredItems: BusinessSearchResult[] = [];
    const newRunSeenKeys = new Set<string>();
    let previouslyDiscoveredSkipped = 0;
    let providerDuplicatesSkipped = 0;
    const targetsUsed: string[] = [];

    const runStartedAt = new Date();
    const providerKey = process.env.NODE_ENV === 'test' ? 'MOCK' : 'AUTO';

    // 3. Search approved target categories in sequence until targetNewCount new buyers are found
    for (const cat of candidateCategories) {
      if (newDiscoveredItems.length >= targetNewCount) {
        break;
      }
      targetsUsed.push(cat);

      const needed = targetNewCount - newDiscoveredItems.length;
      // Request depth (at least 20, max 50) so skipping previously-seen businesses still yields new results
      const queryLimit = Math.min(Math.max(needed * 2, 20), 50);

      try {
        const results = await businessSearchService.search(
          {
            q: cat,
            location: mission.targetMarket,
            limit: queryLimit,
            provider: providerKey,
            targetCategories: [cat],
            buyerType: mission.buyerType !== 'AI_DECIDE' ? (mission.buyerType as any) : undefined
          },
          {
            organizationId: mission.organizationId,
            userId: context?.userId || mission.createdByUserId,
            correlationId: context?.correlationId || `mission-${mission.id}-${cat}`
          }
        );

        for (const item of results) {
          const keys = this.extractDedupeKeys({
            provider: item.provider,
            externalId: item.externalId,
            name: item.name,
            address: item.address,
            locality: item.locality,
            city: item.city,
            contacts: item.contacts,
            website: item.website
          });

          // Check against already-existing buyers for this mission
          const isPreviouslySeen = keys.some((k) => existingExclusionKeys.has(k));
          if (isPreviouslySeen) {
            previouslyDiscoveredSkipped++;
            continue;
          }

          // Check against duplicates already found within this new run
          const isDuplicateInRun = keys.some((k) => newRunSeenKeys.has(k));
          if (isDuplicateInRun) {
            providerDuplicatesSkipped++;
            continue;
          }

          for (const k of keys) {
            newRunSeenKeys.add(k);
          }

          newDiscoveredItems.push({
            ...item,
            matchedBuyerCategory: item.matchedBuyerCategory || cat,
            searchTargetUsed: item.searchTargetUsed || `${cat} in ${mission.targetMarket}`
          });

          if (newDiscoveredItems.length >= targetNewCount) {
            break;
          }
        }
      } catch (err) {
        console.warn(`Category discovery query for "${cat}" failed:`, err);
      }
    }

    // 4. Fallback search with product name if target categories were exhausted before reaching targetNewCount
    if (newDiscoveredItems.length < targetNewCount) {
      const searchQuery = mission.product ? mission.product.name : mission.name;
      if (!targetsUsed.includes(searchQuery)) {
        targetsUsed.push(searchQuery);
        const needed = targetNewCount - newDiscoveredItems.length;

        try {
          const results = await businessSearchService.search(
            {
              q: searchQuery,
              location: mission.targetMarket,
              limit: Math.min(Math.max(needed * 2, 20), 50),
              provider: providerKey,
              buyerType: mission.buyerType !== 'AI_DECIDE' ? (mission.buyerType as any) : undefined
            },
            {
              organizationId: mission.organizationId,
              userId: context?.userId || mission.createdByUserId,
              correlationId: context?.correlationId || `mission-${mission.id}-raw`
            }
          );

          for (const item of results) {
            const keys = this.extractDedupeKeys({
              provider: item.provider,
              externalId: item.externalId,
              name: item.name,
              address: item.address,
              locality: item.locality,
              city: item.city,
              contacts: item.contacts,
              website: item.website
            });

            if (keys.some((k) => existingExclusionKeys.has(k))) {
              previouslyDiscoveredSkipped++;
              continue;
            }
            if (keys.some((k) => newRunSeenKeys.has(k))) {
              providerDuplicatesSkipped++;
              continue;
            }

            for (const k of keys) {
              newRunSeenKeys.add(k);
            }

            newDiscoveredItems.push({
              ...item,
              matchedBuyerCategory: item.matchedBuyerCategory || 'General',
              searchTargetUsed: item.searchTargetUsed || `${searchQuery} in ${mission.targetMarket}`
            });

            if (newDiscoveredItems.length >= targetNewCount) {
              break;
            }
          }
        } catch {
          // Ignore fallback query failure
        }
      }
    }

    // 5. Persist ONLY new buyers (never overwrite or delete older records)
    const newlyCreatedBuyerIds = new Set<string>();

    for (const item of newDiscoveredItems) {
      try {
        const created = await prisma.salesMissionBuyer.create({
          data: {
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
        newlyCreatedBuyerIds.add(created.id);
      } catch (err) {
        // Safe skip if database uniqueness constraint caught a race condition
        console.warn('Skipped duplicate database insert for buyer:', err);
      }
    }

    // 6. Fetch cumulative buyers
    const allBuyers = await prisma.salesMissionBuyer.findMany({
      where: {
        salesMissionId: mission.id,
        organizationId: mission.organizationId
      },
      orderBy: { createdAt: 'desc' }
    });

    // 7. Calculate run metrics & persist in run history
    const existingSnapshot = (mission.productAnalysisSnapshot as any) || {};
    const previousRuns = Array.isArray(existingSnapshot.discoveryRuns) ? existingSnapshot.discoveryRuns : [];
    const runNumber = previousRuns.length + 1;

    const runMetrics: DiscoveryRunMetrics = {
      runNumber,
      newBuyersAdded: newlyCreatedBuyerIds.size,
      previouslyDiscoveredSkipped,
      providerDuplicatesSkipped,
      missionTotal: allBuyers.length,
      targetsUsed,
      message:
        newlyCreatedBuyerIds.size > 0
          ? `${newlyCreatedBuyerIds.size} new potential buyers found`
          : 'No new buyers were found for the current targets and location.'
    };

    const updatedSnapshot = {
      ...existingSnapshot,
      discoveryRuns: [...previousRuns, runMetrics],
      latestRunMetrics: runMetrics
    };

    const updated = await prisma.salesMission.update({
      where: { id: missionId },
      data: {
        status: SalesMissionStatus.READY,
        resultCount: allBuyers.length,
        productAnalysisSnapshot: updatedSnapshot,
        completedAt: new Date()
      },
      include: {
        product: true
      }
    });

    return this.serializeMission(updated, allBuyers, newlyCreatedBuyerIds, runMetrics);
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
