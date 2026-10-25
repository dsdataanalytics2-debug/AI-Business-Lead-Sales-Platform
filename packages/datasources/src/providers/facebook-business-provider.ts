/**
 * Facebook Business Provider
 *
 * Implements compliant, authorized discovery for Facebook Business Pages and metadata
 * via official Meta Graph APIs.
 *
 * PRIVACY & COMPLIANCE RULES:
 * - Allowed: Official connected Meta business accounts, public Facebook Page directory metadata.
 * - Strict prohibition: Zero personal account scraping, zero personal timeline access,
 *   zero private search history access, zero CAPTCHA or anti-bot bypass.
 * - Safe Degradation: When credentials are not configured, gracefully returns empty results
 *   with status NOT_CONFIGURED without blocking missions.
 * - PHONE != WHATSAPP: Public page phone numbers are saved strictly as PHONE with
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

export const FACEBOOK_BUSINESS_PROVIDER_KEY = 'facebook-business';

const META_GRAPH_BASE_URL = 'https://graph.facebook.com/v19.0';
const DEFAULT_TIMEOUT_MS = 5000;

export interface FacebookPageRawItem {
  id: string;
  name: string;
  category?: string;
  category_list?: Array<{ id: string; name: string }>;
  about?: string;
  link?: string;
  phone?: string;
  emails?: string[];
  website?: string;
  single_line_address?: string;
  location?: {
    city?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
    street?: string;
    zip?: string;
  };
  verification_status?: string;
}

export class FacebookBusinessProvider implements DataSourceProvider {
  readonly name = FACEBOOK_BUSINESS_PROVIDER_KEY;
  readonly capabilities: ProviderCapability[] = ['OWNED_ASSET'];
  private readonly fetchImpl: typeof fetch;

  constructor(dependencies: { fetch?: typeof fetch } = {}) {
    this.fetchImpl = dependencies.fetch || fetch;
  }

  /**
   * Facebook Business does NOT support arbitrary keyword/location commercial buyer discovery.
   * Official Meta Graph API endpoints are restricted to authorized owned business assets.
   * Returns UNSUPPORTED capability error.
   */
  async search(
    _query: BusinessSearchInput,
    _context?: ProviderContext
  ): Promise<BusinessSearchResult[]> {
    throw new ProviderCapabilityUnsupportedError(
      FACEBOOK_BUSINESS_PROVIDER_KEY,
      'DISCOVERY',
      'Official Meta Graph API does not support arbitrary commercial buyer search. Supported capabilities: OWNED_ASSET'
    );
  }

  /**
   * Resolves a Facebook Business Page by its stable Page ID.
   */
  async resolveByExternalId(
    externalId: string,
    context?: ProviderContext
  ): Promise<BusinessSearchResult | null> {
    const token = context?.apiKey || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    if (!token || !externalId) {
      return null;
    }

    const cleanId = externalId.replace(/^fb_/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const params = new URLSearchParams({
        fields: 'id,name,category,category_list,link,phone,emails,website,single_line_address,location,verification_status',
        access_token: token
      });

      const res = await this.fetchImpl(`${META_GRAPH_BASE_URL}/${encodeURIComponent(cleanId)}?${params.toString()}`, {
        method: 'GET',
        signal: context?.signal || controller.signal,
        headers: { Accept: 'application/json' }
      });

      if (!res.ok) {
        return null;
      }

      const page = (await res.json()) as FacebookPageRawItem;
      if (!page?.id) return null;

      return this.mapPageToSearchResult(page);
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Tests connection validity against Meta Graph API.
   */
  async testConnection(
    apiKey?: string
  ): Promise<{ connected: boolean; message: string; status: 'ACTIVE' | 'NOT_CONFIGURED' | 'ERROR' | 'RATE_LIMITED' }> {
    const token = apiKey || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    if (!token) {
      return {
        connected: false,
        message: 'Facebook Business: Not configured (Requires authorized Page Access Token)',
        status: 'NOT_CONFIGURED'
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const res = await this.fetchImpl(`${META_GRAPH_BASE_URL}/me?access_token=${encodeURIComponent(token)}&fields=id,name`, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });

      if (res.status === 429) {
        return {
          connected: false,
          message: 'Facebook Business: Meta API rate limited (429)',
          status: 'RATE_LIMITED'
        };
      }

      if (!res.ok) {
        return {
          connected: false,
          message: `Facebook Business: Token rejected (HTTP ${res.status})`,
          status: 'ERROR'
        };
      }

      const body = (await res.json()) as { id?: string; name?: string };
      return {
        connected: true,
        message: `Facebook Business connected: ${body.name || body.id || 'Authorized Account'}`,
        status: 'ACTIVE'
      };
    } catch (err: any) {
      return {
        connected: false,
        message: `Facebook Business connection failed: ${err.message || 'Network error'}`,
        status: 'ERROR'
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Public normalizer for Facebook Page items
   */
  normalizePage(page: FacebookPageRawItem, fallbackLocation?: string): BusinessSearchResult {
    return this.mapPageToSearchResult(page, fallbackLocation);
  }

  /**
   * Normalizes a raw Facebook Page object into the platform's BusinessSearchResult contract.
   */
  private mapPageToSearchResult(page: FacebookPageRawItem, fallbackLocation?: string): BusinessSearchResult {
    const contacts: DiscoveredContact[] = [];

    // Phone: strictly ContactType.PHONE, never automatically WhatsApp
    if (page.phone) {
      contacts.push({
        type: ContactType.PHONE,
        rawValue: page.phone.trim(),
        phoneType: PhoneType.UNKNOWN,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        evidenceType: EvidenceType.AUTHORIZED_API,
        sourceUrl: page.link || `https://facebook.com/${page.id}`,
        snippet: `Facebook Page business phone: ${page.phone.trim()}`
      });
    }

    // Email
    if (Array.isArray(page.emails) && page.emails.length > 0) {
      for (const email of page.emails) {
        if (email && email.includes('@')) {
          contacts.push({
            type: ContactType.EMAIL,
            rawValue: email.trim().toLowerCase(),
            phoneType: PhoneType.UNKNOWN,
            whatsappStatus: WhatsAppStatus.UNKNOWN,
            evidenceType: EvidenceType.AUTHORIZED_API,
            sourceUrl: page.link || `https://facebook.com/${page.id}`,
            snippet: `Facebook Page public email: ${email.trim()}`
          });
        }
      }
    }

    // Check for explicit WhatsApp link in website (e.g. wa.me/...)
    if (page.website && (page.website.includes('wa.me/') || page.website.includes('api.whatsapp.com/send'))) {
      contacts.push({
        type: ContactType.WHATSAPP,
        rawValue: page.website.trim(),
        phoneType: PhoneType.UNKNOWN,
        whatsappStatus: WhatsAppStatus.CONFIRMED,
        evidenceType: EvidenceType.AUTHORIZED_API,
        sourceUrl: page.website.trim(),
        snippet: `Explicit WhatsApp contact link: ${page.website.trim()}`
      });
    }

    const city = page.location?.city || fallbackLocation || undefined;
    const address = page.single_line_address || (page.location?.street ? `${page.location.street}, ${city || ''}` : undefined);

    return {
      provider: FACEBOOK_BUSINESS_PROVIDER_KEY,
      externalId: `fb_${page.id}`,
      name: page.name,
      category: page.category || (page.category_list && page.category_list[0]?.name) || 'Business',
      description: page.about || undefined,
      address: address || undefined,
      city: city || undefined,
      country: page.location?.country || 'BD',
      latitude: page.location?.latitude ?? undefined,
      longitude: page.location?.longitude ?? undefined,
      website: page.website || page.link || undefined,
      reviewCount: 0,
      sourceUrl: page.link || `https://facebook.com/${page.id}`,
      contacts
    };
  }
}
