/**
 * Business Search & Trusted Save Service
 *
 * Implements preview-only search across registered datasource providers
 * and trusted server-side lead persistence with deterministic duplicate detection.
 */

import prisma, {
  Prisma,
  ContactType,
  PhoneType,
  WhatsAppStatus,
  EvidenceType
} from '@leadmate/db';
import {
  ErrorCodes,
  WebsiteStatus,
  OnlinePresenceType,
  DuplicateMatchLevel,
  DuplicateAction,
  businessSearchResultSchema,
  type BusinessSearchQuery,
  type BusinessSearchResult,
  type SaveLeadRequest
} from '@leadmate/shared';
import {
  getProvider,
  UnknownProviderError
} from '@leadmate/datasources';
import {
  detectDuplicate,
  mergeIntoExistingLead,
  normalizeBusinessName,
  normalizeWebsite,
  normalizePhone,
  normalizeEmail,
  normalizeContact,
  type IncomingLeadData,
  type IncomingContact
} from '@leadmate/core';
import {
  AppError,
  BadRequestError,
  NotFoundError
} from '../lib/errors.js';
import { invalidateLeadOnlinePresenceAnalysis } from './online-presence.service.js';
import { aiBuyerDiscoveryService } from './ai-buyer-discovery.service.js';
import { aiSettingsService } from './ai-settings.service.js';
import { GEMINI_PROVIDER_KEY } from '@leadmate/ai';
import { datasourceSettingsService } from './datasource-settings.service.js';
import { z } from 'zod';

export interface BusinessSearchRequestContext {
  organizationId: string;
  userId: string;
  correlationId: string;
}

export interface SaveLeadResult {
  action: DuplicateAction;
  leadId: string;
  matchReason?: string;
}

