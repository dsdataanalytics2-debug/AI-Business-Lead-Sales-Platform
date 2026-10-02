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
   * Performs read-only business search preview across registered providers.
   * STRICTLY READ-ONLY: Never writes or modifies DB records.
   */
  async search(
    query: BusinessSearchQuery & { provider?: string },
    context: BusinessSearchRequestContext
  ): Promise<BusinessSearchResult[]> {
    const providerName = (query.provider || 'MOCK').toUpperCase().trim();

    let provider;
    try {
      provider = getProvider(providerName);
    } catch (err) {
      if (err instanceof UnknownProviderError) {
        throw new BadRequestError(`Unknown datasource provider: "${query.provider}"`, {
          provider: query.provider
        });
      }
      throw err;
    }

    const rawResults = await provider.search(
      {
        q: query.q,
        location: query.location,
        category: query.category,
        limit: query.limit,
        cursor: query.cursor
      },
      {
        organizationId: context.organizationId,
        correlationId: context.correlationId
      }
    );

    // Runtime validation of provider search response
    return z.array(businessSearchResultSchema).parse(rawResults);
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
    const providerName = input.provider.toUpperCase().trim();

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

    // 2. Authoritative Resolution with exact externalId
    const rawAuthoritative = await provider.resolveByExternalId(input.externalId, {
      organizationId,
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
