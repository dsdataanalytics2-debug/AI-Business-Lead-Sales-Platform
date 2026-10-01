/**
 * Datasource Provider Registry
 *
 * Manages registered datasource provider instances with safe lookup and error handling.
 */

import type { DataSourceProvider } from './types.js';
import { UnknownProviderError } from './errors.js';
import { MockDataSourceProvider } from './providers/mock-provider.js';

export class DataSourceRegistry {
  private readonly providers = new Map<string, DataSourceProvider>();

  constructor() {
    // Automatically register the default built-in Mock provider
    this.register(new MockDataSourceProvider());
  }

  /**
   * Registers a datasource provider.
   */
  public register(provider: DataSourceProvider): void {
    const key = provider.name.toUpperCase().trim();
    this.providers.set(key, provider);
  }

  /**
   * Checks if a provider is registered.
   */
  public has(name: string): boolean {
    if (!name || typeof name !== 'string') return false;
    return this.providers.has(name.toUpperCase().trim());
  }

  /**
   * Retrieves a registered provider by name.
   * Throws UnknownProviderError if the provider is not registered.
   */
  public get(name: string): DataSourceProvider {
    if (!name || typeof name !== 'string') {
      throw new UnknownProviderError(String(name));
    }
    const key = name.toUpperCase().trim();
    const provider = this.providers.get(key);
    if (!provider) {
      throw new UnknownProviderError(name);
    }
    return provider;
  }

  /**
   * Lists all registered provider names.
   */
  public list(): string[] {
    return Array.from(this.providers.values()).map((p) => p.name);
  }
}

/** Global default registry instance */
export const defaultRegistry = new DataSourceRegistry();

/** Convenience helper to get a provider from the default registry */
export function getProvider(name: string): DataSourceProvider {
  return defaultRegistry.get(name);
}

/** Convenience helper to check if a provider exists in the default registry */
export function hasProvider(name: string): boolean {
  return defaultRegistry.has(name);
}

/** Convenience helper to list all registered providers in the default registry */
export function listProviders(): string[] {
  return defaultRegistry.list();
}

/** Convenience helper to register a provider in the default registry */
export function registerProvider(provider: DataSourceProvider): void {
  defaultRegistry.register(provider);
}
