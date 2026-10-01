/**
 * @leadmate/datasources
 *
 * Datasource provider abstractions, registries, deterministic mock provider,
 * and fixtures for LeadMate lead discovery.
 */

export const DATASOURCES_PACKAGE_NAME = '@leadmate/datasources';

export * from './types.js';
export * from './errors.js';
export * from './fixtures/mock-businesses.js';
export * from './providers/mock-provider.js';
export * from './registry.js';
