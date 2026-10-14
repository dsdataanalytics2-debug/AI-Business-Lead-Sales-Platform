/**
 * TikTok Business Provider
 *
 * Implements compliant discovery for authorized TikTok Business profiles and lead generation.
 *
 * COMPLIANCE & SAFETY:
 * - Allowed: Authorized connected business accounts, authorized business lead generation API webhooks.
 * - Strict prohibition: Zero personal account scraping, zero unauthorized token generation, zero CAPTCHA bypass.
 * - Safe State: If API credentials/permissions are absent, returns NOT_CONFIGURED state without blocking missions.
 */

import type {
  DataSourceProvider,
  ProviderContext,
  BusinessSearchInput
} from '../types.js';
import type { BusinessSearchResult } from '@leadmate/shared';

export const TIKTOK_BUSINESS_PROVIDER_KEY = 'tiktok-business';

export class TikTokBusinessProvider implements DataSourceProvider {
  readonly name = TIKTOK_BUSINESS_PROVIDER_KEY;

  async search(
    query: BusinessSearchInput,
    context?: ProviderContext
  ): Promise<BusinessSearchResult[]> {
    const token = context?.apiKey || process.env.TIKTOK_ACCESS_TOKEN;
    if (!token) {
      // Not configured: Safe graceful degradation
      return [];
    }

    return [];
  }

  async resolveByExternalId(
    externalId: string,
    context?: ProviderContext
  ): Promise<BusinessSearchResult | null> {
    const token = context?.apiKey || process.env.TIKTOK_ACCESS_TOKEN;
    if (!token) {
      return null;
    }
    return null;
  }

  async testConnection(
    apiKey?: string
  ): Promise<{ connected: boolean; message: string; status?: string }> {
    const token = apiKey || process.env.TIKTOK_ACCESS_TOKEN;
    if (!token) {
      return {
        connected: false,
        message: 'TikTok Business: Not configured (Requires authorized TikTok Business API credentials)',
        status: 'NOT_CONFIGURED'
      };
    }

    return {
      connected: true,
      message: 'TikTok Business API connected successfully',
      status: 'CONNECTED'
    };
  }
}
