/**
 * Datasource Settings Service
 *
 * Manages tenant-specific configuration, AES-256-GCM encryption, connection testing,
 * and active provider selection for business lead discovery sources.
 *
 * STRICT SECURITY INVARIANTS:
 * - Plaintext API keys are NEVER logged or returned to clients.
 * - Credentials are encrypted immediately via AES-256-GCM with random 12-byte IV.
 * - Responses contain only masked strings (e.g., AIza••••••••9x2A).
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
  getCredentialLastFour,
  EncryptionConfigError
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

    // Check if Google is configured and active
    const isGoogleConfigured = Boolean(
      googleConfig?.encryptedCredential && googleConfig.encryptedCredential.length > 0
    );
    const isGoogleActive = Boolean(googleConfig?.isEnabled && isGoogleConfigured);

    // Active provider defaults to OpenStreetMap (free-first) or Google if active
    let activeProvider = 'AUTO';
    if (isGoogleActive) {
      activeProvider = 'GOOGLE_PLACES';
    } else if (osmConfig?.isEnabled) {
      activeProvider = 'OPENSTREETMAP';
    }


    let googleStatus: DataSourceCardStatus = 'NOT_CONFIGURED';
    if (isGoogleConfigured) {
      googleStatus = googleConfig?.isEnabled !== false ? 'CONNECTED' : 'DISABLED';
    }

    const cards: DataSourceCardDTO[] = [
      {
        id: 'mock',
        provider: 'mock',
        name: 'mock',
        displayName: 'Mock Provider (Standard)',
        description: 'Deterministic local business discovery fixtures for development, testing, and offline usage.',
        status: 'CONNECTED',
        isActive: activeProvider === 'MOCK',
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
        id: 'csv',
        provider: 'csv',
        name: 'csv',
        displayName: 'CSV File Provider',
        description: 'Import and search structured business databases from local CSV spreadsheets.',
        status: 'CONNECTED',
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
        status: 'CONNECTED',
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
        id: googleConfig?.id || 'google-places',
        provider: 'google-places',
        name: 'google-places',
        displayName: 'Google Places API (New)',
        description: 'Live verified business discovery, high-accuracy geocoding, and official business details via Google Places API (New).',
        status: googleStatus,
        isActive: isGoogleActive,
        isEnabled: googleConfig?.isEnabled !== false,
        isConfigured: isGoogleConfigured,
        costType: 'PAID',
        requiresCredential: true,
        credentialMasked: googleConfig?.credentialMasked || null,
        credentialLastFour: googleConfig?.credentialLastFour || null,
        lastTestedAt: googleConfig?.lastTestedAt ? googleConfig.lastTestedAt.toISOString() : null,
        updatedAt: googleConfig?.updatedAt ? googleConfig.updatedAt.toISOString() : null
      }
    ];

    return {
      activeProvider,
      dataSources: cards
    };
  }

  /**
   * Tests a Google Places connection without broad searches.
   * Can test an unsaved key provided from the dashboard or the tenant's saved encrypted key.
   */
  async testGooglePlaces(
    organizationId: string,
    apiKeyInput?: string
  ): Promise<{ connected: boolean; provider: string; message: string }> {
    let keyToTest = apiKeyInput?.trim();

    if (!keyToTest) {
      const config = await prisma.dataSourceConfig.findFirst({
        where: {
          organizationId,
          provider: { in: ['google-places', 'GOOGLE_PLACES'] }
        }
      });
      if (!config?.encryptedCredential) {
        throw new BadRequestError('No Google Places API key provided or currently saved');
      }
      try {
        keyToTest = decryptCredential(config.encryptedCredential);
      } catch {
        throw new BadRequestError('Unable to decrypt stored credential');
      }
    }

    const result = await this.googlePlacesProvider.testConnection(keyToTest);

    // Update lastTestedAt if successfully tested saved key
    if (result.connected) {
      await prisma.dataSourceConfig.updateMany({
        where: {
          organizationId,
          provider: { in: ['google-places', 'GOOGLE_PLACES'] }
        },
        data: { lastTestedAt: new Date() }
      });
    }

    return {
      connected: result.connected,
      provider: GOOGLE_PLACES_PROVIDER_KEY,
      message: result.message
    };
  }

  /**
   * Tests OpenStreetMap connection.
   */
  async testOpenStreetMap(
    organizationId: string
  ): Promise<{ connected: boolean; provider: string; message: string }> {
    const result = await this.osmProvider.testConnection();

    if (result.connected) {
      await prisma.dataSourceConfig.updateMany({
        where: {
          organizationId,
          provider: { in: ['openstreetmap', 'OPENSTREETMAP'] }
        },
        data: { lastTestedAt: new Date() }
      });
    }

    return {
      connected: result.connected,
      provider: OPENSTREETMAP_PROVIDER_KEY,
      message: result.message
    };
  }

  /**
   * Configures and encrypts a Google Places API key for an organization.
   * Replaces any existing key safely. Never stores or logs plaintext.
   */
  async configureGooglePlaces(
    organizationId: string,
    userId: string,
    apiKey: string
  ): Promise<{ success: boolean; credentialMasked: string; credentialLastFour: string; status: DataSourceCardStatus }> {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey || trimmedKey.length < 10) {
      throw new BadRequestError('Google Places API key must be at least 10 characters');
    }

    // Verify key with bounded test before storing
    const testResult = await this.googlePlacesProvider.testConnection(trimmedKey);
    if (!testResult.connected) {
      throw new BadRequestError(
        `Google Places API key verification failed: ${testResult.message}`
      );
    }

    let encryptedCredential: string;
    try {
      encryptedCredential = encryptCredential(trimmedKey);
    } catch (err: any) {
      if (err instanceof EncryptionConfigError) {
        throw new BadRequestError(`Encryption system configuration error: ${err.message}`);
      }
      throw err;
    }
    const credentialMasked = maskCredential(trimmedKey);
    const credentialLastFour = getCredentialLastFour(trimmedKey);
    const configName = `${organizationId}:google-places`;

    const config = await prisma.$transaction(async (tx) => {
      // Find existing config or create new
      const existing = await tx.dataSourceConfig.findFirst({
        where: { organizationId, provider: 'google-places' }
      });

      let saved;
      if (existing) {
        saved = await tx.dataSourceConfig.update({
          where: { id: existing.id },
          data: {
            role: DataSourceRole.BOTH,
            status: DataSourceStatus.APPROVED,
            isEnabled: true,
            encryptedCredential,
            credentialMasked,
            credentialLastFour,
            lastTestedAt: new Date()
          }
        });
      } else {
        saved = await tx.dataSourceConfig.create({
          data: {
            organizationId,
            provider: 'google-places',
            name: configName,
            role: DataSourceRole.BOTH,
            status: DataSourceStatus.APPROVED,
            isEnabled: true,
            encryptedCredential,
            credentialMasked,
            credentialLastFour,
            lastTestedAt: new Date()
          }
        });
      }

      // Audit log: safe metadata ONLY. Never log the plaintext or encrypted blob!
      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'datasource.google_places_configured',
          entityType: 'DataSourceConfig',
          entityId: saved.id,
          after: {
            provider: 'google-places',
            credentialMasked,
            credentialLastFour,
            success: true
          }
        }
      });

      return saved;
    });

    return {
      success: true,
      credentialMasked,
      credentialLastFour,
      status: config.isEnabled ? 'CONNECTED' : 'DISABLED'
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
        // Fall back safely to OpenStreetMap/Mock if decryption fails
        return { providerName: OPENSTREETMAP_PROVIDER_KEY };
      }
    }

    // Check for local development bootstrap from environment
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
