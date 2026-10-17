/**
 * Sales Analytics Service
 *
 * Provides real-time aggregated sales analytics derived exclusively
 * from persisted PostgreSQL records, with optional Redis caching.
 *
 * Guarantees:
 * 1. Zero external API calls on load (0 Gemini, 0 Google Places, 0 OSM, 0 Facebook, 0 TikTok).
 * 2. Strict tenant isolation (scoped by organizationId).
 * 3. Reply Rate denominator uses only CONTACTED buyers (never APPROVED drafts).
 * 4. Multi-currency safety (never combine BDT and USD).
 * 5. Primary source attribution for conversions and revenue.
 * 6. Minimum cohort N >= 5 for recommendations.
 */

import prisma from '@leadmate/db';
import Redis from 'ioredis';
import {
  computeDashboardKpis,
  computeSourceEffectiveness,
  computeProductAnalytics,
  aggregateLearningLoopCohorts,
  generateDiscoveryRecommendations,
  type BuyerAnalyticsRecord
} from '@leadmate/core';
import type {
  DashboardSalesKpisDto,
  ProductAnalyticsDto,
  SourceEffectivenessDto,
  RecommendationResponseDto,
  AnalyticsProviderStatus
} from '@leadmate/shared';
import { env } from '../config/env.js';
import { NotFoundError } from '../lib/errors.js';

import { getRedisClient } from '../lib/redis.js';

const CACHE_TTL_SECONDS = 900; // 15 minutes

function getRedis(): Redis | null {
  return getRedisClient();
}

async function getFromCache<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    if (raw) {
      return JSON.parse(raw) as T;
    }
  } catch {
    // Redis unavailable, fallback to DB
  }
  return null;
}

async function setInCache(key: string, data: any, ttlSeconds = CACHE_TTL_SECONDS): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(data));
  } catch {
    // Redis unavailable, continue silently
  }
}