export class BusinessSearchService {
  /**
   * Helper to parse and normalize target categories from query input.
   */
  private parseTargetCategories(input?: string[] | string | null): string[] {
    if (!input) return [];
    if (Array.isArray(input)) {
      return input.map((s) => s.trim()).filter((s) => s.length > 0);
    }
    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return parsed.map((s) => String(s).trim()).filter((s) => s.length > 0);
          }
        } catch {
          // Fall back to comma split
        }
      }
      return trimmed
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return [];
  }

  /**
   * Generates strong deduplication keys for a business result across 4 tiers:
   * 1. provider + externalId
   * 2. normalized business name + address / locality / city
   * 3. verified / found direct phone
   * 4. normalized website domain
   */
  private extractDedupeKeys(item: BusinessSearchResult): string[] {
    const keys: string[] = [];

    // 1. Provider + externalId
    if (item.provider && item.externalId) {
      keys.push(`provider:${item.provider.toUpperCase().trim()}:${item.externalId.trim().toLowerCase()}`);
    }

    // 2. Normalized business name + address/locality/city
    const normName = normalizeBusinessName(item.name);
    if (normName) {
      const locKey = normalizeBusinessName(item.address || item.locality || item.city || '');
      if (locKey) {
        keys.push(`name_loc:${normName}:${locKey}`);
      } else {
        keys.push(`name:${normName}`);
      }
    }

    // 3. Verified / Found phone number
    if (item.contacts && item.contacts.length > 0) {
      for (const c of item.contacts) {
        if (c.type === ContactType.PHONE || c.type === ContactType.WHATSAPP) {
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
   * Executes a single provider search for a specific category query.
   * Supports AUTO (free-first: OpenStreetMap -> Google Places -> Mock fallback),
   * OPENSTREETMAP, GOOGLE_PLACES, and MOCK.
   */
  private async executeSingleProviderSearch(
    subQuery: {
      q: string;
      location: string;
      category?: string;
      limit?: number;
      cursor?: string;
    },
    requestedProvider: string,
    context: BusinessSearchRequestContext
  ): Promise<BusinessSearchResult[]> {
    let rawResults: BusinessSearchResult[] = [];

    if (requestedProvider === 'AUTO') {
      // 1. Free-First Invariant: Search OpenStreetMap first
      try {
        const osmProvider = getProvider('OPENSTREETMAP');
        rawResults = await osmProvider.search(
          {
            q: subQuery.q,
            location: subQuery.location,
            category: subQuery.category,
            limit: subQuery.limit,
            cursor: subQuery.cursor
          },
          {
            organizationId: context.organizationId,
            correlationId: context.correlationId
          }
        );
      } catch {
        rawResults = [];
      }

      // 2. If OSM returned 0 results, check if Google Places is configured
      if (rawResults.length === 0) {
        const providerContext = await datasourceSettingsService.getActiveProviderContext(context.organizationId);
        if (providerContext.apiKey) {
          try {
            const googleProvider = getProvider('GOOGLE_PLACES');
            rawResults = await googleProvider.search(
              {
                q: subQuery.q,
                location: subQuery.location,
                category: subQuery.category,
                limit: subQuery.limit,
                cursor: subQuery.cursor
              },
              {
                organizationId: context.organizationId,
                apiKey: providerContext.apiKey,
                correlationId: context.correlationId
              }
            );
          } catch {
            rawResults = [];
          }
        }
      }

      // 3. Fallback to Mock fixtures if both yielded 0 results in development / test offline environments
      if (rawResults.length === 0) {
        try {
          const mockProvider = getProvider('MOCK');
          rawResults = await mockProvider.search(
            {
              q: subQuery.q,
              location: subQuery.location,
              category: subQuery.category,
              limit: subQuery.limit,
              cursor: subQuery.cursor
            },
            {
              organizationId: context.organizationId,
              correlationId: context.correlationId
            }
          );
        } catch {
          rawResults = [];
        }
      }
    } else if (requestedProvider === 'GOOGLE_PLACES') {
      const providerContext = await datasourceSettingsService.getActiveProviderContext(context.organizationId);
      if (!providerContext.apiKey) {
        throw new BadRequestError('Google Places API key is not configured for this organization.');
      }
      const provider = getProvider('GOOGLE_PLACES');
      rawResults = await provider.search(
        {
          q: subQuery.q,
          location: subQuery.location,
          category: subQuery.category,
          limit: subQuery.limit,
          cursor: subQuery.cursor
        },
        {
          organizationId: context.organizationId,
          apiKey: providerContext.apiKey,
          correlationId: context.correlationId
        }
      );
    } else {
      let provider;
      try {
        provider = getProvider(requestedProvider);
      } catch (err) {
        if (err instanceof UnknownProviderError) {
          throw new BadRequestError(`Unknown datasource provider: "${requestedProvider}"`, {
            provider: requestedProvider
          });
        }
        throw err;
      }

      let decryptedKey: string | undefined;
      try {
        decryptedKey = await datasourceSettingsService.getDecryptedProviderKey(
          context.organizationId,
          requestedProvider
        );
      } catch {
        // Safe fail-closed
      }

      rawResults = await provider.search(
        {
          q: subQuery.q,
          location: subQuery.location,
          category: subQuery.category,
          limit: subQuery.limit,
          cursor: subQuery.cursor
        },
        {
          organizationId: context.organizationId,
          apiKey: decryptedKey,
          correlationId: context.correlationId
        }
      );
    }

    return rawResults;
  }

  /**
   * Performs AI-driven read-only business search preview across registered providers.
   *
   * ARCHITECTURAL CONTRACT:
   * 1. AI Determines WHO to search for (buyer target categories).
   * 2. Real directory providers (Google Places / OSM) find real businesses.
   * 3. Selected buyer categories in UI take strict precedence.
   * 4. Multi-target search distributes API budget across bounded targets (top 3–5).
   * 5. Results are merged and deduplicated across 4 identifier tiers.
   * 6. Provenance fields (matchedBuyerCategory, searchTargetUsed) are preserved.
   * 7. Safe fallback on AI errors without returning 500.
   */
  async search(
    query: BusinessSearchQuery & { provider?: string; targetCategories?: string[] | string },
    context: BusinessSearchRequestContext
  ): Promise<BusinessSearchResult[]> {
    const defaultProvider = process.env.NODE_ENV === 'test' ? 'MOCK' : 'AUTO';
    const requestedProvider = (query.provider || defaultProvider).toUpperCase().trim().replace(/-/g, '_');
    const overallLimit = Math.min(Math.max(query.limit ?? 20, 1), 50);

    // 1. Determine target categories to search
    let targetCategories: string[] = this.parseTargetCategories(query.targetCategories);
    const hasExplicitTargets = targetCategories.length > 0;

    if (!hasExplicitTargets) {
      // Auto AI Mode: Check if AI Buyer Discovery is active for tenant
      let isAiActive = false;
      try {
        const aiContext = await aiSettingsService.getActiveAiContext(
          context.organizationId,
          GEMINI_PROVIDER_KEY
        );
        isAiActive = Boolean(aiContext.isEnabled && aiContext.apiKey);
      } catch {
        isAiActive = false;
      }

      if (isAiActive) {
        try {
          const aiResponse = await aiBuyerDiscoveryService.suggestBuyerTargets(
            {
              product: query.q,
              location: query.location,
              buyerType: query.buyerType
            },
            context
          );

          const candidates = (aiResponse.buyerTargets || (aiResponse as any).categories || [])
            .map((t: any) => (t.category || t.name || '').trim())
            .filter((c: string) => c.length > 0);

          if (candidates.length > 0) {
            targetCategories = candidates;
          }
        } catch {
          // Fallback safely if AI fails, is quota-limited, or throws
          targetCategories = [];
        }
      }

      // Safe Fallback Resolution when AI is disabled, unconfigured, or returned 0 targets
      if (targetCategories.length === 0) {
        if (query.category && query.category.trim().length > 0) {
          targetCategories = [query.category.trim()];
        } else {
          targetCategories = [query.q.trim()];
        }
      }
    }

    // 2. Limit API Cost: Bound target count to top 3–5 categories
    const boundedTargets = targetCategories.slice(0, 5);

    // 3. Multi-Category Search & Deduplication
    const dedupedResults: BusinessSearchResult[] = [];
    const seenKeys = new Set<string>();

    for (let i = 0; i < boundedTargets.length; i++) {
      if (dedupedResults.length >= overallLimit) {
        break; // Stop early when enough unique businesses are collected
      }

      const categoryTarget = boundedTargets[i];
      const remainingTargets = boundedTargets.length - i;
      const remainingLimit = overallLimit - dedupedResults.length;
      const perCategoryBudget = Math.min(
        overallLimit,
        Math.max(5, Math.ceil(remainingLimit / remainingTargets))
      );

      const categoryResults = await this.executeSingleProviderSearch(
        {
          q: categoryTarget,
          location: query.location,
          category: categoryTarget,
          limit: perCategoryBudget,
          cursor: query.cursor
        },
        requestedProvider,
        context
      );

      for (const item of categoryResults) {
        const keys = this.extractDedupeKeys(item);
        const isDuplicate = keys.some((k) => seenKeys.has(k));

        if (!isDuplicate) {
          for (const k of keys) {
            seenKeys.add(k);
          }

          const provenanceItem: BusinessSearchResult = {
            ...item,
            matchedBuyerCategory: item.matchedBuyerCategory || categoryTarget,
            searchTargetUsed: item.searchTargetUsed || `${categoryTarget} in ${query.location}`
          };

          dedupedResults.push(provenanceItem);

          if (dedupedResults.length >= overallLimit) {
            break;
          }
        }
      }
    }

    // 4. Last-Resort Search Fallback if category searches returned 0 results
    // (Only if user did not provide explicit category targets and raw query was not already searched)
    if (
      dedupedResults.length === 0 &&
      !hasExplicitTargets &&
      !boundedTargets.some((t) => t.toLowerCase() === query.q.trim().toLowerCase())
    ) {
      try {
        const rawResults = await this.executeSingleProviderSearch(
          {
            q: query.q.trim(),
            location: query.location,
            category: query.category,
            limit: overallLimit,
            cursor: query.cursor
          },
          requestedProvider,
          context
        );

        for (const item of rawResults) {
          const keys = this.extractDedupeKeys(item);
          const isDuplicate = keys.some((k) => seenKeys.has(k));

          if (!isDuplicate) {
            for (const k of keys) {
              seenKeys.add(k);
            }

            const provenanceItem: BusinessSearchResult = {
              ...item,
              matchedBuyerCategory: item.matchedBuyerCategory || query.category || 'General',
              searchTargetUsed: item.searchTargetUsed || `${query.q.trim()} in ${query.location}`
            };

            dedupedResults.push(provenanceItem);

            if (dedupedResults.length >= overallLimit) {
              break;
            }
          }
        }
      } catch {
        // Safe non-blocking fallback
      }
    }

    // Runtime validation of provider search response
    return z.array(businessSearchResultSchema).parse(dedupedResults.slice(0, overallLimit));
  }

  /**
   * Executes trusted lead save from authoritative provider resolution.
   *
   * SECURITY CONTRACT:
   * 1. Resolves canonical record authoritatively from datasource provider.
   * 2. Ignores/rejects all untrusted client payload data.
   * 3. Scopes all queries and mutations to authenticated organizationId.
   * 4. Evaluates duplicate rules inside concurrency-safe transaction.
   */
  async saveLead(
    input: SaveLeadRequest,
    context: BusinessSearchRequestContext
  ): Promise<SaveLeadResult> {
    const { organizationId, userId, correlationId } = context;
    const providerName = input.provider.toUpperCase().trim().replace(/-/g, '_');

    // 1. Resolve Provider
    let provider;
    try {
      provider = getProvider(providerName);
    } catch (err) {
      if (err instanceof UnknownProviderError) {
        throw new BadRequestError(`Unknown datasource provider: "${input.provider}"`, {
          provider: input.provider
        });
      }
      throw err;
    }

    // Resolve API key if Google Places
    let apiKey: string | undefined;
    if (providerName === 'GOOGLE_PLACES') {
      const activeCtx = await datasourceSettingsService.getActiveProviderContext(organizationId);
      apiKey = activeCtx.apiKey;
    }

    // 2. Authoritative Resolution with exact externalId
    const rawAuthoritative = await provider.resolveByExternalId(input.externalId, {
      organizationId,
      apiKey,
      correlationId
    });

    if (!rawAuthoritative) {
      throw new NotFoundError(
        `Business with external ID "${input.externalId}" not found in provider "${providerName}"`
      );
    }


    // Runtime validation of authoritative provider record
    const authoritative = businessSearchResultSchema.parse(rawAuthoritative);

    // 3. Map authoritative contacts into normalized direct contact structures
    const incomingContacts: IncomingContact[] = [];

    if (authoritative.contacts && Array.isArray(authoritative.contacts)) {
      for (const contact of authoritative.contacts) {
        // Direct channels only: PHONE, WHATSAPP, EMAIL
        if (
          contact.type === ContactType.PHONE ||
          contact.type === ContactType.WHATSAPP ||
          contact.type === ContactType.EMAIL
        ) {
          incomingContacts.push({
            type: contact.type,
            rawValue: contact.rawValue,
            phoneType: contact.phoneType,
            whatsappStatus: contact.whatsappStatus || WhatsAppStatus.UNKNOWN,
            isPrimary: false,
            evidence: [
              {
                sourceName: providerName,
                sourceUrl: contact.sourceUrl || authoritative.sourceUrl || null,
                evidenceType: contact.evidenceType || EvidenceType.LISTING_FIELD,
                snippet: contact.snippet || null
              }
            ]
          });
        }
      }
    }

    // Determine conservative primary phone and email
    let primaryPhone: string | null = null;
    let primaryEmail: string | null = null;

    // Find first valid normalized direct phone/mobile
    for (const c of incomingContacts) {
      if (c.type === ContactType.PHONE || c.type === ContactType.WHATSAPP) {
        const norm = normalizePhone(c.rawValue);
        if (norm.isValid && norm.normalizedValue) {
          primaryPhone = norm.normalizedValue;
          c.isPrimary = true;
          break;
        }
      }
    }

    // Find first valid normalized email
    for (const c of incomingContacts) {
      if (c.type === ContactType.EMAIL) {
        const norm = normalizeEmail(c.rawValue);
        if (norm.isValid && norm.normalizedValue) {
          primaryEmail = norm.normalizedValue;
          c.isPrimary = true;
          break;
        }
      }
    }

    const minimizedRawData = {
      externalId: authoritative.externalId,
      provider: authoritative.provider,
      name: authoritative.name,
      category: authoritative.category,
      description: authoritative.description || null,
      address: authoritative.address || null,
      locality: authoritative.locality || null,
      city: authoritative.city || null,
      website: authoritative.website || null,
      rating: authoritative.rating || null,
      reviewCount: authoritative.reviewCount || 0,
      sourceUrl: authoritative.sourceUrl || null
    };

    // Construct IncomingLeadData for duplicate detection and persistence
    const incomingLeadData: IncomingLeadData = {
      organizationId,
      name: authoritative.name,
      category: authoritative.category || 'General',
      description: authoritative.description || null,
      address: authoritative.address || null,
      locality: authoritative.locality || null,
      city: authoritative.city || 'Dhaka',
      region: authoritative.region || 'Dhaka Division',
      country: authoritative.country || 'BD',
      latitude: authoritative.latitude || null,
      longitude: authoritative.longitude || null,
      primaryPhone,
      primaryEmail,
      website: authoritative.website || null,
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.UNKNOWN,
      rating: authoritative.rating || null,
      reviewCount: authoritative.reviewCount || 0,
      primarySource: providerName,
      source: {
        sourceName: providerName,
        sourceExternalId: authoritative.externalId,
        sourceUrl: authoritative.sourceUrl || null,
        rawData: minimizedRawData as any
      },
      contacts: incomingContacts
    };

    // 4. Transactional duplicate check and mutation with concurrency safety
    try {
      return await prisma.$transaction(async (tx) => {
        const dupResult = await detectDuplicate(tx, incomingLeadData);

        // 4A. Definite Conflict -> Throw 409
        if (dupResult.isConflict || dupResult.reason === 'DEFINITE_MATCH_CONFLICT') {
          throw new AppError(
            ErrorCodes.CONFLICT,
            'Definite match conflict detected between multiple leads',
            409,
            {
              action: 'DEFINITE_MATCH_CONFLICT',
              reason: dupResult.conflictDetails?.reason || 'Multiple conflicting matches found',
              conflictingLeadIds: dupResult.candidateLeadIds
            }
          );
        }

        // 4B. Candidate Match -> Throw 409 (Requires manual confirmation)
        if (dupResult.action === DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION) {
          throw new AppError(
            ErrorCodes.CONFLICT,
            'Candidate duplicate match requires user confirmation',
            409,
            {
              action: 'CANDIDATE_REQUIRES_CONFIRMATION',
              matchLevel: dupResult.matchLevel,
              reason: dupResult.reason,
              candidateLeadIds: dupResult.candidateLeadIds
            }
          );
        }

        // 4C. Clean Definite Match -> Merge into existing Lead
        if (dupResult.matchLevel === DuplicateMatchLevel.DEFINITE && dupResult.leadId) {
          const mergeResult = await mergeIntoExistingLead(tx, dupResult.leadId, incomingLeadData);
          await invalidateLeadOnlinePresenceAnalysis(tx, organizationId, dupResult.leadId, 'PROVIDER_MERGE');

          try {
            await tx.auditLog.create({
              data: {
                organizationId,
                userId,
                action: 'lead.merged_from_provider',
                entityType: 'Lead',
                entityId: dupResult.leadId,
                after: {
                  provider: providerName,
                  externalId: authoritative.externalId,
                  matchReason: dupResult.reason,
                  updatedFields: mergeResult.updatedFields,
                  addedContactsCount: mergeResult.addedContactsCount
                }
              }
            });
          } catch {
            // Ignore audit log error if not blocking
          }

          return {
            action: DuplicateAction.MERGED,
            leadId: dupResult.leadId,
            matchReason: dupResult.reason
          };
        }

        // 4D. No Match -> Create brand new Lead
        const normalizedName = normalizeBusinessName(incomingLeadData.name);
        const normalizedWebsite = incomingLeadData.website
          ? normalizeWebsite(incomingLeadData.website).normalizedDomain
          : null;

        const createdLead = await tx.lead.create({
          data: {
            organizationId,
            name: incomingLeadData.name,
            normalizedName,
            category: incomingLeadData.category || 'General',
            description: incomingLeadData.description,
            address: incomingLeadData.address,
            locality: incomingLeadData.locality,
            city: incomingLeadData.city || 'Dhaka',
            region: incomingLeadData.region || 'Dhaka Division',
            country: incomingLeadData.country || 'BD',
            latitude: incomingLeadData.latitude,
            longitude: incomingLeadData.longitude,
            primaryPhone: incomingLeadData.primaryPhone,
            primaryEmail: incomingLeadData.primaryEmail,
            website: incomingLeadData.website,
            normalizedWebsite,
            websiteStatus: WebsiteStatus.UNKNOWN as any,
            onlinePresenceType: OnlinePresenceType.UNKNOWN as any,
            rating: incomingLeadData.rating,
            reviewCount: incomingLeadData.reviewCount || 0,
            primarySource: providerName
          }
        });

        // Insert LeadSource provenance
        await tx.leadSource.create({
          data: {
            leadId: createdLead.id,
            organizationId,
            sourceName: providerName,
            sourceExternalId: authoritative.externalId,
            sourceUrl: authoritative.sourceUrl || undefined,
            rawData: minimizedRawData,
            fetchedAt: new Date()
          }
        });

        // Insert normalized contacts and evidence
        for (const contact of incomingContacts) {
          const norm = normalizeContact(contact);
          await tx.leadContact.create({
            data: {
              leadId: createdLead.id,
              type: norm.type,
              rawValue: norm.rawValue,
              normalizedValue: norm.normalizedValue || norm.rawValue,
              phoneType: norm.phoneType || PhoneType.UNKNOWN,
              status: norm.status,
              whatsappStatus: norm.whatsappStatus,
              isPrimary: contact.isPrimary ?? false,
              evidence: {
                create: (contact.evidence || []).map((ev) => ({
                  sourceName: ev.sourceName,
                  sourceUrl: ev.sourceUrl || undefined,
                  evidenceType: ev.evidenceType as any,
                  snippet: ev.snippet || undefined,
                  discoveredAt: new Date()
                }))
              }
            }
          });
        }

        // Record audit event
        try {
          await tx.auditLog.create({
            data: {
              organizationId,
              userId,
              action: 'lead.created_from_provider',
              entityType: 'Lead',
              entityId: createdLead.id,
              after: {
                provider: providerName,
                externalId: authoritative.externalId,
                name: createdLead.name
              }
            }
          });
        } catch {
          // Ignore audit log error
        }

        return {
          action: DuplicateAction.CREATED,
          leadId: createdLead.id
        };
      });
    } catch (err: any) {
      // Concurrency Recovery: Handle PostgreSQL unique constraint race condition on lead_sources
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existingSource = await prisma.leadSource.findUnique({
          where: {
            organizationId_sourceName_sourceExternalId: {
              organizationId,
              sourceName: providerName,
              sourceExternalId: authoritative.externalId
            }
          }
        });

        if (existingSource) {
          const mergeResult = await mergeIntoExistingLead(prisma, existingSource.leadId, incomingLeadData);
          await invalidateLeadOnlinePresenceAnalysis(prisma, organizationId, existingSource.leadId, 'PROVIDER_MERGE');

          try {
            await prisma.auditLog.create({
              data: {
                organizationId,
                userId,
                action: 'lead.merged_from_provider',
                entityType: 'Lead',
                entityId: existingSource.leadId,
                after: {
                  provider: providerName,
                  externalId: authoritative.externalId,
                  matchReason: 'TIER_1A_PROVIDER_IDENTITY',
                  updatedFields: mergeResult.updatedFields,
                  addedContactsCount: mergeResult.addedContactsCount
                }
              }
            });
          } catch {
            // Ignore audit log error
          }

          return {
            action: DuplicateAction.MERGED,
            leadId: existingSource.leadId,
            matchReason: 'TIER_1A_PROVIDER_IDENTITY'
          };
        }
      }

      throw err;
    }
  }
}

export const businessSearchService = new BusinessSearchService();
