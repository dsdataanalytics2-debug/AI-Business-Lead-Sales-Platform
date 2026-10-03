import { z } from 'zod';
import {
  SalesAssistantDraftType,
  SalesAssistantLanguage,
  SalesAssistantTone,
  SalesAssistantDraftStatus,
  SalesAssistantWarning
} from '../enums.js';

/* =========================================================
 * M5 Step 1: AI Sales Assistant Contracts + Guardrails
 *
 * Provider-agnostic, contract-only. No AI provider, persistence,
 * API, UI, or sending semantics exist at this layer.
 * ========================================================= */

/* ---------------------------------------------------------
 * Limits (characters). Output is always bounded.
 * --------------------------------------------------------- */

export const SALES_ASSISTANT_LIMITS = {
  OBJECTIVE_MAX: 300,
  CUSTOM_INSTRUCTION_MAX: 1000,
  WHATSAPP_CONTENT_MAX: 2000,
  EMAIL_SUBJECT_MAX: 200,
  EMAIL_BODY_MAX: 6000,
  CALL_SCRIPT_CONTENT_MAX: 8000,
  PROPOSAL_CONTENT_MAX: 12000,
  FOLLOW_UP_CONTENT_MAX: 2000,
  WARNINGS_MAX: 10
} as const;

/* ---------------------------------------------------------
 * Guardrail contracts (documented, machine-readable invariants)
 * --------------------------------------------------------- */

/**
 * AI-generated sales content is DRAFT-ONLY.
 * Human approval is mandatory before any future external action or send.
 * There is no implicit approval and no auto-send.
 */
export const SALES_ASSISTANT_HUMAN_APPROVAL_REQUIRED = true as const;

/**
 * Fresh generated content is always created with this status.
 */
export const SALES_ASSISTANT_INITIAL_DRAFT_STATUS = SalesAssistantDraftStatus.DRAFT;

/**
 * The only data sources generation may use (verified facts only).
 */
export const SALES_ASSISTANT_ALLOWED_FACT_SOURCES = [
  'LEAD_DATA',
  'VERIFIED_PUBLIC_CONTACT_FACTS',
  'USER_PROVIDED_TRUSTED_CONTEXT',
  'APPROVED_INTERNAL_BUSINESS_DATA'
] as const;

/**
 * Policy contract: categories of facts that must never be invented by AI generation.
 * Runtime generation services must enforce that output prose does not contain invented values
 * from these categories. Schema-level enforcement is deferred to the provider/service layer.
 * Covers: fake urgency/scarcity, fake social proof, false discounts, unsupported guarantees.
 */
export const SALES_ASSISTANT_PROHIBITED_FABRICATIONS = [
  'DISCOUNTS',
  'PRICES',
  'ORIGINAL_PRICE',
  'COUPONS',
  'SPECIAL_OFFERS',
  'FREE_DELIVERY',
  'STOCK_AVAILABILITY',
  'DELIVERY_PROMISES',
  'CERTIFICATIONS',
  'REVIEWS',
  'TESTIMONIALS',
  'RATINGS',
  'AWARDS',
  'OPENING_HOURS',
  'CUSTOMER_COUNTS',
  'PARTNERSHIPS',
  'CASE_STUDIES',
  'SUCCESS_STORIES',
  'REVENUE',
  'FAKE_URGENCY',
  'FAKE_SCARCITY',
  'GUARANTEED_ROI',
  'GUARANTEED_SALES',
  'GUARANTEED_RESULTS',
  'LEGAL_GUARANTEES',
  'MEDICAL_GUARANTEES',
  'FINANCIAL_GUARANTEES'
] as const;

/**
 * Context excluded from future generation input by default (data minimization).
 */
export const SALES_ASSISTANT_EXCLUDED_CONTEXT = [
  'PASSWORDS',
  'SESSION_DATA',
  'AUDIT_RECORDS',
  'SUPPRESSION_LISTS',
  'USAGE_LEDGERS',
  'INTERNAL_INFRASTRUCTURE_DATA',
  'UNRELATED_CRM_HISTORY',
  'RAW_TECHNICAL_METADATA'
] as const;

