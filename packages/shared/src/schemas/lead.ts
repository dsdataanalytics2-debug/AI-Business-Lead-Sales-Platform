import { z } from 'zod';
import {
  ContactType,
  PhoneType,
  ContactStatus,
  WhatsAppStatus,
  EvidenceType,
  WebsiteStatus,
  OnlinePresenceType,
  SuppressionReason,
  DuplicateMatchLevel,
  DuplicateAction
} from '../enums.js';
import { cursorPaginationSchema } from './pagination.js';

// Helper for parsing boolean query parameters correctly ("true" -> true, "false" -> false)
const booleanQueryParamSchema = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((val) => {
    if (val === undefined || val === null || val === '') return undefined;
    if (typeof val === 'boolean') return val;
    const lower = val.toLowerCase().trim();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
    return undefined;
  });

/* =========================================================
 * Contact & Evidence Schemas
 * ========================================================= */

export const contactEvidenceSchema = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid(),
  sourceName: z.string().min(1).max(100),
  sourceUrl: z.string().nullable().optional(),
  evidenceType: z.nativeEnum(EvidenceType),
  snippet: z.string().nullable().optional(),
  discoveredAt: z.union([z.date(), z.string()])
});

export type ContactEvidence = z.infer<typeof contactEvidenceSchema>;

export const leadContactSchema = z.object({
  id: z.string().uuid(),
  leadId: z.string().uuid(),
  type: z.nativeEnum(ContactType),
  rawValue: z.string().min(1).max(255),
  normalizedValue: z.string().min(1).max(255),
  phoneType: z.nativeEnum(PhoneType).nullable().optional(),
  status: z.nativeEnum(ContactStatus),
  whatsappStatus: z.nativeEnum(WhatsAppStatus),
  isPrimary: z.boolean(),
  isSuppressed: z.boolean().default(false),
  suppressionReason: z.nativeEnum(SuppressionReason).nullable().optional(),
  evidence: z.array(contactEvidenceSchema).optional().default([]),
  createdAt: z.union([z.date(), z.string()]),
  updatedAt: z.union([z.date(), z.string()])
});

export type LeadContact = z.infer<typeof leadContactSchema>;

/* =========================================================
 * Lead Source Summary Schema
 * ========================================================= */

export const leadSourceSummarySchema = z.object({
  id: z.string().uuid(),
  leadId: z.string().uuid(),
  sourceName: z.string().min(1).max(100),
  sourceExternalId: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
  fetchedAt: z.union([z.date(), z.string()])
});

export type LeadSourceSummary = z.infer<typeof leadSourceSummarySchema>;

/* =========================================================
 * Lead Summary & Detail Schemas (M1 Business Identity)
 * ========================================================= */

export const leadSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  normalizedName: z.string().min(1).max(255),
  category: z.string().min(1).max(100),
  locality: z.string().nullable().optional(),
  city: z.string().min(1).max(100),
  region: z.string().nullable().optional(),
  country: z.string().min(1).max(50),
  primaryPhone: z.string().nullable().optional(),
  primaryEmail: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  websiteStatus: z.nativeEnum(WebsiteStatus),
  onlinePresenceType: z.nativeEnum(OnlinePresenceType),
  rating: z.number().nullable().optional(),
  reviewCount: z.number().int().nullable().optional(),
  primarySource: z.string().min(1).max(100),
  createdAt: z.union([z.date(), z.string()]),
  updatedAt: z.union([z.date(), z.string()])
});

export type LeadSummary = z.infer<typeof leadSummarySchema>;

export const leadDetailSchema = leadSummarySchema.extend({
  description: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  normalizedWebsite: z.string().nullable().optional(),
  contacts: z.array(leadContactSchema).default([]),
  sources: z.array(leadSourceSummarySchema).default([])
});

export type LeadDetail = z.infer<typeof leadDetailSchema>;

/* =========================================================
 * Query & Mutation Schemas
 * ========================================================= */

export const leadListQuerySchema = cursorPaginationSchema.extend({
  search: z.string().trim().optional(),
  city: z.string().trim().optional(),
  category: z.string().trim().optional(),
  websiteStatus: z.nativeEnum(WebsiteStatus).optional(),
  onlinePresence: z.nativeEnum(OnlinePresenceType).optional(),
  hasPhone: booleanQueryParamSchema,
  hasEmail: booleanQueryParamSchema,
  hasWhatsApp: booleanQueryParamSchema
});

export type LeadListQuery = z.infer<typeof leadListQuerySchema>;

/**
 * LeadUpdateRequest
 * Strict schema rejecting organizationId, primarySource, CRM fields, and credentials.
 */
export const leadUpdateRequestSchema = z
  .object({
    name: z.string().trim().min(1, 'Name cannot be empty').max(255).optional(),
    category: z.string().trim().min(1, 'Category cannot be empty').max(100).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    locality: z.string().trim().max(100).nullable().optional(),
    city: z.string().trim().min(1, 'City cannot be empty').max(100).optional(),
    website: z.string().trim().max(255).nullable().optional()
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update'
  });

export type LeadUpdateRequest = z.infer<typeof leadUpdateRequestSchema>;

/**
 * ManualContactRequest
 * Request contract for adding a manual contact to an existing lead.
 * Security: Client CANNOT set ContactStatus.VERIFIED or modify internal status flags.
 */
export const manualContactRequestSchema = z
  .object({
    type: z.nativeEnum(ContactType),
    rawValue: z.string().trim().min(1, 'Contact value is required').max(255),
    isPrimary: z.boolean().optional().default(false),
    whatsappStatus: z.nativeEnum(WhatsAppStatus).optional().default(WhatsAppStatus.UNKNOWN),
    sourceName: z.string().trim().max(100).optional().default('MANUAL'),
    sourceUrl: z.string().trim().max(500).optional()
  })
  .strict();

export type ManualContactRequest = z.infer<typeof manualContactRequestSchema>;

/* =========================================================
 * Duplicate Result Contract
 * ========================================================= */

export const duplicateResultSchema = z.object({
  matchLevel: z.nativeEnum(DuplicateMatchLevel),
  action: z.nativeEnum(DuplicateAction),
  reason: z.string().optional(),
  existingLeadId: z.string().uuid().optional(),
  lead: leadDetailSchema.optional()
});

export type DuplicateResult = z.infer<typeof duplicateResultSchema>;
