/**
 * Centralized AI Provider Registry
 *
 * Manages registered AI providers (Gemini, OpenAI, DeepSeek, GLM, Mock)
 * with provider lookup, metadata discovery, and extensibility.
 */

import { GEMINI_DEFAULT_MODEL, GEMINI_STRONGER_MODEL, SUPPORTED_GEMINI_MODELS } from '@leadmate/shared';
import type { AIProvider, AIProviderMetadata } from './types.js';
import { GeminiProvider, GEMINI_PROVIDER_KEY } from './providers/gemini-provider.js';
import { MockAIProvider, MOCK_AI_PROVIDER_KEY } from './providers/mock-ai-provider.js';

export const BUILTIN_AI_PROVIDER_METADATA: Record<string, AIProviderMetadata> = {
  gemini: {
    key: 'gemini',
    displayName: 'Google Gemini',
    description: 'Official Google Gemini models for buyer target discovery, category expansion, and fit explanation.',
    defaultModel: GEMINI_DEFAULT_MODEL,
    supportedModels: [...SUPPORTED_GEMINI_MODELS]
  },
  'mock-ai': {
    key: 'mock-ai',
    displayName: 'Mock AI Provider',
    description: 'Deterministic local AI provider for development, tests, and offline use.',
    defaultModel: GEMINI_DEFAULT_MODEL,
    supportedModels: [GEMINI_DEFAULT_MODEL, GEMINI_STRONGER_MODEL]
  },
  openai: {
    key: 'openai',
    displayName: 'OpenAI (GPT-4o)',
    description: 'OpenAI provider (available for future activation).',
    defaultModel: 'gpt-4o-mini',
    supportedModels: ['gpt-4o-mini', 'gpt-4o']
  },
  deepseek: {
    key: 'deepseek',
    displayName: 'DeepSeek',
    description: 'DeepSeek LLM provider (available for future activation).',
    defaultModel: 'deepseek-chat',
    supportedModels: ['deepseek-chat', 'deepseek-reasoner']
  },
  glm: {
    key: 'glm',
    displayName: 'GLM (General Language Model)',
    description: 'Zhipu GLM provider (available for future activation).',
    defaultModel: 'glm-4-flash',
    supportedModels: ['glm-4-flash', 'glm-4-plus']
  }
};

export class AIProviderRegistry {
  private readonly providers = new Map<string, AIProvider>();
  private readonly metadataMap = new Map<string, AIProviderMetadata>();

  constructor() {
    // Register metadata for all supported/planned providers
    for (const [key, meta] of Object.entries(BUILTIN_AI_PROVIDER_METADATA)) {
      this.metadataMap.set(key.toLowerCase(), meta);
    }

    // Register active provider implementations
    this.register(new GeminiProvider());
    this.register(new MockAIProvider());
  }

  private normalizeKey(name: string): string {
    return (name || '').trim().toLowerCase().replace(/_/g, '-');
  }

  public register(provider: AIProvider, metadata?: AIProviderMetadata): void {
    const key = this.normalizeKey(provider.name);
    this.providers.set(key, provider);
    if (metadata) {
      this.metadataMap.set(key, metadata);
    }
  }

  public has(name: string): boolean {
    if (!name || typeof name !== 'string') return false;
    return this.providers.has(this.normalizeKey(name));
  }

  public get(name: string): AIProvider | undefined {
    return this.providers.get(this.normalizeKey(name));
  }

  public getMetadata(name: string): AIProviderMetadata | undefined {
    return this.metadataMap.get(this.normalizeKey(name));
  }

  public listMetadata(): AIProviderMetadata[] {
    return Array.from(this.metadataMap.values());
  }

  public listRegisteredProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}

export const defaultAiRegistry = new AIProviderRegistry();

export function getAiProvider(name = 'gemini'): AIProvider {
  const provider = defaultAiRegistry.get(name);
  if (!provider) {
    throw new Error(`AI provider '${name}' is not registered or supported.`);
  }
  return provider;
}
