import {
  SalesAssistantProviderErrorCode,
  SalesAssistantProviderError
} from './errors.js';
import type { SalesAssistantProviderClient } from './provider.js';
import { MockSalesAssistantProvider } from './mock-provider.js';

export * from './errors.js';
export * from './provider.js';
export * from './mock-provider.js';

/**
 * Internal provider kinds supported by the sales assistant subsystem.
 * In Step 3, only MOCK is active. Real AI providers are blocked until subsequent milestones.
 */
export const SalesAssistantProviderKind = {
  MOCK: 'MOCK'
} as const;

export type SalesAssistantProviderKind =
  (typeof SalesAssistantProviderKind)[keyof typeof SalesAssistantProviderKind];

const defaultMockProvider = new MockSalesAssistantProvider();

/**
 * Sales assistant provider factory / resolver.
 * - 'MOCK': Returns deterministic MockSalesAssistantProvider (or injected instance).
 * - Any other provider: Throws normalized SalesAssistantProviderError(PROVIDER_UNAVAILABLE).
 */
export function getSalesAssistantProvider(
  provider: SalesAssistantProviderKind | string = SalesAssistantProviderKind.MOCK,
  customProvider?: SalesAssistantProviderClient
): SalesAssistantProviderClient {
  if (provider === SalesAssistantProviderKind.MOCK || provider === 'MOCK') {
    return customProvider ?? defaultMockProvider;
  }

  throw new SalesAssistantProviderError(
    SalesAssistantProviderErrorCode.PROVIDER_UNAVAILABLE,
    `Sales assistant provider '${String(provider)}' is unavailable or not supported in this deployment.`,
    false
  );
}
