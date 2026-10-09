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
  provider: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
});

export type BusinessSearchQuery = z.infer<typeof businessSearchQuerySchema>;


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
  contacts: z.array(discoveredContactSchema).default([])
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
