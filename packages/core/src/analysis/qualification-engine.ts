/**
 * Pure Deterministic Campaign Qualification Engine (M2 V1)
 *
 * Implements rule-based, side-effect-free scoring across three core campaigns:
 * - WEBSITE_ACQUISITION
 * - WEBSITE_REDESIGN
 * - ONLINE_PRESENCE_IMPROVEMENT
 *
 * Invariants:
 * - 100% deterministic (no AI/LLM, no Date.now(), no network, no DB)
 * - Returns fixed campaign order with fixed rule-table reason ordering
 * - Scores are clamped between 0 and 100
 * - Never mutates input
 */

import {
  AnalysisWebsiteStatus,
  CampaignType,
  QualificationReasonCode,
  ContactType,
  PhoneType,
  ContactStatus,
  WhatsAppStatus,
  type CampaignScore,
  type QualificationScoringInput
} from '@leadmate/shared';
import { normalizePhone } from '../normalization/phone.js';
import { normalizeEmail } from '../normalization/email.js';

export const SCORE_VERSION = 'v1';

/**
 * Normalizes string inputs for defensive metadata parsing.
 * Empty or whitespace-only strings are treated as null.
 */
function normalizeStringInput(val?: string | null): string | null {
  if (val === undefined || val === null) return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Calculates campaign scores deterministically based on factual signals.
 *
 * @param input - Structured qualification scoring input facts
 * @returns Array of CampaignScore objects in fixed canonical order
 */
export function calculateCampaignScores(
  input: QualificationScoringInput
): CampaignScore[] {
  const normalizedTitle = normalizeStringInput(input.pageTitle);
  const normalizedMeta = normalizeStringInput(input.metaDescription);
  const contacts = Array.isArray(input.contacts) ? input.contacts : [];

  // 1. Evaluate contact facts under strict M1 trust rules
  const hasUsableMobile = contacts.some((c) => {
    if (
      c.type !== ContactType.PHONE ||
      c.phoneType !== PhoneType.MOBILE ||
      (c.status !== ContactStatus.FOUND && c.status !== ContactStatus.VERIFIED) ||
      c.isSuppressed ||
      typeof c.normalizedValue !== 'string'
    ) {
      return false;
    }
    const norm = normalizePhone(c.normalizedValue);
    return (
      norm.isValid &&
      norm.phoneType === PhoneType.MOBILE &&
      norm.normalizedValue === c.normalizedValue
    );
  });

  const hasUsablePrimaryEmail = contacts.some((c) => {
    if (
      c.type !== ContactType.EMAIL ||
      c.isPrimary !== true ||
      (c.status !== ContactStatus.FOUND && c.status !== ContactStatus.VERIFIED) ||
      c.isSuppressed ||
      typeof c.normalizedValue !== 'string'
    ) {
      return false;
    }
    const norm = normalizeEmail(c.normalizedValue);
    return norm.isValid && norm.normalizedValue === c.normalizedValue;
  });

  const hasUsableWhatsApp = contacts.some((c) => {
    if (
      c.type !== ContactType.WHATSAPP ||
      (c.whatsappStatus !== WhatsAppStatus.PUBLICLY_LISTED &&
        c.whatsappStatus !== WhatsAppStatus.CONFIRMED) ||
      (c.status !== ContactStatus.FOUND && c.status !== ContactStatus.VERIFIED) ||
      c.isSuppressed ||
      typeof c.normalizedValue !== 'string'
    ) {
      return false;
    }
    const norm = normalizePhone(c.normalizedValue);
    return (
      norm.isValid &&
      norm.phoneType === PhoneType.MOBILE &&
      norm.normalizedValue === c.normalizedValue
    );
  });

  // 2. Evaluate rating and review signals
  const hasHighRatingNoWeb =
    typeof input.rating === 'number' &&
    input.rating >= 4.0 &&
    typeof input.reviewCount === 'number' &&
    input.reviewCount >= 5 &&
    (input.websiteStatus === AnalysisWebsiteStatus.NOT_APPLICABLE ||
      input.websiteStatus === AnalysisWebsiteStatus.UNREACHABLE ||
      input.websiteStatus === AnalysisWebsiteStatus.TIMEOUT);

  const hasEstablishedReviews =
    typeof input.reviewCount === 'number' && input.reviewCount >= 10;

  // =========================================================
  // CAMPAIGN 1: WEBSITE_ACQUISITION
  // =========================================================
  let acquisitionScore = 0;
  const acquisitionReasons: QualificationReasonCode[] = [];

  const isAcquisitionEligible =
    input.websiteStatus === AnalysisWebsiteStatus.NOT_APPLICABLE ||
    input.websiteStatus === AnalysisWebsiteStatus.UNREACHABLE ||
    input.websiteStatus === AnalysisWebsiteStatus.TIMEOUT;

  if (isAcquisitionEligible) {
    if (input.websiteStatus === AnalysisWebsiteStatus.NOT_APPLICABLE) {
      acquisitionScore += 40;
      acquisitionReasons.push(QualificationReasonCode.NO_WEBSITE);
    } else if (input.websiteStatus === AnalysisWebsiteStatus.UNREACHABLE) {
      acquisitionScore += 35;
      acquisitionReasons.push(QualificationReasonCode.WEBSITE_UNREACHABLE);
    } else if (input.websiteStatus === AnalysisWebsiteStatus.TIMEOUT) {
      acquisitionScore += 30;
      acquisitionReasons.push(QualificationReasonCode.WEBSITE_TIMEOUT);
    }

    if (input.hasFacebook === true && input.hasWebsite === false) {
      acquisitionScore += 20;
      acquisitionReasons.push(QualificationReasonCode.FACEBOOK_ONLY);
    }

    if (hasHighRatingNoWeb) {
      acquisitionScore += 15;
      acquisitionReasons.push(QualificationReasonCode.HIGH_RATING_NO_WEB);
    }

    if (hasUsableMobile) {
      acquisitionScore += 15;
      acquisitionReasons.push(QualificationReasonCode.HAS_MOBILE_PHONE);
    }

    if (hasUsablePrimaryEmail) {
      acquisitionScore += 10;
      acquisitionReasons.push(QualificationReasonCode.HAS_PRIMARY_EMAIL);
    }

    if (hasUsableWhatsApp) {
      acquisitionScore += 10;
      acquisitionReasons.push(QualificationReasonCode.HAS_WHATSAPP);
    }
  }

  const acquisitionResult: CampaignScore = {
    campaignType: CampaignType.WEBSITE_ACQUISITION,
    score: Math.min(100, Math.max(0, acquisitionScore)),
    reasons: acquisitionReasons
  };

  // =========================================================
  // CAMPAIGN 2: WEBSITE_REDESIGN
  // =========================================================
  let redesignScore = 0;
  const redesignReasons: QualificationReasonCode[] = [];

  const isRedesignEligible =
    input.websiteStatus === AnalysisWebsiteStatus.REACHABLE;

  if (isRedesignEligible) {
    if (input.isHttps === false) {
      redesignScore += 35;
      redesignReasons.push(QualificationReasonCode.NO_HTTPS);
    }

    if (normalizedMeta === null) {
      redesignScore += 25;
      redesignReasons.push(QualificationReasonCode.NO_META_DESCRIPTION);
    }

    if (normalizedTitle === null || normalizedTitle.length < 10) {
      redesignScore += 15;
      redesignReasons.push(QualificationReasonCode.SHORT_PAGE_TITLE);
    }

    if (
      typeof input.responseTimeMs === 'number' &&
      input.responseTimeMs > 2500
    ) {
      redesignScore += 10;
      redesignReasons.push(QualificationReasonCode.SLOW_RESPONSE);
    }

    if (input.hasFacebook === true) {
      redesignScore += 15;
      redesignReasons.push(QualificationReasonCode.MULTI_CHANNEL_PRESENCE);
    }

    if (hasUsableMobile) {
      redesignScore += 10;
      redesignReasons.push(QualificationReasonCode.HAS_MOBILE_PHONE);
    }
  }

  const redesignResult: CampaignScore = {
    campaignType: CampaignType.WEBSITE_REDESIGN,
    score: Math.min(100, Math.max(0, redesignScore)),
    reasons: redesignReasons
  };

  // =========================================================
  // CAMPAIGN 3: ONLINE_PRESENCE_IMPROVEMENT
  // =========================================================
  let presenceScore = 0;
  const presenceReasons: QualificationReasonCode[] = [];

  if (input.hasFacebook === true && input.hasWebsite === false) {
    presenceScore += 35;
    presenceReasons.push(QualificationReasonCode.FACEBOOK_ONLY);
  } else if (
    input.hasInstagram === true &&
    input.hasWebsite === false &&
    input.hasFacebook === false
  ) {
    presenceScore += 30;
    presenceReasons.push(QualificationReasonCode.INSTAGRAM_ONLY);
  }

  if (
    input.websiteStatus === AnalysisWebsiteStatus.REACHABLE &&
    normalizedMeta === null
  ) {
    presenceScore += 20;
    presenceReasons.push(QualificationReasonCode.NO_META_DESCRIPTION);
  }

  if (hasEstablishedReviews) {
    presenceScore += 20;
    presenceReasons.push(QualificationReasonCode.HAS_ESTABLISHED_REVIEWS);
  }

  if (hasUsableWhatsApp) {
    presenceScore += 15;
    presenceReasons.push(QualificationReasonCode.HAS_WHATSAPP);
  }

  if (hasUsablePrimaryEmail) {
    presenceScore += 10;
    presenceReasons.push(QualificationReasonCode.HAS_PRIMARY_EMAIL);
  }

  if (hasUsableMobile) {
    presenceScore += 10;
    presenceReasons.push(QualificationReasonCode.HAS_MOBILE_PHONE);
  }

  const presenceResult: CampaignScore = {
    campaignType: CampaignType.ONLINE_PRESENCE_IMPROVEMENT,
    score: Math.min(100, Math.max(0, presenceScore)),
    reasons: presenceReasons
  };

  // Fixed canonical output order
  return [acquisitionResult, redesignResult, presenceResult];
}
