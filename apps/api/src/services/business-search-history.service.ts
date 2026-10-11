/**
 * Business Search History & Session Persistence Service
 *
 * Implements persistent business search sessions, recent search history,
 * snapshot persistence, and automatic duplicate reuse.
 *
 * SECURITY CONTRACT:
 * All operations are strictly scoped to authenticated (organizationId, userId).
 * Client-submitted identifiers or snapshots are validated against size and content limits.
 */

import prisma, { Prisma } from '@leadmate/db';
import {
  type CreateBusinessSearchSessionInput,
  type BusinessSearchSessionSummary,
  type BusinessSearchSessionDetail,
  type BusinessSearchResult,
  businessSearchResultSchema
} from '@leadmate/shared';
import { BadRequestError, NotFoundError } from '../lib/errors.js';

const MAX_HISTORY_ENTRIES = 20;
const MAX_SNAPSHOT_BYTES = 1_572_864; // 1.5 MB payload cap
const DEDUPLICATION_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export interface HistoryContext {
  organizationId: string;
  userId: string;
}

export class BusinessSearchHistoryService {
  /**
   * Sanitizes results snapshot to ensure only safe, normalized business card fields
   * are stored (strictly strips any API keys, credentials, or raw secrets).
   */
  private sanitizeSnapshot(snapshot: BusinessSearchResult[]): BusinessSearchResult[] {
    return snapshot.map((item) => {
      // Validate against the shared schema
      return businessSearchResultSchema.parse({
        externalId: item.externalId,
        provider: item.provider,
        name: item.name,
        category: item.category,
        description: item.description,
        address: item.address,
        locality: item.locality,
        city: item.city,
        region: item.region,
        country: item.country || 'BD',
        latitude: item.latitude,
        longitude: item.longitude,
        website: item.website,
        rating: item.rating,
        reviewCount: item.reviewCount || 0,
        sourceUrl: item.sourceUrl,
        contacts: item.contacts || []
      });
    });
  }

  /**
   * Validates storage size of results snapshot.
   */
  private validateSnapshotStorage(snapshot: unknown): void {
    const serialized = JSON.stringify(snapshot);
    if (serialized.length > MAX_SNAPSHOT_BYTES) {
      throw new BadRequestError(
        `Results snapshot exceeds maximum allowable size of 1.5MB (${serialized.length} bytes).`
      );
    }
  }

  /**
   * GET recent searches list (up to 20, newest first).
   * Excludes full resultsSnapshot for performance.
   */
  async listHistory(ctx: HistoryContext, limit = MAX_HISTORY_ENTRIES): Promise<BusinessSearchSessionSummary[]> {
    const take = Math.min(Math.max(1, limit), MAX_HISTORY_ENTRIES);

    const sessions = await prisma.businessSearchSession.findMany({
      where: {
        organizationId: ctx.organizationId,
        userId: ctx.userId
      },
      orderBy: {
        lastOpenedAt: 'desc'
      },
      take,
      select: {
        id: true,
        organizationId: true,
        userId: true,
        productQuery: true,
        location: true,
        buyerType: true,
        category: true,
        provider: true,
        limit: true,
        resultCount: true,
        selectedAiBuyerTargets: true,
        searchStatus: true,
        lastOpenedAt: true,
        createdAt: true,
        updatedAt: true
      }
    });

    return sessions.map((s) => ({
      ...s,
      selectedAiBuyerTargets: (s.selectedAiBuyerTargets as any) ?? null,
      lastOpenedAt: s.lastOpenedAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString()
    }));
  }

  /**
   * GET latest search session for returning user restore.
   */
  async getLatestSession(ctx: HistoryContext): Promise<BusinessSearchSessionDetail | null> {
    const session = await prisma.businessSearchSession.findFirst({
      where: {
        organizationId: ctx.organizationId,
        userId: ctx.userId
      },
      orderBy: {
        lastOpenedAt: 'desc'
      }
    });

    if (!session) {
      return null;
    }

    return {
      id: session.id,
      organizationId: session.organizationId,
      userId: session.userId,
      productQuery: session.productQuery,
      location: session.location,
      buyerType: session.buyerType,
      category: session.category,
      provider: session.provider,
      limit: session.limit,
      resultCount: session.resultCount,
      selectedAiBuyerTargets: (session.selectedAiBuyerTargets as any) ?? null,
      resultsSnapshot: (session.resultsSnapshot as any) ?? [],
      sourceMetadata: (session.sourceMetadata as any) ?? null,
      searchStatus: session.searchStatus,
      lastOpenedAt: session.lastOpenedAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString()
    };
  }

  /**
   * GET single session by ID and update lastOpenedAt.
   */
  async getSession(ctx: HistoryContext, id: string): Promise<BusinessSearchSessionDetail> {
    const session = await prisma.businessSearchSession.findFirst({
      where: {
        id,
        organizationId: ctx.organizationId,
        userId: ctx.userId
      }
    });

    if (!session) {
      throw new NotFoundError('Business search session not found');
    }

    // Touch lastOpenedAt
    const updated = await prisma.businessSearchSession.update({
      where: { id: session.id },
      data: { lastOpenedAt: new Date() }
    });

    return {
      id: updated.id,
      organizationId: updated.organizationId,
      userId: updated.userId,
      productQuery: updated.productQuery,
      location: updated.location,
      buyerType: updated.buyerType,
      category: updated.category,
      provider: updated.provider,
      limit: updated.limit,
      resultCount: updated.resultCount,
      selectedAiBuyerTargets: (updated.selectedAiBuyerTargets as any) ?? null,
      resultsSnapshot: (updated.resultsSnapshot as any) ?? [],
      sourceMetadata: (updated.sourceMetadata as any) ?? null,
      searchStatus: updated.searchStatus,
      lastOpenedAt: updated.lastOpenedAt.toISOString(),
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString()
    };
  }