/**
 * Prohibited output exposure categories (contract-level invariant for later provider/service enforcement).
 * The normalized output object schemas use `.strict()` to reject unknown *fields* carrying these
 * values (e.g. `rawProviderResponse`, `systemPrompt`, `reasoning`, `chainOfThought`, `apiKey`).
 * Runtime generation services must additionally ensure the *content text itself* does not expose
 * secrets, system prompts, or internal configuration. Prose-level semantic filtering is not
 * performed at this schema layer.
 */
export const SALES_ASSISTANT_PROHIBITED_OUTPUT_EXPOSURE = [
  'API_KEYS',
  'TOKENS',
  'PASSWORDS',
  'DATABASE_URL',
  'SYSTEM_PROMPTS',
  'HIDDEN_MODEL_CONFIGURATION',
  'INTERNAL_INFRASTRUCTURE_DETAILS',
  'AUTHORIZATION_HEADERS',
  'RAW_PROVIDER_RESPONSE',
  'HIDDEN_REASONING',
  'CHAIN_OF_THOUGHT'
] as const;

/**
 * Prompt injection invariant (contract-level policy; runtime enforcement deferred to provider/service).
 * Lead data and user-supplied text (including `customInstruction`) are UNTRUSTED input sources.
 * The request schema bounds and normalizes these fields but does not parse or interpret their prose.
 * Runtime prompt precedence and injection resistance — ensuring text such as
 * "ignore previous instructions" cannot override system guardrails — must be enforced by the
 * AI provider integration and generation service in later implementation steps.
 */
export const SALES_ASSISTANT_UNTRUSTED_INPUT_SOURCES = [
  'LEAD_DATA',
  'OBJECTIVE',
  'CUSTOM_INSTRUCTION'
] as const;

/**
 * PHONE != WHATSAPP (product invariant / policy constant).
 * A plain phone number must never be treated as WhatsApp contact evidence.
 * Only explicit verified/public WhatsApp data may be used as a WhatsApp contact channel.
 * Actual contact-channel selection enforcement belongs to the lead/contact service layer;
 * this constant documents the invariant for later runtime implementation.
 */
export const SALES_ASSISTANT_PHONE_IS_NOT_WHATSAPP = true as const;

/* ---------------------------------------------------------
 * Request schema
 * --------------------------------------------------------- */

