import { describe, it, expect } from 'vitest';
import {
  SalesAssistantDraftType,
  SalesAssistantLanguage,
  SalesAssistantTone,
  SalesAssistantDraftStatus,
  SalesAssistantWarning,
  generatedSalesAssistantDraftSchema
} from '@leadmate/shared';
import {
  MockSalesAssistantProvider,
  getSalesAssistantProvider,
  SalesAssistantProviderKind,
  SalesAssistantProviderErrorCode,
  SalesAssistantProviderError,
  type NormalizedSalesAssistantInput
} from '../index.js';

describe('M5 Step 3: AI Sales Assistant Provider Abstraction & Mock Provider', () => {
  const baseLeadContext = {
    leadId: '11111111-1111-1111-1111-111111111111',
    businessName: 'Apex Electronics',
    category: 'Consumer Electronics',
    description: 'Retailer of home appliances and consumer electronics.',
    location: 'Dhanmondi, Dhaka',
    website: 'https://apexelectronics.example.com',
    email: 'info@apexelectronics.example.com',
    phone: '+8801700000000',
    whatsapp: '+8801700000000'
  };

  const baseBusinessContext = {
    companyName: 'LeadMate AI',
    productName: 'StoreMate Retail Suite',
    serviceName: 'Automated Catalog Management',
    price: '৳15,000 / month',
    currency: 'BDT',
    offer: 'Full onboarding, inventory sync, and digital store catalog setup.',
    verifiedClaims: ['Direct ERP sync', 'SMS alert notifications']
  };

  const createInput = (
    overrides?: Partial<NormalizedSalesAssistantInput>
  ): NormalizedSalesAssistantInput => ({
    draftType: SalesAssistantDraftType.WHATSAPP,
    language: SalesAssistantLanguage.ENGLISH,
    tone: SalesAssistantTone.PROFESSIONAL,
    objective: 'Introduce digital store catalog benefits',
    leadContext: { ...baseLeadContext },
    businessContext: { ...baseBusinessContext },
    ...overrides
  });

  describe('1. Provider Resolution & Factory', () => {
    it('resolves default MockSalesAssistantProvider for MOCK kind', () => {
      const provider = getSalesAssistantProvider(SalesAssistantProviderKind.MOCK);
      expect(provider).toBeInstanceOf(MockSalesAssistantProvider);
      expect(provider.providerName).toBe('MOCK');
    });

    it('resolves injected custom provider client when provided', () => {
      const customMock = new MockSalesAssistantProvider();
      const provider = getSalesAssistantProvider('MOCK', customMock);
      expect(provider).toBe(customMock);
    });

    it('throws normalized SalesAssistantProviderError(PROVIDER_UNAVAILABLE) for unsupported real provider', () => {
      expect(() => getSalesAssistantProvider('OPENAI')).toThrow(SalesAssistantProviderError);

      try {
        getSalesAssistantProvider('GEMINI');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(SalesAssistantProviderError);
        const providerErr = err as SalesAssistantProviderError;
        expect(providerErr.code).toBe(SalesAssistantProviderErrorCode.PROVIDER_UNAVAILABLE);
        expect(providerErr.safeMessage).toContain('GEMINI');
        expect(providerErr.retryable).toBe(false);
      }
    });
  });

  describe('2. All 5 Draft Types & Schema Validation', () => {
    const provider = new MockSalesAssistantProvider();

    it('generates valid WHATSAPP draft', async () => {
      const input = createInput({ draftType: SalesAssistantDraftType.WHATSAPP });
      const result = await provider.generateDraft(input);

      expect(result.type).toBe(SalesAssistantDraftType.WHATSAPP);
      expect(result.status).toBe(SalesAssistantDraftStatus.DRAFT);
      expect('content' in result && typeof result.content === 'string').toBe(true);
      if ('content' in result) {
        expect(result.content.length).toBeGreaterThan(10);
        expect(result.content.length).toBeLessThanOrEqual(2000);
      }
      expect(generatedSalesAssistantDraftSchema.safeParse(result).success).toBe(true);
    });

    it('generates valid EMAIL draft with subject and body (no generic content)', async () => {
      const input = createInput({ draftType: SalesAssistantDraftType.EMAIL });
      const result = await provider.generateDraft(input);

      expect(result.type).toBe(SalesAssistantDraftType.EMAIL);
      expect(result.status).toBe(SalesAssistantDraftStatus.DRAFT);
      expect('content' in result).toBe(false);
      expect('subject' in result && typeof result.subject === 'string').toBe(true);
      expect('body' in result && typeof result.body === 'string').toBe(true);
      if ('subject' in result && 'body' in result) {
        expect(result.subject.length).toBeGreaterThan(5);
        expect(result.subject.length).toBeLessThanOrEqual(200);
        expect(result.body.length).toBeGreaterThan(20);
        expect(result.body.length).toBeLessThanOrEqual(6000);
      }
      expect(generatedSalesAssistantDraftSchema.safeParse(result).success).toBe(true);
    });

    it('generates valid CALL_SCRIPT draft', async () => {
      const input = createInput({ draftType: SalesAssistantDraftType.CALL_SCRIPT });
      const result = await provider.generateDraft(input);

      expect(result.type).toBe(SalesAssistantDraftType.CALL_SCRIPT);
      expect(result.status).toBe(SalesAssistantDraftStatus.DRAFT);
      expect('content' in result && typeof result.content === 'string').toBe(true);
      if ('content' in result) {
        expect(result.content).toContain('[CALL SCRIPT');
        expect(result.content.length).toBeLessThanOrEqual(8000);
      }
      expect(generatedSalesAssistantDraftSchema.safeParse(result).success).toBe(true);
    });

    it('generates valid PROPOSAL draft', async () => {
      const input = createInput({ draftType: SalesAssistantDraftType.PROPOSAL });
      const result = await provider.generateDraft(input);

      expect(result.type).toBe(SalesAssistantDraftType.PROPOSAL);
      expect(result.status).toBe(SalesAssistantDraftStatus.DRAFT);
      expect('content' in result && typeof result.content === 'string').toBe(true);
      if ('content' in result) {
        expect(result.content).toContain('PROPOSAL:');
        expect(result.content).toContain('Commercial Terms:');
        expect(result.content.length).toBeLessThanOrEqual(12000);
      }
      expect(generatedSalesAssistantDraftSchema.safeParse(result).success).toBe(true);
    });

    it('generates valid FOLLOW_UP draft', async () => {
      const input = createInput({ draftType: SalesAssistantDraftType.FOLLOW_UP });
      const result = await provider.generateDraft(input);

      expect(result.type).toBe(SalesAssistantDraftType.FOLLOW_UP);
      expect(result.status).toBe(SalesAssistantDraftStatus.DRAFT);
      expect('content' in result && typeof result.content === 'string').toBe(true);
      if ('content' in result) {
        expect(result.content.length).toBeGreaterThan(10);
        expect(result.content.length).toBeLessThanOrEqual(2000);
      }
      expect(generatedSalesAssistantDraftSchema.safeParse(result).success).toBe(true);
    });
  });

  describe('3. Language Support & Determinism (BANGLA, ENGLISH, MIXED)', () => {
    const provider = new MockSalesAssistantProvider();

    it('generates distinct Bangla output for BANGLA language', async () => {
      const input = createInput({
        language: SalesAssistantLanguage.BANGLA,
        draftType: SalesAssistantDraftType.WHATSAPP
      });
      const result = await provider.generateDraft(input);

      expect(result.language).toBe(SalesAssistantLanguage.BANGLA);
      if ('content' in result) {
        expect(result.content).toContain('আসসালামু আলাইকুম');
      }
      expect(generatedSalesAssistantDraftSchema.safeParse(result).success).toBe(true);
    });

    it('generates distinct Mixed output for MIXED language', async () => {
      const input = createInput({
        language: SalesAssistantLanguage.MIXED,
        draftType: SalesAssistantDraftType.WHATSAPP
      });
      const result = await provider.generateDraft(input);

      expect(result.language).toBe(SalesAssistantLanguage.MIXED);
      if ('content' in result) {
        expect(result.content).toContain('আসসালামু আলাইকুম');
        expect(result.content).toContain('Team');
      }
      expect(generatedSalesAssistantDraftSchema.safeParse(result).success).toBe(true);
    });

    it('generates English output for ENGLISH language', async () => {
      const input = createInput({
        language: SalesAssistantLanguage.ENGLISH,
        draftType: SalesAssistantDraftType.WHATSAPP
      });
      const result = await provider.generateDraft(input);

      expect(result.language).toBe(SalesAssistantLanguage.ENGLISH);
      if ('content' in result) {
        expect(result.content).toContain('Hello');
      }
      expect(generatedSalesAssistantDraftSchema.safeParse(result).success).toBe(true);
    });
  });

  describe('4. Tone Support (PROFESSIONAL, FRIENDLY, CONCISE, PERSUASIVE)', () => {
    const provider = new MockSalesAssistantProvider();

    for (const tone of Object.values(SalesAssistantTone)) {
      it(`supports tone ${tone} producing contract-valid output`, async () => {
        const input = createInput({ tone, draftType: SalesAssistantDraftType.WHATSAPP });
        const result = await provider.generateDraft(input);

        expect(result.tone).toBe(tone);
        expect(result.status).toBe(SalesAssistantDraftStatus.DRAFT);
        expect(generatedSalesAssistantDraftSchema.safeParse(result).success).toBe(true);
      });
    }
  });

  describe('5. DRAFT-Only Invariant', () => {
    const provider = new MockSalesAssistantProvider();

    it('always produces status = DRAFT across all types, never APPROVED, REJECTED, or SENT', async () => {
      for (const draftType of Object.values(SalesAssistantDraftType)) {
        const input = createInput({ draftType });
        const result = await provider.generateDraft(input);
        expect(result.status).toBe(SalesAssistantDraftStatus.DRAFT);
        expect(result.status).not.toBe('APPROVED');
        expect(result.status).not.toBe('REJECTED');
        expect(result.status).not.toBe('SENT');
      }
    });
  });

  describe('6. Warnings & Guardrails', () => {
    const provider = new MockSalesAssistantProvider();

    it('attaches UNVERIFIED_WHATSAPP when draftType=WHATSAPP and leadContext has no verified whatsapp', async () => {
      const input = createInput({
        draftType: SalesAssistantDraftType.WHATSAPP,
        leadContext: {
          ...baseLeadContext,
          whatsapp: undefined,
          phone: '+8801711111111' // Invariant: phone alone must NOT satisfy whatsapp
        }
      });

      const result = await provider.generateDraft(input);
      expect(result.warnings).toBeDefined();
      expect(result.warnings).toContain(SalesAssistantWarning.UNVERIFIED_WHATSAPP);
    });

    it('does NOT attach UNVERIFIED_WHATSAPP when leadContext has explicit verified whatsapp', async () => {
      const input = createInput({
        draftType: SalesAssistantDraftType.WHATSAPP,
        leadContext: {
          ...baseLeadContext,
          whatsapp: '+8801700000000'
        }
      });

      const result = await provider.generateDraft(input);
      expect(result.warnings ?? []).not.toContain(SalesAssistantWarning.UNVERIFIED_WHATSAPP);
    });

    it('attaches MISSING_PRICE_CONTEXT when proposal has no price context and does not invent price', async () => {
      const input = createInput({
        draftType: SalesAssistantDraftType.PROPOSAL,
        businessContext: {
          ...baseBusinessContext,
          price: undefined
        }
      });

      const result = await provider.generateDraft(input);
      expect(result.warnings).toBeDefined();
      expect(result.warnings).toContain(SalesAssistantWarning.MISSING_PRICE_CONTEXT);
      if ('content' in result) {
        expect(result.content).toContain('To be discussed');
        expect(result.content).not.toMatch(/৳\s*\d+/);
      }
    });

    it('attaches LIMITED_LEAD_CONTEXT when lead context has only a business name without details', async () => {
      const input = createInput({
        leadContext: {
          leadId: '22222222-2222-2222-2222-222222222222',
          businessName: 'Solo Cafe'
        }
      });

      const result = await provider.generateDraft(input);
      expect(result.warnings).toBeDefined();
      expect(result.warnings).toContain(SalesAssistantWarning.LIMITED_LEAD_CONTEXT);
    });

    it('attaches MISSING_PRODUCT_CONTEXT when businessContext is omitted or empty', async () => {
      const input = createInput({
        businessContext: undefined
      });

      const result = await provider.generateDraft(input);
      expect(result.warnings).toBeDefined();
      expect(result.warnings).toContain(SalesAssistantWarning.MISSING_PRODUCT_CONTEXT);
    });

    it('attaches UNSUPPORTED_CLAIM_REMOVED when customInstruction contains unverified guarantee/discount claims', async () => {
      const input = createInput({
        customInstruction: 'Include 100% ROI guarantee and 50% off discount'
      });

      const result = await provider.generateDraft(input);
      expect(result.warnings).toBeDefined();
      expect(result.warnings).toContain(SalesAssistantWarning.UNSUPPORTED_CLAIM_REMOVED);
    });
  });

  describe('7. Verified Facts Only (No Fabrication)', () => {
    const provider = new MockSalesAssistantProvider();

    it('does not invent discounts, ratings, guarantees, or delivery promises', async () => {
      const input = createInput({
        leadContext: {
          leadId: '33333333-3333-3333-3333-333333333333',
          businessName: 'Unverified Shop'
        },
        businessContext: {
          companyName: 'Clean Company'
        }
      });

      const result = await provider.generateDraft(input);
      const text = 'content' in result ? result.content : `${result.subject} ${result.body}`;

      expect(text).not.toMatch(/\b(discount|off|guarantee|guaranteed|5 star|rating|reviews?|free shipping)\b/i);
    });
  });

  describe('8. Controlled Failure Modes & Safe Error Normalization', () => {
    it('throws normalized SalesAssistantProviderError when simulateFailure is enabled', async () => {
      const provider = new MockSalesAssistantProvider({
        simulateFailure: true,
        failureErrorCode: SalesAssistantProviderErrorCode.PROVIDER_RATE_LIMITED,
        failureErrorMessage: 'Rate limit exceeded for test',
        retryable: true
      });

      await expect(provider.generateDraft(createInput())).rejects.toThrow(
        SalesAssistantProviderError
      );

      try {
        await provider.generateDraft(createInput());
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(SalesAssistantProviderError);
        const providerErr = err as SalesAssistantProviderError;
        expect(providerErr.code).toBe(SalesAssistantProviderErrorCode.PROVIDER_RATE_LIMITED);
        expect(providerErr.safeMessage).toBe('Rate limit exceeded for test');
        expect(providerErr.retryable).toBe(true);
      }
    });

    it('supports runtime toggle of simulated failure via setSimulateFailure', async () => {
      const provider = new MockSalesAssistantProvider();

      // Normal call works
      const first = await provider.generateDraft(createInput());
      expect(first.status).toBe(SalesAssistantDraftStatus.DRAFT);

      // Turn on simulated failure
      provider.setSimulateFailure(
        true,
        SalesAssistantProviderErrorCode.PROVIDER_TIMEOUT,
        'Simulated timeout',
        true
      );

      await expect(provider.generateDraft(createInput())).rejects.toMatchObject({
        code: SalesAssistantProviderErrorCode.PROVIDER_TIMEOUT,
        safeMessage: 'Simulated timeout',
        retryable: true
      });

      // Turn off simulated failure
      provider.setSimulateFailure(false);
      const third = await provider.generateDraft(createInput());
      expect(third.status).toBe(SalesAssistantDraftStatus.DRAFT);
    });

    it('supports all normalized error codes', () => {
      const codes = [
        SalesAssistantProviderErrorCode.PROVIDER_UNAVAILABLE,
        SalesAssistantProviderErrorCode.PROVIDER_TIMEOUT,
        SalesAssistantProviderErrorCode.PROVIDER_RATE_LIMITED,
        SalesAssistantProviderErrorCode.INVALID_PROVIDER_RESPONSE,
        SalesAssistantProviderErrorCode.GENERATION_FAILED
      ];

      for (const code of codes) {
        const error = new SalesAssistantProviderError(code, `Safe message for ${code}`, false);
        expect(error.code).toBe(code);
        expect(error.safeMessage).toBe(`Safe message for ${code}`);
        expect(error.retryable).toBe(false);
      }
    });
  });

  describe('9. Secret Leakage Protection', () => {
    const provider = new MockSalesAssistantProvider();

    it('output draft contains zero secret or raw provider fields', async () => {
      const result = await provider.generateDraft(createInput());

      const forbiddenKeys = [
        'rawResponse',
        'apiKey',
        'token',
        'systemPrompt',
        'reasoning',
        'chainOfThought',
        'authorization',
        'secret',
        'prompt'
      ];

      for (const key of forbiddenKeys) {
        expect(key in result).toBe(false);
      }
    });
  });

  describe('10. Statelessness & Determinism', () => {
    it('produces identical deterministic output given identical input', async () => {
      const provider = new MockSalesAssistantProvider();
      const input = createInput();

      const output1 = await provider.generateDraft(input);
      const output2 = await provider.generateDraft(input);

      expect(output1).toEqual(output2);
    });

    it('is stateless across consecutive calls with different inputs', async () => {
      const provider = new MockSalesAssistantProvider();

      const inputA = createInput({
        leadContext: { ...baseLeadContext, businessName: 'Store A' }
      });
      const inputB = createInput({
        leadContext: { ...baseLeadContext, businessName: 'Store B' }
      });

      const resA1 = await provider.generateDraft(inputA);
      const resB = await provider.generateDraft(inputB);
      const resA2 = await provider.generateDraft(inputA);

      expect(resA1).toEqual(resA2);
      expect(resA1).not.toEqual(resB);
    });
  });
});
