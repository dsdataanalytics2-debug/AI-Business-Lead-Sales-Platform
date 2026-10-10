/**
 * AI Buyer Discovery Service
 *
 * Implements AI-powered commercial buyer category suggestions,
 * query expansion, and buyer fit explanation using centralized AI providers.
 *
 * INVARIANTS:
 * - AI is an enhancement, NEVER replaces real OpenStreetMap or Google Places searches.
 * - AI suggestions determine WHO to search for (business categories). Real businesses
 *   are discovered via authentic datasource providers.
 * - ZERO fabrication: AI never invents phone, email, WhatsApp, RFQs, or verified purchase intent.
 * - Usage tracking: External AI calls record safe metadata in UsageLedger.
 * - Clean fallback: System remains 100% operational when AI is unconfigured or unavailable.
 */

import prisma from '@leadmate/db';
import {
  buyerTargetsResponseSchema,
  buyerFitResponseSchema,
  type SuggestBuyerTargetsRequest,
  type BuyerTargetsResponse,
  type ExplainBuyerFitRequest,
  type BuyerFitResponse,
  GEMINI_DEFAULT_MODEL
} from '@leadmate/shared';
import {
  GeminiProvider,
  GEMINI_PROVIDER_KEY,
  defaultAiRegistry,
  AIProvider
} from '@leadmate/ai';
import { aiSettingsService } from './ai-settings.service.js';
import { BadRequestError } from '../lib/errors.js';

export interface BuyerDiscoveryRequestContext {
  organizationId: string;
  userId: string;
  correlationId?: string;
}

export class AiBuyerDiscoveryService {
  private readonly geminiProvider: GeminiProvider;

  constructor() {
    this.geminiProvider =
      (defaultAiRegistry.get(GEMINI_PROVIDER_KEY) as GeminiProvider) ??
      new GeminiProvider();
  }

  /**
   * Suggests commercial buyer categories (business types) for a given product or service.
   */
  async suggestBuyerTargets(
    input: SuggestBuyerTargetsRequest,
    context: BuyerDiscoveryRequestContext
  ): Promise<BuyerTargetsResponse> {
    const trimmedProduct = input.product.trim();
    if (!trimmedProduct) {
      throw new BadRequestError('Product or service description is required');
    }

    const aiContext = await aiSettingsService.getActiveAiContext(
      context.organizationId,
      GEMINI_PROVIDER_KEY
    );

    if (!aiContext.isEnabled || !aiContext.apiKey) {
      // Return clean heuristic fallback when AI is not configured/enabled
      return this.generateFallbackBuyerTargets(trimmedProduct, input.buyerType);
    }

    const prompt = `
You are LeadAtlas AI, an expert commercial B2B buyer discovery assistant specialized in commercial trade, retail channels, and wholesale distribution in Bangladesh and regional markets.

Given the seller's product/service, determine 4 to 8 commercial buyer business types (retailers, wholesalers, distributors, clinics, corporate offices, e-commerce stores) that routinely buy, stock, or distribute this product.

PRODUCT / SERVICE: "${trimmedProduct}"
BUYER TYPE PREFERENCE: "${input.buyerType || 'Any Buyer'}"
TARGET MARKET / LOCATION: "${input.location || 'Bangladesh'}"

STRICT INVARIANTS:
1. Return ONLY commercial business categories (e.g. "Electronics Retailer", "Mobile Accessories Shop", "Pharmacy", "Medical Distributor").
2. NEVER invent private personal names, individual consumers, phone numbers, emails, or WhatsApp contacts.
3. For each category, provide a concise, factual reason (1-2 sentences) explaining why this business type distributes or purchases this product.
4. Output MUST conform strictly to this JSON format:
{
  "product": "${trimmedProduct}",
  "buyerTargets": [
    { "category": "Category Name", "reason": "1-2 sentence explanation" }
  ]
}
`.trim();

    try {
      const result = await this.geminiProvider.generateStructured(
        prompt,
        buyerTargetsResponseSchema,
        {
          apiKey: aiContext.apiKey,
          model: aiContext.model || GEMINI_DEFAULT_MODEL,
          systemInstruction:
            'You are LeadAtlas AI, a commercial trade assistant. You only output valid JSON conforming to the requested schema. You never invent private contact data.',
          temperature: 0.2
        }
      );

      // Record safe usage ledger entry (no prompt text, no PII)
      const totalTokens = (result.usage?.inputTokens || 0) + (result.usage?.outputTokens || 0);
      await this.recordUsage(context.organizationId, 'ai.buyer_targets', totalTokens, result.model);

      return result.data;
    } catch {
      // Fallback gracefully on AI timeout, network error, or schema issue
      return this.generateFallbackBuyerTargets(trimmedProduct, input.buyerType);
    }
  }

