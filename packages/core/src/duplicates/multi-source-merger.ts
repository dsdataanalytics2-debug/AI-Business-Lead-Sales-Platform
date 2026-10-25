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
import { detectWholesaleIntent } from '../intent/wholesale-intent-detector.js';
import { deriveSuggestedRelatedNeeds } from '../analysis/related-needs-advisor.js';

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
  priority?: string | null;
  wholesaleIntent?: string | null;
  wholesaleIntentSignals?: string[] | null;
  suggestedRelatedNeeds?: string[] | null;
}

export type MatchTier =
  | 'PROVIDER_ID'
  | 'WEBSITE_DOMAIN'
  | 'VERIFIED_PHONE'
  | 'VERIFIED_EMAIL'
  | 'NAME_LOCATION_SOFT'
  | 'NONE';

export interface MultiSourceMatchResult {
  isMatch: boolean;
  matchTier: MatchTier;
  matchedKey?: string;
  isSoftMatch?: boolean;
}

/**
 * Extracts candidate matching keys for an item according to the 5-tier hierarchy.
 */
export function getHierarchyMatchKeys(item: {
  provider?: string | null;
  externalBusinessId?: string | null;
  businessName?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
}): {
  tier1ProviderId: string | null;
  tier2Domain: string | null;
  tier3Phone: string | null;
  tier4Email: string | null;
  tier5NameLoc: string | null;
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

  // Tier 4: Verified email
  let tier4Email: string | null = null;
  if (item.email && item.email.includes('@')) {
    tier4Email = `e:${item.email.trim().toLowerCase()}`;
  }

  // Tier 5: Normalized business name + normalized address/location (Soft Match)
  let tier5NameLoc: string | null = null;
  const nameNorm = normalizeBusinessName(item.businessName || '');
  if (nameNorm) {
    const locNorm = normalizeBusinessName(item.address || item.city || '');
    tier5NameLoc = locNorm ? `nl:${nameNorm}:${locNorm}` : `n:${nameNorm}`;
  }

  return { tier1ProviderId, tier2Domain, tier3Phone, tier4Email, tier5NameLoc };
}

/**
 * Checks if two business items refer to the same commercial entity.
 * Strict adherence to Priority Hierarchy:
 * 1. provider + externalBusinessId
 * 2. canonical website domain
 * 3. verified phone
 * 4. verified email
 * 5. normalized business name + address/city as soft match (flagged for review)
 */
export function checkBusinessMatch(
  existing: {
    provider?: string | null;
    externalBusinessId?: string | null;
    businessName?: string | null;
    address?: string | null;
    city?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
  },
  candidate: {
    provider?: string | null;
    externalBusinessId?: string | null;
    businessName?: string | null;
    address?: string | null;
    city?: string | null;
    phone?: string | null;
    email?: string | null;
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

  // Tier 4: Verified email
  if (k1.tier4Email && k2.tier4Email && k1.tier4Email === k2.tier4Email) {
    return { isMatch: true, matchTier: 'VERIFIED_EMAIL', matchedKey: k1.tier4Email };
  }

  // Tier 5: Normalized name + location (Soft Match)
  // Per rule: businessName + locality alone must NOT silently hard-merge. Flag uncertain matches.
  if (k1.tier5NameLoc && k2.tier5NameLoc && k1.tier5NameLoc === k2.tier5NameLoc) {
    return {
      isMatch: true,
      matchTier: 'NAME_LOCATION_SOFT',
      matchedKey: k1.tier5NameLoc,
      isSoftMatch: true
    };
  }

  const name1 = normalizeBusinessName(existing.businessName || '');
  const name2 = normalizeBusinessName(candidate.businessName || '');
  if (name1 && name2 && name1 === name2) {
    const loc1 = normalizeBusinessName(existing.address || existing.city || '');
    const loc2 = normalizeBusinessName(candidate.address || candidate.city || '');
    if (loc1 && loc2 && (loc1 === loc2 || loc1.includes(loc2) || loc2.includes(loc1))) {
      return {
        isMatch: true,
        matchTier: 'NAME_LOCATION_SOFT',
        matchedKey: `nl:${name1}`,
        isSoftMatch: true
      };
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

  const intentResult = detectWholesaleIntent({
    businessName: target.businessName,
    category: target.category,
    sourceEvidences: evidences,
    sourceData: (target as any).sourceData
  });

  // Preserve stronger historical intent: HIGH > MEDIUM > LOW > NONE
  const intentHierarchy: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 };
  const targetIntent = (target.wholesaleIntent as string) || 'NONE';
  const finalIntentLevel =
    (intentHierarchy[intentResult.level] ?? 0) >= (intentHierarchy[targetIntent] ?? 0)
      ? intentResult.level
      : (targetIntent as any);

  const mergedSignals = Array.from(new Set([
    ...((target.wholesaleIntentSignals as string[]) || []),
    ...intentResult.signals
  ]));

  let buyerScore = target.buyerScore;
  let scoreBreakdown = target.scoreBreakdown;
  let priority = target.priority || 'WARM';

  if (productContext) {
    const scored = computeBuyerScore(
      {
        ...buyerForScoring,
        wholesaleIntent: finalIntentLevel
      },
      productContext
    );
    buyerScore = scored.buyerScore;
    scoreBreakdown = scored.breakdown;
    priority = scored.priority;
  }

  const relatedNeeds = productContext
    ? deriveSuggestedRelatedNeeds({
        productName: productContext.productName,
        productCategory: productContext.productCategory,
        buyerCategory: target.category
      })
    : target.suggestedRelatedNeeds;

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
    scoreBreakdown,
    priority,
    wholesaleIntent: finalIntentLevel,
    wholesaleIntentSignals: mergedSignals,
    suggestedRelatedNeeds: relatedNeeds
  };
}