  /**
   * POST create or deduplicate search session.
   */
  async saveSession(
    ctx: HistoryContext,
    input: CreateBusinessSearchSessionInput
  ): Promise<BusinessSearchSessionDetail> {
    const sanitizedSnapshot = this.sanitizeSnapshot(input.resultsSnapshot || []);
    this.validateSnapshotStorage(sanitizedSnapshot);

    const normProduct = input.productQuery.trim().toLowerCase();
    const normLocation = input.location.trim().toLowerCase();
    const normBuyerType = input.buyerType?.trim() || null;
    const normCategory = input.category?.trim() || null;
    const normProvider = input.provider?.trim() || 'auto';

    // Duplicate check within short window (1 hour)
    const windowStart = new Date(Date.now() - DEDUPLICATION_WINDOW_MS);

    const existingMatch = await prisma.businessSearchSession.findFirst({
      where: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        lastOpenedAt: { gte: windowStart },
        productQuery: { equals: input.productQuery.trim(), mode: 'insensitive' },
        location: { equals: input.location.trim(), mode: 'insensitive' },
        buyerType: normBuyerType,
        category: normCategory,
        provider: normProvider
      },
      orderBy: { lastOpenedAt: 'desc' }
    });

    let savedSession;

    if (existingMatch) {
      // Reuse / update existing session
      savedSession = await prisma.businessSearchSession.update({
        where: { id: existingMatch.id },
        data: {
          productQuery: input.productQuery.trim(),
          location: input.location.trim(),
          buyerType: normBuyerType,
          category: normCategory,
          provider: normProvider,
          limit: input.limit || 20,
          selectedAiBuyerTargets: (input.selectedAiBuyerTargets as any) ?? Prisma.JsonNull,
          resultCount: sanitizedSnapshot.length,
          resultsSnapshot: sanitizedSnapshot as unknown as Prisma.InputJsonValue,
          sourceMetadata: (input.sourceMetadata as any) ?? Prisma.JsonNull,
          searchStatus: input.searchStatus || 'SUCCESS',
          lastOpenedAt: new Date()
        }
      });
    } else {
      // Create new session
      savedSession = await prisma.businessSearchSession.create({
        data: {
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          productQuery: input.productQuery.trim(),
          location: input.location.trim(),
          buyerType: normBuyerType,
          category: normCategory,
          provider: normProvider,
          limit: input.limit || 20,
          selectedAiBuyerTargets: (input.selectedAiBuyerTargets as any) ?? Prisma.JsonNull,
          resultCount: sanitizedSnapshot.length,
          resultsSnapshot: sanitizedSnapshot as unknown as Prisma.InputJsonValue,
          sourceMetadata: (input.sourceMetadata as any) ?? Prisma.JsonNull,
          searchStatus: input.searchStatus || 'SUCCESS',
          lastOpenedAt: new Date()
        }
      });

      // Trim older entries beyond MAX_HISTORY_ENTRIES
      await this.trimUserHistory(ctx.organizationId, ctx.userId);
    }

    return {
      id: savedSession.id,
      organizationId: savedSession.organizationId,
      userId: savedSession.userId,
      productQuery: savedSession.productQuery,
      location: savedSession.location,
      buyerType: savedSession.buyerType,
      category: savedSession.category,
      provider: savedSession.provider,
      limit: savedSession.limit,
      resultCount: savedSession.resultCount,
      selectedAiBuyerTargets: (savedSession.selectedAiBuyerTargets as any) ?? null,
      resultsSnapshot: (savedSession.resultsSnapshot as any) ?? [],
      sourceMetadata: (savedSession.sourceMetadata as any) ?? null,
      searchStatus: savedSession.searchStatus,
      lastOpenedAt: savedSession.lastOpenedAt.toISOString(),
      createdAt: savedSession.createdAt.toISOString(),
      updatedAt: savedSession.updatedAt.toISOString()
    };
  }

  /**
   * Enforces max 20 history sessions per user.
   */
  private async trimUserHistory(organizationId: string, userId: string): Promise<void> {
    const excessSessions = await prisma.businessSearchSession.findMany({
      where: { organizationId, userId },
      orderBy: { lastOpenedAt: 'desc' },
      skip: MAX_HISTORY_ENTRIES,
      select: { id: true }
    });

    if (excessSessions.length > 0) {
      const idsToDelete = excessSessions.map((s) => s.id);
      await prisma.businessSearchSession.deleteMany({
        where: {
          id: { in: idsToDelete },
          organizationId,
          userId
        }
      });
    }
  }

  /**
   * DELETE single search history item.
   */
  async deleteSession(ctx: HistoryContext, id: string): Promise<{ success: boolean }> {
    const existing = await prisma.businessSearchSession.findFirst({
      where: {
        id,
        organizationId: ctx.organizationId,
        userId: ctx.userId
      }
    });

    if (!existing) {
      throw new NotFoundError('Search session not found');
    }

    await prisma.businessSearchSession.delete({
      where: { id: existing.id }
    });

    return { success: true };
  }

  /**
   * DELETE all history for current user.
   */
  async clearHistory(ctx: HistoryContext): Promise<{ success: boolean; count: number }> {
    const res = await prisma.businessSearchSession.deleteMany({
      where: {
        organizationId: ctx.organizationId,
        userId: ctx.userId
      }
    });

    return { success: true, count: res.count };
  }
}

export const businessSearchHistoryService = new BusinessSearchHistoryService();
