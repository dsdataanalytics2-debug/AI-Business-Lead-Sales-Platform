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

export const aiProductAnalysisSchema = z.object({
  productCategory: z.string().trim().min(1).max(100),
  productSummary: z.string().trim().min(1).max(500),
  buyerTargets: z.array(aiBuyerTargetItemSchema).min(1).max(10),
  searchTerms: z.array(z.string().trim().min(1).max(100)).min(1).max(10)
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

export interface DiscoveryRunMetrics {
  runNumber: number;
  newBuyersAdded: number;
  previouslyDiscoveredSkipped: number;
  providerDuplicatesSkipped: number;
  missionTotal: number;
  targetsUsed?: string[];
  message?: string;
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
  matchedBuyerCategory?: string | null;
  searchTargetUsed?: string | null;
  sourceData?: any;
  leadId?: string | null;
  status: MissionBuyerStatus | string;
  isNew?: boolean;
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
