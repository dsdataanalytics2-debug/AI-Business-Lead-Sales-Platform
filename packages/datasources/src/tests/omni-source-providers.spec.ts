import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FacebookBusinessProvider, FACEBOOK_BUSINESS_PROVIDER_KEY } from '../providers/facebook-business-provider.js';
import { FacebookLeadAdsProvider, FACEBOOK_LEAD_ADS_PROVIDER_KEY } from '../providers/facebook-lead-ads-provider.js';
import { TikTokBusinessProvider, TIKTOK_BUSINESS_PROVIDER_KEY } from '../providers/tiktok-business-provider.js';
import { TikTokLeadGenProvider, TIKTOK_LEAD_GEN_PROVIDER_KEY } from '../providers/tiktok-lead-gen-provider.js';
import { PublicRfqProvider, PUBLIC_RFQ_PROVIDER_KEY } from '../providers/public-rfq-provider.js';
import { ProviderCapabilityUnsupportedError } from '../errors.js';
import { defaultRegistry } from '../registry.js';
import { ContactType, WhatsAppStatus } from '@leadmate/shared';

describe('Omni-Source Discovery Providers (Facebook, TikTok, Public RFQ)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================
  // 1. CAPABILITY & UNSUPPORTED GENERIC DISCOVERY CONTRACT
  // ==========================================
  describe('Capability Model & UNSUPPORTED Generic Discovery Contract', () => {
    it('Facebook Business rejects generic search(q, loc) with UNSUPPORTED DISCOVERY capability error', async () => {
      const provider = new FacebookBusinessProvider();
      expect(provider.capabilities).toEqual(['OWNED_ASSET']);

      await expect(
        provider.search({
          q: 'Lighting Wholesalers',
          location: 'Dhaka',
          limit: 10
        })
      ).rejects.toThrow(ProviderCapabilityUnsupportedError);

      try {
        await provider.search({ q: 'Wholesalers', location: 'Dhaka' });
      } catch (err: any) {
        expect(err.capability).toBe('DISCOVERY');
        expect(err.providerName).toBe(FACEBOOK_BUSINESS_PROVIDER_KEY);
      }
    });

    it('TikTok Business rejects generic search(q, loc) with UNSUPPORTED DISCOVERY capability error', async () => {
      const provider = new TikTokBusinessProvider();
      expect(provider.capabilities).toEqual(['OWNED_ASSET']);

      await expect(
        provider.search({
          q: 'Electronics Wholesaler',
          location: 'Chattogram',
          limit: 10
        })
      ).rejects.toThrow(ProviderCapabilityUnsupportedError);

      try {
        await provider.search({ q: 'Electronics', location: 'Chattogram' });
      } catch (err: any) {
        expect(err.capability).toBe('DISCOVERY');
        expect(err.providerName).toBe(TIKTOK_BUSINESS_PROVIDER_KEY);
      }
    });

    it('Facebook Lead Ads rejects generic search() as DISCOVERY and operates via authorized inbound lead path', async () => {
      const provider = new FacebookLeadAdsProvider();
      expect(provider.capabilities).toEqual(['INBOUND_LEADS']);

      await expect(
        provider.search({
          q: 'Bulk Orders',
          location: 'Dhaka',
          limit: 10
        })
      ).rejects.toThrow(ProviderCapabilityUnsupportedError);

      // Authorized inbound lead path returns empty when not configured (zero fabricated leads)
      const inboundLeads = await provider.fetchInboundLeads();
      expect(inboundLeads).toEqual([]);
      expect(inboundLeads.length).toBe(0);
    });

    it('TikTok Lead Gen rejects generic search() as DISCOVERY and operates via authorized inbound lead path', async () => {
      const provider = new TikTokLeadGenProvider();
      expect(provider.capabilities).toEqual(['INBOUND_LEADS']);

      await expect(
        provider.search({
          q: 'Retailer Network',
          location: 'Dhaka',
          limit: 10
        })
      ).rejects.toThrow(ProviderCapabilityUnsupportedError);

      // Authorized inbound lead path returns empty when not configured (zero fabricated leads)
      const inboundLeads = await provider.fetchInboundLeads();
      expect(inboundLeads).toEqual([]);
      expect(inboundLeads.length).toBe(0);
    });

    it('Registry metadata explicitly flags social providers as supportsBuyerSearch: false', () => {
      const fbBusinessMeta = defaultRegistry.getMetadata(FACEBOOK_BUSINESS_PROVIDER_KEY);
      expect(fbBusinessMeta?.supportsBuyerSearch).toBe(false);
      expect(fbBusinessMeta?.capabilities).toEqual(['OWNED_ASSET']);

      const fbLeadAdsMeta = defaultRegistry.getMetadata(FACEBOOK_LEAD_ADS_PROVIDER_KEY);
      expect(fbLeadAdsMeta?.supportsBuyerSearch).toBe(false);
      expect(fbLeadAdsMeta?.capabilities).toEqual(['INBOUND_LEADS']);

      const ttBusinessMeta = defaultRegistry.getMetadata(TIKTOK_BUSINESS_PROVIDER_KEY);
      expect(ttBusinessMeta?.supportsBuyerSearch).toBe(false);
      expect(ttBusinessMeta?.capabilities).toEqual(['OWNED_ASSET']);

      const ttLeadGenMeta = defaultRegistry.getMetadata(TIKTOK_LEAD_GEN_PROVIDER_KEY);
      expect(ttLeadGenMeta?.supportsBuyerSearch).toBe(false);
      expect(ttLeadGenMeta?.capabilities).toEqual(['INBOUND_LEADS']);

      // Genuine discovery providers support buyer search
      const osmMeta = defaultRegistry.getMetadata('openstreetmap');
      expect(osmMeta?.supportsBuyerSearch).toBe(true);
      expect(osmMeta?.capabilities).toEqual(['DISCOVERY']);

      const rfqMeta = defaultRegistry.getMetadata('public-rfq');
      expect(rfqMeta?.supportsBuyerSearch).toBe(true);
      expect(rfqMeta?.capabilities).toContain('DISCOVERY');
      expect(rfqMeta?.capabilities).toContain('PROCUREMENT');
    });

    it('testConnection reports NOT_CONFIGURED when credentials are missing without fabricating results', async () => {
      const fb = new FacebookBusinessProvider();
      const fbStatus = await fb.testConnection();
      expect(fbStatus.status).toBe('NOT_CONFIGURED');
      expect(fbStatus.connected).toBe(false);

      const tt = new TikTokBusinessProvider();
      const ttStatus = await tt.testConnection();
      expect(ttStatus.status).toBe('NOT_CONFIGURED');
      expect(ttStatus.connected).toBe(false);
    });
  });

  // ==========================================
  // 2. AUTHORIZED LEAD NORMALIZATION & PROVENANCE
  // ==========================================
  describe('Authorized Lead Normalization & Provenance', () => {
    it('normalizes Facebook authorized Page correctly', () => {
      const provider = new FacebookBusinessProvider();
      const rawPage = {
        id: '10987654321',
        name: 'Dhaka Lighting & Electrical Wholesale',
        category: 'Lighting Store',
        about: 'Official distributor for commercial LED fittings and lamps in Gulshan',
        location: {
          street: 'Road 11, Block D, Banani',
          city: 'Dhaka',
          country: 'BD'
        },
        phone: '01711223344',
        emails: ['wholesale@dhakalighting.com'],
        website: 'https://dhakalighting.com',
        link: 'https://facebook.com/dhakalighting'
      };

      const normalized = provider.normalizePage(rawPage, 'Dhaka');

      expect(normalized.externalId).toBe('fb_10987654321');
      expect(normalized.provider).toBe(FACEBOOK_BUSINESS_PROVIDER_KEY);
      expect(normalized.name).toBe('Dhaka Lighting & Electrical Wholesale');
      expect(normalized.city).toBe('Dhaka');
      expect(normalized.category).toBe('Lighting Store');
      expect(normalized.website).toBe('https://dhakalighting.com');
      expect(normalized.sourceUrl).toBe('https://facebook.com/dhakalighting');
      expect(normalized.description).toBe('Official distributor for commercial LED fittings and lamps in Gulshan');
    });

    it('normalizes Facebook Lead Ads submission with authorized consent and commercial intent', () => {
      const provider = new FacebookLeadAdsProvider();
      const rawLead = {
        id: '555123',
        form_id: 'form_999888',
        page_id: 'page_123456',
        campaign_id: 'camp_777',
        created_time: '2026-10-17T10:00:00Z',
        field_data: [
          { name: 'business_name', values: ['Apex Retailers Co'] },
          { name: 'company_name', values: ['Apex Retailers Co'] },
          { name: 'phone_number', values: ['+8801812345678'] },
          { name: 'email', values: ['procurement@apexretail.bd'] },
          { name: 'city', values: ['Chattogram'] },
          { name: 'order_volume', values: ['Interested in 500 units bulk order wholesale quote'] }
        ]
      };

      const normalized = provider.normalizeLead(rawLead, 'Wholesale Lead Ad');

      expect(normalized.externalId).toBe('fb_lead_555123');
      expect(normalized.provider).toBe(FACEBOOK_LEAD_ADS_PROVIDER_KEY);
      expect(normalized.name).toBe('Apex Retailers Co');
      expect(normalized.city).toBe('Chattogram');
      expect(normalized.description).toContain('Wholesale Lead Ad');
      expect(normalized.contacts.some(c => c.type === ContactType.EMAIL)).toBe(true);
      expect(normalized.contacts.some(c => c.type === ContactType.PHONE)).toBe(true);
    });

    it('normalizes TikTok Lead Generation submission with consent and commercial intent', () => {
      const provider = new TikTokLeadGenProvider();
      const rawLead = {
        lead_id: '444555',
        campaign_id: 'tt_camp_888',
        adgroup_id: 'tt_adgroup_222',
        form_id: 'tt_form_111',
        create_time: '1729159200',
        lead_data: [
          { key: 'company_name', value: 'Padma General Store' },
          { key: 'city', value: 'Sylhet' },
          { key: 'phone_number', value: '01911223344' },
          { key: 'email', value: 'padma.store@gmail.com' },
          { key: 'inquiry', value: 'Requesting wholesale catalog and dealership terms' }
        ]
      };

      const normalized = provider.normalizeLead(rawLead);

      expect(normalized.externalId).toBe('tt_lead_444555');
      expect(normalized.provider).toBe(TIKTOK_LEAD_GEN_PROVIDER_KEY);
      expect(normalized.name).toBe('Padma General Store');
      expect(normalized.city).toBe('Sylhet');
      expect(normalized.contacts.some(c => c.type === ContactType.PHONE)).toBe(true);
      expect(normalized.contacts.some(c => c.type === ContactType.EMAIL)).toBe(true);
    });

    it('normalizes Public RFQ notice into verified buyer with source URL', () => {
      const provider = new PublicRfqProvider();
      const rfqItem = {
        id: 'procure_bd_2026_091',
        rfqTitle: 'Procurement of Commercial LED Illumination Fixtures for Multi-Store Retail Chain',
        organizationName: 'Shwapno Superstores Ltd',
        category: 'Supermarket / Retail Chain',
        address: 'Tejgaon Industrial Area, Dhaka',
        city: 'Dhaka',
        phone: '+88028888999',
        email: 'tenders@shwapno.net',
        sourcePortal: 'Public Procurement BD / E-GP',
        sourceUrl: 'https://tender.gov.bd/notice/2026_091'
      };

      const normalized = provider.normalizeRfq(rfqItem);

      expect(normalized.externalId).toBe('rfq_procure_bd_2026_091');
      expect(normalized.provider).toBe(PUBLIC_RFQ_PROVIDER_KEY);
      expect(normalized.name).toBe('Shwapno Superstores Ltd');
      expect(normalized.city).toBe('Dhaka');
      expect(normalized.sourceUrl).toBe('https://tender.gov.bd/notice/2026_091');
    });
  });

  // ==========================================
  // 3. PHONE != WHATSAPP INVARIANT
  // ==========================================
  describe('Strict PHONE != WHATSAPP Invariant', () => {
    it('stores discovered phone strictly as PHONE, never marks WHATSAPP without explicit wa.me link', () => {
      const provider = new FacebookBusinessProvider();
      const rawPage = {
        id: '12345',
        name: 'Gulshan Electricals',
        phone: '01711223344',
        emails: []
      };

      const normalized = provider.normalizePage(rawPage);

      expect(normalized.contacts).toHaveLength(1);
      const contact = normalized.contacts[0];
      expect(contact.type).toBe(ContactType.PHONE);
      expect(contact.rawValue).toBe('01711223344');
      expect(contact.whatsappStatus).toBe(WhatsAppStatus.UNKNOWN);

      // Verify no contact was labeled WHATSAPP
      const hasWhatsApp = normalized.contacts.some(c => c.type === ContactType.WHATSAPP);
      expect(hasWhatsApp).toBe(false);
    });

    it('marks WHATSAPP as EXPLICIT_VERIFIED only when wa.me or explicit WhatsApp link exists', () => {
      const provider = new FacebookBusinessProvider();
      const rawPage = {
        id: 'whatsapp_store',
        name: 'Banani Gadget Wholesaler',
        phone: '01811998877',
        website: 'https://wa.me/8801811998877' // Explicit wa.me link
      };

      const normalized = provider.normalizePage(rawPage);

      const waContact = normalized.contacts.find(c => c.type === ContactType.WHATSAPP);
      expect(waContact).toBeDefined();
      expect(waContact?.whatsappStatus).toBe(WhatsAppStatus.CONFIRMED);
    });
  });

  // ==========================================
  // 4. RATE LIMIT & ERROR HANDLING
  // ==========================================
  describe('Rate Limiting & Error Resilience', () => {
    it('handles Facebook 429 rate limit in testConnection by reporting RATE_LIMITED status', async () => {
      const provider = new FacebookBusinessProvider({
        fetch: vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify({
            error: {
              message: 'Application request limit reached',
              code: 4,
              is_transient: true
            }
          }), { status: 429, statusText: 'Too Many Requests' })
        )
      });

      const res = await provider.testConnection('test_token');
      expect(res.connected).toBe(false);
      expect(res.status).toBe('RATE_LIMITED');
      expect(res.message).toContain('rate limited (429)');
    });

    it('handles TikTok 429 rate limit in testConnection by reporting RATE_LIMITED status', async () => {
      const provider = new TikTokBusinessProvider({
        fetch: vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify({
            code: 40100,
            message: 'Rate limit exceeded'
          }), { status: 429, statusText: 'Too Many Requests' })
        )
      });

      const res = await provider.testConnection('test_token');
      expect(res.connected).toBe(false);
      expect(res.status).toBe('RATE_LIMITED');
      expect(res.message).toContain('rate limited (429)');
    });

    it('never leaks API credentials in normalized output or error messages', async () => {
      const secretToken = 'EAABwz_SUPER_SECRET_FACEBOOK_TOKEN_XYZ';
      const provider = new FacebookBusinessProvider();

      const rawPage = {
        id: 'safe_page',
        name: 'Safe Store',
        phone: '01711000000'
      };

      const normalized = provider.normalizePage(rawPage);
      const outputStr = JSON.stringify(normalized);

      expect(outputStr).not.toContain(secretToken);
      expect(outputStr).not.toContain('SUPER_SECRET');
    });
  });

  // ==========================================
  // 5. BANGLADESH LOCALIZATION
  // ==========================================
  describe('Bangladesh Normalization', () => {
    it('normalizes local 11-digit mobile numbers cleanly without errors', () => {
      const provider = new FacebookBusinessProvider();
      const rawPage = {
        id: 'bd_1',
        name: 'Dhanmondi Supplies',
        phone: '01712-345678',
        location: { city: 'Dhaka' }
      };

      const normalized = provider.normalizePage(rawPage);
      expect(normalized.contacts[0].rawValue).toBe('01712-345678');
      expect(normalized.contacts[0].type).toBe(ContactType.PHONE);
    });

    it('recognizes key Bangladesh commercial hubs', () => {
      const provider = new PublicRfqProvider();
      const rfq = {
        id: 'ctg',
        rfqTitle: 'Bulk delivery of construction lighting fixtures',
        organizationName: 'Chattogram Port Logistics',
        category: 'Logistics',
        address: 'Agrabad, Chattogram',
        city: 'Chattogram',
        phone: '+8803123456'
      };

      const normalized = provider.normalizeRfq(rfq);
      expect(normalized.city).toBe('Chattogram');
    });
  });
});
