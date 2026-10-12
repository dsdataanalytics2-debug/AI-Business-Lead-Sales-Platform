/**
 * AI Product Analysis Service
 *
 * Implements AI-driven commercial product understanding, buyer category generation,
 * and search term expansion using centralized AI providers and strict schema validation.
 *
 * INVARIANTS:
 * - AI is an advisory classification layer, NEVER invents real businesses or contacts.
 * - Medical Safety: Never repeats or asserts unsupported efficacy claims.
 * - Strict Schema: Validates structured output via Zod.
 * - Safe Fallback: Operates 100% deterministically when AI is unavailable or disabled.
 * - Usage Tracking: Records usage metadata in UsageLedger.
 */

import prisma from '@leadmate/db';
import {
  aiProductAnalysisSchema,
  type AnalyzeProductInput,
  type AiProductAnalysisResult,
  GEMINI_DEFAULT_MODEL
} from '@leadmate/shared';
import {
  GeminiProvider,
  GEMINI_PROVIDER_KEY,
  defaultAiRegistry
} from '@leadmate/ai';
import { aiSettingsService } from './ai-settings.service.js';
import { BadRequestError } from '../lib/errors.js';

export interface ProductAnalysisRequestContext {
  organizationId: string;
  userId: string;
  correlationId?: string;
}

export class AiProductAnalysisService {
  private geminiProvider: GeminiProvider;

  constructor() {
    this.geminiProvider =
      (defaultAiRegistry.get(GEMINI_PROVIDER_KEY) as GeminiProvider) ??
      new GeminiProvider();
  }

  /**
   * Resolves the AI Provider dynamically from the centralized registry.
   */
  private getProvider(): GeminiProvider {
    return (
      this.geminiProvider ??
      (defaultAiRegistry.get(GEMINI_PROVIDER_KEY) as GeminiProvider) ??
      new GeminiProvider()
    );
  }

  /**
   * Analyzes a product to determine its commercial category and likely buyer categories.
   */
  async analyzeProductForBuyerDiscovery(
    input: AnalyzeProductInput,
    context: ProductAnalysisRequestContext
  ): Promise<AiProductAnalysisResult> {
    const trimmedName = input.productName.trim();
    const trimmedDesc = input.productDescription.trim();

    if (!trimmedName || !trimmedDesc) {
      throw new BadRequestError('Product name and product description are required');
    }

    const aiContext = await aiSettingsService.getActiveAiContext(
      context.organizationId,
      GEMINI_PROVIDER_KEY
    );

    if (!aiContext.isEnabled || !aiContext.apiKey) {
      return this.generateFallbackAnalysis(input);
    }

    const selectedModel = aiContext.model || GEMINI_DEFAULT_MODEL;

    const prompt = `
You are LeadAtlas AI, an expert commercial B2B product classifier and wholesale distribution analyst specialized in Bangladesh and South Asian retail/wholesale markets.

Analyze the seller's product to determine:
1. Concise commercial product category (e.g. "Healthcare / Diabetes Care", "Kitchenware & Small Appliances", "Consumer Electronics").
2. 1-2 sentence commercial summary of the product value proposition.
3. 3 to 6 commercial business types (retailers, wholesalers, distributors, institutional buyers) that commercially purchase, stock, or distribute this product in "${input.targetMarket || 'Bangladesh'}".
4. Specific commercial search terms (English business category keywords) suitable for searching OpenStreetMap and Google Places to discover authentic businesses (e.g. "Pharmacy", "Kitchenware Store", "Electronics Shop").

PRODUCT NAME: "${trimmedName}"
PRODUCT DESCRIPTION: "${trimmedDesc}"
SELLER CATEGORY HINT: "${input.category || 'Not specified'}"
SALES GOAL: "${input.goal || 'WHOLESALE'}"
BUYER TYPE PREFERENCE: "${input.buyerType || 'AI_DECIDE'}"
TARGET MARKET: "${input.targetMarket || 'Bangladesh'}"

STRICT INVARIANTS:
1. Return ONLY commercial business types (e.g. "Pharmacy", "Medicine Shop", "Medical Distributor", "Kitchenware Store", "Gadget Shop", "Wholesale Grocery").
2. ZERO FABRICATION: NEVER invent company names, individual person names, phone numbers, emails, WhatsApp contacts, purchase orders, or RFQs.
3. MEDICAL SAFETY: If the product is a healthcare, medicine, diabetes, pharmaceutical, or nutritional product (such as blood glucose monitors, insulin aids, diagnostic strips, or supplements), classify ONLY authentic commercial trade channels (e.g. "Pharmacy", "Medicine Shop", "Medical Equipment Distributor", "Hospital Pharmacy", "Health Supplement Store"). NEVER validate or assert medical claims as facts (never assert "cures diabetes", "clinically proven", or "guaranteed results"). Focus exclusively on who sells or distributes such items.
4. Output MUST conform strictly to this JSON format:
{
  "productCategory": "Category Name",
  "productSummary": "1-2 sentence product summary",
  "buyerTargets": [
    {
      "category": "Buyer Category Name",
      "reason": "1-2 sentence explanation of why this business type buys/distributes it",
      "confidence": "HIGH"
    }
  ],
  "searchTerms": [
    "Search Term 1",
    "Search Term 2"
  ]
}
`.trim();

    const startTime = Date.now();
    try {
      const provider = this.getProvider();
      const result = await provider.generateStructured(
        prompt,
        aiProductAnalysisSchema,
        {
          apiKey: aiContext.apiKey,
          model: selectedModel,
          systemInstruction:
            'You are LeadAtlas AI, an expert commercial B2B product classifier and wholesale distribution analyst. You only output valid JSON conforming strictly to the requested schema. You never invent private contact data or validate medical efficacy claims.',
          temperature: 0.2
        }
      );

      const latencyMs = Date.now() - startTime;
      const modelUsed = result.model || selectedModel;
      await this.recordUsage(context, {
        promptTokens: result.usage?.inputTokens || Math.ceil(prompt.length / 4),
        completionTokens: result.usage?.outputTokens || 200,
        latencyMs,
        success: true,
        model: modelUsed
      });

      return {
        ...result.data,
        buyerTargets: result.data.buyerTargets.map((b) => ({
          category: b.category,
          reason: b.reason,
          confidence: (b.confidence || 'HIGH') as 'HIGH' | 'MEDIUM' | 'LOW'
        }))
      };
    } catch (err: any) {
      console.warn('AI product analysis call failed or malformed, falling back to deterministic heuristic:', err?.message || err);
      const latencyMs = Date.now() - startTime;
      await this.recordUsage(context, {
        promptTokens: Math.ceil(prompt.length / 4),
        completionTokens: 0,
        latencyMs,
        success: false,
        errorMessage: err?.message || 'AI generation failed',
        model: selectedModel
      });
      return this.generateFallbackAnalysis(input);
    }
  }

