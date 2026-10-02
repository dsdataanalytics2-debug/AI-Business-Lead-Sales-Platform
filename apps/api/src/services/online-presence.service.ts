/**
 * Online Presence Analysis Service
 *
 * Implements:
 * - SSRF-safe website probing outside of database transactions
 * - Social & marketplace presence detection with exact hostname boundary matching
 * - Deterministic multi-campaign qualification scoring
 * - Optimistic concurrency protection against stale lead modifications
 * - In-process in-flight analysis deduplication
 * - Centralized transactional analysis invalidation
 * - Audit logging for all valid analysis execution outcomes
 */

import crypto from 'crypto';
import prisma, {
  Prisma,
  WebsiteStatus,
  OnlinePresenceType,
  SuppressionType,
  ChannelScope
} from '@leadmate/db';
import {
  AnalysisWebsiteStatus,
  ContactType,
  SCORE_VERSION,
  ANALYZER_VERSION,
  type LeadAnalysisResponse,
  type QualificationScoringInput,
  type ScoringContactFact
} from '@leadmate/shared';
import {
  calculateCampaignScores,
  websiteAnalyzer,
  WebsiteAnalyzer
} from '@leadmate/core';
import {
  NotFoundError,
  ConflictError
} from '../lib/errors.js';
import type { LeadRequestContext } from './lead.service.js';

// =========================================================
// Suppression Applicability Helper
// =========================================================

export interface SuppressionCheckEntry {
  type: SuppressionType | string;
  normalizedValue: string;
  channelScope: ChannelScope | string;
  expiresAt?: Date | null;
}

/**
 * Evaluates whether a direct contact is actively suppressed based on
 * organization suppression entries, channel scope, and expiration.
 */
export function isContactSuppressed(
  contactType: ContactType | string,
  contactNormalizedValue: string,
  suppressionEntries: SuppressionCheckEntry[],
  now: Date = new Date()
): boolean {
  return suppressionEntries.some((s) => {
    // 1. Normalized contact value match
    if (s.normalizedValue !== contactNormalizedValue) return false;

    // 2. Active / expiration validity check
    if (s.expiresAt && s.expiresAt <= now) return false;

    // 3. Channel scope & type applicability
    if (contactType === ContactType.PHONE || contactType === 'PHONE') {
      const typeMatches = s.type === SuppressionType.PHONE || s.type === 'PHONE';
      const scopeMatches =
        s.channelScope === ChannelScope.ALL ||
        s.channelScope === 'ALL' ||
        s.channelScope === ChannelScope.CALL ||
        s.channelScope === 'CALL';
      return typeMatches && scopeMatches;
    }

    if (contactType === ContactType.WHATSAPP || contactType === 'WHATSAPP') {
      const typeMatches =
        s.type === SuppressionType.WHATSAPP ||
        s.type === 'WHATSAPP' ||
        s.type === SuppressionType.PHONE ||
        s.type === 'PHONE';
      const scopeMatches =
        s.channelScope === ChannelScope.ALL ||
        s.channelScope === 'ALL' ||
        s.channelScope === ChannelScope.WHATSAPP ||
        s.channelScope === 'WHATSAPP';
      return typeMatches && scopeMatches;
    }

    if (contactType === ContactType.EMAIL || contactType === 'EMAIL') {
      const typeMatches = s.type === SuppressionType.EMAIL || s.type === 'EMAIL';
      const scopeMatches =
        s.channelScope === ChannelScope.ALL ||
        s.channelScope === 'ALL' ||
        s.channelScope === ChannelScope.EMAIL ||
        s.channelScope === 'EMAIL';
      return typeMatches && scopeMatches;
    }

    return false;
  });
}

// =========================================================
// Analysis Input Fingerprinting (In-Memory Stale Detection)
// =========================================================

export interface AnalysisFactualInputs {
  leadId: string;
  organizationId: string;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  updatedAt: Date;
  contacts: Array<{
    id: string;
    type: string;
    normalizedValue: string;
    phoneType: string | null;
    status: string;
    whatsappStatus: string;
    isPrimary: boolean;
    isSuppressed: boolean;
    evidence: Array<{
      sourceUrl: string | null;
    }>;
  }>;
  sources: Array<{
    sourceUrl: string | null;
  }>;
}

/**
 * Computes a deterministic SHA-256 fingerprint of all factual scoring & presence inputs.
 * Sorts child collections (contacts by ID, evidence & sources by sourceUrl) to ensure
 * stable canonical hashing across re-reads.
 */
