import {
  DemoWebsiteStatus,
  DemoWebsiteProvider,
  DemoWebsiteErrorCode,
  type StoreMateOutboundPayload
} from '@leadmate/shared';

/**
 * Normalized result returned by a DemoWebsiteProviderClient
 */
export interface ProviderDemoResult {
  providerSiteId: string;
  status: DemoWebsiteStatus;
  demoUrl?: string | null;
  readyAt?: Date | null;
  lastErrorCode?: DemoWebsiteErrorCode | string | null;
  lastErrorMessageSafe?: string | null;
}

/**
 * Pluggable provider abstraction for demo website generation and lifecycle management.
 * LeadMate interacts exclusively with this interface.
 */
export interface DemoWebsiteProviderClient {
  readonly providerName: DemoWebsiteProvider;

  /**
   * Provisions or creates a new demo website from normalized outbound business payload.
   */
  createDemo(payload: StoreMateOutboundPayload): Promise<ProviderDemoResult>;

  /**
   * Queries the current status of a demo website at the provider.
   */
  getDemoStatus(providerSiteId: string): Promise<ProviderDemoResult>;

  /**
   * Marks a demo website expired on the provider side.
   */
  expireDemo(providerSiteId: string): Promise<void>;

  /**
   * Removes / unpublishes a demo website from the provider side.
   */
  removeDemo(providerSiteId: string): Promise<void>;
}

/**
 * Custom error thrown when StoreMate provider transport is invoked while blocked
 */
export class StoreMateUnavailableError extends Error {
  public readonly code = DemoWebsiteErrorCode.STOREMATE_UNAVAILABLE;
  constructor(message = 'StoreMate live provider transport is blocked pending human-owned API contract in docs/storemate-api-contract.md') {
    super(message);
    this.name = 'StoreMateUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
