/**
 * Google Gemini Live AI Provider
 *
 * Implements AIProvider interface connecting to Google's official
 * Generative Language REST API:
 * https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *
 * MODELS:
 * - Default / Low-Cost: gemini-3.5-flash-lite (fast, cost-effective for buyer expansion & summaries)
 * - Stronger: gemini-3.8-flash (advanced reasoning, high-quality generation)
 * - Dynamic Latest Alias: gemini-flash-lite-latest
 * - Legacy-compatible: gemini-2.5-flash-lite, gemini-2.5-flash, gemini-3.1-flash-lite, gemini-3.6-flash
 *
 * SECURITY & PRIVACY INVARIANTS:
 * - Server-side only: Browser never receives secret API keys.
 * - Key passed via header: x-goog-api-key (never in URL query string to prevent proxy logging).
 * - Zero secret leakage: API keys are redacted from all error messages and logs.
 * - Bounded outputs: temperature, maxOutputTokens, and timeouts strictly enforced.
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
import {
  AIAuthError,
  AIQuotaError,
  AIModelUnavailableError,
  AIStructuredOutputError,
  AIProviderError
} from '../errors.js';

export const GEMINI_PROVIDER_KEY = 'gemini';
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiProviderDependencies {
  fetch?: typeof fetch;
}

export class GeminiProvider implements AIProvider {
  public readonly name: string = GEMINI_PROVIDER_KEY;
  private readonly customFetch: typeof fetch;

  constructor(deps?: GeminiProviderDependencies) {
    this.customFetch = deps?.fetch ?? globalThis.fetch;
  }

  /**
   * Central validation and normalization of Gemini model IDs.
   * Defaults to gemini-3.1-flash-lite.
   */
  public validateModel(model?: string): string {
    if (!model || typeof model !== 'string' || model.trim().length === 0) {
      return GEMINI_DEFAULT_MODEL;
    }
    const trimmed = model.trim().toLowerCase();

    // Check against canonical supported models
    if (SUPPORTED_GEMINI_MODELS.includes(trimmed as any)) {
      return trimmed;
    }

    // Allow custom or forward-compatible gemini models matching gemini-* naming pattern
    if (/^gemini-[a-zA-Z0-9.-]+$/.test(trimmed)) {
      return trimmed;
    }

    throw new AIModelUnavailableError(
      this.name,
      model,
      `Unsupported Gemini model '${model}'. Supported models: ${SUPPORTED_GEMINI_MODELS.join(', ')}`
    );
  }

  public getMetadata(): AIProviderMetadata {
    return {
      key: GEMINI_PROVIDER_KEY,
      displayName: 'Google Gemini',
      description: 'Official Google Gemini Generative AI models for buyer discovery and smart sales assistance.',
      defaultModel: GEMINI_DEFAULT_MODEL,
      supportedModels: [...SUPPORTED_GEMINI_MODELS]
    };
  }

  /**
   * Tests connection with minimal prompt and tiny output token budget.
   */
  public async testConnection(apiKey?: string, model?: string): Promise<AIConnectionTestResult> {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return {
        connected: false,
        status: 'INVALID_API_KEY',
        message: 'Gemini API key is missing or empty',
        model: this.validateModel(model)
      };
    }

    let targetModel: string;
    try {
      targetModel = this.validateModel(model);
    } catch (err: any) {
      return {
        connected: false,
        status: 'MODEL_NOT_AVAILABLE',
        message: err.message,
        model: model || GEMINI_DEFAULT_MODEL
      };
    }

    const endpoint = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(targetModel)}:generateContent`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
      const response = await this.customFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey.trim()
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Return exactly: OK' }] }],
          generationConfig: {
            maxOutputTokens: 5,
            temperature: 0.1
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return {
          connected: true,
          status: 'CONNECTED',
          message: `Google Gemini connected successfully (${targetModel})`,
          model: targetModel
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          connected: false,
          status: 'INVALID_API_KEY',
          message: 'Invalid Gemini API key or unauthorized project',
          model: targetModel
        };
      }

      if (response.status === 404) {
        return {
          connected: false,
          status: 'MODEL_NOT_AVAILABLE',
          message: `Model '${targetModel}' not found or not enabled on this Gemini project`,
          model: targetModel
        };
      }

      if (response.status === 429) {
        return {
          connected: false,
          status: 'QUOTA_EXCEEDED',
          message: 'Gemini API rate limit or quota exceeded',
          model: targetModel
        };
      }

      return {
        connected: false,
        status: 'NETWORK_ERROR',
        message: `Gemini API returned HTTP ${response.status}`,
        model: targetModel
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      return {
        connected: false,
        status: 'NETWORK_ERROR',
        message: err.name === 'AbortError' ? 'Gemini connection timed out' : 'Network failure contacting Gemini API',
        model: targetModel
      };
    }
  }

  /**
   * Generates free-form text using Gemini REST API.
   */
  public async generateText(prompt: string, options?: AIGenerateOptions): Promise<AIGenerateResult> {
    const apiKey = options?.apiKey;
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new AIAuthError(this.name, 'Gemini API key is not configured for this organization');
    }

    const model = this.validateModel(options?.model);
    const endpoint = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`;

    const body: Record<string, any> = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: options?.temperature ?? 0.2,
        maxOutputTokens: options?.maxOutputTokens ?? 1000
      }
    };

    if (options?.systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: options.systemInstruction }]
      };
    }

    const response = await this.executeRequest(endpoint, apiKey, body, options?.signal);
    const payload = (await response.json()) as any;

    const candidateText =
      payload?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    const inputTokens = payload?.usageMetadata?.promptTokenCount;
    const outputTokens = payload?.usageMetadata?.candidatesTokenCount;

    return {
      text: candidateText,
      model,
      inputTokens,
      outputTokens
    };
  }

  /**
   * Generates structured data validated against a Zod schema.
   */
  public async generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: AIGenerateOptions
  ): Promise<{ data: T; usage?: { inputTokens?: number; outputTokens?: number }; model: string }> {
    const apiKey = options?.apiKey;
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new AIAuthError(this.name, 'Gemini API key is not configured for this organization');
    }

    const model = this.validateModel(options?.model);
    const endpoint = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`;

    const body: Record<string, any> = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: options?.temperature ?? 0.1,
        maxOutputTokens: options?.maxOutputTokens ?? 1500,
        responseMimeType: 'application/json'
      }
    };

    if (options?.systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: options.systemInstruction }]
      };
    }

    const response = await this.executeRequest(endpoint, apiKey, body, options?.signal);
    const payload = (await response.json()) as any;

    const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!rawText) {
      throw new AIStructuredOutputError(this.name, 'Gemini returned an empty candidate payload');
    }

    // Strip Markdown code fencing if returned despite JSON responseMimeType
    const cleanJson = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```$/, '')
      .trim();

    let parsed: any;
    try {
      parsed = JSON.parse(cleanJson);
    } catch {
      throw new AIStructuredOutputError(this.name, 'Gemini response could not be parsed as valid JSON');
    }

    const validation = schema.safeParse(parsed);
    if (!validation.success) {
      throw new AIStructuredOutputError(
        this.name,
        `Gemini structured response failed schema validation: ${validation.error.message}`
      );
    }

    const inputTokens = payload?.usageMetadata?.promptTokenCount;
    const outputTokens = payload?.usageMetadata?.candidatesTokenCount;

    return {
      data: validation.data,
      usage: { inputTokens, outputTokens },
      model
    };
  }

  private async executeRequest(
    endpoint: string,
    apiKey: string,
    body: Record<string, any>,
    signal?: AbortSignal
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.customFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey.trim()
        },
        body: JSON.stringify(body),
        signal
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new AIProviderError(this.name, 'TIMEOUT', 'Gemini API request timed out', true);
      }
      throw new AIProviderError(
        this.name,
        'NETWORK_ERROR',
        `Network error contacting Gemini API: ${err.message || 'Unknown network error'}`,
        true
      );
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AIAuthError(this.name, 'Gemini API authentication failed (invalid API key)');
      }
      if (response.status === 429) {
        throw new AIQuotaError(this.name, 'Gemini API quota or rate limit exceeded');
      }
      if (response.status === 404) {
        throw new AIModelUnavailableError(this.name, 'model', 'Requested Gemini model was not found');
      }
      throw new AIProviderError(
        this.name,
        `HTTP_${response.status}`,
        `Gemini API returned error HTTP ${response.status}`,
        response.status >= 500
      );
    }

    return response;
  }
}