export class SalesAnalyticsService {
  /**
   * Helper to load all persisted buyer records for an organization with related interactions & drafts.
   */
  private async loadTenantBuyerRecords(
    organizationId: string,
    productId?: string
  ): Promise<BuyerAnalyticsRecord[]> {
    const whereClause: any = {
      organizationId
    };

    if (productId) {
      whereClause.salesMission = {
        productId
      };
    }

    const rawBuyers = await prisma.salesMissionBuyer.findMany({
      where: whereClause,
      select: {
        id: true,
        organizationId: true,
        salesMissionId: true,
        externalBusinessId: true,
        provider: true,
        businessName: true,
        category: true,
        address: true,
        city: true,
        country: true,
        website: true,
        phone: true,
        whatsappStatus: true,
        priority: true,
        wholesaleIntent: true,
        matchedBuyerCategory: true,
        conversionStage: true,
        conversionWonEvidence: true,
        conversionLostReason: true,
        sourceEvidences: true,
        enrichedContacts: true,
        interactions: {
          select: {
            direction: true,
            channel: true,
            classification: true,
            createdAt: true
          }
        },
        outreachDrafts: {
          select: {
            channel: true,
            status: true,
            aiContextSnapshot: true
          }
        },
        salesMission: {
          select: {
            targetMarket: true,
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                category: true,
                currency: true,
                sellingPrice: true
              }
            }
          }
        }
      }
    });

    return rawBuyers.map((b) => ({
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
      website: b.website,
      phone: b.phone,
      whatsappStatus: b.whatsappStatus,
      priority: b.priority,
      wholesaleIntent: b.wholesaleIntent,
      matchedBuyerCategory: b.matchedBuyerCategory,
      conversionStage: b.conversionStage,
      conversionWonEvidence: b.conversionWonEvidence as any,
      conversionLostReason: b.conversionLostReason,
      sourceEvidences: b.sourceEvidences as any,
      enrichedContacts: b.enrichedContacts as any,
      interactions: b.interactions,
      outreachDrafts: b.outreachDrafts,
      product: b.salesMission?.product
        ? {
            id: b.salesMission.product.id,
            name: b.salesMission.product.name,
            sku: b.salesMission.product.sku,
            category: b.salesMission.product.category,
            currency: b.salesMission.product.currency,
            sellingPrice: b.salesMission.product.sellingPrice ? Number(b.salesMission.product.sellingPrice) : null
          }
        : null,
      targetMarket: b.salesMission?.targetMarket
    }));
  }

  /**
   * Loads provider statuses configured for the organization.
   */
  private async loadTenantProviderStatuses(
    organizationId: string
  ): Promise<Record<string, AnalyticsProviderStatus>> {
    const configs = await prisma.dataSourceConfig.findMany({
      where: { organizationId },
      select: {
        provider: true,
        isEnabled: true,
        status: true
      }
    });

    const statusMap: Record<string, AnalyticsProviderStatus> = {
      openstreetmap: 'ACTIVE',
      'company-website': 'ACTIVE',
      'public-directory': 'ACTIVE'
    };

    for (const c of configs) {
      const pKey = c.provider.toLowerCase();
      if (!c.isEnabled) {
        statusMap[pKey] = 'DISABLED';
      } else if (c.status === 'APPROVED') {
        statusMap[pKey] = 'ACTIVE';
      } else if (c.status === 'REJECTED') {
        statusMap[pKey] = 'ERROR';
      } else {
        statusMap[pKey] = 'NOT_CONFIGURED';
      }
    }

    return statusMap;
  }

  /**
   * GET /api/v1/sales-missions/analytics/dashboard
   */
  async getDashboardKpis(organizationId: string): Promise<DashboardSalesKpisDto> {
    const cacheKey = `leadmate:analytics:${organizationId}:dashboard:all`;
    const cached = await getFromCache<DashboardSalesKpisDto>(cacheKey);
    if (cached) return cached;

    // Zero external calls — only local DB queries
    const [buyers, totalProductsCount, activeMissionsCount] = await Promise.all([
      this.loadTenantBuyerRecords(organizationId),
      prisma.product.count({ where: { organizationId } }),
      prisma.salesMission.count({
        where: {
          organizationId,
          status: { in: ['READY', 'DISCOVERING', 'TARGETING', 'ANALYZING'] }
        }
      })
    ]);

    const result = computeDashboardKpis(buyers, totalProductsCount, activeMissionsCount);
    await setInCache(cacheKey, result);
    return result;
  }

  /**
   * GET /api/v1/sales-missions/analytics/products/:productId
   */
  async getProductAnalytics(
    organizationId: string,
    productId: string
  ): Promise<ProductAnalyticsDto> {
    const cacheKey = `leadmate:analytics:${organizationId}:product:${productId}`;
    const cached = await getFromCache<ProductAnalyticsDto>(cacheKey);
    if (cached) return cached;

    const product = await prisma.product.findFirst({
      where: {
        id: productId,
        organizationId
      },
      select: {
        id: true,
        name: true,
        sku: true,
        category: true,
        currency: true,
        sellingPrice: true
      }
    });

    if (!product) {
      throw new NotFoundError(`Product "${productId}" not found in organization.`);
    }

    const buyers = await this.loadTenantBuyerRecords(organizationId, productId);
    const result = computeProductAnalytics(
      {
        id: product.id,
        name: product.name,
        sku: product.sku,
        category: product.category,
        currency: product.currency,
        sellingPrice: product.sellingPrice ? Number(product.sellingPrice) : null
      },
      buyers
    );

    await setInCache(cacheKey, result);
    return result;
  }

  /**
   * GET /api/v1/sales-missions/analytics/sources
   */
  async getSourceEffectiveness(organizationId: string): Promise<SourceEffectivenessDto[]> {
    const cacheKey = `leadmate:analytics:${organizationId}:sources:all`;
    const cached = await getFromCache<SourceEffectivenessDto[]>(cacheKey);
    if (cached) return cached;

    const [buyers, providerStatuses] = await Promise.all([
      this.loadTenantBuyerRecords(organizationId),
      this.loadTenantProviderStatuses(organizationId)
    ]);

    const result = computeSourceEffectiveness(buyers, providerStatuses);
    await setInCache(cacheKey, result);
    return result;
  }

  /**
   * GET /api/v1/sales-missions/analytics/recommendations
   */
  async getRecommendations(
    organizationId: string,
    productId?: string
  ): Promise<RecommendationResponseDto> {
    const cacheKey = `leadmate:analytics:${organizationId}:recommendations:${productId || 'all'}`;
    const cached = await getFromCache<RecommendationResponseDto>(cacheKey);
    if (cached) return cached;

    const buyers = await this.loadTenantBuyerRecords(organizationId, productId);
    const cohorts = aggregateLearningLoopCohorts(buyers);

    let ibpFallback = null;
    if (productId) {
      const missionWithAnalysis = await prisma.salesMission.findFirst({
        where: {
          organizationId,
          productId,
          productAnalysisSnapshot: { not: null as any }
        },
        select: {
          productAnalysisSnapshot: true
        }
      });

      if (missionWithAnalysis?.productAnalysisSnapshot) {
        const snap = missionWithAnalysis.productAnalysisSnapshot as any;
        if (snap.idealBuyerProfile) {
          ibpFallback = snap.idealBuyerProfile;
        }
      }
    }

    const result = generateDiscoveryRecommendations({
      cohorts,
      targetProductId: productId,
      idealBuyerProfileFallback: ibpFallback
    });

    await setInCache(cacheKey, result);
    return result;
  }
}

export const salesAnalyticsService = new SalesAnalyticsService();
