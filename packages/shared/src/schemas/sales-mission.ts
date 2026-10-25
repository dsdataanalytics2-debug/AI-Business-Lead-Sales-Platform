import { z } from 'zod';
import {
  SalesMissionGoal,
  SalesMissionStatus,
  MissionBuyerStatus,
  SalesMissionBuyerStrategy
} from '../enums.js';
import type { ProductDto } from './product.js';

export const aiBuyerTargetItemSchema = z.object({
  category: z.string().trim().min(1, 'Category is required').max(100),
  reason: z.string().trim().min(1, 'Reason is required').max(500),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('HIGH')
});

export type AiBuyerTargetItem = z.infer<typeof aiBuyerTargetItemSchema>;

export const idealBuyerProfileSchema = z.object({
  primaryBuyerTypes: z.array(z.string().trim()),
  secondaryBuyerTypes: z.array(z.string().trim()),
  businessSize: z.array(z.string().trim()),
  targetMarkets: z.array(z.string().trim()),
  commercialUseCases: z.array(z.string().trim()),
  recommendedPitchAngles: z.array(z.string().trim())
});

export type IdealBuyerProfile = z.infer<typeof idealBuyerProfileSchema>;

export const aiProductAnalysisSchema = z.object({
  productCategory: z.string().trim().min(1).max(100),
  productSummary: z.string().trim().min(1).max(500),
  buyerTargets: z.array(aiBuyerTargetItemSchema).min(1).max(10),
  searchTerms: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  idealBuyerProfile: idealBuyerProfileSchema.optional().nullable(),
  suggestedRelatedNeeds: z.array(z.string().trim()).optional().nullable()
});

export type AiProductAnalysisResult = z.infer<typeof aiProductAnalysisSchema>;

export const createSalesMissionObjectSchema = z.object({
  productId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1, 'Mission name is required').max(200),
  missionName: z.string().trim().min(1).max(200).optional(),
  goal: z.nativeEnum(SalesMissionGoal).or(z.string().trim().min(1)).default(SalesMissionGoal.WHOLESALE),
  salesGoal: z.string().trim().optional(),
  targetMarket: z.string().trim().min(1, 'Target market is required').max(200),
  location: z.string().trim().max(200).optional(),
  buyerType: z.nativeEnum(SalesMissionBuyerStrategy).or(z.string().trim().min(1)).default(SalesMissionBuyerStrategy.AI_DECIDE),
  buyerStrategy: z.string().trim().optional(),
  resultTarget: z.coerce.number().int().min(5).max(100).default(50),
  targetCount: z.coerce.number().int().optional(),
  productAnalysisSnapshot: aiProductAnalysisSchema.optional().nullable(),
  selectedBuyerTargets: z.array(z.string().trim()).optional().nullable()
});

export const createSalesMissionSchema = z.preprocess(
  (raw: any) => {
    if (typeof raw !== 'object' || raw === null) return raw;
    const normalized: Record<string, any> = { ...raw };
    if (!normalized.name && normalized.missionName) {
      normalized.name = normalized.missionName;
    }
    if (!normalized.targetMarket && normalized.location) {
      normalized.targetMarket = normalized.location;
    }
    if (!normalized.goal && normalized.salesGoal) {
      normalized.goal = normalized.salesGoal;
    }
    if (!normalized.buyerType && normalized.buyerStrategy) {
      normalized.buyerType = normalized.buyerStrategy;
    }
    if (normalized.resultTarget === undefined && normalized.targetCount !== undefined) {
      normalized.resultTarget = normalized.targetCount;
    }
    return normalized;
  },
  createSalesMissionObjectSchema
);

export type CreateSalesMissionInput = z.input<typeof createSalesMissionObjectSchema>;
export type CreateSalesMissionParsed = z.output<typeof createSalesMissionObjectSchema>;