export function computeAnalysisInputFingerprint(data: AnalysisFactualInputs): string {
  // 1. Sort contacts deterministically by id
  const sortedContacts = [...data.contacts]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => {
      const sortedEvidence = [...c.evidence]
        .map((e) => e.sourceUrl || '')
        .sort();

      return {
        id: c.id,
        type: c.type,
        normalizedValue: c.normalizedValue,
        phoneType: c.phoneType || '',
        status: c.status,
        whatsappStatus: c.whatsappStatus,
        isPrimary: c.isPrimary,
        isSuppressed: c.isSuppressed,
        evidence: sortedEvidence
      };
    });

  // 2. Sort sources by sourceUrl
  const sortedSources = [...data.sources]
    .map((s) => s.sourceUrl || '')
    .sort();

  // 3. Build canonical structure
  const canonical = {
    leadId: data.leadId,
    organizationId: data.organizationId,
    website: data.website || '',
    rating: data.rating ?? null,
    reviewCount: data.reviewCount ?? 0,
    updatedAtMs: data.updatedAt.getTime(),
    contacts: sortedContacts,
    sources: sortedSources
  };

  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

// =========================================================
// Presence Detection & Hostname Utilities
// =========================================================

export function parseHostname(rawUrl?: string | null): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : 'https://' + trimmed;
  try {
    const parsed = new URL(withProtocol);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isFacebookHost(host: string): boolean {
  return (
    host === 'facebook.com' ||
    host.endsWith('.facebook.com') ||
    host === 'fb.me' ||
    host.endsWith('.fb.me')
  );
}

export function isInstagramHost(host: string): boolean {
  return host === 'instagram.com' || host.endsWith('.instagram.com');
}

export const APPROVED_MARKETPLACE_DOMAINS = [
  'daraz.com.bd',
  'bikroy.com',
  'bdtradeinfo.com',
  'chaldal.com'
];

export function isMarketplaceHost(host: string): boolean {
  return APPROVED_MARKETPLACE_DOMAINS.some(
    (domain) => host === domain || host.endsWith('.' + domain)
  );
}

export interface PresenceFlags {
  hasWebsite: boolean;
  hasFacebook: boolean;
  hasInstagram: boolean;
  hasMarketplace: boolean;
}

export function detectPresenceFlags(
  leadWebsite: string | null | undefined,
  candidateUrls: Array<string | null | undefined>
): PresenceFlags {
  const allUrls = [leadWebsite, ...candidateUrls].filter(Boolean) as string[];

  let hasFacebook = false;
  let hasInstagram = false;
  let hasMarketplace = false;

  for (const rawUrl of allUrls) {
    const host = parseHostname(rawUrl);
    if (!host) continue;

    if (isFacebookHost(host)) {
      hasFacebook = true;
    }
    if (isInstagramHost(host)) {
      hasInstagram = true;
    }
    if (isMarketplaceHost(host)) {
      hasMarketplace = true;
    }
  }

  // hasWebsite requires a valid standalone website that is NOT Facebook, Instagram, or a marketplace
  let hasWebsite = false;
  if (leadWebsite && leadWebsite.trim().length > 0) {
    const mainHost = parseHostname(leadWebsite);
    if (mainHost) {
      const isSocialOrMarketplace =
        isFacebookHost(mainHost) ||
        isInstagramHost(mainHost) ||
        isMarketplaceHost(mainHost);
      if (!isSocialOrMarketplace) {
        hasWebsite = true;
      }
    }
  }

  return {
    hasWebsite,
    hasFacebook,
    hasInstagram,
    hasMarketplace
  };
}

export function classifyOnlinePresenceType(flags: PresenceFlags): OnlinePresenceType {
  const { hasWebsite, hasFacebook, hasInstagram, hasMarketplace } = flags;

  if (hasWebsite) {
    return OnlinePresenceType.WEBSITE;
  }

  if (hasFacebook && !hasInstagram && !hasMarketplace) {
    return OnlinePresenceType.FACEBOOK_ONLY;
  }

  if (hasInstagram && !hasFacebook && !hasMarketplace) {
    return OnlinePresenceType.INSTAGRAM_ONLY;
  }

  if (hasMarketplace && !hasFacebook && !hasInstagram) {
    return OnlinePresenceType.MARKETPLACE_ONLY;
  }

  if (!hasFacebook && !hasInstagram && !hasMarketplace) {
    return OnlinePresenceType.NONE_DETECTED;
  }

  // Multiple social/marketplace channels without standalone website
  return OnlinePresenceType.UNKNOWN;
}

export function mapAnalysisWebsiteStatusToDbWebsiteStatus(
  status: AnalysisWebsiteStatus
): WebsiteStatus {
  switch (status) {
    case AnalysisWebsiteStatus.NOT_APPLICABLE:
      return WebsiteStatus.NONE_DETECTED;
    case AnalysisWebsiteStatus.REACHABLE:
      return WebsiteStatus.REACHABLE;
    case AnalysisWebsiteStatus.UNREACHABLE:
    case AnalysisWebsiteStatus.TIMEOUT:
      return WebsiteStatus.UNREACHABLE;
    case AnalysisWebsiteStatus.ACCESS_RESTRICTED:
    case AnalysisWebsiteStatus.BLOCKED_SSRF:
    case AnalysisWebsiteStatus.INVALID_URL:
    case AnalysisWebsiteStatus.NON_HTML:
    default:
      return WebsiteStatus.UNKNOWN;
  }
}

// =========================================================
// Centralized Invalidation Helper
// =========================================================

/**
 * Transactionally invalidates the online presence analysis and resets
 * the lead's synchronized websiteStatus and onlinePresenceType.
 */
export async function invalidateLeadOnlinePresenceAnalysis(
  tx: Prisma.TransactionClient,
  organizationId: string,
  leadId: string,
  _reason?: string
): Promise<void> {
  // 1. Delete existing analysis row if present
  await tx.leadOnlinePresenceAnalysis.deleteMany({
    where: {
      leadId,
      organizationId
    }
  });

  // 2. Determine reset websiteStatus based on whether lead has a website
  const lead = await tx.lead.findUnique({
    where: { id: leadId },
    select: { website: true }
  });

  if (!lead) {
    return;
  }

  const resetWebsiteStatus =
    lead.website && lead.website.trim().length > 0
      ? WebsiteStatus.UNKNOWN
      : WebsiteStatus.NONE_DETECTED;

  // 3. Reset Lead summary fields
  await tx.lead.update({
    where: { id: leadId },
    data: {
      websiteStatus: resetWebsiteStatus,
      onlinePresenceType: OnlinePresenceType.UNKNOWN
    }
  });
}

// =========================================================
// Online Presence Service Implementation
// =========================================================

export class OnlinePresenceService {
  private readonly inFlightAnalyses = new Map<string, Promise<LeadAnalysisResponse>>();

  constructor(private readonly analyzer: WebsiteAnalyzer = websiteAnalyzer) {}

  /**
   * Triggers or re-runs online presence analysis for a lead.
   * Employs same-process in-flight deduplication.
   */
  async analyzeLead(
    leadId: string,
    context: LeadRequestContext
  ): Promise<LeadAnalysisResponse> {
    const dedupeKey = `${context.organizationId}:${leadId}`;
    const inFlight = this.inFlightAnalyses.get(dedupeKey);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.executeAnalysis(leadId, context);
    this.inFlightAnalyses.set(dedupeKey, promise);

    try {
      return await promise;
    } finally {
      this.inFlightAnalyses.delete(dedupeKey);
    }
  }

  /**
   * Retrieves the current persisted online presence analysis for a lead.
   * Returns null if analysis has not been executed yet.
   */
  async getLeadAnalysis(
    leadId: string,
    context: LeadRequestContext
  ): Promise<LeadAnalysisResponse | null> {
    const { organizationId } = context;

    // Tenant-scoped Lead existence check
    const lead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        organizationId
      },
      select: { id: true }
    });

    if (!lead) {
      throw new NotFoundError(`Lead with ID "${leadId}" not found`);
    }

    const analysis = await prisma.leadOnlinePresenceAnalysis.findUnique({
      where: {
        leadId_organizationId: {
          leadId,
          organizationId
        }
      }
    });

    if (!analysis) {
      return null;
    }

    return this.formatResponse(analysis);
  }

  /**
   * Loads all scoring and presence factual inputs for a lead, including
   * contacts, evidence, sources, and active suppression list state.
   */
  private async loadFactualInputs(
    client: Prisma.TransactionClient | typeof prisma,
    organizationId: string,
    leadId: string
  ): Promise<AnalysisFactualInputs> {
    const lead = await client.lead.findFirst({
      where: {
        id: leadId,
        organizationId
      },
      select: {
        id: true,
        organizationId: true,
        website: true,
        rating: true,
        reviewCount: true,
        updatedAt: true,
        contacts: {
          select: {
            id: true,
            type: true,
            normalizedValue: true,
            phoneType: true,
            status: true,
            whatsappStatus: true,
            isPrimary: true,
            evidence: {
              select: {
                sourceUrl: true
              }
            }
          }
        },
        sources: {
          select: {
            sourceUrl: true
          }
        }
      }
    });

    if (!lead) {
      throw new NotFoundError(`Lead with ID "${leadId}" not found`);
    }

    // Load active suppression list entries for organization
    const normalizedValues = lead.contacts.map((c) => c.normalizedValue);
    const suppressions =
      normalizedValues.length > 0
        ? await client.suppressionList.findMany({
            where: {
              organizationId,
              normalizedValue: { in: normalizedValues }
            },
            select: {
              type: true,
              normalizedValue: true,
              channelScope: true,
              expiresAt: true
            }
          })
        : [];

    const now = new Date();

    const contactsWithSuppression = lead.contacts.map((c) => ({
      id: c.id,
      type: c.type,
      normalizedValue: c.normalizedValue,
      phoneType: c.phoneType,
      status: c.status,
      whatsappStatus: c.whatsappStatus,
      isPrimary: c.isPrimary,
      isSuppressed: isContactSuppressed(c.type, c.normalizedValue, suppressions, now),
      evidence: c.evidence.map((e) => ({ sourceUrl: e.sourceUrl }))
    }));

    return {
      leadId: lead.id,
      organizationId: lead.organizationId,
      website: lead.website,
      rating: lead.rating,
      reviewCount: lead.reviewCount,
      updatedAt: lead.updatedAt,
      contacts: contactsWithSuppression,
      sources: lead.sources.map((s) => ({ sourceUrl: s.sourceUrl }))
    };
  }

  /**
   * Core analysis execution pipeline:
   * 1. Read factual scoring inputs & compute initial input fingerprint + capture updatedAt.
   * 2. Perform external website analysis OUTSIDE DB transactions.
   * 3. Compute presence flags and campaign scores.
   * 4. Persist in short transactional boundary with optimistic stale check & input fingerprint comparison.
   */
  private async executeAnalysis(
    leadId: string,
    context: LeadRequestContext
  ): Promise<LeadAnalysisResponse> {
    const { organizationId, userId } = context;

    // 1. Read initial factual scoring inputs
    const initialInputs = await this.loadFactualInputs(prisma, organizationId, leadId);
    const initialFingerprint = computeAnalysisInputFingerprint(initialInputs);
    const initialUpdatedAt = initialInputs.updatedAt;

    // Map initial contacts to ScoringContactFact
    const scoringContacts: ScoringContactFact[] = initialInputs.contacts.map((c) => ({
      type: c.type as any,
      normalizedValue: c.normalizedValue,
      phoneType: c.phoneType as any,
      status: c.status as any,
      whatsappStatus: c.whatsappStatus as any,
      isPrimary: c.isPrimary,
      isSuppressed: c.isSuppressed
    }));

    // Extract candidate URLs for social & marketplace presence detection
    const candidateUrls: Array<string | null | undefined> = [
      ...initialInputs.sources.map((s) => s.sourceUrl),
      ...initialInputs.contacts.flatMap((c) => c.evidence.map((e) => e.sourceUrl))
    ];

    const presenceFlags = detectPresenceFlags(initialInputs.website, candidateUrls);
    const onlinePresenceType = classifyOnlinePresenceType(presenceFlags);

    // 2. Run Website Analyzer OUTSIDE of database transactions
    const analyzerResult = await this.analyzer.analyze(initialInputs.website);

    // 3. Build qualification scoring input & compute campaign scores
    const scoringInput: QualificationScoringInput = {
      websiteStatus: analyzerResult.websiteStatus,
      isHttps: analyzerResult.isHttps,
      responseTimeMs: analyzerResult.responseTimeMs,
      pageTitle: analyzerResult.pageTitle,
      metaDescription: analyzerResult.metaDescription,
      hasWebsite: presenceFlags.hasWebsite,
      hasFacebook: presenceFlags.hasFacebook,
      hasInstagram: presenceFlags.hasInstagram,
      hasMarketplace: presenceFlags.hasMarketplace,
      rating: initialInputs.rating,
      reviewCount: initialInputs.reviewCount,
      contacts: scoringContacts
    };

    const campaignScores = calculateCampaignScores(scoringInput);
    const mappedWebsiteStatus = mapAnalysisWebsiteStatusToDbWebsiteStatus(
      analyzerResult.websiteStatus
    );

    // 4. Open short transactional boundary for upsert, lead sync, and audit log
    const persisted = await prisma.$transaction(async (tx) => {
      // Re-read current factual inputs inside transaction
      const currentInputs = await this.loadFactualInputs(tx, organizationId, leadId);
      const currentFingerprint = computeAnalysisInputFingerprint(currentInputs);

      // Concurrency protection: Verify both updatedAt timestamp AND factual input fingerprint
      if (
        currentInputs.updatedAt.getTime() !== initialUpdatedAt.getTime() ||
        currentFingerprint !== initialFingerprint
      ) {
        throw new ConflictError(
          'Lead or scoring inputs were modified during analysis. Please retry.'
        );
      }

      // Upsert LeadOnlinePresenceAnalysis using composite key [leadId, organizationId]
      const analysisRow = await tx.leadOnlinePresenceAnalysis.upsert({
        where: {
          leadId_organizationId: {
            leadId,
            organizationId
          }
        },
        create: {
          organizationId,
          leadId,
          websiteUrl: analyzerResult.websiteUrl,
          websiteStatus: analyzerResult.websiteStatus,
          httpStatusCode: analyzerResult.httpStatusCode,
          isHttps: analyzerResult.isHttps,
          isRedirected: analyzerResult.isRedirected,
          finalUrl: analyzerResult.finalUrl,
          responseTimeMs: analyzerResult.responseTimeMs,
          pageTitle: analyzerResult.pageTitle,
          metaDescription: analyzerResult.metaDescription,
          hasWebsite: presenceFlags.hasWebsite,
          hasFacebook: presenceFlags.hasFacebook,
          hasInstagram: presenceFlags.hasInstagram,
          hasMarketplace: presenceFlags.hasMarketplace,
          campaignScores: campaignScores as any,
          analyzerVersion: ANALYZER_VERSION,
          scoreVersion: SCORE_VERSION,
          analyzedAt: new Date()
        },
        update: {
          websiteUrl: analyzerResult.websiteUrl,
          websiteStatus: analyzerResult.websiteStatus,
          httpStatusCode: analyzerResult.httpStatusCode,
          isHttps: analyzerResult.isHttps,
          isRedirected: analyzerResult.isRedirected,
          finalUrl: analyzerResult.finalUrl,
          responseTimeMs: analyzerResult.responseTimeMs,
          pageTitle: analyzerResult.pageTitle,
          metaDescription: analyzerResult.metaDescription,
          hasWebsite: presenceFlags.hasWebsite,
          hasFacebook: presenceFlags.hasFacebook,
          hasInstagram: presenceFlags.hasInstagram,
          hasMarketplace: presenceFlags.hasMarketplace,
          campaignScores: campaignScores as any,
          analyzerVersion: ANALYZER_VERSION,
          scoreVersion: SCORE_VERSION,
          analyzedAt: new Date()
        }
      });

      // Synchronize Lead summary presence state
      await tx.lead.update({
        where: { id: leadId },
        data: {
          websiteStatus: mappedWebsiteStatus,
          onlinePresenceType
        }
      });

      // Audit Log (scalar metadata only)
      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'lead.online_presence_analyzed',
          entityType: 'Lead',
          entityId: leadId,
          after: {
            websiteStatus: analyzerResult.websiteStatus,
            analyzerVersion: ANALYZER_VERSION,
            scoreVersion: SCORE_VERSION,
            analyzedAt: analysisRow.analyzedAt.toISOString()
          }
        }
      });

      return analysisRow;
    });

    return this.formatResponse(persisted);
  }

  private formatResponse(analysis: any): LeadAnalysisResponse {
    return {
      id: analysis.id,
      leadId: analysis.leadId,
      websiteUrl: analysis.websiteUrl,
      websiteStatus: analysis.websiteStatus,
      httpStatusCode: analysis.httpStatusCode,
      isHttps: analysis.isHttps,
      isRedirected: analysis.isRedirected,
      finalUrl: analysis.finalUrl,
      responseTimeMs: analysis.responseTimeMs,
      pageTitle: analysis.pageTitle,
      metaDescription: analysis.metaDescription,
      hasWebsite: analysis.hasWebsite,
      hasFacebook: analysis.hasFacebook,
      hasInstagram: analysis.hasInstagram,
      hasMarketplace: analysis.hasMarketplace,
      campaignScores: analysis.campaignScores as any,
      analyzerVersion: analysis.analyzerVersion,
      scoreVersion: analysis.scoreVersion,
      analyzedAt:
        analysis.analyzedAt instanceof Date
          ? analysis.analyzedAt.toISOString()
          : analysis.analyzedAt
    };
  }
}

export const onlinePresenceService = new OnlinePresenceService();
