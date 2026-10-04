import {
  SalesAssistantDraftType,
  SalesAssistantLanguage,
  SalesAssistantTone,
  SalesAssistantDraftStatus,
  SalesAssistantWarning,
  generatedSalesAssistantDraftSchema,
  type GeneratedSalesAssistantDraft
} from '@leadmate/shared';
import {
  SalesAssistantProviderErrorCode,
  SalesAssistantProviderError
} from './errors.js';
import type {
  SalesAssistantProviderClient,
  NormalizedSalesAssistantInput
} from './provider.js';

export interface MockSalesAssistantProviderOptions {
  simulateFailure?: boolean;
  failureErrorCode?: SalesAssistantProviderErrorCode;
  failureErrorMessage?: string;
  retryable?: boolean;
}

/**
 * Deterministic Mock AI Sales Assistant Provider for development and tests.
 * Performs zero network/HTTP calls. Produces contract-valid DRAFT outputs only.
 */
export class MockSalesAssistantProvider implements SalesAssistantProviderClient {
  public readonly providerName = 'MOCK';

  private simulateFailure = false;
  private failureErrorCode: SalesAssistantProviderErrorCode =
    SalesAssistantProviderErrorCode.PROVIDER_UNAVAILABLE;
  private failureErrorMessage = 'Mock provider simulated failure';
  private retryable = false;

  constructor(options: MockSalesAssistantProviderOptions = {}) {
    if (options.simulateFailure !== undefined) {
      this.simulateFailure = options.simulateFailure;
    }
    if (options.failureErrorCode) {
      this.failureErrorCode = options.failureErrorCode;
    }
    if (options.failureErrorMessage) {
      this.failureErrorMessage = options.failureErrorMessage;
    }
    if (options.retryable !== undefined) {
      this.retryable = options.retryable;
    }
  }

  /**
   * Configure simulated failure mode for test scenarios.
   */
  public setSimulateFailure(
    enabled: boolean,
    errorCode: SalesAssistantProviderErrorCode = SalesAssistantProviderErrorCode.PROVIDER_UNAVAILABLE,
    errorMessage = 'Mock provider simulated failure',
    retryable = false
  ): void {
    this.simulateFailure = enabled;
    this.failureErrorCode = errorCode;
    this.failureErrorMessage = errorMessage;
    this.retryable = retryable;
  }

  public async generateDraft(
    input: NormalizedSalesAssistantInput
  ): Promise<GeneratedSalesAssistantDraft> {
    if (this.simulateFailure) {
      throw new SalesAssistantProviderError(
        this.failureErrorCode,
        this.failureErrorMessage,
        this.retryable
      );
    }

    const warnings = this.computeWarnings(input);
    const draft = this.buildDraft(input, warnings);

    // Guaranteed contract validation
    return generatedSalesAssistantDraftSchema.parse(draft);
  }

  private computeWarnings(input: NormalizedSalesAssistantInput): SalesAssistantWarning[] {
    const warningSet = new Set<SalesAssistantWarning>();
    const { leadContext, businessContext, draftType, objective, customInstruction } = input;

    // Check for explicit warnings passed in context
    if (input.warningsContext?.explicitWarnings) {
      for (const w of input.warningsContext.explicitWarnings) {
        warningSet.add(w);
      }
    }

    // 1. LIMITED_LEAD_CONTEXT: Only business name present, lacking category, description, and contact info
    const hasDetails = Boolean(
      leadContext.category ||
      leadContext.description ||
      leadContext.location ||
      leadContext.website ||
      leadContext.email ||
      leadContext.phone ||
      leadContext.whatsapp
    );
    if (!hasDetails) {
      warningSet.add(SalesAssistantWarning.LIMITED_LEAD_CONTEXT);
    }

    // 2. MISSING_PRODUCT_CONTEXT: No business context or no product/service name
    if (!businessContext || (!businessContext.productName && !businessContext.serviceName)) {
      warningSet.add(SalesAssistantWarning.MISSING_PRODUCT_CONTEXT);
    }

    // 3. MISSING_PRICE_CONTEXT: Proposal or text requesting pricing, but no price in business context
    const textToCheck = `${objective ?? ''} ${customInstruction ?? ''}`.toLowerCase();
    const pricingImplied =
      draftType === SalesAssistantDraftType.PROPOSAL ||
      /\b(price|pricing|cost|quote|rate|package|fees)\b/i.test(textToCheck);
    if (pricingImplied && !businessContext?.price) {
      warningSet.add(SalesAssistantWarning.MISSING_PRICE_CONTEXT);
    }

    // 4. UNVERIFIED_WHATSAPP: WhatsApp requested but no verified WhatsApp in lead context.
    // Invariant: PHONE != WHATSAPP.
    // The calling service is responsible for populating whatsapp only from explicit verified/public evidence;
    // the provider must never infer whatsapp from phone.
    if (draftType === SalesAssistantDraftType.WHATSAPP && !leadContext.whatsapp) {
      warningSet.add(SalesAssistantWarning.UNVERIFIED_WHATSAPP);
    }

    // 5. UNSUPPORTED_CLAIM_REMOVED: Deterministic MOCK test behavior only.
    // Detects sample unsupported claims in test inputs. This does NOT represent complete
    // semantic moderation; real-provider semantic guardrails remain future work.
    if (customInstruction) {
      const unsupportedPatterns = /\b(guarantee|guaranteed|100% roi|fake urgency|free delivery|unlimited discount|50% off)\b/i;
      if (unsupportedPatterns.test(customInstruction)) {
        warningSet.add(SalesAssistantWarning.UNSUPPORTED_CLAIM_REMOVED);
      }
    }

    return Array.from(warningSet);
  }

