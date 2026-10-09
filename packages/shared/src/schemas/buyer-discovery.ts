import { z } from 'zod';
import { BuyerType } from '../enums.js';

/**
 * BuyerType Zod schema representing commercial customer/buyer classifications.
 */
export const buyerTypeSchema = z.nativeEnum(BuyerType);

/**
 * BuyerSearchQuery
 *
 * Contract for searching potential business buyers by product/service and location.
 * Enforces safe boundaries, trimmed inputs, and bounded pagination limits.
 */
export const buyerSearchQuerySchema = z.object({
  /** Required product or service search query (trimmed, 1-200 chars) */
  productOrService: z
    .string({ required_error: 'Product or service is required' })
    .trim()
    .min(1, 'Product or service is required')
    .max(200, 'Product or service cannot exceed 200 characters'),

  /** Required geographic location or target market (trimmed, 1-200 chars) */
  location: z
    .string({ required_error: 'Location is required' })
    .trim()
    .min(1, 'Location is required')
    .max(200, 'Location cannot exceed 200 characters'),

  /** Buyer classification filter (defaults to UNKNOWN) */
  buyerType: z
    .nativeEnum(BuyerType)
    .optional()
    .default(BuyerType.UNKNOWN),

  /** Optional business category or industry tag */
  category: z
    .string()
    .trim()
    .max(100, 'Category cannot exceed 100 characters')
    .optional(),

  /**
   * Bounded result limit.
   * Default: 10
   * Minimum: 1
   * Maximum: 50
   * Unbounded queries are strictly prohibited.
   */
  limit: z.coerce
    .number()
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(50, 'Limit cannot exceed 50')
    .default(10)
});

export type BuyerSearchQuery = z.infer<typeof buyerSearchQuerySchema>;

/**
 * BuyerSearchResult
 *
 * Represents an ephemeral, read-only discovery preview candidate, NOT a persisted customer or lead.
 *
 * Architecture Invariants:
 * 1. Discovery candidate semantics: A search result is read-only. It is NOT automatically a
 *    Lead, Customer, Opportunity, Campaign member, or Order.
 * 2. Provider-neutral: Common normalized representation across OpenStreetMap/Overpass,
 *    Google Places, trade directories, and mock sources.
 * 3. Missing data invariant: Any field not returned by the upstream source remains null or
 *    undefined. Missing data is NEVER invented or fabricated.
 * 4. PHONE != WHATSAPP invariant: A discovered telephone number is strictly a telephone number (PHONE).
 *    Under no circumstances is a phone number automatically converted to or inferred as WhatsApp.
 * 5. Zero fabricated need/intent: Buyer need and purchasing intent scoring belong strictly
 *    to subsequent domain enrichment and signal verification (M8 Step 7).
 */
export const buyerSearchResultSchema = z.object({
  /** Identifier of the discovery data source (e.g. 'OVERPASS', 'GOOGLE_PLACES', 'MOCK') */
  provider: z
    .string({ required_error: 'Provider identifier is required' })
    .trim()
    .min(1, 'Provider identifier is required')
    .max(100, 'Provider cannot exceed 100 characters'),

  /** Stable external ID assigned by the provider (e.g. OSM node/way ID, Google place_id) */
  providerExternalId: z
    .string({ required_error: 'Provider external ID is required' })
    .trim()
    .min(1, 'Provider external ID is required')
    .max(255, 'Provider external ID cannot exceed 255 characters'),

  /** Discovered trading or business name */
  businessName: z
    .string({ required_error: 'Business name is required' })
    .trim()
    .min(1, 'Business name is required')
    .max(255, 'Business name cannot exceed 255 characters'),

  /** Category or business classification if provided by source */
  category: z
    .string()
    .trim()
    .max(100, 'Category cannot exceed 100 characters')
    .nullable()
    .optional(),

  /** Buyer classification if known, defaulting to UNKNOWN */
  buyerType: z
    .nativeEnum(BuyerType)
    .optional()
    .default(BuyerType.UNKNOWN),

  /** Physical address or location description if explicitly returned by provider */
  address: z
    .string()
    .trim()
    .max(500, 'Address cannot exceed 500 characters')
    .nullable()
    .optional(),

  /** City or municipality if known */
  city: z
    .string()
    .trim()
    .max(100, 'City cannot exceed 100 characters')
    .nullable()
    .optional(),

  /** Country code or country name if known (e.g. 'BD') */
  country: z
    .string()
    .trim()
    .max(100, 'Country cannot exceed 100 characters')
    .nullable()
    .optional(),

  /** Latitude coordinate if provided */
  latitude: z
    .number()
    .min(-90, 'Latitude must be >= -90')
    .max(90, 'Latitude must be <= 90')
    .nullable()
    .optional(),

  /** Longitude coordinate if provided */
  longitude: z
    .number()
    .min(-180, 'Longitude must be >= -180')
    .max(180, 'Longitude must be <= 180')
    .nullable()
    .optional(),

  /** Official website URL if discovered */
  website: z
    .string()
    .trim()
    .max(255, 'Website URL cannot exceed 255 characters')
    .nullable()
    .optional(),

  /**
   * Discovered public telephone number.
   * INVARIANT: Represents strictly a PHONE contact.
   * NEVER automatically infer or convert to WhatsApp.
   */
  phone: z
    .string()
    .trim()
    .max(100, 'Phone cannot exceed 100 characters')
    .nullable()
    .optional(),

  /** Optional source or listing URL for provenance tracking */
  sourceUrl: z
    .string()
    .trim()
    .max(500, 'Source URL cannot exceed 500 characters')
    .nullable()
    .optional()
});

export type BuyerSearchResult = z.infer<typeof buyerSearchResultSchema>;

/**
 * BuyerDiscoverySearchTerm
 *
 * Query expansion contract for multilingual or localized buyer discovery queries
 * (e.g. English + Bangla variations such as "smart watch wholesaler Dhaka" / "স্মার্ট ওয়াচ পাইকারি ঢাকা").
 */
export const buyerDiscoverySearchTermSchema = z.object({
  /** Expanded query string */
  query: z
    .string({ required_error: 'Search term query is required' })
    .trim()
    .min(1, 'Search term query is required')
    .max(200, 'Search term query cannot exceed 200 characters'),

  /** Language code (e.g. 'en', 'bn') */
  language: z
    .string()
    .trim()
    .min(2, 'Language code must be at least 2 characters')
    .max(10, 'Language code cannot exceed 10 characters')
    .default('en'),

  /** Source intent or keyword concept that originated this expansion */
  sourceIntent: z
    .string()
    .trim()
    .max(100, 'Source intent cannot exceed 100 characters')
    .optional()
});

export type BuyerDiscoverySearchTerm = z.infer<typeof buyerDiscoverySearchTermSchema>;
