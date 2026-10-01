/**
 * Deterministic Duplicate Detector
 *
 * Implements strict tenant-scoped duplicate detection across Tier 1 (Definite)
 * and Tier 2 (Candidate) rules.
 *
 * TIER PRECEDENCE:
 * Tier 1A (Provider ID) > Tier 1B (Valid Mobile) > Tier 2A (Website Domain) > Tier 2B (Name + Location) > NONE
 *
 * RULES:
 * 1. Strictly scoped to organizationId (cross-tenant matching is impossible).
 * 2. Tier 1A + Tier 1B targeting different leads triggers explicit CONFLICT (never arbitrary merge).
 * 3. Multiple conflicting Tier 1B mobiles trigger explicit CONFLICT.
 * 4. Tier 2 Candidate matches NEVER auto-merge (Action is CANDIDATE_REQUIRES_CONFIRMATION).
 * 5. Landline numbers and invalid phone formats CANNOT produce Tier 1B matches.
 */

import {
  ContactType,
  PhoneType,
  DuplicateMatchLevel,
  DuplicateAction
} from '@leadmate/shared';
import { normalizePhone } from '../normalization/phone.js';
import { normalizeWebsite } from '../normalization/website.js';
import { normalizeBusinessName } from '../normalization/business-name.js';
import type {
  DbClient,
  IncomingLeadData,
  DuplicateDetectionResult,
  DuplicateMatchReason
} from './types.js';

