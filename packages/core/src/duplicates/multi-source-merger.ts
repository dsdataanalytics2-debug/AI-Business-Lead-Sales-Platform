/**
 * Multi-Source Business Deduplication & Evidence Merger
 *
 * Merges business records across independent sources using a strict 4-tier hierarchy:
 * 1. Provider + externalBusinessId (Definite exact match)
 * 2. Canonical website domain (Company web presence match)
 * 3. Verified phone number (Direct telecommunication match)
 * 4. Normalized business name + normalized address/locality (Physical geographic match)
 *
 * When an incoming business candidate matches an existing record:
 * - Persists ONE consolidated buyer
 * - Merges and deduplicates SourceEvidence items
 * - Merges and deduplicates EnrichedContact items
 * - Enriches missing attributes (phone, website, address) from newer/stronger sources
 * - Upgrades sourceConfidence and recalculates composite Buyer Score
 */

import {
  type SourceEvidence,
  type EnrichedContact
} from '@leadmate/shared';
import { normalizeBusinessName } from '../normalization/business-name.js';
import { normalizeWebsite } from '../normalization/website.js';
import { normalizePhone } from '../normalization/phone.js';
import {
  computeBuyerScore,
  computeSourceConfidence,
  getSourceConfidenceLevel,
  type BuyerCandidateInput,
  type ProductContextInput
} from '../scoring/buyer-score.js';

export interface MergedBusinessRecord {
  id?: string;
  externalBusinessId: string;
  provider: string;
  businessName: string;
  category?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  website?: string | null;
  phone?: string | null;
  sourceEvidences: SourceEvidence[];
  enrichedContacts: EnrichedContact[];
  sourceConfidence: string;
  whatsappStatus: 'EXPLICIT_VERIFIED' | 'NO_WHATSAPP' | 'NOT_VERIFIED';
  buyerScore?: number | null;
  scoreBreakdown?: any;
}

export type MatchTier = 'PROVIDER_ID' | 'WEBSITE_DOMAIN' | 'VERIFIED_PHONE' | 'NAME_LOCATION' | 'NONE';

export interface MultiSourceMatchResult {
  isMatch: boolean;
  matchTier: MatchTier;
  matchedKey?: string;
}

/**
 * Extracts candidate matching keys for an item according to the 4-tier hierarchy.
 */
export function getHierarchyMatchKeys(item: {
  provider?: string | null;
  externalBusinessId?: string | null;
  businessName?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  website?: string | null;
}): {
  tier1ProviderId: string | null;
  tier2Domain: string | null;
  tier3Phone: string | null;
  tier4NameLoc: string | null;
} {
  // Tier 1: provider + externalBusinessId
  const provider = (item.provider || '').trim().toUpperCase();
  const extId = (item.externalBusinessId || '').trim().toLowerCase();
  const tier1ProviderId = provider && extId ? `p:${provider}:${extId}` : null;

  // Tier 2: Canonical website domain
  let tier2Domain: string | null = null;
  if (item.website) {
    const webNorm = normalizeWebsite(item.website);
    if (webNorm.isValid && webNorm.normalizedDomain) {
      tier2Domain = `d:${webNorm.normalizedDomain.toLowerCase()}`;
    }
  }

  // Tier 3: Verified phone number
  let tier3Phone: string | null = null;
  if (item.phone) {
    const phoneNorm = normalizePhone(item.phone);
    if (phoneNorm.isValid && phoneNorm.normalizedValue) {
      tier3Phone = `t:${phoneNorm.normalizedValue}`;
    }
  }

  // Tier 4: Normalized business name + normalized address/location
  let tier4NameLoc: string | null = null;
  const nameNorm = normalizeBusinessName(item.businessName || '');
  if (nameNorm) {
    const locNorm = normalizeBusinessName(item.address || item.city || '');
    tier4NameLoc = locNorm ? `nl:${nameNorm}:${locNorm}` : `n:${nameNorm}`;
  }

  return { tier1ProviderId, tier2Domain, tier3Phone, tier4NameLoc };
}

/**
 * Checks if two business items refer to the same commercial entity.
 */
