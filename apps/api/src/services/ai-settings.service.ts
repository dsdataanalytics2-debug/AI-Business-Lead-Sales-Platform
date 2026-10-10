/**
 * AI Models Settings Service
 *
 * Manages tenant-scoped AI Provider configurations (Google Gemini, etc.)
 * with AES-256-GCM authenticated encryption at rest, credential masking,
 * model selection, connection testing, and audit logging.
 *
 * SECURITY & PRIVACY INVARIANTS:
 * - Encryption: Stored encrypted at rest using AES-256-GCM.
 * - Zero secret leakage: Raw API keys and encrypted blobs are never returned
 *   in API responses, audit logs, or error strings.
 * - Masked metadata only: Responses expose only credentialMasked and credentialLastFour.
 * - Strict tenant isolation: Tenant A can never read or decrypt Tenant B credentials.
 */

import prisma from '@leadmate/db';
import {
  GEMINI_DEFAULT_MODEL,
  GEMINI_STRONGER_MODEL,
  SUPPORTED_GEMINI_MODELS,
  type AiProviderCard,
  type AiProvidersListResponse,
  type AiProviderCardStatus
} from '@leadmate/shared';
import {
  GeminiProvider,
  GEMINI_PROVIDER_KEY,
  defaultAiRegistry
} from '@leadmate/ai';
import {
  encryptCredential,
  decryptCredential,
  maskCredential,
  getCredentialLastFour,
  EncryptionConfigError
} from '../lib/crypto.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';

export class AiSettingsService {
  private readonly geminiProvider: GeminiProvider;

  constructor() {
    this.geminiProvider =
      (defaultAiRegistry.get(GEMINI_PROVIDER_KEY) as GeminiProvider) ??
      new GeminiProvider();
  }

  /**
   * Lists AI provider status cards for a tenant.
   */
  async listAiProviders(organizationId: string): Promise<AiProvidersListResponse> {
    const configs = await prisma.aiProviderConfig.findMany({
      where: { organizationId }
    });

    const geminiConfig = configs.find(
      (c) => c.provider === GEMINI_PROVIDER_KEY || c.provider === 'google-gemini'
    );

    const isGeminiConfigured = Boolean(
      geminiConfig?.encryptedCredential && geminiConfig.encryptedCredential.length > 0
    );
    const isGeminiActive = Boolean(geminiConfig?.isEnabled && isGeminiConfigured);

    let geminiStatus: AiProviderCardStatus = 'NOT_CONFIGURED';
    if (isGeminiConfigured) {
      geminiStatus = geminiConfig?.isEnabled ? 'CONNECTED' : 'DISABLED';
    }

    const cards: AiProviderCard[] = [
      {
        id: geminiConfig?.id || 'gemini-config',
        provider: GEMINI_PROVIDER_KEY,
        name: 'Google Gemini',
        displayName: 'Google Gemini',
        description:
          'Official Google Gemini AI models for buyer target expansion, categorization, and fit explanation.',
        status: geminiStatus,
        isActive: isGeminiActive,
        isEnabled: geminiConfig?.isEnabled ?? false,
        isConfigured: isGeminiConfigured,
        defaultModel: geminiConfig?.model || GEMINI_DEFAULT_MODEL,
        supportedModels: [...SUPPORTED_GEMINI_MODELS],
        credentialMasked: geminiConfig?.credentialMasked || null,
        credentialLastFour: geminiConfig?.credentialLastFour || null,
        lastTestedAt: geminiConfig?.lastTestedAt ? geminiConfig.lastTestedAt.toISOString() : null,
        updatedAt: geminiConfig?.updatedAt ? geminiConfig.updatedAt.toISOString() : null
      }
    ];

    return { providers: cards };
  }