  private buildDraft(
    input: NormalizedSalesAssistantInput,
    warnings: SalesAssistantWarning[]
  ): GeneratedSalesAssistantDraft {
    const { draftType, language, tone, leadContext, businessContext, objective } = input;
    const businessName = leadContext.businessName;
    const productOrService =
      businessContext?.productName ||
      businessContext?.serviceName ||
      'our business solutions';
    const company = businessContext?.companyName || 'LeadMate';

    // Salutation & Value statement based on language
    const salutation = this.getSalutation(language, businessName);
    const valueProp = this.getValueProposition(language, tone, productOrService, company);
    const closing = this.getClosing(language, tone, company);
    const objectiveLine = objective ? this.getObjectiveLine(language, objective) : '';

    if (draftType === SalesAssistantDraftType.EMAIL) {
      const subject = this.getEmailSubject(language, tone, businessName, productOrService);
      const bodyLines = [
        salutation,
        '',
        valueProp,
        objectiveLine ? `\n${objectiveLine}` : '',
        '',
        closing
      ].filter((l) => l !== undefined);

      return {
        type: SalesAssistantDraftType.EMAIL,
        language,
        tone,
        status: SalesAssistantDraftStatus.DRAFT,
        warnings: warnings.length > 0 ? warnings : undefined,
        subject,
        body: bodyLines.join('\n').trim()
      };
    }

    // Non-email types: WHATSAPP, CALL_SCRIPT, PROPOSAL, FOLLOW_UP
    let content: string;
    switch (draftType) {
      case SalesAssistantDraftType.WHATSAPP:
        content = [
          salutation,
          valueProp,
          objectiveLine,
          closing
        ].filter(Boolean).join('\n\n').trim();
        break;

      case SalesAssistantDraftType.CALL_SCRIPT:
        content = this.buildCallScript(language, tone, businessName, productOrService, company, objectiveLine);
        break;

      case SalesAssistantDraftType.PROPOSAL:
        content = this.buildProposal(language, tone, businessName, productOrService, company, businessContext);
        break;

      case SalesAssistantDraftType.FOLLOW_UP:
        content = this.buildFollowUp(language, tone, businessName, productOrService, company, objectiveLine);
        break;
    }

    return {
      type: draftType,
      language,
      tone,
      status: SalesAssistantDraftStatus.DRAFT,
      warnings: warnings.length > 0 ? warnings : undefined,
      content
    };
  }

  private getSalutation(language: SalesAssistantLanguage, businessName: string): string {
    switch (language) {
      case SalesAssistantLanguage.BANGLA:
        return `আসসালামু আলাইকুম ${businessName} টিম,`;
      case SalesAssistantLanguage.MIXED:
        return `আসসালামু আলাইকুম ${businessName} Team,`;
      case SalesAssistantLanguage.ENGLISH:
      default:
        return `Hello ${businessName} Team,`;
    }
  }

