/**
 * Deterministic Mock AI Provider
 *
 * For unit tests, offline development, and zero-network test suite execution.
 * Guarantees zero external network requests and deterministic, schema-valid outputs.
 */

import { z } from 'zod';
import {
  GEMINI_DEFAULT_MODEL,
  GEMINI_STRONGER_MODEL,
  SUPPORTED_GEMINI_MODELS
} from '@leadmate/shared';
import type {
  AIProvider,
  AIGenerateOptions,
  AIGenerateResult,
  AIConnectionTestResult,
  AIProviderMetadata
} from '../types.js';

export const MOCK_AI_PROVIDER_KEY = 'mock-ai';

export class MockAIProvider implements AIProvider {
  public readonly name: string = MOCK_AI_PROVIDER_KEY;

  public getMetadata(): AIProviderMetadata {
    return {
      key: MOCK_AI_PROVIDER_KEY,
      displayName: 'Mock AI Provider',
      description: 'Deterministic local mock provider for offline development and testing.',
      defaultModel: GEMINI_DEFAULT_MODEL,
      supportedModels: [...SUPPORTED_GEMINI_MODELS]
    };
  }

  public async testConnection(apiKey?: string, model?: string): Promise<AIConnectionTestResult> {
    const targetModel = model || GEMINI_DEFAULT_MODEL;
    if (apiKey === 'invalid_key') {
      return {
        connected: false,
        status: 'INVALID_API_KEY',
        message: 'Invalid Gemini API key or unauthorized project',
        model: targetModel
      };
    }
    return {
      connected: true,
      status: 'CONNECTED',
      message: `Mock AI connected successfully (${targetModel})`,
      model: targetModel
    };
  }

  public async generateText(prompt: string, options?: AIGenerateOptions): Promise<AIGenerateResult> {
    const model = options?.model || GEMINI_DEFAULT_MODEL;
    return {
      text: `Mock AI response for prompt: ${prompt.slice(0, 50)}...`,
      model,
      inputTokens: 15,
      outputTokens: 25
    };
  }

  public async generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: AIGenerateOptions
  ): Promise<{ data: T; usage?: { inputTokens?: number; outputTokens?: number }; model: string }> {
    const model = options?.model || GEMINI_DEFAULT_MODEL;

    // Detect buyer targets request
    if (prompt.includes('buyerTargets') || prompt.includes('product')) {
      const mockBuyerTargets = {
        product: 'Sample Product',
        buyerTargets: [
          { category: 'Electronics Retailer', reason: 'High retail volume for smart accessories' },
          { category: 'Mobile Accessories Shop', reason: 'Direct consumer gadget shoppers' },
          { category: 'Gadget Store', reason: 'Consumer technology point of sale' },
          { category: 'E-commerce Seller', reason: 'Online marketplace distributor' }
        ]
      };
      return {
        data: schema.parse(mockBuyerTargets),
        usage: { inputTokens: 50, outputTokens: 80 },
        model
      };
    }

    // Detect buyer fit request
    if (prompt.includes('fitLevel') || prompt.includes('explanation')) {
      const mockFit = {
        fitLevel: 'HIGH',
        explanation: 'Business category and customer base align directly with the target product distribution channel.',
        disclaimer: 'AI Buyer Fit is an automated explanation based on public business categorization, not verified purchase intent.'
      };
      return {
        data: schema.parse(mockFit),
        usage: { inputTokens: 40, outputTokens: 60 },
        model
      };
    }

    // Default fallback structured generation
    const parsed = schema.parse({});
    return {
      data: parsed,
      usage: { inputTokens: 20, outputTokens: 30 },
      model
    };
  }
}