  /**
   * Deterministic heuristic analysis when AI is disabled, unconfigured, or fails safely.
   */
  generateFallbackAnalysis(input: AnalyzeProductInput): AiProductAnalysisResult {
    const text = `${input.productName} ${input.productDescription} ${input.category || ''}`.toLowerCase();

    // 1. Diabetes care detection (evidence-based from product text, never hardcoding brand names)
    if (text.includes('diabet')) {
      return {
        productCategory: 'Healthcare / Diabetes Care',
        productSummary: `Commercial diabetes-care product (${input.productName}) suitable for pharmaceutical retail and medical distribution.`,
        buyerTargets: [
          {
            category: 'Pharmacy',
            reason: 'Primary retail dispensary for diabetes care supplies and OTC healthcare products.',
            confidence: 'HIGH'
          },
          {
            category: 'Medicine Shop',
            reason: 'Community pharmaceutical retailer providing daily healthcare and diagnostic supplies.',
            confidence: 'HIGH'
          },
          {
            category: 'Medical Distributor',
            reason: 'Wholesale distributor supplying community pharmacies, clinics, and medical outlets.',
            confidence: 'HIGH'
          },
          {
            category: 'Hospital Pharmacy',
            reason: 'Institutional healthcare pharmacy sourcing specialized wellness and patient care lines.',
            confidence: 'HIGH'
          },
          {
            category: 'Health Supplement Store',
            reason: 'Wellness and health product store stocking diabetic nutrition and self-care items.',
            confidence: 'MEDIUM'
          }
        ],
        searchTerms: [
          'Pharmacy',
          'Medicine Shop',
          'Medical Distributor',
          'Hospital Pharmacy',
          'Health Supplement Store'
        ]
      };
    }

    // 2. General Healthcare / Medical / Pharmaceutical detection
    if (
      text.includes('health') ||
      text.includes('medic') ||
      text.includes('pharma') ||
      text.includes('care') ||
      text.includes('clinic') ||
      text.includes('supplement')
    ) {
      return {
        productCategory: 'Healthcare / Medical Supplies',
        productSummary: `Commercial healthcare product (${input.productName}) suitable for pharmaceutical retail and distribution.`,
        buyerTargets: [
          {
            category: 'Pharmacy',
            reason: 'Primary retail point for health, wellness, and medical products.',
            confidence: 'HIGH'
          },
          {
            category: 'Medicine Shop',
            reason: 'Local neighborhood dispensary and retail pharmaceutical supplier.',
            confidence: 'HIGH'
          },
          {
            category: 'Medical Distributor',
            reason: 'Wholesale distributor supplying community pharmacies and clinics.',
            confidence: 'HIGH'
          },
          {
            category: 'Hospital Pharmacy',
            reason: 'Institutional healthcare pharmacy sourcing patient wellness products.',
            confidence: 'MEDIUM'
          },
          {
            category: 'Health Supplement Store',
            reason: 'Specialized wellness retailer stocking nutrition and healthcare lines.',
            confidence: 'MEDIUM'
          }
        ],
        searchTerms: [
          'Pharmacy',
          'Medicine Shop',
          'Medical Distributor',
          'Hospital Pharmacy',
          'Health Supplement Store'
        ]
      };
    }

    // Kitchenware / Appliances / Gadgets detection (e.g. Mini Blender)
    if (
      text.includes('blender') ||
      text.includes('kitchen') ||
      text.includes('gadget') ||
      text.includes('appliance') ||
      text.includes('home') ||
      text.includes('usb')
    ) {
      return {
        productCategory: 'Kitchenware & Small Appliances',
        productSummary: `Portable lifestyle and home appliance product (${input.productName}) suitable for consumer retail.`,
        buyerTargets: [
          {
            category: 'Kitchenware Store',
            reason: 'Specialty retailer selling cookware, food prep gadgets, and kitchen tools.',
            confidence: 'HIGH'
          },
          {
            category: 'Gadget Store',
            reason: 'Electronics and lifestyle gadget shop stocking smart home tools.',
            confidence: 'HIGH'
          },
          {
            category: 'Lifestyle Store',
            reason: 'Department and lifestyle store retailing modern consumer conveniences.',
            confidence: 'HIGH'
          },
          {
            category: 'Home Appliance Store',
            reason: 'Retailer dedicated to household appliances and portable kitchen electrics.',
            confidence: 'HIGH'
          },
          {
            category: 'E-commerce Seller',
            reason: 'Online merchant retailing trending lifestyle and kitchenware products.',
            confidence: 'MEDIUM'
          }
        ],
        searchTerms: [
          'Kitchenware Store',
          'Gadget Store',
          'Lifestyle Store',
          'Home Appliance Store',
          'Electronics Shop'
        ]
      };
    }

    // Electronics / Tech detection
    if (
      text.includes('phone') ||
      text.includes('electronic') ||
      text.includes('computer') ||
      text.includes('cable') ||
      text.includes('charger') ||
      text.includes('smart')
    ) {
      return {
        productCategory: 'Consumer Electronics & Gadgets',
        productSummary: `Consumer electronics product (${input.productName}) suitable for technology retail.`,
        buyerTargets: [
          {
            category: 'Electronics Retailer',
            reason: 'Retail outlet selling consumer electronics and device accessories.',
            confidence: 'HIGH'
          },
          {
            category: 'Mobile Accessories Shop',
            reason: 'Specialty shop retailing personal tech accessories and gadgets.',
            confidence: 'HIGH'
          },
          {
            category: 'Computer & Tech Shop',
            reason: 'Hardware retailer distributing peripherals and gadgets.',
            confidence: 'MEDIUM'
          },
          {
            category: 'Electronics Wholesaler',
            reason: 'Wholesale distributor supplying local gadget and repair shops.',
            confidence: 'HIGH'
          }
        ],
        searchTerms: [
          'Electronics Retailer',
          'Mobile Accessories Shop',
          'Computer Shop',
          'Electronics Wholesaler'
        ]
      };
    }

    // Default general commercial trade fallback
    const categoryName = input.category || 'General Merchandise';
    return {
      productCategory: categoryName,
      productSummary: `Commercial product (${input.productName}) for wholesale and retail distribution.`,
      buyerTargets: [
        {
          category: 'Retail Store',
          reason: 'General retail channel selling consumer products in the local market.',
          confidence: 'HIGH'
        },
        {
          category: 'Wholesale Distributor',
          reason: 'Bulk distributor supplying regional merchants and retailers.',
          confidence: 'HIGH'
        },
        {
          category: 'Department Store',
          reason: 'Multi-category commercial store selling lifestyle and consumer goods.',
          confidence: 'MEDIUM'
        },
        {
          category: 'Supermarket',
          reason: 'Large-format grocery and general merchandise retailer.',
          confidence: 'MEDIUM'
        }
      ],
      searchTerms: [
        'Retail Store',
        'Wholesale Distributor',
        'Department Store',
        'Supermarket'
      ]
    };
  }

  private async recordUsage(
    context: ProductAnalysisRequestContext,
    meta: {
      promptTokens: number;
      completionTokens: number;
      latencyMs: number;
      success: boolean;
      errorMessage?: string;
      model?: string;
    }
  ): Promise<void> {
    try {
      const modelToRecord = meta.model || GEMINI_DEFAULT_MODEL;
      await prisma.usageLedger.create({
        data: {
          organizationId: context.organizationId,
          provider: `gemini:${modelToRecord}`,
          operation: 'ai.product_analysis',
          units: Math.max(meta.promptTokens + meta.completionTokens, 1),
          unitType: 'TOKENS',
          costAmountMinor: 0,
          currency: 'BDT',
          isEstimate: false
        }
      });
    } catch {
      // Usage logging is non-blocking
    }
  }
}

export const aiProductAnalysisService = new AiProductAnalysisService();
