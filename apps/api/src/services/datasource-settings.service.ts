/**
 * Datasource Settings Service
 *
 * Manages tenant-specific configuration, AES-256-GCM encryption, connection testing,
 * and active provider selection for business lead discovery sources across:
 * - OpenStreetMap
 * - Google Places API (New)
 * - Facebook Business Pages & Leads
 * - Facebook Lead Ads
 * - TikTok Business Profile
 * - TikTok Lead Generation
 * - Public Trade & Yellow Pages Directory
 * - Public Procurement & RFQ Notices
 * - Mock & CSV providers
 *
 * STRICT SECURITY INVARIANTS:
 * - Plaintext API keys are NEVER logged or returned to clients.
 * - Credentials are encrypted immediately via AES-256-GCM with random 12-byte IV.
 * - Responses contain only masked strings (e.g., ••••••••9x2A).
 * - All queries enforce strict tenant isolation via organizationId.
 * - Zero secrets stored in audit logs.
 */

import { prisma } from '@leadmate/db';
import { DataSourceStatus, DataSourceRole } from '@leadmate/shared';
import type {
  DataSourceCardDTO,
  DataSourceCardStatus,
  DataSourcesListResponse
} from '@leadmate/shared';
import {
  defaultRegistry,
  GooglePlacesProvider,
  OpenStreetMapProvider,
  GOOGLE_PLACES_PROVIDER_KEY,
  OPENSTREETMAP_PROVIDER_KEY,
  CSV_PROVIDER_KEY
} from '@leadmate/datasources';
import {
  encryptCredential,
  decryptCredential,
  maskCredential,
  getCredentialLastFour
} from '../lib/crypto.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';

export class DatasourceSettingsService {
  private readonly googlePlacesProvider: GooglePlacesProvider;
  private readonly osmProvider: OpenStreetMapProvider;

  constructor() {
    this.googlePlacesProvider = (defaultRegistry.get(GOOGLE_PLACES_PROVIDER_KEY) as GooglePlacesProvider) ?? new GooglePlacesProvider();
    this.osmProvider = (defaultRegistry.get(OPENSTREETMAP_PROVIDER_KEY) as OpenStreetMapProvider) ?? new OpenStreetMapProvider();
  }

