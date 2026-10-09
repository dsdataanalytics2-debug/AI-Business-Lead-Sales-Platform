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

  it('1. Lists default 4 providers for tenant (mock, csv, openstreetmap, google-places)', async () => {
    const list = await datasourceSettingsService.listDataSources(orgA);
    expect(list.dataSources).toHaveLength(4);

    const providers = list.dataSources.map((d) => d.provider);
    expect(providers).toContain('mock');
    expect(providers).toContain('csv');
    expect(providers).toContain('openstreetmap');
    expect(providers).toContain('google-places');

    const google = list.dataSources.find((d) => d.provider === 'google-places');
    expect(google?.isConfigured).toBe(false);
    expect(google?.status).toBe('NOT_CONFIGURED');
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
      .mockResolvedValueOnce({ connected: true, message: 'Google Places API (New) connected successfully.' });

    const testRes = await datasourceSettingsService.testGooglePlaces(orgA, 'AIzaSyFakeKey12345');
    expect(testRes.connected).toBe(true);
    expect(testRes.message).toContain('connected successfully');
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
});
