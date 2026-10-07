import { OutreachChannel } from '@leadmate/shared';
import type {
  OutreachDeliveryProvider,
  MockDeliveryProviderOptions
} from './interfaces.js';
import {
  OutreachDeliveryProviderError,
  OutreachProviderErrorCode
} from './errors.js';
import {
  MockWhatsAppDeliveryProvider,
  MOCK_WHATSAPP_PROVIDER_NAME
} from './mock-whatsapp-provider.js';
import {
  MockEmailDeliveryProvider,
  MOCK_EMAIL_PROVIDER_NAME
} from './mock-email-provider.js';
import { META_WHATSAPP_PROVIDER_NAME } from './meta-whatsapp-provider.js';

export const OutreachDeliveryProviderName = {
  MOCK_WHATSAPP: MOCK_WHATSAPP_PROVIDER_NAME,
  META_WHATSAPP: META_WHATSAPP_PROVIDER_NAME,
  MOCK_EMAIL: MOCK_EMAIL_PROVIDER_NAME
} as const;

export type OutreachDeliveryProviderName =
  (typeof OutreachDeliveryProviderName)[keyof typeof OutreachDeliveryProviderName];

/**
 * Registry interface for resolving delivery providers by channel.
 */
export interface OutreachDeliveryProviderRegistry {
  /**
   * Retrieves the registered delivery provider for a specific channel.
   * Throws OutreachDeliveryProviderError if no provider is registered for the channel.
   */
  getProvider(channel: OutreachChannel): OutreachDeliveryProvider;

  /**
   * Registers or replaces a provider for its declared channel.
   */
  registerProvider(provider: OutreachDeliveryProvider): void;
}

import {
  MetaWhatsAppDeliveryProvider,
  type MetaWhatsAppProviderConfig,
  type MetaWhatsAppFetchFn
} from './meta-whatsapp-provider.js';

export interface MetaWhatsAppRegistryOptions {
  config: MetaWhatsAppProviderConfig;
  fetchFn?: MetaWhatsAppFetchFn;
  clock?: () => Date;
}

export interface DefaultRegistryOptions {
  whatsAppOptions?: MockDeliveryProviderOptions;
  emailOptions?: MockDeliveryProviderOptions;
  metaWhatsAppOptions?: MetaWhatsAppRegistryOptions;
}

/**
 * Default in-memory provider registry initialized with deterministic mock or live providers.
 */
export class DefaultOutreachDeliveryProviderRegistry implements OutreachDeliveryProviderRegistry {
  private readonly providers = new Map<OutreachChannel, OutreachDeliveryProvider>();

  constructor(options: DefaultRegistryOptions = {}) {
    if (options.metaWhatsAppOptions) {
      this.registerProvider(
        new MetaWhatsAppDeliveryProvider({
          config: options.metaWhatsAppOptions.config,
          fetchFn: options.metaWhatsAppOptions.fetchFn,
          clock: options.metaWhatsAppOptions.clock
        })
      );
    } else {
      this.registerProvider(new MockWhatsAppDeliveryProvider(options.whatsAppOptions));
    }

    this.registerProvider(new MockEmailDeliveryProvider(options.emailOptions));
  }

  public getProvider(channel: OutreachChannel): OutreachDeliveryProvider {
    const provider = this.providers.get(channel);
    if (!provider) {
      throw new OutreachDeliveryProviderError({
        code: OutreachProviderErrorCode.INVALID_INPUT,
        safeMessage: `No delivery provider registered for channel: ${String(channel)}`,
        retryable: false
      });
    }
    return provider;
  }

  public registerProvider(provider: OutreachDeliveryProvider): void {
    this.providers.set(provider.channel, provider);
  }
}

let defaultRegistryInstance: OutreachDeliveryProviderRegistry | null = null;

/**
 * Factory creating a fresh default delivery provider registry.
 */
export function createDefaultOutreachDeliveryProviderRegistry(
  options?: DefaultRegistryOptions
): OutreachDeliveryProviderRegistry {
  return new DefaultOutreachDeliveryProviderRegistry(options);
}

/**
 * Global singleton resolver for obtaining delivery provider by channel.
 */
export function getOutreachDeliveryProvider(channel: OutreachChannel): OutreachDeliveryProvider {
  if (!defaultRegistryInstance) {
    defaultRegistryInstance = new DefaultOutreachDeliveryProviderRegistry();
  }
  return defaultRegistryInstance.getProvider(channel);
}

/**
 * Test helper for resetting or replacing the default registry instance.
 */
export function setGlobalOutreachDeliveryProviderRegistry(
  registry: OutreachDeliveryProviderRegistry | null
): void {
  defaultRegistryInstance = registry;
}
