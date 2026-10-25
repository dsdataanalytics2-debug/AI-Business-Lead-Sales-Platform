/**
 * Facebook Lead Ads & Inbound Signals Provider
 *
 * Implements compliant ingestion and discovery for authorized Meta Lead Ads
 * form submissions and connected Page inbound commercial signals.
 *
 * COMPLIANCE & ETHICAL RULES:
 * - Only authorized leads submitted voluntarily through connected Lead Ads forms.
 * - Only inbound commercial messages/comments on connected business Pages.
 * - Zero scraping of personal user timelines or unowned pages.
 * - Inbound signal evidence recorded with full provenance.
 * - PHONE != WHATSAPP: Contact numbers preserved as PHONE unless explicitly provided as WhatsApp.
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

export const FACEBOOK_LEAD_ADS_PROVIDER_KEY = 'facebook-lead-ads';

const META_GRAPH_BASE_URL = 'https://graph.facebook.com/v19.0';
const DEFAULT_TIMEOUT_MS = 5000;

export interface FacebookLeadGenRawItem {
  id: string;
  created_time: string;
  ad_id?: string;
  form_id?: string;
  campaign_id?: string;
  page_id?: string;
  field_data?: Array<{
    name: string;
    values: string[];
  }>;
}

export class FacebookLeadAdsProvider implements DataSourceProvider {
  readonly name = FACEBOOK_LEAD_ADS_PROVIDER_KEY;
  readonly capabilities: ProviderCapability[] = ['INBOUND_LEADS'];
  private readonly fetchImpl: typeof fetch;

  constructor(dependencies: { fetch?: typeof fetch } = {}) {
    this.fetchImpl = dependencies.fetch || fetch;
  }

  /**
   * Facebook Lead Ads is an authorized inbound lead source, not a keyword discovery engine.
   * Keyword/location discovery is unsupported.
   */
  async search(
    _query: BusinessSearchInput,
    _context?: ProviderContext
  ): Promise<BusinessSearchResult[]> {
    throw new ProviderCapabilityUnsupportedError(
      FACEBOOK_LEAD_ADS_PROVIDER_KEY,
      'DISCOVERY',
      'Facebook Lead Ads is an authorized inbound lead source and cannot be used as an arbitrary keyword discovery engine. Supported capabilities: INBOUND_LEADS'
    );
  }

  /**
   * Ingests authorized leads from connected Page leadgen forms.
   */
  async fetchInboundLeads(
    context?: ProviderContext
  ): Promise<BusinessSearchResult[]> {
    const token = context?.apiKey || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    if (!token) {
      // Graceful NOT_CONFIGURED state
      return [];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      // Fetch authorized leads from connected Page leadgen forms
      // First, get connected forms on /me/leadgen_forms
      const formsRes = await this.fetchImpl(`${META_GRAPH_BASE_URL}/me/leadgen_forms?access_token=${encodeURIComponent(token)}&fields=id,name,status`, {
        method: 'GET',
        signal: context?.signal || controller.signal,
        headers: { Accept: 'application/json' }
      });

      if (!formsRes.ok) {
        return [];
      }

      const formsData = (await formsRes.json()) as { data?: Array<{ id: string; name: string }> };
      const forms = Array.isArray(formsData?.data) ? formsData.data : [];
      if (forms.length === 0) return [];

      const results: BusinessSearchResult[] = [];
      const formLimit = Math.min(forms.length, 3);

      for (let i = 0; i < formLimit; i++) {
        const form = forms[i];
        const leadsRes = await this.fetchImpl(`${META_GRAPH_BASE_URL}/${form.id}/leads?access_token=${encodeURIComponent(token)}&fields=id,created_time,ad_id,form_id,field_data&limit=10`, {
          method: 'GET',
          signal: context?.signal || controller.signal,
          headers: { Accept: 'application/json' }
        });

        if (leadsRes.ok) {
          const leadsBody = (await leadsRes.json()) as { data?: FacebookLeadGenRawItem[] };
          const leads = Array.isArray(leadsBody?.data) ? leadsBody.data : [];
          for (const rawLead of leads) {
            results.push(this.mapLeadToSearchResult(rawLead, form.name));
          }
        }
      }

      return results;
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
    const token = context?.apiKey || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    if (!token || !externalId) return null;

    const cleanId = externalId.replace(/^fblead_/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const res = await this.fetchImpl(`${META_GRAPH_BASE_URL}/${cleanId}?access_token=${encodeURIComponent(token)}&fields=id,created_time,form_id,field_data`, {
        method: 'GET',
        signal: context?.signal || controller.signal,
        headers: { Accept: 'application/json' }
      });

      if (!res.ok) return null;
      const rawLead = (await res.json()) as FacebookLeadGenRawItem;
      return this.mapLeadToSearchResult(rawLead, 'Meta Lead Form');
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async testConnection(
    apiKey?: string
  ): Promise<{ connected: boolean; message: string; status: 'ACTIVE' | 'NOT_CONFIGURED' | 'ERROR' | 'RATE_LIMITED' }> {
    const token = apiKey || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    if (!token) {
      return {
        connected: false,
        message: 'Facebook Lead Ads: Not configured (Requires authorized Page Access Token with leadgen permissions)',
        status: 'NOT_CONFIGURED'
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const res = await this.fetchImpl(`${META_GRAPH_BASE_URL}/me/leadgen_forms?access_token=${encodeURIComponent(token)}&limit=1`, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });

      if (res.status === 429) {
        return {
          connected: false,
          message: 'Facebook Lead Ads: Meta API rate limited (429)',
          status: 'RATE_LIMITED'
        };
      }

      if (!res.ok) {
        return {
          connected: false,
          message: `Facebook Lead Ads: Access Token rejected (HTTP ${res.status})`,
          status: 'ERROR'
        };
      }

      return {
        connected: true,
        message: 'Facebook Lead Ads: Connected and authorized to ingest lead forms',
        status: 'ACTIVE'
      };
    } catch (err: any) {
      return {
        connected: false,
        message: `Facebook Lead Ads connection error: ${err.message || 'Network error'}`,
        status: 'ERROR'
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Public normalizer for Facebook Lead Ads items
   */
  normalizeLead(rawLead: FacebookLeadGenRawItem, formName?: string): BusinessSearchResult {
    return this.mapLeadToSearchResult(rawLead, formName);
  }

  private mapLeadToSearchResult(rawLead: FacebookLeadGenRawItem, formName?: string): BusinessSearchResult {
    const contacts: DiscoveredContact[] = [];
    let businessName = `Lead Form Respondent (${rawLead.id.slice(-6)})`;
    let emailVal: string | null = null;
    let phoneVal: string | null = null;
    let cityVal: string | null = null;
    let intentSignal: string | null = null;

    if (Array.isArray(rawLead.field_data)) {
      for (const field of rawLead.field_data) {
        const name = (field.name || '').toLowerCase();
        const val = field.values && field.values[0] ? field.values[0].trim() : '';
        if (!val) continue;

        if (name.includes('company') || name.includes('business') || name.includes('store') || name.includes('shop')) {
          businessName = val;
        } else if (name.includes('name') && !businessName.includes(' ') && businessName.startsWith('Lead Form')) {
          businessName = `${val} Business`;
        } else if (name.includes('phone') || name.includes('mobile')) {
          phoneVal = val;
        } else if (name.includes('email')) {
          emailVal = val.toLowerCase();
        } else if (name.includes('city') || name.includes('location')) {
          cityVal = val;
        } else if (name.includes('quantity') || name.includes('moq') || name.includes('product') || name.includes('requirement')) {
          intentSignal = `${field.name}: ${val}`;
        }
      }
    }

    if (phoneVal) {
      contacts.push({
        type: ContactType.PHONE,
        rawValue: phoneVal,
        phoneType: PhoneType.UNKNOWN,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        evidenceType: EvidenceType.AUTHORIZED_API,
        sourceUrl: `https://business.facebook.com/leads_manager`,
        snippet: `Meta Lead Form business phone: ${phoneVal}`
      });
    }

    if (emailVal) {
      contacts.push({
        type: ContactType.EMAIL,
        rawValue: emailVal,
        phoneType: PhoneType.UNKNOWN,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        evidenceType: EvidenceType.AUTHORIZED_API,
        sourceUrl: `https://business.facebook.com/leads_manager`,
        snippet: `Meta Lead Form business email: ${emailVal}`
      });
    }

    return {
      provider: FACEBOOK_LEAD_ADS_PROVIDER_KEY,
      externalId: `fb_lead_${rawLead.id}`,
      name: businessName,
      category: 'Wholesale Buyer Inbound',
      description: intentSignal ? `Meta Lead Form: ${intentSignal}` : `Inbound Lead Form: ${formName || 'Meta Lead Form'}`,
      city: cityVal || undefined,
      country: 'BD',
      reviewCount: 0,
      sourceUrl: `https://business.facebook.com/leads_manager`,
      contacts
    };
  }
}
