import { z } from 'zod';
import { ContactType, PhoneType, WhatsAppStatus, EvidenceType } from '../enums.js';
import { cursorPaginationSchema } from './pagination.js';

export const businessSearchQuerySchema = cursorPaginationSchema.extend({
  q: z
    .string()
    .trim()
    .min(1, 'Search query (q) is required')
    .max(200, 'Search query cannot exceed 200 characters'),
  location: z
    .string()
    .trim()
    .min(1, 'Location is required')
    .max(200, 'Location cannot exceed 200 characters'),
  category: z
    .string()
    .trim()
    .max(100, 'Category cannot exceed 100 characters')
    .optional(),
  buyerType: z
    .string()
    .trim()
    .max(100)
    .optional(),
  provider: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional(),
  targetCategories: z
    .union([z.string(), z.array(z.string())])
    .optional()
});

export type BusinessSearchQuery = z.infer<typeof businessSearchQuerySchema>;

export const locationSuggestionQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, 'Query is required')
    .max(100, 'Query cannot exceed 100 characters'),
  limit: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(5)
});

export type LocationSuggestionQuery = z.infer<typeof locationSuggestionQuerySchema>;

export const locationSuggestionItemSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  primaryText: z.string().trim().min(1),
  secondaryText: z.string().trim().optional()
});

export type LocationSuggestionItem = z.infer<typeof locationSuggestionItemSchema>;

export const locationSuggestionResponseSchema = z.object({
  data: z.array(locationSuggestionItemSchema)
});

export type LocationSuggestionResponse = z.infer<typeof locationSuggestionResponseSchema>;


export const discoveredContactSchema = z.object({
  type: z.nativeEnum(ContactType),
  rawValue: z.string().trim().min(1, 'Raw contact value cannot be empty').max(255),
  phoneType: z.nativeEnum(PhoneType).optional().default(PhoneType.UNKNOWN),
  whatsappStatus: z.nativeEnum(WhatsAppStatus).optional().default(WhatsAppStatus.UNKNOWN),
  evidenceType: z.nativeEnum(EvidenceType).optional().default(EvidenceType.LISTING_FIELD),
  sourceUrl: z.string().trim().max(500).optional(),
  snippet: z.string().trim().max(500).optional()
});

export type DiscoveredContact = z.infer<typeof discoveredContactSchema>;

export const businessSearchResultSchema = z.object({
  externalId: z.string().trim().min(1).max(255),
  provider: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(255),
  category: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
  address: z.string().trim().max(500).optional(),
  locality: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional(),
  country: z.string().trim().max(50).optional().default('BD'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  website: z.string().trim().max(255).optional(),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().min(0).optional().default(0),
  sourceUrl: z.string().trim().max(500).optional(),
  contacts: z.array(discoveredContactSchema).default([]),
  matchedBuyerCategory: z.string().trim().max(200).optional(),
  searchTargetUsed: z.string().trim().max(200).optional()
});

export type BusinessSearchResult = z.infer<typeof businessSearchResultSchema>;

/**
 * SaveLeadRequest
 *
 * CRITICAL SECURITY CONTRACT:
 * Client only submits the provider and externalId.
 * Authoritative fields (name, phone, email, website, ratings, rawData)
 * are NEVER accepted from client input and will be rejected by strict schema validation.
 */
export const saveLeadRequestSchema = z
  .object({
    provider: z
      .string()
      .trim()
      .min(1, 'Provider identifier is required')
      .max(100, 'Provider cannot exceed 100 characters'),
    externalId: z
      .string()
      .min(1, 'External business ID is required')
      .max(255, 'External ID cannot exceed 255 characters')
  })
  .strict();

export type SaveLeadRequest = z.infer<typeof saveLeadRequestSchema>;

export const selectedAiBuyerTargetItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  relevance: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('HIGH'),
  rationale: z.string().trim().max(1000).optional(),
  selected: z.boolean().default(true)
});

export type SelectedAiBuyerTargetItem = z.infer<typeof selectedAiBuyerTargetItemSchema>;

export const createBusinessSearchSessionSchema = z.object({
  productQuery: z.string().trim().min(1, 'Product/service query is required').max(200),
  location: z.string().trim().min(1, 'Location is required').max(200),
  buyerType: z.string().trim().max(100).optional().nullable(),
  category: z.string().trim().max(100).optional().nullable(),
  provider: z.string().trim().min(1).max(100).default('auto'),
  limit: z.number().int().min(1).max(100).default(20),
  selectedAiBuyerTargets: z.array(selectedAiBuyerTargetItemSchema).optional().nullable(),
  resultsSnapshot: z.array(businessSearchResultSchema).max(200, 'Cannot exceed 200 items in results snapshot'),
  sourceMetadata: z.record(z.unknown()).optional().nullable(),
  searchStatus: z.string().trim().max(50).default('SUCCESS')
});

export type CreateBusinessSearchSessionInput = z.infer<typeof createBusinessSearchSessionSchema>;

export const businessSearchSessionSummarySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  productQuery: z.string(),
  location: z.string(),
  buyerType: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  provider: z.string(),
  limit: z.number().int(),
  resultCount: z.number().int(),
  selectedAiBuyerTargets: z.array(selectedAiBuyerTargetItemSchema).nullable().optional(),
  searchStatus: z.string(),
  lastOpenedAt: z.union([z.date(), z.string()]),
  createdAt: z.union([z.date(), z.string()]),
  updatedAt: z.union([z.date(), z.string()])
});

export type BusinessSearchSessionSummary = z.infer<typeof businessSearchSessionSummarySchema>;

export const businessSearchSessionDetailSchema = businessSearchSessionSummarySchema.extend({
  resultsSnapshot: z.array(businessSearchResultSchema),
  sourceMetadata: z.record(z.unknown()).nullable().optional()
});

export type BusinessSearchSessionDetail = z.infer<typeof businessSearchSessionDetailSchema>;

export const businessSearchHistoryListResponseSchema = z.object({
  data: z.array(businessSearchSessionSummarySchema)
});

export type BusinessSearchHistoryListResponse = z.infer<typeof businessSearchHistoryListResponseSchema>;
