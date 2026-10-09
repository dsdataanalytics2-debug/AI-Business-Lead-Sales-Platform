import { z } from 'zod';
import { DemoWebsiteStatus, DemoWebsiteProvider, DemoWebsiteErrorCode } from '../enums.js';
import { assigneeSummarySchema } from './crm.js';

/* =========================================================
 * M4: StoreMate Demo Website Schemas & Contracts
 * ========================================================= */

/**
 * Request schema for creating / requesting a demo website for a lead
 */
export const createDemoWebsiteRequestSchema = z
  .object({
    templateKey: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .default('generic-local-business'),
    customHeadline: z
      .string()
      .trim()
      .max(200, 'Headline cannot exceed 200 characters')
      .nullable()
      .optional()
      .transform((val) => (val && val.length > 0 ? val : null)),
    customDescription: z
      .string()
      .trim()
      .max(2000, 'Description cannot exceed 2000 characters')
      .nullable()
      .optional()
      .transform((val) => (val && val.length > 0 ? val : null))
  })
  .strict();

export type CreateDemoWebsiteRequest = z.infer<typeof createDemoWebsiteRequestSchema>;

/**
 * Summary representation of a DemoWebsite record
 */
export const demoWebsiteSummarySchema = z
  .object({
    id: z.string().uuid(),
    leadId: z.string().uuid(),
    organizationId: z.string().uuid(),
    status: z.nativeEnum(DemoWebsiteStatus, {
      errorMap: () => ({ message: 'Invalid demo website status' })
    }),
    provider: z.nativeEnum(DemoWebsiteProvider, {
      errorMap: () => ({ message: 'Invalid demo website provider' })
    }),
    providerSiteId: z.string().nullable().optional(),
    demoUrl: z.string().url('Invalid demo URL format').nullable().optional(),
    requestedByUserId: z.string().uuid(),
    requestedByUser: assigneeSummarySchema.optional(),
    readyAt: z.union([z.date(), z.string()]).nullable().optional(),
    expiresAt: z.union([z.date(), z.string()]).nullable().optional(),
    lastErrorCode: z
      .nativeEnum(DemoWebsiteErrorCode)
      .or(z.string())
      .nullable()
      .optional(),
    lastErrorMessageSafe: z.string().max(500).nullable().optional(),
    createdAt: z.union([z.date(), z.string()]),
    updatedAt: z.union([z.date(), z.string()])
  })
  .strict();

export type DemoWebsiteSummary = z.infer<typeof demoWebsiteSummarySchema>;

/**
 * Single DemoWebsite response schema
 */
export const demoWebsiteResponseSchema = demoWebsiteSummarySchema;
export type DemoWebsiteResponse = z.infer<typeof demoWebsiteResponseSchema>;

/**
 * LeadMate internal normalized outbound payload contract for DemoWebsite providers.
 * StoreMate provider transport details (endpoints, raw request/response shapes, auth headers)
 * are TBD pending human-owned `docs/storemate-api-contract.md`.
 *
 * Invariants:
 * - Content uses source business data only (no invented facts/claims/reviews)
 * - isDemo = true (MUST be clearly marked as demo)
 * - noindex = true & nofollow = true (SEO search engine disallowance)
 * - WhatsApp is populated only when explicitly verified/publicly listed (PHONE != WHATSAPP)
 * - No internal LeadMate secrets, CRM notes, follow-up notes, or audit logs
 * - Provider credentials remain backend-only regardless of auth method chosen
 */
export const storemateOutboundBusinessSchema = z
  .object({
    name: z.string().trim().min(1, 'Business name is required').max(200),
    category: z.string().trim().max(100).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional()
  })
  .strict();

export const storemateOutboundContactSchema = z
  .object({
    phone: z.string().trim().max(50).nullable().optional(),
    email: z
      .string()
      .trim()
      .email('Invalid email address')
      .max(100)
      .nullable()
      .optional()
      .or(z.literal('')),
    address: z.string().trim().max(300).nullable().optional()
  })
  .strict();

export const storemateOutboundBrandingSchema = z
  .object({
    logoUrl: z
      .string()
      .trim()
      .url('Invalid logo URL')
      .max(500)
      .nullable()
      .optional()
      .or(z.literal('')),
    coverImageUrl: z
      .string()
      .trim()
      .url('Invalid cover image URL')
      .max(500)
      .nullable()
      .optional()
      .or(z.literal(''))
  })
  .strict();

export const storemateOutboundSocialSchema = z
  .object({
    facebook: z
      .string()
      .trim()
      .url('Invalid Facebook URL')
      .max(300)
      .nullable()
      .optional()
      .or(z.literal('')),
    instagram: z
      .string()
      .trim()
      .url('Invalid Instagram URL')
      .max(300)
      .nullable()
      .optional()
      .or(z.literal('')),
    whatsapp: z.string().trim().max(50).nullable().optional()
  })
  .strict();

export const storemateOutboundMetadataSchema = z
  .object({
    leadId: z.string().uuid(),
    organizationId: z.string().uuid(),
    templateKey: z.string().trim().max(50).default('generic-local-business'),
    isDemo: z.literal(true, {
      errorMap: () => ({ message: 'isDemo invariant must always be true' })
    }),
    noindex: z.literal(true, {
      errorMap: () => ({ message: 'noindex invariant must always be true' })
    }),
    nofollow: z.literal(true, {
      errorMap: () => ({ message: 'nofollow invariant must always be true' })
    })
  })
  .strict();

export const storemateOutboundPayloadSchema = z
  .object({
    business: storemateOutboundBusinessSchema,
    contact: storemateOutboundContactSchema,
    branding: storemateOutboundBrandingSchema.optional(),
    social: storemateOutboundSocialSchema.optional(),
    metadata: storemateOutboundMetadataSchema
  })
  .strict();

export type StoreMateOutboundPayload = z.infer<typeof storemateOutboundPayloadSchema>;

export const demoCatalogItemSchema = z.object({
  id: z.string().uuid(),
  leadId: z.string().uuid(),
  businessName: z.string(),
  category: z.string().optional(),
  city: z.string().optional(),
  status: z.nativeEnum(DemoWebsiteStatus),
  provider: z.nativeEnum(DemoWebsiteProvider),
  demoUrl: z.string().nullable().optional(),
  createdAt: z.union([z.date(), z.string()]),
  updatedAt: z.union([z.date(), z.string()]),
  expiresAt: z.union([z.date(), z.string()]).nullable().optional()
});

export type DemoCatalogItem = z.infer<typeof demoCatalogItemSchema>;