  private getValueProposition(
    language: SalesAssistantLanguage,
    tone: SalesAssistantTone,
    productOrService: string,
    company: string
  ): string {
    switch (language) {
      case SalesAssistantLanguage.BANGLA:
        if (tone === SalesAssistantTone.CONCISE) {
          return `${company}-এর ${productOrService} আপনার ব্যবসায়িক কার্যক্রমে সহায়ক হতে পারে।`;
        }
        if (tone === SalesAssistantTone.PERSUASIVE) {
          return `আমরা লক্ষ্য করেছি আপনার ব্যবসার উন্নতিতে আধুনিক সমাধান প্রয়োজন। ${company}-এর ${productOrService} আপনার সেলস ও কাস্টমার এনগেজমেন্ট বৃদ্ধিতে কার্যকর ভূমিকা রাখতে পারে।`;
        }
        if (tone === SalesAssistantTone.FRIENDLY) {
          return `আশা করি ভালো আছেন! আমরা ${company} থেকে যোগাযোগ করছি, যেখানে ${productOrService} দিয়ে ব্যবসায়িক প্রবৃদ্ধি সহজ করা হয়।`;
        }
        return `আমরা ${company} থেকে আপনার ব্যবসায়িক প্রসারে ${productOrService}-এর সুবিধাগুলো তুলে ধরতে আগ্রহী।`;

      case SalesAssistantLanguage.MIXED:
        if (tone === SalesAssistantTone.CONCISE) {
          return `${company}-এর ${productOrService} দিয়ে আপনার business workflow সহজ করতে পারেন।`;
        }
        if (tone === SalesAssistantTone.PERSUASIVE) {
          return `আপনার business growth ত্বরান্বিত করতে ${company}-এর ${productOrService} হতে পারে একটি reliable solution।`;
        }
        if (tone === SalesAssistantTone.FRIENDLY) {
          return `Hope you are well! ${company} থেকে reach out করছি, আমাদের ${productOrService} আপনার team-কে সাহায্য করতে পারে।`;
        }
        return `আমরা ${company} থেকে আপনার business expansion-এ ${productOrService}-এর সুবিধা শেয়ার করতে চাই।`;

      case SalesAssistantLanguage.ENGLISH:
      default:
        if (tone === SalesAssistantTone.CONCISE) {
          return `${company}'s ${productOrService} can help streamline your daily operations.`;
        }
        if (tone === SalesAssistantTone.PERSUASIVE) {
          return `Elevate your business capabilities with ${company}'s ${productOrService}, designed to improve customer response and sales efficiency.`;
        }
        if (tone === SalesAssistantTone.FRIENDLY) {
          return `Hope you're having a productive week! Reaching out from ${company} to share how ${productOrService} could benefit your team.`;
        }
        return `At ${company}, we provide ${productOrService} designed to assist businesses like yours in scaling operations effectively.`;
    }
  }

  private getObjectiveLine(language: SalesAssistantLanguage, objective: string): string {
    switch (language) {
      case SalesAssistantLanguage.BANGLA:
        return `আমাদের উদ্দেশ্য: ${objective}`;
      case SalesAssistantLanguage.MIXED:
        return `Our objective: ${objective}`;
      case SalesAssistantLanguage.ENGLISH:
      default:
        return `Our objective: ${objective}`;
    }
  }

  private getClosing(
    language: SalesAssistantLanguage,
    tone: SalesAssistantTone,
    company: string
  ): string {
    switch (language) {
      case SalesAssistantLanguage.BANGLA:
        if (tone === SalesAssistantTone.CONCISE) return `ধন্যবাদ,\n${company} টিম`;
        if (tone === SalesAssistantTone.FRIENDLY) return `আপনার উত্তরের অপেক্ষায়,\n${company} টিম`;
        return `বিনীত,\n${company} সেলস টিম`;

      case SalesAssistantLanguage.MIXED:
        if (tone === SalesAssistantTone.CONCISE) return `Thanks,\n${company} Team`;
        if (tone === SalesAssistantTone.FRIENDLY) return `Looking forward to connecting,\n${company} Team`;
        return `Best regards,\n${company} Sales Team`;

      case SalesAssistantLanguage.ENGLISH:
      default:
        if (tone === SalesAssistantTone.CONCISE) return `Thanks,\n${company} Team`;
        if (tone === SalesAssistantTone.FRIENDLY) return `Looking forward to hearing from you!\nBest,\n${company} Team`;
        return `Best regards,\n${company} Sales Team`;
    }
  }