  /**
   * Lists all datasource cards for an organization with masked credentials.
   */
  async listDataSources(organizationId: string): Promise<DataSourcesListResponse> {
    const configs = await prisma.dataSourceConfig.findMany({
      where: { organizationId }
    });

    const googleConfig = configs.find(
      (c) => c.provider === 'google-places' || c.provider === 'GOOGLE_PLACES'
    );
    const osmConfig = configs.find(
      (c) => c.provider === 'openstreetmap' || c.provider === 'OPENSTREETMAP'
    );
    const fbBusinessConfig = configs.find((c) => c.provider === 'facebook-business');
    const fbLeadAdsConfig = configs.find((c) => c.provider === 'facebook-lead-ads');
    const ttBusinessConfig = configs.find((c) => c.provider === 'tiktok-business');
    const ttLeadGenConfig = configs.find((c) => c.provider === 'tiktok-lead-gen');

    const isGoogleConfigured = Boolean(
      googleConfig?.encryptedCredential && googleConfig.encryptedCredential.length > 0
    );
    const isGoogleActive = Boolean(googleConfig?.isEnabled && isGoogleConfigured);

    let activeProvider = 'AUTO';
    if (isGoogleActive) {
      activeProvider = 'GOOGLE_PLACES';
    } else if (osmConfig?.isEnabled) {
      activeProvider = 'OPENSTREETMAP';
    }

    const getStatusForConfig = (config?: any): DataSourceCardStatus => {
      if (!config || !config.encryptedCredential) return 'NOT_CONFIGURED';
      if (!config.isEnabled) return 'DISABLED';
      return 'ACTIVE';
    };

    const isProduction = process.env.NODE_ENV === 'production';

    const cards: DataSourceCardDTO[] = [
      {
        id: 'mock',
        provider: 'mock',
        name: 'mock',
        displayName: isProduction ? 'Mock Provider (DEV / TEST ONLY)' : 'Mock Provider (Standard)',
        description: isProduction
          ? 'Development & test fixture generator. Strictly disabled and blocked in production environment.'
          : 'Deterministic local business discovery fixtures for development, testing, and offline usage.',
        status: isProduction ? 'DISABLED' : 'ACTIVE',
        capabilities: isProduction ? [] : ['DISCOVERY', 'ENRICHMENT'],
        group: 'DISCOVERY',
        discoveryStatus: isProduction ? 'DISABLED' : 'ACTIVE',
        isActive: isProduction ? false : activeProvider === 'MOCK',
        isEnabled: !isProduction,
        isConfigured: !isProduction,
        costType: 'FREE',
        requiresCredential: false,
        credentialMasked: null,
        credentialLastFour: null,
        lastTestedAt: null,
        updatedAt: null
      },
      {
        id: 'csv',
        provider: 'csv',
        name: 'csv',
        displayName: 'CSV File Provider',
        description: 'Import and search structured business databases from local CSV spreadsheets.',
        status: 'ACTIVE',
        capabilities: ['DISCOVERY'],
        group: 'DISCOVERY',
        discoveryStatus: 'ACTIVE',
        isActive: false,
        isEnabled: true,
        isConfigured: true,
        costType: 'FREE',
        requiresCredential: false,
        credentialMasked: null,
        credentialLastFour: null,
        lastTestedAt: null,
        updatedAt: null
      },
      {
        id: osmConfig?.id || 'openstreetmap',
        provider: 'openstreetmap',
        name: 'openstreetmap',
        displayName: 'OpenStreetMap (Overpass)',
        description: 'First free live buyer discovery provider via global OpenStreetMap Overpass API.',
        status: 'ACTIVE',
        capabilities: ['DISCOVERY'],
        group: 'DISCOVERY',
        discoveryStatus: 'ACTIVE',
        isActive: activeProvider === 'OPENSTREETMAP' || activeProvider === 'AUTO',
        isEnabled: osmConfig?.isEnabled !== false,
        isConfigured: true,
        costType: 'FREE',
        requiresCredential: false,
        credentialMasked: null,
        credentialLastFour: null,
        lastTestedAt: osmConfig?.lastTestedAt ? osmConfig.lastTestedAt.toISOString() : null,
        updatedAt: osmConfig?.updatedAt ? osmConfig.updatedAt.toISOString() : null
      },
      {
        id: 'public-directory',
        provider: 'public-directory',
        name: 'public-directory',
        displayName: 'Public Trade & Yellow Pages Directory',
        description: 'Comprehensive commercial trade listings, yellow pages, and wholesale directories.',
        status: 'ACTIVE',
        capabilities: ['DISCOVERY'],
        group: 'DISCOVERY',
        discoveryStatus: 'ACTIVE',
        isActive: false,
        isEnabled: true,
        isConfigured: true,
        costType: 'FREE',
        requiresCredential: false,
        credentialMasked: null,
        credentialLastFour: null,
        lastTestedAt: null,
        updatedAt: null
      },
      {
        id: 'public-rfq',
        provider: 'public-rfq',
        name: 'public-rfq',
        displayName: 'Public Procurement & RFQ Notices',
        description: 'Authorized public procurement portals, open tender notices, and institutional buyer solicitations.',
        status: 'ACTIVE',
        capabilities: ['DISCOVERY', 'PROCUREMENT'],
        group: 'DISCOVERY',
        discoveryStatus: 'ACTIVE',
        isActive: false,
        isEnabled: true,
        isConfigured: true,
        costType: 'FREE',
        requiresCredential: false,
        credentialMasked: null,
        credentialLastFour: null,
        lastTestedAt: null,
        updatedAt: null
      },
      {
        id: googleConfig?.id || 'google-places',
        provider: 'google-places',
        name: 'google-places',
        displayName: 'Google Places API (New)',
        description: 'Live verified business discovery, high-accuracy geocoding, and official business details via Google Places API (New).',
        status: isGoogleConfigured ? (googleConfig?.isEnabled !== false ? 'ACTIVE' : 'DISABLED') : 'NOT_CONFIGURED',
        capabilities: ['DISCOVERY'],
        group: 'DISCOVERY',
        discoveryStatus: isGoogleConfigured ? (googleConfig?.isEnabled !== false ? 'ACTIVE' : 'DISABLED') : 'NOT_CONFIGURED',
        isActive: isGoogleActive,
        isEnabled: googleConfig?.isEnabled !== false,
        isConfigured: isGoogleConfigured,
        costType: 'PAID',
        requiresCredential: true,
        credentialMasked: googleConfig?.credentialMasked || null,
        credentialLastFour: googleConfig?.credentialLastFour || null,
        lastTestedAt: googleConfig?.lastTestedAt ? googleConfig.lastTestedAt.toISOString() : null,
        updatedAt: googleConfig?.updatedAt ? googleConfig.updatedAt.toISOString() : null
      },
      {
        id: fbBusinessConfig?.id || 'facebook-business',
        provider: 'facebook-business',
        name: 'facebook-business',
        displayName: 'Facebook Business Pages & Metadata',
        description: 'Authorized connected Facebook business accounts, page metadata, and owned asset details.',
        status: getStatusForConfig(fbBusinessConfig),
        capabilities: ['OWNED_ASSET'],
        group: 'ENRICHMENT_ACCOUNT',
        discoveryStatus: 'UNSUPPORTED',
        isActive: false,
        isEnabled: fbBusinessConfig?.isEnabled !== false,
        isConfigured: Boolean(fbBusinessConfig?.encryptedCredential),
        costType: 'FREE',
        requiresCredential: true,
        credentialMasked: fbBusinessConfig?.credentialMasked || null,
        credentialLastFour: fbBusinessConfig?.credentialLastFour || null,
        lastTestedAt: fbBusinessConfig?.lastTestedAt ? fbBusinessConfig.lastTestedAt.toISOString() : null,
        updatedAt: fbBusinessConfig?.updatedAt ? fbBusinessConfig.updatedAt.toISOString() : null
      },
      {
        id: fbLeadAdsConfig?.id || 'facebook-lead-ads',
        provider: 'facebook-lead-ads',
        name: 'facebook-lead-ads',
        displayName: 'Facebook Lead Ads & Inbound Signals',
        description: 'Ingest authorized commercial lead forms and inbound buyer inquiries from connected Facebook Pages.',
        status: getStatusForConfig(fbLeadAdsConfig),
        capabilities: ['INBOUND_LEADS'],
        group: 'INBOUND_LEADS',
        discoveryStatus: 'UNSUPPORTED',
        isActive: false,
        isEnabled: fbLeadAdsConfig?.isEnabled !== false,
        isConfigured: Boolean(fbLeadAdsConfig?.encryptedCredential),
        costType: 'FREE',
        requiresCredential: true,
        credentialMasked: fbLeadAdsConfig?.credentialMasked || null,
        credentialLastFour: fbLeadAdsConfig?.credentialLastFour || null,
        lastTestedAt: fbLeadAdsConfig?.lastTestedAt ? fbLeadAdsConfig.lastTestedAt.toISOString() : null,
        updatedAt: fbLeadAdsConfig?.updatedAt ? fbLeadAdsConfig.updatedAt.toISOString() : null
      },
      {
        id: ttBusinessConfig?.id || 'tiktok-business',
        provider: 'tiktok-business',
        name: 'tiktok-business',
        displayName: 'TikTok Business Profile & Metadata',
        description: 'Authorized TikTok commercial business accounts, advertiser profiles, and owned asset details.',
        status: getStatusForConfig(ttBusinessConfig),
        capabilities: ['OWNED_ASSET'],
        group: 'ENRICHMENT_ACCOUNT',
        discoveryStatus: 'UNSUPPORTED',
        isActive: false,
        isEnabled: ttBusinessConfig?.isEnabled !== false,
        isConfigured: Boolean(ttBusinessConfig?.encryptedCredential),
        costType: 'FREE',
        requiresCredential: true,
        credentialMasked: ttBusinessConfig?.credentialMasked || null,
        credentialLastFour: ttBusinessConfig?.credentialLastFour || null,
        lastTestedAt: ttBusinessConfig?.lastTestedAt ? ttBusinessConfig.lastTestedAt.toISOString() : null,
        updatedAt: ttBusinessConfig?.updatedAt ? ttBusinessConfig.updatedAt.toISOString() : null
      },
      {
        id: ttLeadGenConfig?.id || 'tiktok-lead-gen',
        provider: 'tiktok-lead-gen',
        name: 'tiktok-lead-gen',
        displayName: 'TikTok Lead Generation Inbound',
        description: 'Ingest authorized wholesale buyer leads from connected TikTok Lead Generation advertising campaigns.',
        status: getStatusForConfig(ttLeadGenConfig),
        capabilities: ['INBOUND_LEADS'],
        group: 'INBOUND_LEADS',
        discoveryStatus: 'UNSUPPORTED',
        isActive: false,
        isEnabled: ttLeadGenConfig?.isEnabled !== false,
        isConfigured: Boolean(ttLeadGenConfig?.encryptedCredential),
        costType: 'FREE',
        requiresCredential: true,
        credentialMasked: ttLeadGenConfig?.credentialMasked || null,
        credentialLastFour: ttLeadGenConfig?.credentialLastFour || null,
        lastTestedAt: ttLeadGenConfig?.lastTestedAt ? ttLeadGenConfig.lastTestedAt.toISOString() : null,
        updatedAt: ttLeadGenConfig?.updatedAt ? ttLeadGenConfig.updatedAt.toISOString() : null
      }
    ];

    return {
      activeProvider,
      dataSources: cards
    };
  }

