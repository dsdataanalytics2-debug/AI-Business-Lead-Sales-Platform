import { describe, it, expect } from 'vitest';
import { detectWholesaleIntent } from '../intent/wholesale-intent-detector.js';

describe('Wholesale Intent Detector Engine', () => {
  it('detects HIGH intent when RFQ or procurement signals exist in evidence', () => {
    const result = detectWholesaleIntent({
      businessName: 'Apex Trade Global',
      category: 'Wholesale Distributor',
      sourceEvidences: [
        {
          sourceType: 'PUBLIC_RFQ',
          sourceName: 'National Procurement Board',
          snippet: 'Open RFQ for bulk LED lighting fixtures and modern lamps',
          evidenceType: 'PUBLIC_RFQ'
        }
      ]
    });

    expect(result.level).toBe('HIGH');
    expect(result.signals).toContain('RFQ');
    expect(result.matchedSnippets.length).toBeGreaterThan(0);
  });

  it('detects HIGH intent for wholesale price or bulk price inquiries', () => {
    const result = detectWholesaleIntent({
      businessName: 'Bengal Decor Mart',
      sourceEvidences: [
        {
          sourceType: 'COMPANY_WEBSITE',
          sourceName: 'Website Contact Page',
          snippet: 'Contact our sales desk for wholesale price lists and bulk price tier inquiries.'
        }
      ]
    });

    expect(result.level).toBe('HIGH');
    expect(result.signals).toContain('wholesale price');
  });

  it('detects HIGH intent when looking for suppliers or distributor wanted', () => {
    const result = detectWholesaleIntent({
      businessName: 'Chittagong Lighting Hub',
      sourceData: {
        description: 'New showroom opening in GEC Circle. Looking for supplier and distributor wanted for lifestyle decor.'
      }
    });

    expect(result.level).toBe('HIGH');
    expect(result.signals).toContain('distributor wanted');
  });

  it('detects MEDIUM intent for reseller inquiries, wholesalers, or dealer network', () => {
    const result = detectWholesaleIntent({
      businessName: 'Dhaka Gift & Lamps',
      category: 'Wholesale Store',
      sourceEvidences: [
        {
          sourceType: 'PUBLIC_DIRECTORY',
          sourceName: 'B2B Trade Directory',
          snippet: 'Leading regional wholesaler and authorized distributor network.'
        }
      ]
    });

    expect(result.level).toBe('MEDIUM');
    expect(result.signals).toContain('wholesaler');
  });

  it('detects LOW intent for general commercial trade mentions', () => {
    const result = detectWholesaleIntent({
      businessName: 'Karim General Trading',
      category: 'General Trading'
    });

    expect(result.level).toBe('LOW');
    expect(result.signals).toContain('commercial trade');
  });

  it('returns NONE when evidence has zero intent signals (No-Evidence = NONE)', () => {
    const result = detectWholesaleIntent({
      businessName: 'Ujjal Gift Shop',
      category: 'Gift Shop',
      sourceEvidences: [
        {
          sourceType: 'OPENSTREETMAP',
          sourceName: 'openstreetmap',
          snippet: 'Retail gift store located on Mirpur Road.'
        }
      ]
    });

    expect(result.level).toBe('NONE');
    expect(result.signals).toHaveLength(0);
    expect(result.matchedSnippets).toHaveLength(0);
  });

  it('strictly returns NONE when input has no text or null evidence (Never invent intent)', () => {
    const result = detectWholesaleIntent({
      businessName: 'Unknown Store',
      sourceEvidences: null,
      sourceData: null
    });

    expect(result.level).toBe('NONE');
    expect(result.signals).toHaveLength(0);
  });

  describe('Social Inbound Lead Intent Safety', () => {
    it('generic Facebook lead form does NOT default to HIGH intent (returns NONE)', () => {
      const result = detectWholesaleIntent({
        businessName: 'Karim Dental Clinic',
        sourceEvidences: [
          {
            sourceType: 'FACEBOOK_LEAD_ADS',
            sourceName: 'facebook-lead-ads Inbound Form',
            evidenceType: 'AUTHORIZED_INBOUND_LEAD',
            metadata: {
              campaign_name: 'Lead Generation - Healthcare'
            }
          }
        ],
        sourceData: {
          provider: 'facebook-lead-ads',
          externalLeadId: 'fb_lead_generic_01',
          businessName: 'Karim Dental Clinic',
          notes: 'Interested in product range and clinic consultation'
        }
      });

      expect(result.level).not.toBe('HIGH');
      expect(result.level).toBe('NONE');
      expect(result.signals).toHaveLength(0);
    });

    it('generic TikTok lead does NOT default to HIGH intent (returns NONE)', () => {
      const result = detectWholesaleIntent({
        businessName: 'Fashion Trendz BD',
        sourceEvidences: [
          {
            sourceType: 'TIKTOK_LEAD_GEN',
            sourceName: 'tiktok-lead-gen Inbound Form',
            evidenceType: 'AUTHORIZED_INBOUND_LEAD',
            metadata: {
              ad_id: 'tiktok_ad_12345'
            }
          }
        ],
        sourceData: {
          provider: 'tiktok-lead-gen',
          externalLeadId: 'tt_lead_generic_02',
          businessName: 'Fashion Trendz BD'
        }
      });

      expect(result.level).not.toBe('HIGH');
      expect(result.level).toBe('NONE');
    });

    it('detects HIGH intent for explicit bulk-price / quotation inquiry on inbound lead', () => {
      const resultQuotation = detectWholesaleIntent({
        businessName: 'Dhaka Surgical Traders',
        sourceData: {
          notes: 'Need quotation for 500 units of digital dental units. Send dealer pricing.'
        }
      });
      expect(resultQuotation.level).toBe('HIGH');
      expect(resultQuotation.signals).toContain('RFQ');
      expect(resultQuotation.signals).toContain('dealer pricing');

      const resultBulk = detectWholesaleIntent({
        businessName: 'Chittagong Supplies',
        sourceData: {
          notes: 'Bulk price for 1000 pcs needed. We need a distributor/supplier immediately.'
        }
      });
      expect(resultBulk.level).toBe('HIGH');
      expect(resultBulk.signals).toContain('bulk price');
      expect(resultBulk.signals).toContain('distributor/supplier wanted');

      // Standalone benchmark phrases
      expect(detectWholesaleIntent({ sourceData: { inquiry: 'Need quotation for 500 units' } }).level).toBe('HIGH');
      expect(detectWholesaleIntent({ sourceData: { notes: 'Bulk price for 1000 pcs' } }).level).toBe('HIGH');
      expect(detectWholesaleIntent({ sourceData: { notes: 'We need a distributor/supplier' } }).level).toBe('HIGH');
      expect(detectWholesaleIntent({ sourceData: { notes: 'Send dealer pricing' } }).level).toBe('HIGH');
    });

    it('detects MEDIUM intent for explicit MOQ / wholesale catalog inquiry', () => {
      const resultMoq = detectWholesaleIntent({
        businessName: 'Sylhet Med Store',
        sourceData: {
          notes: 'What is your MOQ? Please send wholesale catalog.'
        }
      });
      expect(resultMoq.level).toBe('MEDIUM');
      expect(resultMoq.signals).toContain('MOQ inquiry');
      expect(resultMoq.signals).toContain('wholesale catalog');

      const resultWholesaleOffer = detectWholesaleIntent({
        businessName: 'Barisal Health Hub',
        sourceData: {
          notes: 'Do you offer wholesale? Stock inquiry for Q4.'
        }
      });
      expect(resultWholesaleOffer.level).toBe('MEDIUM');
      expect(resultWholesaleOffer.signals).toContain('wholesale offer inquiry');
      expect(resultWholesaleOffer.signals).toContain('stock inquiry');

      // Standalone benchmark phrases
      expect(detectWholesaleIntent({ sourceData: { notes: 'What is your MOQ?' } }).level).toBe('MEDIUM');
      expect(detectWholesaleIntent({ sourceData: { notes: 'Send wholesale catalog' } }).level).toBe('MEDIUM');
      expect(detectWholesaleIntent({ sourceData: { notes: 'Do you offer wholesale?' } }).level).toBe('MEDIUM');
      expect(detectWholesaleIntent({ sourceData: { notes: 'stock / reseller inquiry' } }).level).toBe('MEDIUM');
    });

    it('detects LOW or NONE for generic commercial inquiry without wholesale request', () => {
      const resultCommercial = detectWholesaleIntent({
        businessName: 'Rahim Trading',
        sourceData: {
          notes: 'general trading office in Motijheel'
        }
      });
      expect(resultCommercial.level).toBe('LOW');

      const resultVague = detectWholesaleIntent({
        businessName: 'Vague Store',
        sourceData: {
          notes: 'Please contact me about your company'
        }
      });
      expect(resultVague.level).toBe('NONE');

      // Standalone benchmark phrases
      expect(detectWholesaleIntent({ sourceData: { notes: 'generic lead from social ad' } }).level).toBe('NONE');
      expect(detectWholesaleIntent({ sourceData: { notes: 'general product interest in new collection' } }).level).toBe('NONE');
      expect(detectWholesaleIntent({ sourceData: { notes: 'vague inquiry with no commercial request' } }).level).toBe('NONE');
      expect(detectWholesaleIntent({ sourceData: { notes: 'commercial trade overview' } }).level).toBe('LOW');
    });
  });
});
