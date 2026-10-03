import {
  DemoWebsiteStatus,
  DemoWebsiteProvider,
  DemoWebsiteErrorCode,
  type StoreMateOutboundPayload
} from '@leadmate/shared';
import {
  type DemoWebsiteProviderClient,
  type ProviderDemoResult
} from './demo-provider.js';

export interface MockProviderOptions {
  simulateFailure?: boolean;
  failureErrorCode?: DemoWebsiteErrorCode | string;
  failureErrorMessage?: string;
  baseUrlPrefix?: string;
}

/**
 * Deterministic Mock Demo Website Provider for local development and integration tests.
 * Performs zero network/HTTP calls.
 */
export class MockDemoWebsiteProvider implements DemoWebsiteProviderClient {
  public readonly providerName = DemoWebsiteProvider.MOCK;

  private simulateFailure = false;
  private failureErrorCode: DemoWebsiteErrorCode | string = DemoWebsiteErrorCode.STOREMATE_TIMEOUT;
  private failureErrorMessage = 'Mock provider simulated timeout during demo creation';
  private readonly baseUrlPrefix: string;

  constructor(options: MockProviderOptions = {}) {
    if (options.simulateFailure !== undefined) {
      this.simulateFailure = options.simulateFailure;
    }
    if (options.failureErrorCode) {
      this.failureErrorCode = options.failureErrorCode;
    }
    if (options.failureErrorMessage) {
      this.failureErrorMessage = options.failureErrorMessage;
    }
    this.baseUrlPrefix = options.baseUrlPrefix ?? 'https://demo.local/sites';
  }

  /**
   * Configure simulated failure mode for test scenarios
   */
  public setSimulateFailure(
    enabled: boolean,
    errorCode: DemoWebsiteErrorCode | string = DemoWebsiteErrorCode.STOREMATE_TIMEOUT,
    errorMessage = 'Mock provider simulated timeout during demo creation'
  ): void {
    this.simulateFailure = enabled;
    this.failureErrorCode = errorCode;
    this.failureErrorMessage = errorMessage;
  }

  /**
   * Generates a deterministic provider site identifier from a lead UUID
   */
  public static generateSiteId(leadId: string): string {
    const sanitized = leadId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    return `mock_site_${sanitized}`;
  }

  /**
   * Generates a deterministic safe demo HTTPS URL from a lead UUID
   */
  public generateDemoUrl(leadId: string): string {
    const siteId = MockDemoWebsiteProvider.generateSiteId(leadId);
    return `${this.baseUrlPrefix}/${siteId}`;
  }

  public async createDemo(payload: StoreMateOutboundPayload): Promise<ProviderDemoResult> {
    // Invariant assertions
    if (!payload.metadata.isDemo || !payload.metadata.noindex || !payload.metadata.nofollow) {
      throw new Error('MockDemoWebsiteProvider: outbound payload violates demo safety invariants (isDemo, noindex, nofollow must be true)');
    }

    const leadId = payload.metadata.leadId;
    const providerSiteId = MockDemoWebsiteProvider.generateSiteId(leadId);

    if (this.simulateFailure) {
      return {
        providerSiteId,
        status: DemoWebsiteStatus.FAILED,
        demoUrl: null,
        readyAt: null,
        lastErrorCode: this.failureErrorCode,
        lastErrorMessageSafe: this.failureErrorMessage
      };
    }

    const demoUrl = this.generateDemoUrl(leadId);

    return {
      providerSiteId,
      status: DemoWebsiteStatus.READY,
      demoUrl,
      readyAt: new Date(),
      lastErrorCode: null,
      lastErrorMessageSafe: null
    };
  }

  public async getDemoStatus(providerSiteId: string): Promise<ProviderDemoResult> {
    return {
      providerSiteId,
      status: DemoWebsiteStatus.READY,
      demoUrl: `${this.baseUrlPrefix}/${providerSiteId}`,
      readyAt: new Date(),
      lastErrorCode: null,
      lastErrorMessageSafe: null
    };
  }

  public async expireDemo(_providerSiteId: string): Promise<void> {
    // Deterministic no-op for mock provider
  }

  public async removeDemo(_providerSiteId: string): Promise<void> {
    // Deterministic no-op for mock provider
  }
}