  /**
   * Explains commercial buyer fit for a discovered public business listing.
   */
  async explainBuyerFit(
    input: ExplainBuyerFitRequest,
    context: BuyerDiscoveryRequestContext
  ): Promise<BuyerFitResponse> {
    const aiContext = await aiSettingsService.getActiveAiContext(
      context.organizationId,
      GEMINI_PROVIDER_KEY
    );

    if (!aiContext.isEnabled || !aiContext.apiKey) {
      return {
        fitLevel: 'MEDIUM',
        explanation: `Business listed under category "${input.category}". Configure AI in Settings to get automated commercial fit reasoning.`,
        disclaimer:
          'AI Buyer Fit is an automated explanation based on public business categorization, not verified purchase intent.'
      };
    }

    const prompt = `
You are LeadAtlas AI. Analyze the commercial fit between the seller's product and a public business listing discovered from public directories.

SELLER PRODUCT: "${input.product.trim()}"
BUSINESS NAME: "${input.businessName.trim()}"
BUSINESS CATEGORY: "${input.category.trim()}"
PUBLIC DESCRIPTION / SNIPPET: "${(input.description || 'N/A').trim()}"
LOCATION: "${(input.location || 'N/A').trim()}"

STRICT RULES:
1. Assess fit level as "HIGH", "MEDIUM", or "LOW".
2. Write a 1-2 sentence concise commercial explanation of why this business category would or would not stock or buy this product.
3. NEVER claim verified purchase intent, RFQ commitments, or active buying orders.
4. NEVER invent phone, email, or WhatsApp data.
5. Output MUST conform strictly to this JSON format:
{
  "fitLevel": "HIGH",
  "explanation": "Concise commercial reason",
  "disclaimer": "AI Buyer Fit is an automated explanation based on public business categorization, not verified purchase intent."
}
`.trim();

    try {
      const result = await this.geminiProvider.generateStructured(prompt, buyerFitResponseSchema, {
        apiKey: aiContext.apiKey,
        model: aiContext.model || GEMINI_DEFAULT_MODEL,
        systemInstruction:
          'You are LeadAtlas AI. Output valid JSON only. Never invent verified buying intent or contacts.',
        temperature: 0.1
      });

      const totalTokens = (result.usage?.inputTokens || 0) + (result.usage?.outputTokens || 0);
      await this.recordUsage(context.organizationId, 'ai.buyer_fit', totalTokens, result.model);

      return {
        fitLevel: result.data.fitLevel,
        explanation: result.data.explanation,
        disclaimer:
          result.data.disclaimer ||
          'AI Buyer Fit is an automated explanation based on public business categorization, not verified purchase intent.'
      };
    } catch {
      return {
        fitLevel: 'MEDIUM',
        explanation: `Public business categorization ("${input.category}") matches commercial trade channels for ${input.product}.`,
        disclaimer:
          'AI Buyer Fit is an automated explanation based on public business categorization, not verified purchase intent.'
      };
    }
  }

  /**
   * Deterministic fallback when Gemini is unconfigured or offline.
   */
  private generateFallbackBuyerTargets(product: string, buyerType?: string): BuyerTargetsResponse {
    const lower = product.toLowerCase();
    const targets: Array<{ category: string; reason: string }> = [];

    if (lower.includes('watch') || lower.includes('phone') || lower.includes('power') || lower.includes('electronic') || lower.includes('fan')) {
      targets.push(
        { category: 'Electronics Retailer', reason: 'High retail consumer demand for gadgets and electronic hardware.' },
        { category: 'Mobile Accessories Shop', reason: 'Direct consumer point of sale for portable devices and accessories.' },
        { category: 'Gadget Store', reason: 'Specialized in consumer technology and smart products.' },
        { category: 'E-commerce Seller', reason: 'Multi-channel distributors servicing online marketplace shoppers.' }
      );
    } else if (lower.includes('diabet') || lower.includes('medic') || lower.includes('health') || lower.includes('pharma')) {
      targets.push(
        { category: 'Pharmacy', reason: 'Authoritative retail distribution for health, medical, and diagnostics products.' },
        { category: 'Medical Equipment Supplier', reason: 'Wholesale and B2B distributor supplying clinics and diagnostic centers.' },
        { category: 'Diagnostic Center', reason: 'Direct clinical usage and institutional requirement.' },
        { category: 'Healthcare Distributor', reason: 'Regional supply chain servicing local chemists and drugstores.' }
      );
    } else {
      targets.push(
        { category: 'Retail Store', reason: 'Direct consumer distribution point in target market.' },
        { category: 'Wholesale Distributor', reason: 'B2B supply channel servicing regional shops.' },
        { category: 'Corporate Buyer', reason: 'Commercial entity with institutional procurement requirements.' },
        { category: 'E-commerce Seller', reason: 'Digital commerce vendor selling consumer products.' }
      );
    }

    if (buyerType && buyerType !== 'ANY') {
      const typeLabel = buyerType.replace(/_/g, ' ').toLowerCase();
      targets.unshift({
        category: `${product} ${typeLabel.replace(/\b\w/g, (c) => c.toUpperCase())}`,
        reason: `Filtered matching your explicit "${buyerType}" buyer type criteria.`
      });
    }

    return {
      product,
      buyerTargets: targets.slice(0, 6)
    };
  }

  private async recordUsage(
    organizationId: string,
    operation: string,
    tokens: number,
    model: string
  ): Promise<void> {
    try {
      await prisma.usageLedger.create({
        data: {
          organizationId,
          provider: `gemini:${model}`,
          operation,
          units: Math.max(tokens, 1),
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

export const aiBuyerDiscoveryService = new AiBuyerDiscoveryService();