  /**
   * Configures and encrypts an API key / token for any supported provider.
   */
  async configureProvider(
    organizationId: string,
    userId: string,
    provider: string,
    apiKey: string
  ): Promise<{ success: boolean; credentialMasked: string; credentialLastFour: string; status: DataSourceCardStatus }> {
    const normalizedProvider = provider.toLowerCase().replace(/_/g, '-');
    const trimmedKey = (apiKey || '').trim();

    if (!trimmedKey || trimmedKey.length < 5) {
      throw new BadRequestError('Credential must be at least 5 characters');
    }

    if (!defaultRegistry.has(normalizedProvider)) {
      throw new NotFoundError(`Provider "${normalizedProvider}" is not registered`);
    }

    // Encrypt key
    const encryptedCredential = encryptCredential(trimmedKey);
    const credentialMasked = maskCredential(trimmedKey);
    const credentialLastFour = getCredentialLastFour(trimmedKey);

    await prisma.$transaction(async (tx) => {
      const existing = await tx.dataSourceConfig.findFirst({
        where: {
          organizationId,
          provider: normalizedProvider
        }
      });

      if (existing) {
        await tx.dataSourceConfig.update({
          where: { id: existing.id },
          data: {
            encryptedCredential,
            credentialMasked,
            credentialLastFour,
            isEnabled: true,
            status: DataSourceStatus.APPROVED,
            lastTestedAt: new Date(),
            updatedAt: new Date()
          }
        });
      } else {
        await tx.dataSourceConfig.create({
          data: {
            organizationId,
            provider: normalizedProvider,
            name: normalizedProvider,
            role: DataSourceRole.DISCOVERY,
            status: DataSourceStatus.APPROVED,
            isEnabled: true,
            encryptedCredential,
            credentialMasked,
            credentialLastFour,
            lastTestedAt: new Date()
          }
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: `datasource.${normalizedProvider.replace(/-/g, '_')}_configured`,
          entityType: 'DataSourceConfig',
          entityId: existing?.id || 'new',
          after: {
            provider: normalizedProvider,
            credentialMasked,
            credentialLastFour,
            success: true
          }
        }
      });
    });

    return {
      success: true,
      credentialMasked,
      credentialLastFour,
      status: 'ACTIVE'
    };
  }

