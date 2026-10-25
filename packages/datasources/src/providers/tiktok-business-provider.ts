/**
 * TikTok Business Provider
 *
 * Implements compliant discovery for authorized TikTok Business profiles and commercial metadata
 * via official TikTok Business API (open.tiktokapis.com).
 *
 * PRIVACY & COMPLIANCE RULES:
 * - Only authorized TikTok Business accounts and public commercial profiles.
 * - Zero scraping of personal creator/user accounts.
 * - Zero bypassing of TikTok anti-bot or CAPTCHA protections.
 * - Safe Degradation: Returns empty results with NOT_CONFIGURED when credentials are not configured.
 * - PHONE != WHATSAPP: Public profile phone numbers are stored strictly as PHONE with
 *   WhatsAppStatus.UNKNOWN. Zero automatic WhatsApp inference.
 */

import {
  ContactType,
  PhoneType,
  WhatsAppStatus,
  EvidenceType
} from '@leadmate/shared';
import type {
  DataSourceProvider,
  ProviderContext,
  BusinessSearchInput,
  BusinessSearchResult,
  DiscoveredContact,
  ProviderCapability
} from '../types.js';
import { ProviderCapabilityUnsupportedError } from '../errors.js';

export const TIKTOK_BUSINESS_PROVIDER_KEY = 'tiktok-business';

const TIKTOK_BUSINESS_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';
const DEFAULT_TIMEOUT_MS = 5000;

export interface TikTokBusinessProfileRaw {
  advertiser_id?: string;
  name?: string;
  company?: string;
  industry?: string;
  address?: string;
  telephone?: string;
  email?: string;
  website_url?: string;
  country?: string;
}

export class TikTokBusinessProvider implements DataSourceProvider {
  readonly name = TIKTOK_BUSINESS_PROVIDER_KEY;
  readonly capabilities: ProviderCapability[] = ['OWNED_ASSET'];
  private readonly fetchImpl: typeof fetch;

  constructor(dependencies: { fetch?: typeof fetch } = {}) {
    this.fetchImpl = dependencies.fetch || fetch;
  }

  /**
   * TikTok Business API does NOT support arbitrary keyword/location commercial buyer discovery.
   * Official TikTok API for Business identity endpoints are strictly advertiser/authorized-account scoped.
   * Returns UNSUPPORTED capability error.
   */
  async search(
    _query: BusinessSearchInput,
    _context?: ProviderContext
  ): Promise<BusinessSearchResult[]> {
    throw new ProviderCapabilityUnsupportedError(
      TIKTOK_BUSINESS_PROVIDER_KEY,
      'DISCOVERY',
      'Official TikTok API for Business endpoints are advertiser/authorized-account scoped. Arbitrary buyer search is not supported. Supported capabilities: OWNED_ASSET, INBOUND_LEADS'
    );
  }

