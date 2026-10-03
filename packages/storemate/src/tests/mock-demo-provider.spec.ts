import { describe, it, expect } from 'vitest';
import {
  DemoWebsiteStatus,
  DemoWebsiteProvider,
  DemoWebsiteErrorCode,
  type StoreMateOutboundPayload
} from '@leadmate/shared';
import {
  MockDemoWebsiteProvider,
  getDemoWebsiteProvider,
  StoreMateUnavailableError
} from '../index.js';

describe('M4 Step 3: Mock Demo Website Provider & Factory', () => {
  const validPayload: StoreMateOutboundPayload = {
    business: {
      name: 'Gulshan Dental Studio',
      category: 'Dental Clinic',
      description: 'Comprehensive oral healthcare services in Gulshan, Dhaka.'
    },
    contact: {
      phone: '+8801700000000',
      email: 'contact@gulshandental.com',
      address: 'Gulshan-2, Dhaka'
    },
    branding: {
      logoUrl: 'https://cdn.example.com/logo.png'
    },
    social: {
      facebook: 'https://facebook.com/gulshandental',
      whatsapp: '+8801700000000'
    },
    metadata: {
      leadId: 'a0000000-0000-0000-0000-000000000001',
      organizationId: 'b0000000-0000-0000-0000-000000000001',
      templateKey: 'generic-local-business',
      isDemo: true,
      noindex: true,
      nofollow: true
    }
  };

  describe('MockDemoWebsiteProvider', () => {
    it('1. Generates deterministic providerSiteId and demoUrl from leadId', () => {
      const siteId1 = MockDemoWebsiteProvider.generateSiteId('a0000000-0000-0000-0000-000000000001');
      const siteId2 = MockDemoWebsiteProvider.generateSiteId('a0000000-0000-0000-0000-000000000001');
      expect(siteId1).toBe(siteId2);
      expect(siteId1).toBe('mock_site_a0000000000000000000000000000001');

      const provider = new MockDemoWebsiteProvider();
      const url1 = provider.generateDemoUrl('a0000000-0000-0000-0000-000000000001');
      const url2 = provider.generateDemoUrl('a0000000-0000-0000-0000-000000000001');
      expect(url1).toBe(url2);
      expect(url1).toBe('https://demo.local/sites/mock_site_a0000000000000000000000000000001');
    });

    it('2. Successfully creates demo with READY status, url, and readyAt timestamp', async () => {
      const provider = new MockDemoWebsiteProvider();
      const result = await provider.createDemo(validPayload);

      expect(result.status).toBe(DemoWebsiteStatus.READY);
      expect(result.providerSiteId).toBe('mock_site_a0000000000000000000000000000001');
      expect(result.demoUrl).toBe('https://demo.local/sites/mock_site_a0000000000000000000000000000001');
      expect(result.readyAt).toBeInstanceOf(Date);
      expect(result.lastErrorCode).toBeNull();
      expect(result.lastErrorMessageSafe).toBeNull();
    });

    it('3. Invariant check: rejects outbound payload if demo safety invariants are violated', async () => {
      const provider = new MockDemoWebsiteProvider();
      const invalidPayload = {
        ...validPayload,
        metadata: {
          ...validPayload.metadata,
          isDemo: false as unknown as true
        }
      };

      await expect(provider.createDemo(invalidPayload)).rejects.toThrow(
        /violates demo safety invariants/i
      );
    });

    it('4. Failure simulation: returns FAILED result with safe error code when simulateFailure is active', async () => {
      const provider = new MockDemoWebsiteProvider({
        simulateFailure: true,
        failureErrorCode: DemoWebsiteErrorCode.STOREMATE_TIMEOUT,
        failureErrorMessage: 'Simulated timeout during demo creation'
      });

      const result = await provider.createDemo(validPayload);

      expect(result.status).toBe(DemoWebsiteStatus.FAILED);
      expect(result.demoUrl).toBeNull();
      expect(result.readyAt).toBeNull();
      expect(result.lastErrorCode).toBe(DemoWebsiteErrorCode.STOREMATE_TIMEOUT);
      expect(result.lastErrorMessageSafe).toBe('Simulated timeout during demo creation');
    });

    it('5. Supports getDemoStatus, expireDemo, and removeDemo cleanly without network calls', async () => {
      const provider = new MockDemoWebsiteProvider();
      const siteId = 'mock_site_a0000000000000000000000000000001';

      const statusResult = await provider.getDemoStatus(siteId);
      expect(statusResult.providerSiteId).toBe(siteId);
      expect(statusResult.status).toBe(DemoWebsiteStatus.READY);
      expect(statusResult.demoUrl).toBe('https://demo.local/sites/mock_site_a0000000000000000000000000000001');

      await expect(provider.expireDemo(siteId)).resolves.toBeUndefined();
      await expect(provider.removeDemo(siteId)).resolves.toBeUndefined();
    });
  });

  describe('getDemoWebsiteProvider Factory', () => {
    it('6. Resolves MockDemoWebsiteProvider when MOCK provider is requested', () => {
      const provider = getDemoWebsiteProvider(DemoWebsiteProvider.MOCK);
      expect(provider.providerName).toBe(DemoWebsiteProvider.MOCK);
    });

    it('7. Throws StoreMateUnavailableError when STOREMATE provider is requested while transport is blocked', () => {
      expect(() => getDemoWebsiteProvider(DemoWebsiteProvider.STOREMATE)).toThrow(
        StoreMateUnavailableError
      );
    });
  });
});
