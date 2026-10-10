/**
 * @leadmate/ai
 *
 * Centralized, provider-neutral AI layer for LeadAtlas.
 * LLM orchestration, buyer target discovery, fit explanations, and sales drafts.
 */

export const AI_PACKAGE_NAME = '@leadmate/ai';

export * from './types.js';
export * from './errors.js';
export * from './providers/gemini-provider.js';
export * from './providers/mock-ai-provider.js';
export * from './registry.js';
export * from './sales-assistant/index.js';