export const updateSalesMissionSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  goal: z.nativeEnum(SalesMissionGoal).optional(),
  targetMarket: z.string().trim().min(1).max(200).optional(),
  buyerType: z.string().trim().optional(),
  resultTarget: z.coerce.number().int().min(5).max(100).optional(),
  status: z.nativeEnum(SalesMissionStatus).optional(),
  productAnalysisSnapshot: aiProductAnalysisSchema.optional().nullable(),
  selectedBuyerTargets: z.array(z.string().trim()).optional().nullable()
});

export type UpdateSalesMissionInput = z.input<typeof updateSalesMissionSchema>;
export type UpdateSalesMissionParsed = z.output<typeof updateSalesMissionSchema>;

export const listSalesMissionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  productId: z.string().uuid().optional(),
  status: z.nativeEnum(SalesMissionStatus).optional(),
  search: z.string().trim().optional()
});

export type ListSalesMissionsQuery = z.infer<typeof listSalesMissionsQuerySchema>;

export interface BuyerScoreBreakdown {
  productFit: number;
  categoryMatch: number;
  locationFit: number;
  contactability: number;
  sourceConfidence: number;
  intentStrength?: number;
}

export type WholesaleIntentLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export type BuyerPriority = 'HOT' | 'WARM' | 'COLD';

export interface WholesaleIntentEvidence {
  level: WholesaleIntentLevel;
  signals: string[];
  matchedSnippets: string[];
  evaluatedAt: string | Date;
}

export interface DiscoveryRunMetrics {
  runNumber: number;
  newBuyersAdded: number;
  previouslyDiscoveredSkipped: number;
  providerDuplicatesSkipped: number;
  duplicatesSkipped?: number;
  missionTotal: number;
  targetsUsed?: string[];
  locationsUsed?: string[];
  providersUsed?: string[];
  searchedCombinations?: string[];
  executedAt?: string | Date;
  providerStatuses?: Record<string, string>;
  providerBreakdown?: Record<string, number>;
  mergedDuplicates?: number;
  contactableCount?: number;
  hotBuyersCount?: number;
  highIntentCount?: number;
  discoveredBuyersCount?: number;
  inboundLeadsCount?: number;
  assistedSourcesCount?: number;
  message?: string;
}

export type SourceEvidenceType =
  | 'GOOGLE_PLACES'
  | 'OPENSTREETMAP'
  | 'COMPANY_WEBSITE'
  | 'PUBLIC_DIRECTORY'
  | 'FACEBOOK_BUSINESS_PAGE'
  | 'TIKTOK_BUSINESS'
  | 'PUBLIC_RFQ';

export interface SourceEvidence {
  sourceType: SourceEvidenceType | string;
  sourceName: string;
  sourceUrl?: string | null;
  externalId?: string | null;
  observedAt: string | Date;
  evidenceType: string;
  snippet?: string | null;
  confidence?: 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW' | number;
  notes?: string | null;
  metadata?: Record<string, any> | null;
}

export type EnrichedContactType =
  | 'PHONE'
  | 'EMAIL'
  | 'WEBSITE'
  | 'CONTACT_PAGE'
  | 'FACEBOOK_PAGE'
  | 'INSTAGRAM_PAGE'
  | 'WHATSAPP'
  | 'ADDRESS';

export interface EnrichedContact {
  value: string;
  type: EnrichedContactType;
  source: string;
  verifiedAt: string | Date;
  confidence: 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW';
  sourceUrl?: string | null;
}

