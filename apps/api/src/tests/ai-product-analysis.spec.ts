import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiProductAnalysisService } from '../services/ai-product-analysis.service.js';
import { aiProductAnalysisSchema, AnalyzeProductRequestSchema } from '@leadmate/shared';
import { defaultAiRegistry, GEMINI_PROVIDER_KEY } from '@leadmate/ai';

describe('AiProductAnalysisService', () => {
  let service: AiProductAnalysisService;
  const mockContext = {
    organizationId: 'org-test-123',
    userId: 'user-test-456',
    correlationId: 'req-corr-789'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AiProductAnalysisService();
  });

  it('1. Analyzes Diamum healthcare product with appropriate commercial retail channels', async () => {
    const analysis = service.generateFallbackAnalysis({
      productName: 'Diamum',
      productDescription: 'Diabetes-care related healthcare product intended for retail and wholesale distribution.',
      category: 'Healthcare',
      goal: 'WHOLESALE',
      targetMarket: 'Dhaka, Bangladesh',
      buyerType: 'AI_DECIDE'
    });

    const validated = aiProductAnalysisSchema.parse(analysis);
    expect(validated.productCategory).toContain('Healthcare');
    expect(validated.buyerTargets.length).toBeGreaterThanOrEqual(3);

    const categories = validated.buyerTargets.map((b) => b.category);
    expect(categories).toContain('Pharmacy');
    expect(categories).toContain('Medicine Shop');
    expect(categories).toContain('Medical Distributor');

    // Medical safety invariant: no unsupported medical efficacy claims in reasons
    for (const target of validated.buyerTargets) {
      expect(target.reason).not.toContain('cures diabetes');
      expect(target.reason).not.toContain('clinically proven');
      expect(target.reason).not.toContain('guaranteed');
    }
  });

  it('2. Analyzes Portable Mini Blender with consumer kitchen and gadget retail channels', async () => {
    const analysis = service.generateFallbackAnalysis({
      productName: 'Portable Mini Blender',
      productDescription: 'USB rechargeable portable blender suitable for smoothies, home, and travel.',
      category: 'Kitchenware',
      goal: 'WHOLESALE',
      targetMarket: 'Chattogram, Bangladesh',
      buyerType: 'AI_DECIDE'
    });

    const validated = aiProductAnalysisSchema.parse(analysis);
    expect(validated.productCategory).toContain('Kitchenware');
    expect(validated.buyerTargets.length).toBeGreaterThanOrEqual(4);

    const categories = validated.buyerTargets.map((b) => b.category);
    expect(categories).toContain('Kitchenware Store');
    expect(categories).toContain('Gadget Store');
    expect(categories).toContain('Lifestyle Store');
  });

  it('3. Rejects invalid or empty product name / description with BadRequestError', async () => {
    await expect(
      service.analyzeProductForBuyerDiscovery(
        {
          productName: '',
          productDescription: 'Some description',
          goal: 'WHOLESALE',
          targetMarket: 'Dhaka',
          buyerType: 'AI_DECIDE'
        },
        mockContext
      )
    ).rejects.toThrow('Product name and product description are required');

    await expect(
      service.analyzeProductForBuyerDiscovery(
        {
          productName: 'Sample Product',
          productDescription: '   ',
          goal: 'WHOLESALE',
          targetMarket: 'Dhaka',
          buyerType: 'AI_DECIDE'
        },
        mockContext
      )
    ).rejects.toThrow('Product name and product description are required');
  });

  it('4. Rejects malformed Gemini output and falls back to safe deterministic heuristic', async () => {
    // Mock generateStructured to throw a validation/parsing error
    const mockGemini = {
      generateStructured: vi.fn().mockRejectedValue(new Error('JSON Parse error: Unexpected token < in JSON'))
    };
    (service as any).geminiProvider = mockGemini;

    const result = await service.analyzeProductForBuyerDiscovery(
      {
        productName: 'Diamum Blood Glucose Strips',
        productDescription: 'Medical diabetes care testing strips',
        goal: 'WHOLESALE',
        targetMarket: 'Dhaka',
        buyerType: 'AI_DECIDE'
      },
      mockContext
    );

    expect(result).toBeDefined();
    expect(result.productCategory).toContain('Healthcare');
    expect(result.buyerTargets.length).toBeGreaterThanOrEqual(3);
  });

  it('5. Strictly validates schema invariants: zero personal names, phone numbers, or fabricated contacts', () => {
    const analysis = service.generateFallbackAnalysis({
      productName: 'Wireless Bluetooth Earbuds',
      productDescription: 'Active noise cancelling wireless earbuds with charging case.',
      category: 'Electronics',
      goal: 'RETAIL_DISTRIBUTION',
      targetMarket: 'Dhaka',
      buyerType: 'AI_DECIDE'
    });

    const parsed = aiProductAnalysisSchema.parse(analysis);
    expect(parsed.searchTerms.length).toBeGreaterThan(0);

    for (const target of parsed.buyerTargets) {
      // Must only be commercial category names, not individual people or phones
      expect(target.category).not.toMatch(/\+?880\d+/);
      expect(target.category).not.toMatch(/@/);
      expect(target.reason).not.toMatch(/\+?880\d+/);
    }
  });

  it('6. Regression: AnalyzeProductRequestSchema normalizes frontend payload with aliases, empty strings, and enums without 422', () => {
    const rawFrontendPayload = {
      name: 'Portable Mini Blender',
      description: 'USB rechargeable portable blender for smoothies, home and travel use.',
      category: '',
      location: 'Dhaka',
      salesGoal: 'WHOLESALE',
      buyerStrategy: 'AI_DECIDE',
      targetCount: 20
    };

    const validatedInput = AnalyzeProductRequestSchema.parse(rawFrontendPayload);
    expect(validatedInput.productName).toBe('Portable Mini Blender');
    expect(validatedInput.productDescription).toContain('USB rechargeable');
    expect(validatedInput.targetMarket).toBe('Dhaka');
    expect(validatedInput.goal).toBe('WHOLESALE');
    expect(validatedInput.buyerType).toBe('AI_DECIDE');
    expect(validatedInput.resultTarget).toBe(20);
    expect(validatedInput.category).toBeNull();

    const parsed = service.generateFallbackAnalysis(validatedInput);
    expect(parsed).toBeDefined();
    expect(parsed.productCategory).toContain('Kitchenware');
    expect(parsed.buyerTargets.length).toBeGreaterThanOrEqual(3);
  });

  it('7. Regression: 2017-character product description passes AnalyzeProductRequestSchema', () => {
    const desc2017 = 'A'.repeat(2017);
    const result = AnalyzeProductRequestSchema.safeParse({
      productName: 'Mushroom Lamp',
      productDescription: desc2017,
      targetMarket: 'Dhaka',
      goal: 'WHOLESALE'
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.productDescription.length).toBe(2017);
    }
  });

  it('8. Regression: exactly 4000-character description passes AnalyzeProductRequestSchema', () => {
    const desc4000 = 'B'.repeat(4000);
    const result = AnalyzeProductRequestSchema.safeParse({
      productName: 'Mushroom Lamp Large Spec',
      productDescription: desc4000,
      targetMarket: 'Dhaka',
      goal: 'WHOLESALE'
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.productDescription.length).toBe(4000);
    }
  });

  it('9. Regression: 4001-character description returns validation error with clear message', () => {
    const desc4001 = 'C'.repeat(4001);
    const result = AnalyzeProductRequestSchema.safeParse({
      productName: 'Mushroom Lamp Exceeding Spec',
      productDescription: desc4001,
      targetMarket: 'Dhaka',
      goal: 'WHOLESALE'
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes('productDescription'));
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('4000 characters or fewer');
    }
  });
});
