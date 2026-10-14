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
});