export interface SalesMissionBuyerDto {
  id: string;
  organizationId: string;
  salesMissionId: string;
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
  buyerScore?: number | null;
  scoreBreakdown?: BuyerScoreBreakdown | null;
  matchedBuyerCategory?: string | null;
  searchTargetUsed?: string | null;
  sourceData?: any;
  leadId?: string | null;
  status: MissionBuyerStatus | string;
  isNew?: boolean;
  sourceEvidences?: SourceEvidence[] | null;
  enrichedContacts?: EnrichedContact[] | null;
  sourceConfidence?: string | null;
  whatsappStatus?: 'EXPLICIT_VERIFIED' | 'NO_WHATSAPP' | 'NOT_VERIFIED' | string | null;
  priority?: BuyerPriority | string | null;
  wholesaleIntent?: WholesaleIntentLevel | string | null;
  wholesaleIntentSignals?: string[] | null;
  suggestedRelatedNeeds?: string[] | null;
  conversionStage?: string | null;
  conversionWonEvidence?: any;
  conversionLostReason?: string | null;
  conversionLostAt?: string | Date | null;
  outreachDrafts?: any[] | null;
  isSuppressed?: boolean;
  suppressionReason?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface SalesMissionDetailDto {
  id: string;
  organizationId: string;
  createdByUserId: string;
  productId?: string | null;
  name: string;
  goal: SalesMissionGoal | string;
  targetMarket: string;
  buyerType: string;
  resultTarget: number;
  status: SalesMissionStatus | string;
  productAnalysisSnapshot?: AiProductAnalysisResult | null;
  selectedBuyerTargets?: string[] | null;
  resultCount: number;
  startedAt?: string | Date | null;
  completedAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  product?: ProductDto | null;
  buyers?: SalesMissionBuyerDto[];
  buyerStats?: {
    found: number;
    savedToCrm: number;
  };
  discoveryRunMetrics?: DiscoveryRunMetrics | null;
  discoveryRuns?: DiscoveryRunMetrics[];
}

export const analyzeProductObjectSchema = z.object({
  productId: z.string().uuid().optional().nullable(),
  productName: z.string().trim().min(1, 'Product name is required').max(200, 'Product name must be 200 characters or fewer'),
  name: z.string().trim().min(1).max(200).optional(),
  productDescription: z.string().trim().min(1, 'Product description is required').max(4000, 'Product description must be 4000 characters or fewer'),
  description: z.string().trim().min(1).max(4000, 'Product description must be 4000 characters or fewer').optional(),
  category: z.string().trim().max(100).optional().nullable(),
  goal: z.nativeEnum(SalesMissionGoal).or(z.string().trim().min(1)).default(SalesMissionGoal.WHOLESALE),
  salesGoal: z.string().trim().optional(),
  targetMarket: z.string().trim().min(1, 'Target market is required').max(200).default('Bangladesh'),
  location: z.string().trim().max(200).optional(),
  buyerType: z.nativeEnum(SalesMissionBuyerStrategy).or(z.string().trim().min(1)).default(SalesMissionBuyerStrategy.AI_DECIDE),
  buyerStrategy: z.string().trim().optional(),
  resultTarget: z.coerce.number().int().min(5).max(100).optional().nullable(),
  targetCount: z.coerce.number().int().optional()
});

export const AnalyzeProductRequestSchema = z.preprocess(
  (raw: any) => {
    if (typeof raw !== 'object' || raw === null) return raw;
    const normalized: Record<string, any> = { ...raw };

    // Support field aliases from different frontend versions or payloads
    if (!normalized.productName && normalized.name) {
      normalized.productName = normalized.name;
    }
    if (!normalized.productDescription && normalized.description) {
      normalized.productDescription = normalized.description;
    }
    if (!normalized.targetMarket && normalized.location) {
      normalized.targetMarket = normalized.location;
    }
    if (!normalized.goal && normalized.salesGoal) {
      normalized.goal = normalized.salesGoal;
    }
    if (!normalized.buyerType && normalized.buyerStrategy) {
      normalized.buyerType = normalized.buyerStrategy;
    }
    if (normalized.resultTarget === undefined && normalized.targetCount !== undefined) {
      normalized.resultTarget = normalized.targetCount;
    }

    // Convert empty string to null/undefined where appropriate
    if (normalized.category === '') {
      normalized.category = null;
    }

    return normalized;
  },
  analyzeProductObjectSchema
);

export type AnalyzeProductRequest = z.output<typeof analyzeProductObjectSchema>;
export const analyzeProductInputSchema = AnalyzeProductRequestSchema;
export type AnalyzeProductInput = AnalyzeProductRequest;