  /**
   * Backwards compatible helper for Google Places configuration.
   */
  async configureGooglePlaces(
    organizationId: string,
    userId: string,
    apiKey: string
  ): Promise<{ success: boolean; credentialMasked: string; credentialLastFour: string; status: DataSourceCardStatus }> {
    return this.configureProvider(organizationId, userId, 'google-places', apiKey);
  }

  /**
   * Tests connection for any provider by key or saved credentials.
   */
  async testProvider(
    organizationId: string,
    provider: string,
    apiKeyInput?: string
  ): Promise<{ connected: boolean; provider: string; message: string; status: DataSourceCardStatus }> {
    const normalizedProvider = provider.toLowerCase().replace(/_/g, '-');
    let keyToTest = apiKeyInput?.trim();

    if (!keyToTest) {
      const config = await prisma.dataSourceConfig.findFirst({
        where: {
          organizationId,
          provider: normalizedProvider
        }
      });
      if (config?.encryptedCredential) {
        try {
          keyToTest = decryptCredential(config.encryptedCredential);
        } catch {
          return {
            connected: false,
            provider: normalizedProvider,
            message: 'Unable to decrypt stored credentials (fail-closed)',
            status: 'ERROR'
          };
        }
      }
    }

    if (normalizedProvider === 'mock' && process.env.NODE_ENV === 'production') {
      return {
        connected: false,
        provider: 'mock',
        message: 'Mock provider is strictly disabled and blocked in production environment',
        status: 'DISABLED'
      };
    }

    if (!defaultRegistry.has(normalizedProvider)) {
      throw new NotFoundError(`Provider "${normalizedProvider}" is not registered`);
    }

    const providerInstance = defaultRegistry.get(normalizedProvider);
    if (!providerInstance.testConnection) {
      return {
        connected: true,
        provider: normalizedProvider,
        message: `${normalizedProvider} is operational`,
        status: 'ACTIVE'
      };
    }

    const result = await providerInstance.testConnection(keyToTest);
    const status: DataSourceCardStatus = result.connected ? 'ACTIVE' : ((result as any).status || 'ERROR');

    if (result.connected) {
      await prisma.dataSourceConfig.updateMany({
        where: { organizationId, provider: normalizedProvider },
        data: { lastTestedAt: new Date() }
      });
    }

    return {
      connected: result.connected,
      provider: normalizedProvider,
      message: result.message,
      status
    };
  }

