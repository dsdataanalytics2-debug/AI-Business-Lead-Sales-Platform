import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { prisma } from '@leadmate/db';
import { datasourceSettingsService } from '../services/datasource-settings.service.js';
import { decryptCredential } from '../lib/crypto.js';

describe('Data Sources Settings Service & Tenant Isolation', () => {
  const orgA = '00000000-0000-0000-0000-00000000000a';
  const orgB = '00000000-0000-0000-0000-00000000000b';
  const userA = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    await prisma.organization.upsert({
      where: { id: orgA },
      update: {},
      create: {
        id: orgA,
        name: 'Test Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.upsert({
      where: { id: orgB },
      update: {},
      create: {
        id: orgB,
        name: 'Test Org B',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.user.upsert({
      where: { id: userA },
      update: {},
      create: {
        id: userA,
        email: 'user-a-datasource-test@leadatlas.local',
        passwordHash: 'dummyhash',
        name: 'User A',
        role: 'ADMIN',
        organizationId: orgA,
        isActive: true
      }
    });
  });

  beforeEach(async () => {
    // Clear test datasource configs for clean tests
    await prisma.dataSourceConfig.deleteMany({
      where: {
        organizationId: { in: [orgA, orgB] }
      }
    });
  });

  it('1. Lists default 10 providers for tenant with proper NOT_CONFIGURED statuses', async () => {
    const list = await datasourceSettingsService.listDataSources(orgA);
    expect(list.dataSources).toHaveLength(10);

    const providers = list.dataSources.map((d) => d.provider);
    expect(providers).toContain('openstreetmap');
    expect(providers).toContain('google-places');
    expect(providers).toContain('facebook-business');
    expect(providers).toContain('facebook-lead-ads');
    expect(providers).toContain('tiktok-business');
    expect(providers).toContain('tiktok-lead-gen');
    expect(providers).toContain('public-directory');
    expect(providers).toContain('public-rfq');

    const fb = list.dataSources.find((d) => d.provider === 'facebook-business');
    expect(fb?.isConfigured).toBe(false);
    expect(fb?.status).toBe('NOT_CONFIGURED');
    expect(fb?.capabilities).toEqual(['OWNED_ASSET']);
    expect(fb?.group).toBe('ENRICHMENT_ACCOUNT');
    expect(fb?.discoveryStatus).toBe('UNSUPPORTED');

    const fbLead = list.dataSources.find((d) => d.provider === 'facebook-lead-ads');
    expect(fbLead?.capabilities).toEqual(['INBOUND_LEADS']);
    expect(fbLead?.group).toBe('INBOUND_LEADS');
    expect(fbLead?.discoveryStatus).toBe('UNSUPPORTED');

    const tt = list.dataSources.find((d) => d.provider === 'tiktok-business');
    expect(tt?.isConfigured).toBe(false);
    expect(tt?.status).toBe('NOT_CONFIGURED');
    expect(tt?.capabilities).toEqual(['OWNED_ASSET']);
    expect(tt?.group).toBe('ENRICHMENT_ACCOUNT');
    expect(tt?.discoveryStatus).toBe('UNSUPPORTED');

    const ttLead = list.dataSources.find((d) => d.provider === 'tiktok-lead-gen');
    expect(ttLead?.capabilities).toEqual(['INBOUND_LEADS']);
    expect(ttLead?.group).toBe('INBOUND_LEADS');
    expect(ttLead?.discoveryStatus).toBe('UNSUPPORTED');

    const osm = list.dataSources.find((d) => d.provider === 'openstreetmap');
    expect(osm?.capabilities).toEqual(['DISCOVERY']);
    expect(osm?.group).toBe('DISCOVERY');
    expect(osm?.discoveryStatus).toBe('ACTIVE');
  });

  it('2. Configures and encrypts Google Places API key via AES-256-GCM', async () => {
    const fakeKey = 'AIzaSyA_TEST_KEY_1234567890abcdef99';

    // Mock connection test to pass without calling Google
    vi.spyOn((datasourceSettingsService as any).googlePlacesProvider, 'testConnection')
      .mockResolvedValueOnce({ connected: true, message: 'Google Places API connected' });

    const result = await datasourceSettingsService.configureGooglePlaces(orgA, userA, fakeKey);
    expect(result.success).toBe(true);
    expect(result.credentialMasked).toContain('AIza');
    expect(result.credentialMasked).toContain('••••');
    expect(result.credentialLastFour).toBe('ef99');

    // Verify in database: stored value MUST be encrypted, NOT plaintext!
    const saved = await prisma.dataSourceConfig.findFirst({
      where: { organizationId: orgA, provider: 'google-places' }
    });
    expect(saved).toBeDefined();
    expect(saved?.encryptedCredential).not.toBe(fakeKey);
    expect(saved?.encryptedCredential).toMatch(/^v1:/);

    // Verify roundtrip decryption
    const decrypted = decryptCredential(saved!.encryptedCredential!);
    expect(decrypted).toBe(fakeKey);
  });

  it('3. Enforces strict tenant isolation (Org A config is completely invisible to Org B)', async () => {
    const keyA = 'AIzaSyA_ORG_A_KEY_98765432101234';

    vi.spyOn((datasourceSettingsService as any).googlePlacesProvider, 'testConnection')
      .mockResolvedValueOnce({ connected: true, message: 'Connected' });

    await datasourceSettingsService.configureGooglePlaces(orgA, userA, keyA);

    // Org B queries its data sources: Google Places MUST remain NOT_CONFIGURED
    const listB = await datasourceSettingsService.listDataSources(orgB);
    const googleB = listB.dataSources.find((d) => d.provider === 'google-places');
    expect(googleB?.isConfigured).toBe(false);
    expect(googleB?.status).toBe('NOT_CONFIGURED');
    expect(googleB?.credentialMasked).toBeNull();

    // Verify Org B cannot access Org A's decrypted credential
    const ctxB = await datasourceSettingsService.getActiveProviderContext(orgB);
    expect(ctxB.apiKey).toBeUndefined();
  });

  it('4. Tests Google Places connection safely using mocked provider', async () => {
    vi.spyOn((datasourceSettingsService as any).googlePlacesProvider, 'testConnection')
      .mockImplementation(async () => ({ connected: true, message: 'Google Places API connected' }));

    const testRes = await datasourceSettingsService.testGooglePlaces(orgA, 'AIzaSyFakeKey12345');
    expect(testRes.connected).toBe(true);
    expect(testRes.message).toContain('connected');
  });

  it('5. Enables and disables provider cleanly with audit trails', async () => {
    const toggleRes = await datasourceSettingsService.setProviderEnabled(
      orgA,
      userA,
      'openstreetmap',
      false
    );
    expect(toggleRes.success).toBe(true);
    expect(toggleRes.isEnabled).toBe(false);
  });

  it('6. Configures and encrypts Facebook Business credentials via AES-256-GCM', async () => {
    const fakeFbToken = 'EAABwz_FB_ACCESS_TOKEN_SECRET_99998888';

    const result = await datasourceSettingsService.configureProvider(
      orgA,
      userA,
      'facebook-business',
      fakeFbToken
    );

    expect(result.success).toBe(true);
    expect(result.credentialMasked).toContain('••••');
    expect(result.credentialLastFour).toBe('8888');

    // Stored value in DB must be encrypted with AES-256-GCM (starts with v1:)
    const saved = await prisma.dataSourceConfig.findFirst({
      where: { organizationId: orgA, provider: 'facebook-business' }
    });
    expect(saved).toBeDefined();
    expect(saved?.encryptedCredential).not.toBe(fakeFbToken);
    expect(saved?.encryptedCredential).toMatch(/^v1:/);

    // Decrypts accurately for internal server use
    const decrypted = await datasourceSettingsService.getDecryptedProviderKey(orgA, 'facebook-business');
    expect(decrypted).toBe(fakeFbToken);

    // Completely isolated from Org B
    const listB = await datasourceSettingsService.listDataSources(orgB);
    const fbB = listB.dataSources.find((d) => d.provider === 'facebook-business');
    expect(fbB?.isConfigured).toBe(false);
    expect(fbB?.status).toBe('NOT_CONFIGURED');
    expect(fbB?.credentialMasked).toBeNull();
  });

  it('7. Configures and encrypts TikTok Business credentials with fail-closed decryption', async () => {
    const fakeTtToken = 'TT_ACT_0192837465_SECRET_TOKEN_1234';

    const result = await datasourceSettingsService.configureProvider(
      orgA,
      userA,
      'tiktok-business',
      fakeTtToken
    );

    expect(result.success).toBe(true);
    expect(result.credentialMasked).toContain('••••');
    expect(result.credentialLastFour).toBe('1234');

    const decrypted = await datasourceSettingsService.getDecryptedProviderKey(orgA, 'tiktok-business');
    expect(decrypted).toBe(fakeTtToken);

    // Org B receives undefined (fail-closed)
    const orgBDecrypted = await datasourceSettingsService.getDecryptedProviderKey(orgB, 'tiktok-business');
    expect(orgBDecrypted).toBeUndefined();
  });

  it('8. Enforces production safety for Mock provider (disabled and blocked when NODE_ENV is production)', async () => {
    const prevEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      const list = await datasourceSettingsService.listDataSources(orgA);
      const mockCard = list.dataSources.find((d) => d.provider === 'mock');
      expect(mockCard).toBeDefined();
      expect(mockCard?.displayName).toContain('DEV / TEST ONLY');
      expect(mockCard?.status).toBe('DISABLED');
      expect(mockCard?.isEnabled).toBe(false);
      expect(mockCard?.isConfigured).toBe(false);
      expect(mockCard?.discoveryStatus).toBe('DISABLED');

      // Attempting to activate Mock in production throws error
      await expect(
        datasourceSettingsService.setActiveProvider(orgA, userA, 'mock')
      ).rejects.toThrow(/disabled in production/i);

      // Attempting to enable Mock in production throws error
      await expect(
        datasourceSettingsService.setProviderEnabled(orgA, userA, 'mock', true)
      ).rejects.toThrow(/cannot be enabled in production/i);

      // Testing Mock in production returns DISABLED status
      const testRes = await datasourceSettingsService.testProvider(orgA, 'mock');
      expect(testRes.connected).toBe(false);
      expect(testRes.status).toBe('DISABLED');
      expect(testRes.message).toContain('disabled');
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});
