/**
 * Pure Suppression Matcher Engine
 *
 * Implements hard and soft suppression matching against organization Do-Not-Contact records.
 *
 * INVARIANTS:
 * - Hard Block Keys: Normalized phone, normalized email, canonical domain, explicit buyer ID.
 * - Soft Review Only: Business name + locality MUST NOT hard-block. It produces POSSIBLE_MATCH_REVIEW.
 * - Pure Function: Zero side-effects, zero network calls.
 */

import { normalizePhone, normalizeWebsite } from '../normalization/index.js';

export interface SuppressionRecordCandidate {
  id?: string;
  phone?: string | null;
  email?: string | null;
  domain?: string | null;
  salesMissionBuyerId?: string | null;
  businessName?: string | null;
  locality?: string | null;
  reason?: string;
}

export interface BuyerTargetForSuppressionCheck {
  id?: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  businessName?: string | null;
  locality?: string | null;
  city?: string | null;
}

export interface SuppressionMatchResult {
  isSuppressed: boolean;
  matchedKey?: 'PHONE' | 'EMAIL' | 'DOMAIN' | 'BUYER_ID' | null;
  matchedValue?: string | null;
  reason?: string | null;
  reviewStatus?: 'HARD_SUPPRESSED' | 'POSSIBLE_MATCH_REVIEW' | 'CLEAR';
  reviewNote?: string | null;
}

export function checkSuppression(
  buyer: BuyerTargetForSuppressionCheck,
  suppressionList: SuppressionRecordCandidate[]
): SuppressionMatchResult {
  if (!suppressionList || suppressionList.length === 0) {
    return { isSuppressed: false, reviewStatus: 'CLEAR' };
  }

  // 1. Prepare normalized target keys
  const targetPhoneNorm = buyer.phone ? normalizePhone(buyer.phone) : null;
  const targetPhone = targetPhoneNorm?.isValid && targetPhoneNorm.normalizedValue ? targetPhoneNorm.normalizedValue : null;
  const targetEmail = buyer.email ? buyer.email.trim().toLowerCase() : null;
  const targetDomainNorm = buyer.website ? normalizeWebsite(buyer.website) : null;
  const targetDomain = targetDomainNorm?.isValid && targetDomainNorm.normalizedDomain ? targetDomainNorm.normalizedDomain.toLowerCase() : null;
  const targetBuyerId = buyer.id ? buyer.id.trim() : null;

  // 2. Check Hard Block Keys
  for (const record of suppressionList) {
    // A. Explicit Buyer ID match
    if (targetBuyerId && record.salesMissionBuyerId && targetBuyerId === record.salesMissionBuyerId) {
      return {
        isSuppressed: true,
        matchedKey: 'BUYER_ID',
        matchedValue: targetBuyerId,
        reason: record.reason || 'Entity explicitly suppressed by operator',
        reviewStatus: 'HARD_SUPPRESSED'
      };
    }

    // B. Phone match
    if (targetPhone && record.phone) {
      const recPhoneNorm = normalizePhone(record.phone);
      const recPhone = recPhoneNorm.isValid && recPhoneNorm.normalizedValue ? recPhoneNorm.normalizedValue : record.phone.trim();
      if (targetPhone === recPhone) {
        return {
          isSuppressed: true,
          matchedKey: 'PHONE',
          matchedValue: targetPhone,
          reason: record.reason || 'Phone number is in Do-Not-Contact registry',
          reviewStatus: 'HARD_SUPPRESSED'
        };
      }
    }

    // C. Email match
    if (targetEmail && record.email) {
      if (targetEmail === record.email.trim().toLowerCase()) {
        return {
          isSuppressed: true,
          matchedKey: 'EMAIL',
          matchedValue: targetEmail,
          reason: record.reason || 'Email address is in Do-Not-Contact registry',
          reviewStatus: 'HARD_SUPPRESSED'
        };
      }
    }

    // D. Domain match
    if (targetDomain && record.domain) {
      const recDomainNorm = normalizeWebsite(record.domain);
      const recDomain = recDomainNorm.isValid && recDomainNorm.normalizedDomain ? recDomainNorm.normalizedDomain.toLowerCase() : record.domain.trim().toLowerCase();
      if (targetDomain === recDomain) {
        return {
          isSuppressed: true,
          matchedKey: 'DOMAIN',
          matchedValue: targetDomain,
          reason: record.reason || 'Company domain is in Do-Not-Contact registry',
          reviewStatus: 'HARD_SUPPRESSED'
        };
      }
    }
  }

  // 3. Check Soft Match (Business Name + Locality): MUST NOT hard-block!
  const buyerNameClean = (buyer.businessName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const buyerLocalityClean = (buyer.locality || buyer.city || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  if (buyerNameClean.length >= 4 && buyerLocalityClean.length >= 3) {
    for (const record of suppressionList) {
      if (record.businessName && record.locality) {
        const recNameClean = record.businessName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const recLocClean = record.locality.toLowerCase().replace(/[^a-z0-9]/g, '');

        if (buyerNameClean === recNameClean && buyerLocalityClean === recLocClean) {
          return {
            isSuppressed: false, // Invariant: DO NOT hard block!
            reviewStatus: 'POSSIBLE_MATCH_REVIEW',
            reviewNote: `Potential duplicate of suppressed business "${record.businessName}" in ${record.locality}. Flagged for operator review, not hard-blocked.`
          };
        }
      }
    }
  }

  return { isSuppressed: false, reviewStatus: 'CLEAR' };
}