  /**
   * Backwards-compatible Google Places connection test.
   */
  async testGooglePlaces(
    organizationId: string,
    apiKeyInput?: string
  ): Promise<{ connected: boolean; provider: string; message: string }> {
    const res = await this.testProvider(organizationId, 'google-places', apiKeyInput);
    return {
      connected: res.connected,
      provider: res.provider,
      message: res.message
    };
  }

  /**
   * Backwards-compatible OpenStreetMap connection test.
   */
  async testOpenStreetMap(
    organizationId: string
  ): Promise<{ connected: boolean; provider: string; message: string }> {
    const res = await this.testProvider(organizationId, 'openstreetmap');
    return {
      connected: res.connected,
      provider: res.provider,
      message: res.message
    };
  }

  /**
   * Sets the active business discovery provider for an organization.
   */
  async setActiveProvider(
    organizationId: string,
    userId: string,
    provider: string
  ): Promise<{ success: boolean; activeProvider: string }> {
    const normalized = provider.toLowerCase().replace(/_/g, '-');

    if (normalized === 'google-places') {
      const config = await prisma.dataSourceConfig.findFirst({
        where: { organizationId, provider: 'google-places' }
      });

      if (!config || !config.encryptedCredential) {
        throw new BadRequestError(
          'Google Places is not configured. Please enter and verify an API key first.'
        );
      }

      await prisma.$transaction(async (tx) => {
        await tx.dataSourceConfig.update({
          where: { id: config.id },
          data: { isEnabled: true }
        });

        await tx.auditLog.create({
          data: {
            organizationId,
            userId,
            action: 'datasource.google_places_activated',
            entityType: 'DataSourceConfig',
            entityId: config.id,
            after: {
              provider: 'google-places',
              isActive: true
            }
          }
        });
      });

      return { success: true, activeProvider: 'GOOGLE_PLACES' };
    }

    if (normalized === 'openstreetmap') {
      return { success: true, activeProvider: 'OPENSTREETMAP' };
    }

    if (normalized === 'auto') {
      return { success: true, activeProvider: 'AUTO' };
    }

    if (normalized === 'mock') {
      if (process.env.NODE_ENV === 'production') {
        throw new BadRequestError('Mock provider is strictly disabled in production environment');
      }
      return { success: true, activeProvider: 'MOCK' };
    }

    if (process.env.NODE_ENV === 'production') {
      return { success: true, activeProvider: 'AUTO' };
    }

    return { success: true, activeProvider: 'MOCK' };
  }

