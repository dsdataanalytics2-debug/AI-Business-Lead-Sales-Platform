import type {
  SalesAssistantDraftType,
  SalesAssistantLanguage,
  SalesAssistantTone,
  SalesAssistantWarning,
  GeneratedSalesAssistantDraft
} from '@leadmate/shared';

/**
 * Normalized public social profile links for lead context.
 */
export interface NormalizedSocialLinks {
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  twitter?: string;
  other?: string[];
}

/**
 * Safe normalized lead context projected for AI generation.
 * Strict data minimization: no internal CRM notes, no passwords, no session data.
 *
 * TRUST BOUNDARY:
 * The provider contract defines the expected normalized trust boundary;
 * the calling service is responsible for selecting/verifying source data.
 *
 * CRITICAL INVARIANT: PHONE != WHATSAPP
 * `whatsapp` must be populated by the calling service only from explicit verified/public WhatsApp evidence.
 * The provider must never infer WhatsApp from `phone`.
 */
export interface NormalizedLeadContext {
  leadId: string;
  businessName: string;
  category?: string;
  description?: string;
  location?: string;
  website?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  socialLinks?: NormalizedSocialLinks;
}

/**
 * Normalized business and product context.
 * Contains caller-supplied trusted/approved business facts — never fabricated facts.
 * The provider contract defines the expected normalized trust boundary;
 * the calling service is responsible for selecting/verifying source data.
 */
export interface NormalizedBusinessContext {
  companyName: string;
  productName?: string;
  serviceName?: string;
  price?: string;
  currency?: string;
  offer?: string;
  deliveryInfo?: string;
  verifiedClaims?: string[];
}

/**
 * Optional contextual warnings or upstream signals passed to the provider.
 */
export interface NormalizedWarningsContext {
  explicitWarnings?: SalesAssistantWarning[];
}

/**
 * Normalized provider input payload.
 * Provider-agnostic, stateless, and free of database models or session objects.
 */
export interface NormalizedSalesAssistantInput {
  draftType: SalesAssistantDraftType;
  language: SalesAssistantLanguage;
  tone: SalesAssistantTone;
  objective?: string;
  customInstruction?: string;
  leadContext: NormalizedLeadContext;
  businessContext?: NormalizedBusinessContext;
  warningsContext?: NormalizedWarningsContext;
}

/**
 * Provider-neutral interface for generating AI Sales Assistant drafts.
 * LeadMate interacts exclusively with this interface.
 */
export interface SalesAssistantProviderClient {
  readonly providerName: string;

  /**
   * Generates a single sales assistant draft from normalized input.
   * Guaranteed to return a fresh DRAFT that conforms to generatedSalesAssistantDraftSchema.
   */
  generateDraft(input: NormalizedSalesAssistantInput): Promise<GeneratedSalesAssistantDraft>;
}
