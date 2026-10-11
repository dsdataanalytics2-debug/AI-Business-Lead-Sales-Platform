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
1. Return ONLY commercial business categories (e.g. "Electronics Retailer", "Mobile Accessories Shop", "Pharmacy", "Medicine Shop", "Medical Distributor").
2. NEVER invent private personal names, individual consumers, phone numbers, emails, or WhatsApp contacts.
3. For each category, provide a concise, factual reason (1-2 sentences) explaining why this business type distributes or purchases this product.
4. MEDICAL SAFETY: If the product is a healthcare, medicine, supplement, or disease-management product (such as Diamum, diabetes care, insulin, pharmaceuticals, or health supplements), classify ONLY commercial trade and retail channel categories (e.g. "Pharmacy", "Medicine Shop", "Medical Distributor", "Health Supplement Store", "Diabetes Care Center"). NEVER validate, infer, or assert medical efficacy claims as facts (never assert "cures diabetes", "clinically proven", or "safe for everyone"). Focus strictly on commercial buyer types.
5. Output MUST conform strictly to this JSON format:
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
            'You are LeadAtlas AI, a commercial trade assistant. You only output valid JSON conforming to the requested schema. You never invent private contact data or validate medical efficacy claims.',
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
   * Deterministic commercial fallback when Gemini is unconfigured or offline.
   * Strictly commercial classification — zero medical claims.
   */
  public generateFallbackBuyerTargets(product: string, buyerType?: string): BuyerTargetsResponse {
    const lower = product.toLowerCase();
    const targets: Array<{ category: string; reason: string }> = [];

    if (
      lower.includes('diamum') ||
      lower.includes('diabet') ||
      lower.includes('medic') ||
      lower.includes('pharma') ||
      lower.includes('health') ||
      lower.includes('supplement') ||
      lower.includes('insulin')
    ) {
      targets.push(
        { category: 'Pharmacy', reason: 'Authoritative retail distribution channel for healthcare, medicine, and diabetes care supplies.' },
        { category: 'Medicine Shop', reason: 'Local retail point of sale for consumer health, medical, and pharmaceutical supplies.' },
        { category: 'Medical Distributor', reason: 'Wholesale distributor supplying hospitals, diagnostic centers, and regional pharmacies.' },
        { category: 'Health Supplement Store', reason: 'Retail shop specializing in wellness, nutrition, and daily health care products.' },
        { category: 'Diabetes Care Center', reason: 'Specialized clinical and support facility recommending diabetes monitoring and care products.' }
      );
    } else if (
      lower.includes('watch') ||
      lower.includes('phone') ||
      lower.includes('power') ||
      lower.includes('electronic') ||
      lower.includes('gadget') ||
      lower.includes('fan')
    ) {
      targets.push(
        { category: 'Electronics Retailer', reason: 'High retail consumer demand for gadgets and electronic hardware.' },
        { category: 'Gadget Store', reason: 'Specialized in consumer technology and smart products.' },
        { category: 'Mobile Accessories Shop', reason: 'Direct consumer point of sale for portable devices and accessories.' },
        { category: 'E-commerce Retailer', reason: 'Multi-channel distributors servicing online marketplace shoppers.' }
      );
    } else if (
      lower.includes('mop') ||
      lower.includes('clean') ||
      lower.includes('household')
    ) {
      targets.push(
        { category: 'Homeware Store', reason: 'Retail store selling home utilities and cleaning appliances.' },
        { category: 'Cleaning Supply Store', reason: 'Specialized merchant stocking residential and commercial cleaning supplies.' },
        { category: 'Supermarket', reason: 'High-footfall departmental store with dedicated household cleaning section.' },
        { category: 'E-commerce Retailer', reason: 'Digital commerce vendor distributing home improvement goods.' }
      );
    } else if (
      lower.includes('bottle') ||
      lower.includes('kitchen') ||
      lower.includes('life') ||
      lower.includes('sport')
    ) {
      targets.push(
        { category: 'Kitchenware Store', reason: 'Retail point of sale for consumer dining and beverage storage hardware.' },
        { category: 'Lifestyle Store', reason: 'Retail outlet stocking personal accessories and everyday lifestyle products.' },
        { category: 'Sports Store', reason: 'Retail outlet catering to fitness, hydration, and outdoor activity gear.' },
        { category: 'Retail Store', reason: 'General departmental store distributing consumer retail merchandise.' }
      );
    } else if (
      lower.includes('software') ||
      lower.includes('saas') ||
      lower.includes('tech') ||
      lower.includes('app')
    ) {
      targets.push(
        { category: 'Corporate Office', reason: 'Commercial business entity with institutional software and operational requirements.' },
        { category: 'IT Services', reason: 'Technology firm and solutions provider adopting digital workflow tools.' },
        { category: 'Business Consultancy', reason: 'Professional services firm procuring business software.' },
        { category: 'Commercial Enterprise', reason: 'Mid-market business adopting automation and management solutions.' }
      );
    } else if (
      lower.includes('dent')
    ) {
      targets.push(
        { category: 'Dental Clinic', reason: 'Specialized oral healthcare provider with direct clinical equipment and consumables requirement.' },
        { category: 'Dentist', reason: 'Healthcare practitioner offering professional clinical services.' },
        { category: 'Healthcare Center', reason: 'Integrated medical facility providing dental and primary health care.' },
        { category: 'Medical Distributor', reason: 'Regional distributor supplying specialized dental supplies.' }
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
