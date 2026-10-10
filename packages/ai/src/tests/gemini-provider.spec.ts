import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  GeminiProvider,
  GEMINI_PROVIDER_KEY,
  AIProviderRegistry,
  defaultAiRegistry,
  AIAuthError,
  AIQuotaError,
  AIModelUnavailableError,
  AIStructuredOutputError
} from '../index.js';

describe('GeminiProvider & Centralized AI Architecture', () => {
  it('1. Model Validation: Defaults to gemini-3.5-flash-lite and supports gemini-3.8-flash, gemini-flash-lite-latest, and legacy models', () => {
    const provider = new GeminiProvider();

    expect(provider.validateModel()).toBe('gemini-3.5-flash-lite');
    expect(provider.validateModel('gemini-3.5-flash-lite')).toBe('gemini-3.5-flash-lite');
    expect(provider.validateModel('gemini-3.8-flash')).toBe('gemini-3.8-flash');
    expect(provider.validateModel('gemini-flash-lite-latest')).toBe('gemini-flash-lite-latest');
    // Legacy models backward compatibility
    expect(provider.validateModel('gemini-2.5-flash-lite')).toBe('gemini-2.5-flash-lite');
    expect(provider.validateModel('gemini-2.5-flash')).toBe('gemini-2.5-flash');
    expect(provider.validateModel('gemini-3.1-flash-lite')).toBe('gemini-3.1-flash-lite');
    expect(provider.validateModel('gemini-3.6-flash')).toBe('gemini-3.6-flash');

    // Reject unknown or arbitrary non-gemini models
    expect(() => provider.validateModel('gpt-4o')).toThrow(AIModelUnavailableError);
  });

  it('2. Test Connection: Successfully reports CONNECTED on HTTP 200 without exposing secret key', async () => {
    const fakeKey = 'AIzaSyFakeKeyForTest12345';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'OK' }] } }]
      })
    });

    const provider = new GeminiProvider({ fetch: mockFetch });
    const result = await provider.testConnection(fakeKey, 'gemini-3.1-flash-lite');

    expect(result.connected).toBe(true);
    expect(result.status).toBe('CONNECTED');
    expect(result.message).toContain('gemini-3.1-flash-lite');
    expect(result.message).not.toContain(fakeKey);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('gemini-3.1-flash-lite'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-goog-api-key': fakeKey
        })
      })
    );
  });

  it('3. Test Connection: Maps HTTP 401/403 to INVALID_API_KEY and HTTP 429 to QUOTA_EXCEEDED', async () => {
    const mockFetch401 = vi.fn().mockResolvedValue({
      ok: false,
      status: 401
    });

    const provider1 = new GeminiProvider({ fetch: mockFetch401 });
    const res401 = await provider1.testConnection('bad_key');
    expect(res401.connected).toBe(false);
    expect(res401.status).toBe('INVALID_API_KEY');

    const mockFetch429 = vi.fn().mockResolvedValue({
      ok: false,
      status: 429
    });

    const provider2 = new GeminiProvider({ fetch: mockFetch429 });
    const res429 = await provider2.testConnection('valid_key');
    expect(res429.connected).toBe(false);
    expect(res429.status).toBe('QUOTA_EXCEEDED');
  });

  it('4. Structured Generation: Validates schema and extracts token counts', async () => {
    const fakeKey = 'AIzaSyFakeKey';
    const mockJson = {
      product: 'Smart Watch',
      buyerTargets: [
        { category: 'Electronics Retailer', reason: 'High retail consumer demand' }
      ]
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: `\`\`\`json\n${JSON.stringify(mockJson)}\n\`\`\`` }]
            }
          }
        ],
        usageMetadata: {
          promptTokenCount: 55,
          candidatesTokenCount: 42
        }
      })
    });

    const testSchema = z.object({
      product: z.string(),
      buyerTargets: z.array(z.object({ category: z.string(), reason: z.string() }))
    });

    const provider = new GeminiProvider({ fetch: mockFetch });
    const result = await provider.generateStructured('Suggest buyers', testSchema, {
      apiKey: fakeKey,
      model: 'gemini-3.1-flash-lite',
      systemInstruction: 'You are LeadAtlas AI'
    });

    expect(result.data.product).toBe('Smart Watch');
    expect(result.data.buyerTargets).toHaveLength(1);
    expect(result.usage?.inputTokens).toBe(55);
    expect(result.usage?.outputTokens).toBe(42);
    expect(result.model).toBe('gemini-3.1-flash-lite');
  });

  it('5. Structured Generation: Throws AIStructuredOutputError on schema mismatch or malformed JSON', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'NOT VALID JSON' }] } }]
      })
    });

    const testSchema = z.object({ value: z.string() });
    const provider = new GeminiProvider({ fetch: mockFetch });

    await expect(
      provider.generateStructured('Prompt', testSchema, { apiKey: 'key' })
    ).rejects.toThrow(AIStructuredOutputError);
  });

  it('6. Central AI Provider Registry: Manages provider metadata and resolution', () => {
    const registry = new AIProviderRegistry();

    expect(registry.has('gemini')).toBe(true);
    expect(registry.has('mock-ai')).toBe(true);
    expect(registry.has('openai')).toBe(false); // Metadata exists, but not active implementation

    const gemini = registry.get('gemini');
    expect(gemini?.name).toBe(GEMINI_PROVIDER_KEY);

    const meta = registry.getMetadata('gemini');
    expect(meta?.defaultModel).toBe('gemini-3.5-flash-lite');
    expect(meta?.supportedModels).toContain('gemini-3.5-flash-lite');
    expect(meta?.supportedModels).toContain('gemini-3.8-flash');
    expect(meta?.supportedModels).toContain('gemini-flash-lite-latest');
    expect(meta?.supportedModels).toContain('gemini-2.5-flash-lite');
    expect(meta?.supportedModels).toContain('gemini-2.5-flash');
    expect(meta?.supportedModels).toContain('gemini-3.1-flash-lite');
    expect(meta?.supportedModels).toContain('gemini-3.6-flash');

    const allMeta = registry.listMetadata();
    expect(allMeta.map((m) => m.key)).toEqual(
      expect.arrayContaining(['gemini', 'mock-ai', 'openai', 'deepseek', 'glm'])
    );
  });
});
