import { z } from 'zod';
import {
  AnalysisWebsiteStatus,
  CampaignType,
  QualificationReasonCode,
  ContactType,
  PhoneType,
  ContactStatus,
  WhatsAppStatus
} from '../enums.js';

export const SCORE_VERSION = 'v1';
export const ANALYZER_VERSION = 'v1';

/* =========================================================
 * Campaign Score & Reason Schemas
 * ========================================================= */

export const campaignScoreSchema = z
  .object({
    campaignType: z.nativeEnum(CampaignType),
    score: z.number().int().min(0).max(100),
    reasons: z.array(z.nativeEnum(QualificationReasonCode))
  })
  .strict();

export type CampaignScore = z.infer<typeof campaignScoreSchema>;

/* =========================================================
 * Lead Analysis Response Contract
 * ========================================================= */

export const leadAnalysisResponseSchema = z
  .object({
    id: z.string().uuid(),
    leadId: z.string().uuid(),
    websiteUrl: z.string().nullable(),
    websiteStatus: z.nativeEnum(AnalysisWebsiteStatus),
    httpStatusCode: z.number().int().nullable(),
    isHttps: z.boolean(),
    isRedirected: z.boolean(),
    finalUrl: z.string().nullable(),
    responseTimeMs: z.number().int().nullable(),
    pageTitle: z.string().nullable(),
    metaDescription: z.string().nullable(),
    hasWebsite: z.boolean(),
    hasFacebook: z.boolean(),
    hasInstagram: z.boolean(),
    hasMarketplace: z.boolean(),
    campaignScores: z.array(campaignScoreSchema),
    analyzerVersion: z.string(),
    scoreVersion: z.string(),
    analyzedAt: z.union([z.date(), z.string()])
  })
  .strict();

export type LeadAnalysisResponse = z.infer<typeof leadAnalysisResponseSchema>;

/* =========================================================
 * Scoring Input Domain Contract (Pure engine input)
 * ========================================================= */

export interface ScoringContactFact {
  type: ContactType;
  normalizedValue: string;
  phoneType?: PhoneType | null;
  status: ContactStatus;
  whatsappStatus?: WhatsAppStatus;
  isPrimary: boolean;
  isSuppressed: boolean;
}

export interface QualificationScoringInput {
  websiteStatus: AnalysisWebsiteStatus;
  isHttps?: boolean | null;
  responseTimeMs?: number | null;
  pageTitle?: string | null;
  metaDescription?: string | null;
  hasWebsite: boolean;
  hasFacebook: boolean;
  hasInstagram: boolean;
  hasMarketplace: boolean;
  rating?: number | null;
  reviewCount?: number | null;
  contacts: ScoringContactFact[];
}