  /**
   * Retrieves authorized connected TikTok Business advertiser profile metadata.
   */
  async getAuthorizedAdvertiserInfo(
    context?: ProviderContext
  ): Promise<BusinessSearchResult[]> {
    const token = context?.apiKey || process.env.TIKTOK_ACCESS_TOKEN;
    if (!token) {
      return [];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const res = await this.fetchImpl(`${TIKTOK_BUSINESS_BASE_URL}/advertiser/info/`, {
        method: 'GET',
        signal: context?.signal || controller.signal,
        headers: {
          'Access-Token': token,
          'Content-Type': 'application/json'
        }
      });

      if (!res.ok) {
        if (res.status === 429) {
          console.warn('[TikTokBusinessProvider] TikTok Business API Rate Limited (429)');
          return [];
        }
        return [];
      }

      const body = (await res.json()) as { code?: number; data?: { list?: TikTokBusinessProfileRaw[] } };
      if (body?.code !== 0 || !Array.isArray(body?.data?.list)) {
        return [];
      }

      return body.data.list.map((item) => this.mapProfileToSearchResult(item));
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.warn('[TikTokBusinessProvider] Request timed out after 5000ms');
      }
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  async resolveByExternalId(
    externalId: string,
    context?: ProviderContext
  ): Promise<BusinessSearchResult | null> {
    const token = context?.apiKey || process.env.TIKTOK_ACCESS_TOKEN;
    if (!token || !externalId) return null;

    const cleanId = externalId.replace(/^tt_/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const res = await this.fetchImpl(`${TIKTOK_BUSINESS_BASE_URL}/advertiser/info/?advertiser_ids=["${encodeURIComponent(cleanId)}"]`, {
        method: 'GET',
        signal: context?.signal || controller.signal,
        headers: {
          'Access-Token': token,
          'Content-Type': 'application/json'
        }
      });

      if (!res.ok) return null;
      const body = (await res.json()) as { code?: number; data?: { list?: TikTokBusinessProfileRaw[] } };
      const item = body?.data?.list?.[0];
      if (!item) return null;

      return this.mapProfileToSearchResult(item);
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async testConnection(
    apiKey?: string
  ): Promise<{ connected: boolean; message: string; status: 'ACTIVE' | 'NOT_CONFIGURED' | 'ERROR' | 'RATE_LIMITED' }> {
    const token = apiKey || process.env.TIKTOK_ACCESS_TOKEN;
    if (!token) {
      return {
        connected: false,
        message: 'TikTok Business: Not configured (Requires authorized TikTok Business API Access Token)',
        status: 'NOT_CONFIGURED'
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const res = await this.fetchImpl(`${TIKTOK_BUSINESS_BASE_URL}/user/info/`, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Access-Token': token,
          'Content-Type': 'application/json'
        }
      });

      if (res.status === 429) {
        return {
          connected: false,
          message: 'TikTok Business: API rate limited (429)',
          status: 'RATE_LIMITED'
        };
      }

      if (!res.ok) {
        return {
          connected: false,
          message: `TikTok Business: Token rejected (HTTP ${res.status})`,
          status: 'ERROR'
        };
      }

      const body = (await res.json()) as { code?: number; message?: string; data?: { display_name?: string } };
      if (body?.code !== 0) {
        return {
          connected: false,
          message: `TikTok Business API error: ${body?.message || 'Invalid credentials'}`,
          status: 'ERROR'
        };
      }

      return {
        connected: true,
        message: `TikTok Business connected: ${body.data?.display_name || 'Authorized Account'}`,
        status: 'ACTIVE'
      };
    } catch (err: any) {
      return {
        connected: false,
        message: `TikTok Business connection error: ${err.message || 'Network error'}`,
        status: 'ERROR'
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private mapProfileToSearchResult(raw: TikTokBusinessProfileRaw): BusinessSearchResult {
    const contacts: DiscoveredContact[] = [];

    if (raw.telephone) {
      contacts.push({
        type: ContactType.PHONE,
        rawValue: raw.telephone.trim(),
        phoneType: PhoneType.UNKNOWN,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        evidenceType: EvidenceType.AUTHORIZED_API,
        sourceUrl: `https://ads.tiktok.com`,
        snippet: `TikTok Business verified telephone: ${raw.telephone.trim()}`
      });
    }

    if (raw.email) {
      contacts.push({
        type: ContactType.EMAIL,
        rawValue: raw.email.trim().toLowerCase(),
        phoneType: PhoneType.UNKNOWN,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        evidenceType: EvidenceType.AUTHORIZED_API,
        sourceUrl: `https://ads.tiktok.com`,
        snippet: `TikTok Business verified email: ${raw.email.trim()}`
      });
    }

    return {
      provider: TIKTOK_BUSINESS_PROVIDER_KEY,
      externalId: `tt_${raw.advertiser_id || 'biz'}`,
      name: raw.company || raw.name || 'TikTok Business Account',
      category: raw.industry || 'Commercial Enterprise',
      address: raw.address || undefined,
      country: raw.country || 'BD',
      website: raw.website_url || undefined,
      reviewCount: 0,
      sourceUrl: `https://ads.tiktok.com`,
      contacts
    };
  }
}