  private getEmailSubject(
    language: SalesAssistantLanguage,
    tone: SalesAssistantTone,
    businessName: string,
    productOrService: string
  ): string {
    switch (language) {
      case SalesAssistantLanguage.BANGLA:
        return tone === SalesAssistantTone.CONCISE
          ? `${businessName}-এর জন্য ${productOrService}`
          : `${businessName}-এর ব্যবসায়িক প্রবৃদ্ধিতে ${productOrService}`;

      case SalesAssistantLanguage.MIXED:
        return tone === SalesAssistantTone.CONCISE
          ? `${productOrService} for ${businessName}`
          : `Exploring ${productOrService} for ${businessName}`;

      case SalesAssistantLanguage.ENGLISH:
      default:
        return tone === SalesAssistantTone.CONCISE
          ? `${productOrService} for ${businessName}`
          : `Partnership Opportunity: ${productOrService} for ${businessName}`;
    }
  }

  private buildCallScript(
    language: SalesAssistantLanguage,
    tone: SalesAssistantTone,
    businessName: string,
    productOrService: string,
    company: string,
    objectiveLine: string
  ): string {
    const greeting = this.getSalutation(language, businessName);
    const value = this.getValueProposition(language, tone, productOrService, company);
    const question = language === SalesAssistantLanguage.BANGLA
      ? 'আপনার কি এই বিষয়ে বিস্তারিত কথা বলার জন্য ২ মিনিট সময় হবে?'
      : language === SalesAssistantLanguage.MIXED
      ? 'Do you have 2 minutes to discuss how this fits your workflow?'
      : 'Do you have 2 minutes to explore if this would be a fit for your workflow?';

    return [
      `[CALL SCRIPT - ${company.toUpperCase()}]`,
      `Introduction:`,
      greeting,
      `Pitch:`,
      value,
      objectiveLine ? `Context: ${objectiveLine}` : '',
      `Qualifying Question:`,
      question,
      `Next Step:`,
      `If interested, offer a brief 10-minute demo. If busy, confirm the best time to follow up.`
    ].filter(Boolean).join('\n\n').trim();
  }

  private buildProposal(
    language: SalesAssistantLanguage,
    tone: SalesAssistantTone,
    businessName: string,
    productOrService: string,
    company: string,
    businessContext?: NormalizedSalesAssistantInput['businessContext']
  ): string {
    const pricingSection = businessContext?.price
      ? `Pricing: ${businessContext.price} ${businessContext.currency || ''}`.trim()
      : `Pricing: To be discussed based on verified scope and requirements.`;

    const offerSection = businessContext?.offer
      ? `Scope of Offer: ${businessContext.offer}`
      : `Scope of Offer: Standard implementation of ${productOrService}.`;

    return [
      `PROPOSAL: ${productOrService.toUpperCase()}`,
      `Prepared for: ${businessName}`,
      `Prepared by: ${company}`,
      '',
      `1. Executive Summary:`,
      this.getValueProposition(language, tone, productOrService, company),
      '',
      `2. Solution Overview:`,
      offerSection,
      '',
      `3. Commercial Terms:`,
      pricingSection,
      '',
      `4. Next Steps:`,
      `Review and confirm interest to schedule onboarding.`
    ].join('\n').trim();
  }

  private buildFollowUp(
    language: SalesAssistantLanguage,
    tone: SalesAssistantTone,
    businessName: string,
    productOrService: string,
    company: string,
    objectiveLine: string
  ): string {
    const opening = language === SalesAssistantLanguage.BANGLA
      ? `পূর্ববর্তী আলোচনার প্রেক্ষিতে যোগাযোগ করছি।`
      : language === SalesAssistantLanguage.MIXED
      ? `Following up on our earlier conversation regarding ${productOrService}.`
      : `Following up on our recent outreach regarding ${productOrService}.`;

    const closing = this.getClosing(language, tone, company);

    return [
      this.getSalutation(language, businessName),
      '',
      opening,
      this.getValueProposition(language, tone, productOrService, company),
      objectiveLine ? `\n${objectiveLine}` : '',
      '',
      closing
    ].filter(Boolean).join('\n').trim();
  }
}
