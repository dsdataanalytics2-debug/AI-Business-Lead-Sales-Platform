import { describe, it, expect } from 'vitest';
import {
  BuyerType,
  BUYER_TYPE_LABELS,
  getBuyerTypeLabel,
  buyerTypeSchema,
  buyerSearchQuerySchema,
  buyerSearchResultSchema,
  buyerDiscoverySearchTermSchema,
  type BuyerSearchQuery,
  type BuyerSearchResult
} from '../index.js';

describe('M8 Step 1: Shared Contracts, Enums & Buyer Discovery Schemas', () => {
  /* =================================================================
   * 1. BuyerType Enum Tests
   * ================================================================= */
  describe('BuyerType Enum', () => {
    it('1.1 accepts all valid BuyerType enum values', () => {
      const validTypes = [
        BuyerType.RETAILER,
        BuyerType.WHOLESALER,
        BuyerType.DISTRIBUTOR,
        BuyerType.ECOMMERCE_SELLER,
        BuyerType.CORPORATE_BUYER,
        BuyerType.UNKNOWN
      ];

      for (const val of validTypes) {
        expect(buyerTypeSchema.parse(val)).toBe(val);
      }
    });

    it('1.2 provides human-readable labels for all BuyerType values', () => {
      expect(BUYER_TYPE_LABELS[BuyerType.RETAILER]).toBe('Retailer');
      expect(BUYER_TYPE_LABELS[BuyerType.WHOLESALER]).toBe('Wholesaler');
      expect(BUYER_TYPE_LABELS[BuyerType.DISTRIBUTOR]).toBe('Distributor');
      expect(BUYER_TYPE_LABELS[BuyerType.ECOMMERCE_SELLER]).toBe('E-commerce Seller');
      expect(BUYER_TYPE_LABELS[BuyerType.CORPORATE_BUYER]).toBe('Corporate Buyer');
      expect(BUYER_TYPE_LABELS[BuyerType.UNKNOWN]).toBe('Unknown');

      expect(getBuyerTypeLabel(BuyerType.WHOLESALER)).toBe('Wholesaler');
    });

    it('1.3 rejects invalid BuyerType values', () => {
      const invalidTypes = ['INVALID', 'INDIVIDUAL', 'FREELANCER', 'DIRECT_CONSUMER', 123, null, ''];
      for (const val of invalidTypes) {
        expect(() => buyerTypeSchema.parse(val)).toThrow();
      }
    });
  });

  /* =================================================================
   * 2. BuyerSearchQuery Schema Tests
   * ================================================================= */
  describe('BuyerSearchQuery Schema', () => {
    it('2.1 parses valid BuyerSearchQuery with full attributes', () => {
      const input = {
        productOrService: 'Smart Watch',
        location: 'Dhaka',
        buyerType: BuyerType.WHOLESALER,
        category: 'Consumer Electronics',
        limit: 25
      };

      const parsed: BuyerSearchQuery = buyerSearchQuerySchema.parse(input);
      expect(parsed.productOrService).toBe('Smart Watch');
      expect(parsed.location).toBe('Dhaka');
      expect(parsed.buyerType).toBe(BuyerType.WHOLESALER);
      expect(parsed.category).toBe('Consumer Electronics');
      expect(parsed.limit).toBe(25);
    });

    it('2.2 requires productOrService and location', () => {
      expect(() =>
        buyerSearchQuerySchema.parse({
          location: 'Dhaka'
        })
      ).toThrow(/Product or service is required/i);

      expect(() =>
        buyerSearchQuerySchema.parse({
          productOrService: 'Garments'
        })
      ).toThrow(/Location is required/i);
    });

    it('2.3 trims whitespace on productOrService, location, and category', () => {
      const input = {
        productOrService: '   Jute Bags   ',
        location: '   Chittagong   ',
        category: '   Packaging Materials   '
      };

      const parsed = buyerSearchQuerySchema.parse(input);
      expect(parsed.productOrService).toBe('Jute Bags');
      expect(parsed.location).toBe('Chittagong');
      expect(parsed.category).toBe('Packaging Materials');
    });

    it('2.4 rejects whitespace-only inputs for required fields', () => {
      expect(() =>
        buyerSearchQuerySchema.parse({
          productOrService: '   ',
          location: 'Dhaka'
        })
      ).toThrow();

      expect(() =>
        buyerSearchQuerySchema.parse({
          productOrService: 'Solar Panels',
          location: '    '
        })
      ).toThrow();
    });

    it('2.5 defaults limit to 10 when omitted', () => {
      const input = {
        productOrService: 'Organic Fertilizer',
        location: 'Bogura'
      };

      const parsed = buyerSearchQuerySchema.parse(input);
      expect(parsed.limit).toBe(10);
      expect(parsed.buyerType).toBe(BuyerType.UNKNOWN);
    });

    it('2.6 accepts maximum limit of 50', () => {
      const input = {
        productOrService: 'Leather Goods',
        location: 'Hazaribagh, Dhaka',
        limit: 50
      };

      const parsed = buyerSearchQuerySchema.parse(input);
      expect(parsed.limit).toBe(50);
    });

    it('2.7 rejects excessive limit (> 50) and negative/zero limit (< 1)', () => {
      expect(() =>
        buyerSearchQuerySchema.parse({
          productOrService: 'Cotton Yarn',
          location: 'Narayanganj',
          limit: 51
        })
      ).toThrow(/Limit cannot exceed 50/i);

      expect(() =>
        buyerSearchQuerySchema.parse({
          productOrService: 'Cotton Yarn',
          location: 'Narayanganj',
          limit: 100
        })
      ).toThrow(/Limit cannot exceed 50/i);

      expect(() =>
        buyerSearchQuerySchema.parse({
          productOrService: 'Cotton Yarn',
          location: 'Narayanganj',
          limit: 0
        })
      ).toThrow(/Limit must be at least 1/i);

      expect(() =>
        buyerSearchQuerySchema.parse({
          productOrService: 'Cotton Yarn',
          location: 'Narayanganj',
          limit: -5
        })
      ).toThrow(/Limit must be at least 1/i);
    });

    it('2.8 handles optional category appropriately', () => {
      const withoutCategory = {
        productOrService: 'Hardware Tools',
        location: 'Nawabpur, Dhaka'
      };
      const parsed = buyerSearchQuerySchema.parse(withoutCategory);
      expect(parsed.category).toBeUndefined();

      // Excessive category length
      expect(() =>
        buyerSearchQuerySchema.parse({
          productOrService: 'Hardware Tools',
          location: 'Nawabpur, Dhaka',
          category: 'A'.repeat(101)
        })
      ).toThrow(/Category cannot exceed 100 characters/i);
    });
  });

  /* =================================================================
   * 3. BuyerSearchResult Schema Tests
   * ================================================================= */
  describe('BuyerSearchResult Schema', () => {
    it('3.1 parses a valid complete discovery candidate', () => {
      const candidate = {
        provider: 'OVERPASS',
        providerExternalId: 'node/987654321',
        businessName: 'Bengal Wholesale Traders',
        category: 'Wholesale Trade',
        buyerType: BuyerType.WHOLESALER,
        address: '14/B Chawkbazar Commercial Area',
        city: 'Dhaka',
        country: 'BD',
        latitude: 23.7188,
        longitude: 90.3986,
        website: 'https://bengalwholesale.com.bd',
        phone: '+8801711000000',
        sourceUrl: 'https://www.openstreetmap.org/node/987654321'
      };

      const parsed: BuyerSearchResult = buyerSearchResultSchema.parse(candidate);
      expect(parsed.provider).toBe('OVERPASS');
      expect(parsed.providerExternalId).toBe('node/987654321');
      expect(parsed.businessName).toBe('Bengal Wholesale Traders');
      expect(parsed.buyerType).toBe(BuyerType.WHOLESALER);
      expect(parsed.city).toBe('Dhaka');
      expect(parsed.country).toBe('BD');
      expect(parsed.phone).toBe('+8801711000000');
    });

    it('3.2 parses minimal candidate with only required fields, keeping missing fields optional/null', () => {
      const minimal = {
        provider: 'MOCK',
        providerExternalId: 'mock-101',
        businessName: 'Apex Distributors'
      };

      const parsed = buyerSearchResultSchema.parse(minimal);
      expect(parsed.provider).toBe('MOCK');
      expect(parsed.providerExternalId).toBe('mock-101');
      expect(parsed.businessName).toBe('Apex Distributors');
      expect(parsed.buyerType).toBe(BuyerType.UNKNOWN);
      expect(parsed.category).toBeUndefined();
      expect(parsed.address).toBeUndefined();
      expect(parsed.city).toBeUndefined();
      expect(parsed.country).toBeUndefined();
      expect(parsed.latitude).toBeUndefined();
      expect(parsed.longitude).toBeUndefined();
      expect(parsed.website).toBeUndefined();
      expect(parsed.phone).toBeUndefined();
      expect(parsed.sourceUrl).toBeUndefined();
    });

    it('3.3 accepts explicit null values for missing source fields without throwing', () => {
      const withNulls = {
        provider: 'GOOGLE_PLACES',
        providerExternalId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
        businessName: 'City Mart Retail',
        category: null,
        address: null,
        city: null,
        country: null,
        latitude: null,
        longitude: null,
        website: null,
        phone: null,
        sourceUrl: null
      };

      const parsed = buyerSearchResultSchema.parse(withNulls);
      expect(parsed.businessName).toBe('City Mart Retail');
      expect(parsed.phone).toBeNull();
      expect(parsed.website).toBeNull();
      expect(parsed.address).toBeNull();
    });

    it('3.4 PHONE != WHATSAPP invariant: treats discovered phone strictly as phone without WhatsApp inference', () => {
      const candidateWithPhone = {
        provider: 'OVERPASS',
        providerExternalId: 'node/12345',
        businessName: 'Dhaka Electro Traders',
        phone: '+8801712345678'
      };

      const parsed = buyerSearchResultSchema.parse(candidateWithPhone);
      expect(parsed.phone).toBe('+8801712345678');

      // Crucial invariant: Ensure no WhatsApp field is inferred or added to the contract
      const resultObj = parsed as Record<string, unknown>;
      expect(resultObj.whatsapp).toBeUndefined();
      expect(resultObj.whatsappStatus).toBeUndefined();
      expect(resultObj.isWhatsApp).toBeUndefined();
    });

    it('3.5 enforces provider-neutral result shape across diverse providers', () => {
      // 1. OpenStreetMap preview
      const osmResult = buyerSearchResultSchema.parse({
        provider: 'OVERPASS',
        providerExternalId: 'way/456789',
        businessName: 'Karwan Bazar Fish Mart',
        category: 'wholesale_market',
        latitude: 23.7516,
        longitude: 90.3943
      });
      expect(osmResult.provider).toBe('OVERPASS');

      // 2. Google Places preview
      const googleResult = buyerSearchResultSchema.parse({
        provider: 'GOOGLE_PLACES',
        providerExternalId: 'ChIJ1234567890',
        businessName: 'National Hardware Supply',
        address: 'Dhaka 1212, Bangladesh',
        phone: '+88029876543'
      });
      expect(googleResult.provider).toBe('GOOGLE_PLACES');

      // 3. Trade Directory preview
      const directoryResult = buyerSearchResultSchema.parse({
        provider: 'PUBLIC_DIRECTORY',
        providerExternalId: 'dir-entry-999',
        businessName: 'Bangladesh Garments Exporters Consortium',
        country: 'BD',
        website: 'https://bgmea.com.bd'
      });
      expect(directoryResult.provider).toBe('PUBLIC_DIRECTORY');
    });

    it('3.6 confirms discovery candidate semantics: does NOT include CRM/order/persisted state fields', () => {
      const candidate = {
        provider: 'MOCK',
        providerExternalId: 'mock-cand-1',
        businessName: 'Padma Textile Agency'
      };

      const parsed = buyerSearchResultSchema.parse(candidate);
      const parsedRecord = parsed as Record<string, unknown>;

      // Ephemeral discovery candidate must NOT have persisted entity fields
      expect(parsedRecord.id).toBeUndefined();
      expect(parsedRecord.leadId).toBeUndefined();
      expect(parsedRecord.customerId).toBeUndefined();
      expect(parsedRecord.opportunityId).toBeUndefined();
      expect(parsedRecord.crmStage).toBeUndefined();
      expect(parsedRecord.campaignId).toBeUndefined();
      expect(parsedRecord.orderId).toBeUndefined();
      expect(parsedRecord.need).toBeUndefined();
      expect(parsedRecord.intentScore).toBeUndefined();
    });
  });

  /* =================================================================
   * 4. BuyerDiscoverySearchTerm (Query Expansion) Tests
   * ================================================================= */
  describe('BuyerDiscoverySearchTerm Schema', () => {
    it('4.1 parses valid English query term with default language', () => {
      const term = {
        query: 'smart watch wholesaler Dhaka',
        sourceIntent: 'consumer_electronics_wholesale'
      };

      const parsed = buyerDiscoverySearchTermSchema.parse(term);
      expect(parsed.query).toBe('smart watch wholesaler Dhaka');
      expect(parsed.language).toBe('en');
      expect(parsed.sourceIntent).toBe('consumer_electronics_wholesale');
    });

    it('4.2 parses localized Bengali query term', () => {
      const term = {
        query: 'স্মার্ট ওয়াচ পাইকারি ঢাকা',
        language: 'bn',
        sourceIntent: 'consumer_electronics_wholesale'
      };

      const parsed = buyerDiscoverySearchTermSchema.parse(term);
      expect(parsed.query).toBe('স্মার্ট ওয়াচ পাইকারি ঢাকা');
      expect(parsed.language).toBe('bn');
    });

    it('4.3 trims query and enforces length limits', () => {
      const trimmed = buyerDiscoverySearchTermSchema.parse({
        query: '   leather bag manufacturer   '
      });
      expect(trimmed.query).toBe('leather bag manufacturer');

      expect(() =>
        buyerDiscoverySearchTermSchema.parse({
          query: '   '
        })
      ).toThrow();
    });
  });
});
