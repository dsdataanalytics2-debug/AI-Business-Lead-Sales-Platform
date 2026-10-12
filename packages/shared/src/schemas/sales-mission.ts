import { z } from 'zod';
import { SalesMissionGoal, SalesMissionStatus, MissionBuyerStatus } from '../enums.js';
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

export const createSalesMissionSchema = z.object({
  productId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1, 'Mission name is required').max(200),
  goal: z.nativeEnum(SalesMissionGoal).default(SalesMissionGoal.WHOLESALE),
  targetMarket: z.string().trim().min(1, 'Target market is required').max(200),
  buyerType: z.string().trim().default('AI_DECIDE'),
  resultTarget: z.coerce.number().int().min(5).max(100).default(50),
  productAnalysisSnapshot: aiProductAnalysisSchema.optional().nullable(),
  selectedBuyerTargets: z.array(z.string().trim()).optional().nullable()
});

export type CreateSalesMissionInput = z.input<typeof createSalesMissionSchema>;
export type CreateSalesMissionParsed = z.output<typeof createSalesMissionSchema>;

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
}

export const analyzeProductInputSchema = z.object({
  productName: z.string().trim().min(1, 'Product name is required').max(200),
  productDescription: z.string().trim().min(1, 'Product description is required').max(2000),
  category: z.string().trim().max(100).optional().nullable(),
  goal: z.string().trim().default('WHOLESALE'),
  targetMarket: z.string().trim().default('Bangladesh'),
  buyerType: z.string().trim().default('AI_DECIDE')
});

export type AnalyzeProductInput = z.infer<typeof analyzeProductInputSchema>;
