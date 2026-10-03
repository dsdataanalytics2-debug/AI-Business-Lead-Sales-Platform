import { DemoWebsiteProvider } from '@leadmate/shared';
import {
  type DemoWebsiteProviderClient,
  StoreMateUnavailableError
} from './demo-provider.js';
import { MockDemoWebsiteProvider } from './mock-demo-provider.js';

export * from './demo-provider.js';
export * from './mock-demo-provider.js';

export const STOREMATE_PACKAGE_NAME = '@leadmate/storemate';

const defaultMockProvider = new MockDemoWebsiteProvider();

/**
 * Provider factory / resolver.
 * - MOCK: Returns deterministic MockDemoWebsiteProvider.
 * - STOREMATE: Throws StoreMateUnavailableError while live provider transport is blocked pending human-owned API contract.
 */
export function getDemoWebsiteProvider(
  provider: DemoWebsiteProvider = DemoWebsiteProvider.MOCK,
  customMockProvider?: DemoWebsiteProviderClient
): DemoWebsiteProviderClient {
  if (provider === DemoWebsiteProvider.MOCK) {
    return customMockProvider ?? defaultMockProvider;
  }

  if (provider === DemoWebsiteProvider.STOREMATE) {
    throw new StoreMateUnavailableError();
  }

  throw new Error(`Unsupported demo website provider: ${String(provider)}`);
}