export async function detectDuplicate(
  db: DbClient,
  input: IncomingLeadData
): Promise<DuplicateDetectionResult> {
  const { organizationId } = input;
  if (!organizationId || typeof organizationId !== 'string') {
    throw new Error('organizationId is required for duplicate detection');
  }

  // 1. Extract and normalize candidate keys
  const normalizedName = normalizeBusinessName(input.name);
  const normalizedWebsite = input.website
    ? normalizeWebsite(input.website).normalizedDomain
    : null;

  // Extract valid canonical Bangladesh mobile numbers (+8801[3-9]XXXXXXXX)
  const validIncomingMobiles = new Set<string>();

  if (input.contacts && Array.isArray(input.contacts)) {
    for (const contact of input.contacts) {
      if (contact.type === ContactType.PHONE || contact.type === ContactType.WHATSAPP) {
        const phoneRes = normalizePhone(contact.rawValue);
        if (phoneRes.isValid && phoneRes.phoneType === PhoneType.MOBILE && phoneRes.normalizedValue) {
          validIncomingMobiles.add(phoneRes.normalizedValue);
        }
      }
    }
  }

  if (input.primaryPhone) {
    const phoneRes = normalizePhone(input.primaryPhone);
    if (phoneRes.isValid && phoneRes.phoneType === PhoneType.MOBILE && phoneRes.normalizedValue) {
      validIncomingMobiles.add(phoneRes.normalizedValue);
    }
  }

  // Provider identity (requires both sourceName and sourceExternalId)
  const providerIdentity =
    input.source?.sourceName && input.source?.sourceExternalId
      ? {
          sourceName: input.source.sourceName.trim(),
          sourceExternalId: input.source.sourceExternalId.trim()
        }
      : null;

  // =========================================================================
  // 2. Query Tier 1 Matches
  // =========================================================================

  // 2A. Tier 1A Check: Provider Identity
  let providerMatchLeadId: string | null = null;
  if (providerIdentity && providerIdentity.sourceName && providerIdentity.sourceExternalId) {
    const existingSource = await db.leadSource.findFirst({
      where: {
        organizationId,
        sourceName: providerIdentity.sourceName,
        sourceExternalId: providerIdentity.sourceExternalId
      },
      select: { leadId: true }
    });

    if (existingSource) {
      providerMatchLeadId = existingSource.leadId;
    }
  }

  // 2B. Tier 1B Check: Valid Mobile Numbers
  let mobileMatchLeadIds: string[] = [];
  if (validIncomingMobiles.size > 0) {
    const existingContacts = await db.leadContact.findMany({
      where: {
        lead: { organizationId },
        type: { in: [ContactType.PHONE, ContactType.WHATSAPP] },
        normalizedValue: { in: Array.from(validIncomingMobiles) }
      },
      select: { leadId: true, normalizedValue: true }
    });

    const uniqueLeadIds = Array.from(new Set(existingContacts.map((c) => c.leadId)));
    mobileMatchLeadIds = uniqueLeadIds;
  }

  // =========================================================================
  // 3. Evaluate Tier 1 Definite Matches & Conflicts
  // =========================================================================

  // Check Conflict A: Multiple distinct leads matched via incoming mobile numbers
  if (mobileMatchLeadIds.length > 1) {
    return {
      matchLevel: DuplicateMatchLevel.DEFINITE,
      action: DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION,
      reason: 'DEFINITE_MATCH_CONFLICT',
      leadId: mobileMatchLeadIds[0],
      candidateLeadIds: mobileMatchLeadIds,
      isConflict: true,
      conflictDetails: {
        reason: `Multiple existing leads (${mobileMatchLeadIds.join(', ')}) matched incoming mobile numbers`,
        conflictingLeadIds: mobileMatchLeadIds
      }
    };
  }

  // Check Conflict B: Provider Identity matches Lead A, but Mobile matches Lead B
  if (
    providerMatchLeadId &&
    mobileMatchLeadIds.length > 0 &&
    !mobileMatchLeadIds.includes(providerMatchLeadId)
  ) {
    const conflictingIds = [providerMatchLeadId, ...mobileMatchLeadIds];
    return {
      matchLevel: DuplicateMatchLevel.DEFINITE,
      action: DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION,
      reason: 'DEFINITE_MATCH_CONFLICT',
      leadId: providerMatchLeadId,
      candidateLeadIds: conflictingIds,
      isConflict: true,
      conflictDetails: {
        reason: `Provider identity matched lead "${providerMatchLeadId}" but mobile matched lead "${mobileMatchLeadIds[0]}"`,
        conflictingLeadIds: conflictingIds
      }
    };
  }

  // Clean Definite Match: Provider Identity (outranks mobile when both match same lead)
  if (providerMatchLeadId) {
    return {
      matchLevel: DuplicateMatchLevel.DEFINITE,
      action: DuplicateAction.MERGED,
      reason: 'TIER_1A_PROVIDER_IDENTITY',
      leadId: providerMatchLeadId,
      candidateLeadIds: [providerMatchLeadId],
      isConflict: false,
      conflictDetails: null
    };
  }

  // Clean Definite Match: Valid Mobile
  if (mobileMatchLeadIds.length === 1) {
    const leadId = mobileMatchLeadIds[0];
    return {
      matchLevel: DuplicateMatchLevel.DEFINITE,
      action: DuplicateAction.MERGED,
      reason: 'TIER_1B_MOBILE_MATCH',
      leadId,
      candidateLeadIds: [leadId],
      isConflict: false,
      conflictDetails: null
    };
  }

  // =========================================================================
  // 4. Query Tier 2 Candidate Matches (Only if no Tier 1 match found)
  // =========================================================================

  // 4A. Tier 2A: Website Domain
  const websiteCandidateIds: string[] = [];
  if (normalizedWebsite) {
    const websiteMatches = await db.lead.findMany({
      where: {
        organizationId,
        normalizedWebsite
      },
      select: { id: true }
    });

    for (const lead of websiteMatches) {
      websiteCandidateIds.push(lead.id);
    }
  }

  // 4B. Tier 2B: Name + Locality / City
  const nameLocationCandidateIds: string[] = [];
  let nameLocationReason: DuplicateMatchReason = 'TIER_2B_NAME_CITY';

  if (normalizedName) {
    const nameMatches = await db.lead.findMany({
      where: {
        organizationId,
        normalizedName
      },
      select: { id: true, locality: true, city: true }
    });

    const incomingLocalityNorm = input.locality
      ? normalizeBusinessName(input.locality)
      : null;
    const incomingCityNorm = (input.city || 'Dhaka').toLowerCase().trim();

    for (const lead of nameMatches) {
      const existingLocalityNorm = lead.locality
        ? normalizeBusinessName(lead.locality)
        : null;
      const existingCityNorm = (lead.city || 'Dhaka').toLowerCase().trim();

      if (incomingLocalityNorm && existingLocalityNorm) {
        if (incomingLocalityNorm === existingLocalityNorm) {
          nameLocationCandidateIds.push(lead.id);
          nameLocationReason = 'TIER_2B_NAME_LOCALITY';
        }
      } else if (incomingCityNorm && existingCityNorm && incomingCityNorm === existingCityNorm) {
        nameLocationCandidateIds.push(lead.id);
      }
    }
  }

  // =========================================================================
  // 5. Evaluate Tier 2 Results & Fallback to NONE
  // =========================================================================

  // Combine Tier 2 candidates in priority order (Tier 2A Website > Tier 2B Name+Location)
  const allCandidateIds = Array.from(
    new Set([...websiteCandidateIds, ...nameLocationCandidateIds])
  );

  if (allCandidateIds.length > 0) {
    const primaryReason =
      websiteCandidateIds.length > 0
        ? 'TIER_2A_WEBSITE_DOMAIN'
        : nameLocationReason;

    return {
      matchLevel: DuplicateMatchLevel.CANDIDATE,
      action: DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION, // CANDIDATES NEVER AUTO-MERGE
      reason: primaryReason,
      leadId: allCandidateIds[0],
      candidateLeadIds: allCandidateIds,
      isConflict: false,
      conflictDetails: null
    };
  }

  // No matches found
  return {
    matchLevel: DuplicateMatchLevel.NONE,
    action: DuplicateAction.CREATED,
    reason: 'NO_MATCH',
    leadId: null,
    candidateLeadIds: [],
    isConflict: false,
    conflictDetails: null
  };
}
