import { z } from 'zod';

export const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite';
export const GEMINI_STRONGER_MODEL = 'gemini-3.8-flash';

export const LEGACY_GEMINI_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.6-flash'
] as const;

export const RECOMMENDED_GEMINI_MODELS = [
  GEMINI_DEFAULT_MODEL,
  GEMINI_STRONGER_MODEL
] as const;

export const SUPPORTED_GEMINI_MODELS = [
  GEMINI_DEFAULT_MODEL,
  GEMINI_STRONGER_MODEL,
  ...LEGACY_GEMINI_MODELS
] as const;

export type SupportedGeminiModel = (typeof SUPPORTED_GEMINI_MODELS)[number];

export interface GeminiModelMetadata {
  id: string;
  label: string;
  purpose: string;
  recommendedDefault: boolean;
  isLegacy: boolean;
}

export const GEMINI_MODEL_METADATA: Record<string, GeminiModelMetadata> = {
  'gemini-3.5-flash-lite': {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    purpose: 'low-cost/high-volume',
    recommendedDefault: true,
    isLegacy: false
  },
  'gemini-3.8-flash': {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    purpose: 'advanced reasoning/high-quality generation',
    recommendedDefault: false,
    isLegacy: false
  },
  'gemini-3.1-flash-lite': {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash-Lite (Legacy)',
    purpose: 'low-cost/high-volume (legacy)',
    recommendedDefault: false,
    isLegacy: true
  },
  'gemini-3.6-flash': {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash (Legacy)',
    purpose: 'advanced reasoning (legacy)',
    recommendedDefault: false,
    isLegacy: true
  }
};

export const geminiModelSchema = z.string().trim().min(1).max(100);

export const configureAiProviderSchema = z.object({
  provider: z.string().trim().min(1).max(50).default('gemini'),
  apiKey: z.string().trim().min(1, 'API key is required').max(500),
  model: z.string().trim().min(1).max(100).optional()
});

export type ConfigureAiProviderRequest = z.infer<typeof configureAiProviderSchema>;

export const testAiConnectionSchema = z.object({
  apiKey: z.string().trim().min(1).max(500).optional(),
  model: z.string().trim().min(1).max(100).optional()
});

export type TestAiConnectionRequest = z.infer<typeof testAiConnectionSchema>;

export const updateAiModelSchema = z.object({
  model: z.string().trim().min(1, 'Model is required').max(100)
});

export type UpdateAiModelRequest = z.infer<typeof updateAiModelSchema>;

export type AiProviderCardStatus = 'NOT_CONFIGURED' | 'CONNECTED' | 'ERROR' | 'DISABLED';

export const aiProviderCardSchema = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  status: z.enum(['NOT_CONFIGURED', 'CONNECTED', 'ERROR', 'DISABLED']),
  isActive: z.boolean(),
  isEnabled: z.boolean(),
  isConfigured: z.boolean(),
  defaultModel: z.string(),
  supportedModels: z.array(z.string()),
  credentialMasked: z.string().nullable(),
  credentialLastFour: z.string().nullable(),
  lastTestedAt: z.string().nullable(),
  updatedAt: z.string().nullable()
});

export type AiProviderCard = z.infer<typeof aiProviderCardSchema>;

export const aiProvidersListResponseSchema = z.object({
  providers: z.array(aiProviderCardSchema)
});

export type AiProvidersListResponse = z.infer<typeof aiProvidersListResponseSchema>;

/* =========================================================================
 * AI Buyer Discovery & Query Expansion Schemas
 * ========================================================================= */

export const suggestBuyerTargetsRequestSchema = z.object({
  product: z
    .string()
    .trim()
    .min(1, 'Product or service is required')
    .max(200, 'Product cannot exceed 200 characters'),
  buyerType: z
    .string()
    .trim()
    .max(100)
    .optional(),
  location: z
    .string()
    .trim()
    .max(200)
    .optional()
});

export type SuggestBuyerTargetsRequest = z.infer<typeof suggestBuyerTargetsRequestSchema>;

export const buyerTargetItemSchema = z.object({
  category: z
    .string()
    .trim()
    .min(1, 'Category is required')
    .max(100, 'Category cannot exceed 100 characters'),
  reason: z
    .string()
    .trim()
    .min(1, 'Reason is required')
    .max(300, 'Reason cannot exceed 300 characters')
});

export type BuyerTargetItem = z.infer<typeof buyerTargetItemSchema>;

export const buyerTargetsResponseSchema = z.object({
  product: z.string().trim().min(1),
  buyerTargets: z.array(buyerTargetItemSchema)
});

export type BuyerTargetsResponse = z.infer<typeof buyerTargetsResponseSchema>;

export const explainBuyerFitRequestSchema = z.object({
  product: z
    .string()
    .trim()
    .min(1, 'Product is required')
    .max(200),
  businessName: z
    .string()
    .trim()
    .min(1, 'Business name is required')
    .max(255),
  category: z
    .string()
    .trim()
    .min(1, 'Category is required')
    .max(100),
  description: z
    .string()
    .trim()
    .max(1000)
    .optional(),
  location: z
    .string()
    .trim()
    .max(200)
    .optional()
});

export type ExplainBuyerFitRequest = z.infer<typeof explainBuyerFitRequestSchema>;

export const buyerFitResponseSchema = z.object({
  fitLevel: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  explanation: z
    .string()
    .trim()
    .min(1, 'Explanation is required')
    .max(500, 'Explanation cannot exceed 500 characters'),
  disclaimer: z
    .string()
    .default(
      'AI Buyer Fit is an automated explanation based on public business categorization, not verified purchase intent.'
    )
});

export type BuyerFitResponse = z.infer<typeof buyerFitResponseSchema>;