  /**
   * Configures and encrypts Google Gemini API key for an organization.
   */
  async configureGemini(
    organizationId: string,
    userId: string,
    apiKey: string,
    model?: string
  ): Promise<{
    success: boolean;
    credentialMasked: string;
    credentialLastFour: string;
    status: AiProviderCardStatus;
    model: string;
  }> {
    const trimmedKey = (apiKey || '').trim();
    if (!trimmedKey) {
      throw new BadRequestError('Gemini API key is required');
    }

    const targetModel = this.geminiProvider.validateModel(model);

    // 1. Test key validity before persisting
    const testResult = await this.geminiProvider.testConnection(trimmedKey, targetModel);
    if (!testResult.connected) {
      throw new BadRequestError(`Gemini API key test connection failed: ${testResult.message}`);
    }

    // 2. Encrypt key via authenticated AES-256-GCM
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
    const configName = `${organizationId}:gemini`;

    const config = await prisma.$transaction(async (tx) => {
      const existing = await tx.aiProviderConfig.findUnique({
        where: {
          organizationId_provider: {
            organizationId,
            provider: GEMINI_PROVIDER_KEY
          }
        }
      });

      let saved;
      if (existing) {
        saved = await tx.aiProviderConfig.update({
          where: { id: existing.id },
          data: {
            model: targetModel,
            isEnabled: true,
            isDefault: true,
            encryptedCredential,
            credentialMasked,
            credentialLastFour,
            lastTestedAt: new Date()
          }
        });
      } else {
        saved = await tx.aiProviderConfig.create({
          data: {
            organizationId,
            provider: GEMINI_PROVIDER_KEY,
            name: configName,
            model: targetModel,
            isEnabled: true,
            isDefault: true,
            encryptedCredential,
            credentialMasked,
            credentialLastFour,
            lastTestedAt: new Date()
          }
        });
      }

      // Safe AuditLog: masked metadata only. Never log plaintext or encrypted blobs!
      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'ai_provider.gemini_configured',
          entityType: 'AiProviderConfig',
          entityId: saved.id,
          after: {
            provider: GEMINI_PROVIDER_KEY,
            model: targetModel,
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
      status: config.isEnabled ? 'CONNECTED' : 'DISABLED',
      model: config.model
    };
  }

  /**
   * Tests Gemini connection safely using minimal prompt.
   */
  async testGemini(
    organizationId: string,
    apiKey?: string,
    model?: string
  ): Promise<{ connected: boolean; status: string; message: string; model: string }> {
    let keyToTest = (apiKey || '').trim();
    let targetModel = model ? this.geminiProvider.validateModel(model) : GEMINI_DEFAULT_MODEL;

    // If no candidate key passed, load tenant's configured key
    if (!keyToTest) {
      const config = await prisma.aiProviderConfig.findUnique({
        where: {
          organizationId_provider: {
            organizationId,
            provider: GEMINI_PROVIDER_KEY
          }
        }
      });

      if (!config || !config.encryptedCredential) {
        // Check development environment bootstrap
        if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0) {
          keyToTest = process.env.GEMINI_API_KEY.trim();
        } else {
          return {
            connected: false,
            status: 'INVALID_API_KEY',
            message: 'Gemini is not configured. Please enter an API key first.',
            model: targetModel
          };
        }
      } else {
        try {
          keyToTest = decryptCredential(config.encryptedCredential);
        } catch {
          return {
            connected: false,
            status: 'INVALID_API_KEY',
            message: 'Failed to decrypt Gemini credential on server.',
            model: targetModel
          };
        }
        if (!model) {
          targetModel = config.model;
        }
      }
    }

    const result = await this.geminiProvider.testConnection(keyToTest, targetModel);

    // Update lastTestedAt if stored config exists
    if (result.connected) {
      await prisma.aiProviderConfig.updateMany({
        where: { organizationId, provider: GEMINI_PROVIDER_KEY },
        data: { lastTestedAt: new Date() }
      });
    }

    return result;
  }

  /**
   * Enables or disables an AI provider for an organization.
   */
  async setProviderEnabled(
    organizationId: string,
    userId: string,
    provider: string,
    enabled: boolean
  ): Promise<{ success: boolean; isEnabled: boolean }> {
    const normalized = provider.toLowerCase().trim();

    await prisma.$transaction(async (tx) => {
      await tx.aiProviderConfig.updateMany({
        where: { organizationId, provider: normalized },
        data: { isEnabled: enabled }
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: enabled ? 'ai_provider.enabled' : 'ai_provider.disabled',
          entityType: 'AiProviderConfig',
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
   * Updates default model selection for an AI provider.
   */
  async setModel(
    organizationId: string,
    userId: string,
    provider: string,
    model: string
  ): Promise<{ success: boolean; model: string }> {
    const normalized = provider.toLowerCase().trim();
    const validatedModel = this.geminiProvider.validateModel(model);

    await prisma.$transaction(async (tx) => {
      await tx.aiProviderConfig.updateMany({
        where: { organizationId, provider: normalized },
        data: { model: validatedModel }
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'ai_provider.model_updated',
          entityType: 'AiProviderConfig',
          after: {
            provider: normalized,
            model: validatedModel
          }
        }
      });
    });

    return { success: true, model: validatedModel };
  }

  /**
   * Internal helper to resolve effective AI provider context and decrypted key for a tenant.
   */
  async getActiveAiContext(
    organizationId: string,
    provider = GEMINI_PROVIDER_KEY
  ): Promise<{
    providerName: string;
    apiKey?: string;
    model: string;
    isEnabled: boolean;
  }> {
    const config = await prisma.aiProviderConfig.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: provider.toLowerCase().trim()
        }
      }
    });

    if (config?.encryptedCredential && config.isEnabled) {
      try {
        const decryptedKey = decryptCredential(config.encryptedCredential);
        return {
          providerName: config.provider,
          apiKey: decryptedKey,
          model: config.model || GEMINI_DEFAULT_MODEL,
          isEnabled: true
        };
      } catch {
        // Fall back cleanly if decryption fails
        return {
          providerName: provider,
          model: GEMINI_DEFAULT_MODEL,
          isEnabled: false
        };
      }
    }

    // Check development environment bootstrap
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0) {
      return {
        providerName: GEMINI_PROVIDER_KEY,
        apiKey: process.env.GEMINI_API_KEY.trim(),
        model: GEMINI_DEFAULT_MODEL,
        isEnabled: true
      };
    }

    return {
      providerName: provider,
      model: GEMINI_DEFAULT_MODEL,
      isEnabled: false
    };
  }
}

export const aiSettingsService = new AiSettingsService();
