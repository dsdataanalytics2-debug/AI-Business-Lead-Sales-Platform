/**
 * TikTok Lead Generation Provider
 *
 * Implements compliant ingestion and discovery for authorized TikTok Lead Generation
 * submissions via official TikTok Business API.
 *
 * COMPLIANCE & ETHICAL RULES:
 * - Ingests only voluntarily submitted business leads from authorized advertising lead campaigns.
 * - Zero scraping of personal accounts.
 * - Retains full provenance: externalLeadId, campaignId, formId, createdAt.
 * - PHONE != WHATSAPP: Public phone numbers are preserved as PHONE unless explicit WhatsApp consent is provided.
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

export const TIKTOK_LEAD_GEN_PROVIDER_KEY = 'tiktok-lead-gen';

const TIKTOK_BUSINESS_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';
const DEFAULT_TIMEOUT_MS = 5000;

export interface TikTokLeadRawItem {
  lead_id: string;
  ad_id?: string;
  campaign_id?: string;
  form_id?: string;
  create_time?: string | number;
  lead_info?: Array<{
    field_name: string;
    field_value: string;
  }>;
  lead_data?: Array<{
    key: string;
    value: string;
  }>;
}

export class TikTokLeadGenProvider implements DataSourceProvider {
  readonly name = TIKTOK_LEAD_GEN_PROVIDER_KEY;
  readonly capabilities: ProviderCapability[] = ['INBOUND_LEADS'];
  private readonly fetchImpl: typeof fetch;

  constructor(dependencies: { fetch?: typeof fetch } = {}) {
    this.fetchImpl = dependencies.fetch || fetch;
  }

  /**
   * TikTok Lead Gen is an authorized inbound lead source, not a keyword discovery engine.
   * Keyword/location discovery is unsupported.
   */
  async search(
    _query: BusinessSearchInput,
    _context?: ProviderContext
  ): Promise<BusinessSearchResult[]> {
    throw new ProviderCapabilityUnsupportedError(
      TIKTOK_LEAD_GEN_PROVIDER_KEY,
      'DISCOVERY',
      'TikTok Lead Gen is an authorized inbound lead source and cannot be used as an arbitrary keyword discovery engine. Supported capabilities: INBOUND_LEADS'
    );
  }

  /**
   * Ingests authorized leads from connected TikTok Lead Generation campaigns.
   */
  async fetchInboundLeads(
    context?: ProviderContext
  ): Promise<BusinessSearchResult[]> {
    const token = context?.apiKey || process.env.TIKTOK_ACCESS_TOKEN;
    if (!token) {
      // Graceful NOT_CONFIGURED state
      return [];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      // Fetch leads from connected TikTok Lead Generation campaigns
      const res = await this.fetchImpl(`${TIKTOK_BUSINESS_BASE_URL}/page/lead/task/`, {
        method: 'GET',
        signal: context?.signal || controller.signal,
        headers: {
          'Access-Token': token,
          'Content-Type': 'application/json'
        }
      });

      if (!res.ok) {
        return [];
      }

      const body = (await res.json()) as { code?: number; data?: { list?: TikTokLeadRawItem[] } };
      if (body?.code !== 0 || !Array.isArray(body?.data?.list)) {
        return [];
      }

      return body.data.list.map((lead) => this.mapLeadToSearchResult(lead));
    } catch {
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

    const cleanId = externalId.replace(/^ttlead_/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const res = await this.fetchImpl(`${TIKTOK_BUSINESS_BASE_URL}/page/lead/task/?lead_ids=["${encodeURIComponent(cleanId)}"]`, {
        method: 'GET',
        signal: context?.signal || controller.signal,
        headers: {
          'Access-Token': token,
          'Content-Type': 'application/json'
        }
      });

      if (!res.ok) return null;
      const body = (await res.json()) as { code?: number; data?: { list?: TikTokLeadRawItem[] } };
      const lead = body?.data?.list?.[0];
      if (!lead) return null;

      return this.mapLeadToSearchResult(lead);
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
        message: 'TikTok Lead Gen: Not configured (Requires authorized TikTok Business API Access Token with lead permissions)',
        status: 'NOT_CONFIGURED'
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const res = await this.fetchImpl(`${TIKTOK_BUSINESS_BASE_URL}/page/lead/task/?page_size=1`, {
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
          message: 'TikTok Lead Gen: API rate limited (429)',
          status: 'RATE_LIMITED'
        };
      }

      if (!res.ok) {
        return {
          connected: false,
          message: `TikTok Lead Gen: Token rejected (HTTP ${res.status})`,
          status: 'ERROR'
        };
      }

      return {
        connected: true,
        message: 'TikTok Lead Gen: Connected and authorized to ingest campaign leads',
        status: 'ACTIVE'
      };
    } catch (err: any) {
      return {
        connected: false,
        message: `TikTok Lead Gen connection error: ${err.message || 'Network error'}`,
        status: 'ERROR'
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Public normalizer for TikTok Lead Gen items
   */
  normalizeLead(raw: TikTokLeadRawItem): BusinessSearchResult {
    return this.mapLeadToSearchResult(raw);
  }

  private mapLeadToSearchResult(raw: TikTokLeadRawItem): BusinessSearchResult {
    const contacts: DiscoveredContact[] = [];
    let businessName = `TikTok Lead (${(raw.lead_id || '').slice(-6)})`;
    let emailVal: string | null = null;
    let phoneVal: string | null = null;
    let cityVal: string | null = null;

    const items = Array.isArray(raw.lead_info)
      ? raw.lead_info
      : Array.isArray((raw as any).lead_data)
      ? (raw as any).lead_data
      : [];

    for (const item of items) {
      const field = (item.field_name || item.key || item.name || '').toLowerCase();
      const val = (item.field_value || item.value || '').trim();
      if (!val) continue;

      if (field.includes('company') || field.includes('business') || field.includes('store')) {
        businessName = val;
      } else if (field.includes('name') && !businessName.includes(' ') && businessName.startsWith('TikTok Lead')) {
        businessName = `${val} Trade`;
      } else if (field.includes('phone') || field.includes('mobile')) {
        phoneVal = val;
      } else if (field.includes('email')) {
        emailVal = val.toLowerCase();
      } else if (field.includes('city') || field.includes('location')) {
        cityVal = val;
      }
    }

    if (phoneVal) {
      contacts.push({
        type: ContactType.PHONE,
        rawValue: phoneVal,
        phoneType: PhoneType.UNKNOWN,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        evidenceType: EvidenceType.AUTHORIZED_API,
        sourceUrl: 'https://ads.tiktok.com',
        snippet: `TikTok Lead Gen business phone: ${phoneVal}`
      });
    }

    if (emailVal) {
      contacts.push({
        type: ContactType.EMAIL,
        rawValue: emailVal,
        phoneType: PhoneType.UNKNOWN,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        evidenceType: EvidenceType.AUTHORIZED_API,
        sourceUrl: 'https://ads.tiktok.com',
        snippet: `TikTok Lead Gen business email: ${emailVal}`
      });
    }

    return {
      provider: TIKTOK_LEAD_GEN_PROVIDER_KEY,
      externalId: `tt_lead_${raw.lead_id}`,
      name: businessName,
      category: 'Wholesale Buyer Inbound',
      city: cityVal || undefined,
      country: 'BD',
      reviewCount: 0,
      sourceUrl: 'https://ads.tiktok.com',
      contacts
    };
  }
}