  /**
   * Disables or enables a provider for an organization.
   */
  async setProviderEnabled(
    organizationId: string,
    userId: string,
    provider: string,
    enabled: boolean
  ): Promise<{ success: boolean; isEnabled: boolean }> {
    const normalized = provider.toLowerCase().replace(/_/g, '-');

    if (normalized === 'mock' && process.env.NODE_ENV === 'production' && enabled) {
      throw new BadRequestError('Mock provider cannot be enabled in production environment');
    }

    await prisma.$transaction(async (tx) => {
      await tx.dataSourceConfig.updateMany({
        where: { organizationId, provider: normalized },
        data: { isEnabled: enabled }
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: enabled ? 'datasource.provider_enabled' : 'datasource.provider_disabled',
          entityType: 'DataSourceConfig',
          after: {
            provider: normalized,
            isEnabled: enabled
          }
        }
      });
    });

    return { success: true, isEnabled: enabled };
  }

  /**
   * Helper to safely retrieve and decrypt a provider's key for a tenant.
   * Fails closed: returns undefined if not configured or if decryption fails.
   */
  async getDecryptedProviderKey(
    organizationId: string,
    provider: string
  ): Promise<string | undefined> {
    const normalized = provider.toLowerCase().replace(/_/g, '-');
    const config = await prisma.dataSourceConfig.findFirst({
      where: {
        organizationId,
        provider: normalized,
        isEnabled: true
      }
    });

    if (!config?.encryptedCredential) {
      return undefined;
    }

    try {
      return decryptCredential(config.encryptedCredential);
    } catch {
      // Fail closed
      return undefined;
    }
  }

  /**
   * Internal helper to resolve the effective active provider and decrypted API key for a tenant.
   */
  async getActiveProviderContext(organizationId: string): Promise<{
    providerName: string;
    apiKey?: string;
  }> {
    const config = await prisma.dataSourceConfig.findFirst({
      where: {
        organizationId,
        provider: 'google-places',
        isEnabled: true
      }
    });

    if (config?.encryptedCredential) {
      try {
        const decryptedKey = decryptCredential(config.encryptedCredential);
        return {
          providerName: GOOGLE_PLACES_PROVIDER_KEY,
          apiKey: decryptedKey
        };
      } catch {
        return { providerName: OPENSTREETMAP_PROVIDER_KEY };
      }
    }

    if (process.env.GOOGLE_PLACES_API_KEY && process.env.GOOGLE_PLACES_API_KEY.trim().length > 0) {
      return {
        providerName: GOOGLE_PLACES_PROVIDER_KEY,
        apiKey: process.env.GOOGLE_PLACES_API_KEY.trim()
      };
    }

    return { providerName: OPENSTREETMAP_PROVIDER_KEY };
  }
}

export const datasourceSettingsService = new DatasourceSettingsService();
