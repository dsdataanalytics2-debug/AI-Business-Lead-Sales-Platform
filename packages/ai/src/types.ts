/**
 * Provider-Neutral AI Layer Contracts & Types
 */

import { z } from 'zod';

export interface AIGenerateOptions {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
  signal?: AbortSignal;
  apiKey?: string;
}

export interface AIGenerateResult {
  text: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

export type AIConnectionStatus =
  | 'CONNECTED'
  | 'INVALID_API_KEY'
  | 'QUOTA_EXCEEDED'
  | 'MODEL_NOT_AVAILABLE'
  | 'NETWORK_ERROR';

export interface AIConnectionTestResult {
  connected: boolean;
  status: AIConnectionStatus;
  message: string;
  model: string;
}

export interface AIProviderMetadata {
  key: string;
  displayName: string;
  description: string;
  defaultModel: string;
  supportedModels: string[];
}

export interface AIProvider {
  readonly name: string;
  generateText(prompt: string, options?: AIGenerateOptions): Promise<AIGenerateResult>;
  generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: AIGenerateOptions
  ): Promise<{ data: T; usage?: { inputTokens?: number; outputTokens?: number }; model: string }>;
  testConnection(apiKey?: string, model?: string): Promise<AIConnectionTestResult>;
  getMetadata(): AIProviderMetadata;
}