export function checkBusinessMatch(
  existing: {
    provider?: string | null;
    externalBusinessId?: string | null;
    businessName?: string | null;
    address?: string | null;
    city?: string | null;
    phone?: string | null;
    website?: string | null;
  },
  candidate: {
    provider?: string | null;
    externalBusinessId?: string | null;
    businessName?: string | null;
    address?: string | null;
    city?: string | null;
    phone?: string | null;
    website?: string | null;
  }
): MultiSourceMatchResult {
  const k1 = getHierarchyMatchKeys(existing);
  const k2 = getHierarchyMatchKeys(candidate);

  // Tier 1: Provider ID
  if (k1.tier1ProviderId && k2.tier1ProviderId && k1.tier1ProviderId === k2.tier1ProviderId) {
    return { isMatch: true, matchTier: 'PROVIDER_ID', matchedKey: k1.tier1ProviderId };
  }

  // Tier 2: Canonical website domain
  if (k1.tier2Domain && k2.tier2Domain && k1.tier2Domain === k2.tier2Domain) {
    return { isMatch: true, matchTier: 'WEBSITE_DOMAIN', matchedKey: k1.tier2Domain };
  }

  // Tier 3: Verified phone
  if (k1.tier3Phone && k2.tier3Phone && k1.tier3Phone === k2.tier3Phone) {
    return { isMatch: true, matchTier: 'VERIFIED_PHONE', matchedKey: k1.tier3Phone };
  }

  // Tier 4: Normalized name + location
  if (k1.tier4NameLoc && k2.tier4NameLoc && k1.tier4NameLoc === k2.tier4NameLoc) {
    return { isMatch: true, matchTier: 'NAME_LOCATION', matchedKey: k1.tier4NameLoc };
  }

  // Also check if normalized names match and locations overlap/subsume
  const name1 = normalizeBusinessName(existing.businessName || '');
  const name2 = normalizeBusinessName(candidate.businessName || '');
  if (name1 && name2 && name1 === name2) {
    const loc1 = normalizeBusinessName(existing.address || existing.city || '');
    const loc2 = normalizeBusinessName(candidate.address || candidate.city || '');
    if (!loc1 || !loc2 || loc1 === loc2 || loc1.includes(loc2) || loc2.includes(loc1)) {
      return { isMatch: true, matchTier: 'NAME_LOCATION', matchedKey: `nl:${name1}` };
    }
  }

  return { isMatch: false, matchTier: 'NONE' };
}

/**
 * Merges a candidate business into an existing business record.
 */
export function mergeBusinessRecords(
  target: MergedBusinessRecord,
  source: Partial<MergedBusinessRecord> & {
    newEvidence?: SourceEvidence;
    newContacts?: EnrichedContact[];
  },
  productContext?: ProductContextInput
): MergedBusinessRecord {
  // 1. Merge and dedupe SourceEvidences
  const evidences: SourceEvidence[] = [...(target.sourceEvidences || [])];
  const seenEvidenceKeys = new Set(
    evidences.map((e) => `${(e.sourceType || '').toUpperCase()}:${(e.sourceUrl || e.sourceName || '').toLowerCase()}`)
  );

  const incomingEvidences = [
    ...(source.sourceEvidences || []),
    ...(source.newEvidence ? [source.newEvidence] : [])
  ];

  for (const ev of incomingEvidences) {
    const key = `${(ev.sourceType || '').toUpperCase()}:${(ev.sourceUrl || ev.sourceName || '').toLowerCase()}`;
    if (!seenEvidenceKeys.has(key)) {
      seenEvidenceKeys.add(key);
      evidences.push(ev);
    }
  }

  // 2. Merge and dedupe EnrichedContacts
  const contacts: EnrichedContact[] = [...(target.enrichedContacts || [])];
  const seenContactKeys = new Set(
    contacts.map((c) => `${c.type}:${c.value.toLowerCase().trim()}`)
  );

  const incomingContacts = [
    ...(source.enrichedContacts || []),
    ...(source.newContacts || [])
  ];

  for (const c of incomingContacts) {
    const key = `${c.type}:${c.value.toLowerCase().trim()}`;
    if (!seenContactKeys.has(key)) {
      seenContactKeys.add(key);
      contacts.push(c);
    }
  }

  // 3. Update primary contact fields if missing or higher confidence
  const phone = target.phone || source.phone || contacts.find((c) => c.type === 'PHONE')?.value || null;
  const website = target.website || source.website || contacts.find((c) => c.type === 'WEBSITE')?.value || null;
  const address = target.address || source.address || null;
  const city = target.city || source.city || null;

  // 4. Determine WhatsApp status (Strict PHONE != WHATSAPP)
  const hasWaContact = contacts.some((c) => c.type === 'WHATSAPP');
  const hasWaEvidence = evidences.some((e) => e.evidenceType === 'EXPLICIT_WA_ME_LINK');
  const whatsappStatus: 'EXPLICIT_VERIFIED' | 'NO_WHATSAPP' | 'NOT_VERIFIED' =
    hasWaContact || hasWaEvidence ? 'EXPLICIT_VERIFIED' : 'NOT_VERIFIED';

  // 5. Evaluate upgraded Source Confidence
  const buyerForScoring: BuyerCandidateInput = {
    businessName: target.businessName,
    category: target.category,
    address,
    city,
    phone,
    website,
    provider: target.provider,
    externalBusinessId: target.externalBusinessId,
    sourceEvidences: evidences,
    enrichedContacts: contacts
  };

  const confidenceScore = computeSourceConfidence(buyerForScoring);
  const sourceConfidence = getSourceConfidenceLevel(confidenceScore);

  let buyerScore = target.buyerScore;
  let scoreBreakdown = target.scoreBreakdown;

  if (productContext) {
    const scored = computeBuyerScore(buyerForScoring, productContext);
    buyerScore = scored.buyerScore;
    scoreBreakdown = scored.breakdown;
  }

  return {
    ...target,
    phone,
    website,
    address,
    city,
    sourceEvidences: evidences,
    enrichedContacts: contacts,
    sourceConfidence,
    whatsappStatus,
    buyerScore,
    scoreBreakdown
  };
}