const optionalBoundedText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} cannot exceed ${max} characters`)
    .optional()
    .transform((val) => (val && val.length > 0 ? val : undefined));

/**
 * Request to generate a sales assistant draft for a lead.
 *
 * Strict: unknown fields (organizationId, requestedByUserId, provider, model,
 * systemPrompt, apiKey, autoSend, sendNow, status, approvedAt, approvedByUserId, ...)
 * are rejected. Identity and provider selection are server-controlled.
 * `customInstruction` is untrusted, bounded, and lower priority than system guardrails.
 */
export const generateSalesAssistantDraftRequestSchema = z
  .object({
    type: z.nativeEnum(SalesAssistantDraftType, {
      errorMap: () => ({ message: 'Invalid sales assistant draft type' })
    }),
    language: z.nativeEnum(SalesAssistantLanguage, {
      errorMap: () => ({ message: 'Invalid sales assistant language' })
    }),
    tone: z.nativeEnum(SalesAssistantTone, {
      errorMap: () => ({ message: 'Invalid sales assistant tone' })
    }),
    objective: optionalBoundedText(SALES_ASSISTANT_LIMITS.OBJECTIVE_MAX, 'Objective'),
    customInstruction: optionalBoundedText(
      SALES_ASSISTANT_LIMITS.CUSTOM_INSTRUCTION_MAX,
      'Custom instruction'
    )
  })
  .strict();

export type GenerateSalesAssistantDraftRequest = z.infer<
  typeof generateSalesAssistantDraftRequestSchema
>;

/* ---------------------------------------------------------
 * Output schema (normalized, provider-neutral, final content only)
 * --------------------------------------------------------- */

const warningsSchema = z
  .array(
    z.nativeEnum(SalesAssistantWarning, {
      errorMap: () => ({ message: 'Invalid sales assistant warning' })
    })
  )
  .max(SALES_ASSISTANT_LIMITS.WARNINGS_MAX)
  .optional();

const generatedAtSchema = z.union([z.date(), z.string()]).optional();

const languageSchema = z.nativeEnum(SalesAssistantLanguage);
const toneSchema = z.nativeEnum(SalesAssistantTone);

/**
 * Fresh generated content is always DRAFT. Human approval is mandatory
 * before any future external action; there is no SENT status.
 */
const freshDraftStatusSchema = z.literal(SalesAssistantDraftStatus.DRAFT);

const textContent = (max: number) => z.string().trim().min(1).max(max);

const baseOutputShape = {
  language: languageSchema,
  tone: toneSchema,
  status: freshDraftStatusSchema,
  warnings: warningsSchema,
  generatedAt: generatedAtSchema
};

export const whatsappDraftOutputSchema = z
  .object({
    type: z.literal(SalesAssistantDraftType.WHATSAPP),
    ...baseOutputShape,
    content: textContent(SALES_ASSISTANT_LIMITS.WHATSAPP_CONTENT_MAX)
  })
  .strict();

export const emailDraftOutputSchema = z
  .object({
    type: z.literal(SalesAssistantDraftType.EMAIL),
    ...baseOutputShape,
    subject: textContent(SALES_ASSISTANT_LIMITS.EMAIL_SUBJECT_MAX),
    body: textContent(SALES_ASSISTANT_LIMITS.EMAIL_BODY_MAX)
  })
  .strict();

/** Human-readable text block only. No voice execution or calling system. */
export const callScriptDraftOutputSchema = z
  .object({
    type: z.literal(SalesAssistantDraftType.CALL_SCRIPT),
    ...baseOutputShape,
    content: textContent(SALES_ASSISTANT_LIMITS.CALL_SCRIPT_CONTENT_MAX)
  })
  .strict();

/** Text only. No PDF; no invented pricing, guarantees, certifications, or facts. */
export const proposalDraftOutputSchema = z
  .object({
    type: z.literal(SalesAssistantDraftType.PROPOSAL),
    ...baseOutputShape,
    content: textContent(SALES_ASSISTANT_LIMITS.PROPOSAL_CONTENT_MAX)
  })
  .strict();

/** Concise, contextual, professional, non-harassing. No scheduling logic. */
export const followUpDraftOutputSchema = z
  .object({
    type: z.literal(SalesAssistantDraftType.FOLLOW_UP),
    ...baseOutputShape,
    content: textContent(SALES_ASSISTANT_LIMITS.FOLLOW_UP_CONTENT_MAX)
  })
  .strict();

/**
 * Normalized generated draft, discriminated by `type`.
 * Strict sub-schemas reject unknown *fields* that could carry provider metadata
 * (e.g. `rawProviderResponse`, `systemPrompt`, `reasoning`, `chainOfThought`, `apiKey`,
 * `authorization`). This is an object-shape invariant — the schema does not semantically
 * scan `content` or `body` text for secrets or internal data. Runtime generation services
 * must ensure the prose content itself does not expose prohibited information.
 */
export const generatedSalesAssistantDraftSchema = z.discriminatedUnion('type', [
  whatsappDraftOutputSchema,
  emailDraftOutputSchema,
  callScriptDraftOutputSchema,
  proposalDraftOutputSchema,
  followUpDraftOutputSchema
]);

export type GeneratedSalesAssistantDraft = z.infer<typeof generatedSalesAssistantDraftSchema>;
