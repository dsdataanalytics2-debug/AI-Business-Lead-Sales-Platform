import { describe, it, expect } from 'vitest';
import {
  checkBusinessMatch,
  mergeBusinessRecords,
  getHierarchyMatchKeys,
  type MergedBusinessRecord
} from '../duplicates/multi-source-merger.js';
import type { ProductContextInput } from '../scoring/buyer-score.js';

describe('Multi-Source Deduplication & Evidence Merger', () => {
  const dummyProductContext: ProductContextInput = {
    productName: 'Mushroom Lamp',
    productDescription: 'Wholesale ambient bedroom mushroom lamp',
    productCategory: 'Home Decor',
    targetMarket: 'Dhaka',
    primaryCategories: ['Lighting Store', 'Home Decor Store'],
    secondaryCategories: ['Gift Shop']
  };

  describe('4-Tier Hierarchy Match Checking', () => {
    it('matches by Tier 1 (Provider + External ID)', () => {
      const b1 = { provider: 'OPENSTREETMAP', externalBusinessId: 'node/12345', businessName: 'Store A' };
      const b2 = { provider: 'OPENSTREETMAP', externalBusinessId: 'node/12345', businessName: 'Different Name' };
      const match = checkBusinessMatch(b1, b2);
      expect(match.isMatch).toBe(true);
      expect(match.matchTier).toBe('PROVIDER_ID');
    });

    it('matches by Tier 2 (Canonical Website Domain)', () => {
      const b1 = { provider: 'OPENSTREETMAP', externalBusinessId: 'node/111', website: 'https://www.dhakalighting.com/home' };
      const b2 = { provider: 'GOOGLE_PLACES', externalBusinessId: 'place_999', website: 'http://dhakalighting.com?ref=google' };
      const match = checkBusinessMatch(b1, b2);
      expect(match.isMatch).toBe(true);
      expect(match.matchTier).toBe('WEBSITE_DOMAIN');
    });

    it('matches by Tier 3 (Verified Direct Phone)', () => {
      const b1 = { provider: 'OPENSTREETMAP', phone: '01711223344' };
      const b2 = { provider: 'GOOGLE_PLACES', phone: '+880 1711-223344' };
      const match = checkBusinessMatch(b1, b2);
      expect(match.isMatch).toBe(true);
      expect(match.matchTier).toBe('VERIFIED_PHONE');
    });

    it('matches by Tier 4 (Verified Direct Email)', () => {
      const b1 = { provider: 'OPENSTREETMAP', email: 'wholesale@rumilighting.bd' };
      const b2 = { provider: 'FACEBOOK_BUSINESS', email: 'wholesale@rumilighting.bd' };
      const match = checkBusinessMatch(b1, b2);
      expect(match.isMatch).toBe(true);
      expect(match.matchTier).toBe('VERIFIED_EMAIL');
    });

    it('matches by Tier 5 (Normalized Name + Location as Soft Match)', () => {
      const b1 = { businessName: 'Rumi Lighting & Electricals', address: 'Gulshan 1, Dhaka' };
      const b2 = { businessName: 'rumi lighting & electricals', city: 'Gulshan 1' };
      const match = checkBusinessMatch(b1, b2);
      expect(match.isMatch).toBe(true);
      expect(match.matchTier).toBe('NAME_LOCATION_SOFT');
      expect(match.isSoftMatch).toBe(true); // Flagged for review, never silent hard-merge
    });

    it('rejects completely different businesses', () => {
      const b1 = { provider: 'OSM', externalBusinessId: '1', businessName: 'Acme Cafe', phone: '01711111111' };
      const b2 = { provider: 'GOOGLE', externalBusinessId: '2', businessName: 'Beta Shoes', phone: '01822222222' };
      const match = checkBusinessMatch(b1, b2);
      expect(match.isMatch).toBe(false);
      expect(match.matchTier).toBe('NONE');
    });
  });

  describe('Merging Records, Evidences, and Upgrading Confidence', () => {
    it('merges multiple sources into ONE consolidated buyer and upgrades sourceConfidence', () => {
      const initialRecord: MergedBusinessRecord = {
        provider: 'OPENSTREETMAP',
        externalBusinessId: 'node/555',
        businessName: 'Bengal Decor Store',
        category: 'Home Decor Store',
        address: 'Dhanmondi 27, Dhaka',
        city: 'Dhaka',
        phone: '01711002233',
        website: 'https://bengaldecor.com.bd',
        sourceEvidences: [
          {
            sourceType: 'OPENSTREETMAP',
            sourceName: 'OpenStreetMap Overpass',
            observedAt: new Date(),
            evidenceType: 'DIRECTORY_NODE'
          }
        ],
        enrichedContacts: [
          {
            type: 'PHONE',
            value: '+8801711002233',
            source: 'OPENSTREETMAP',
            verifiedAt: new Date(),
            confidence: 'MEDIUM'
          }
        ],
        sourceConfidence: 'MEDIUM',
        whatsappStatus: 'NOT_VERIFIED'
      };

      // Candidate 2 from Google Places
      const googleCandidate = {
        provider: 'GOOGLE_PLACES',
        externalBusinessId: 'ChIJ_abc123',
        businessName: 'Bengal Decor Store Dhanmondi',
        newEvidence: {
          sourceType: 'GOOGLE_PLACES',
          sourceName: 'Google Places API',
          observedAt: new Date(),
          evidenceType: 'PLACES_DETAIL'
        }
      };

      const mergedWithGoogle = mergeBusinessRecords(initialRecord, googleCandidate, dummyProductContext);

      // Now has 2 sources: OSM + Google Places
      expect(mergedWithGoogle.sourceEvidences).toHaveLength(2);
      // Upgraded to HIGH
      expect(mergedWithGoogle.sourceConfidence).toBe('HIGH');
      expect(mergedWithGoogle.whatsappStatus).toBe('NOT_VERIFIED'); // Strict PHONE != WHATSAPP

      // Candidate 3: Website Contact Inspection with wa.me link
      const websiteCandidate = {
        newEvidence: {
          sourceType: 'COMPANY_WEBSITE',
          sourceName: 'Official Website',
          sourceUrl: 'https://bengaldecor.com.bd',
          observedAt: new Date(),
          evidenceType: 'EXPLICIT_WA_ME_LINK'
        },
        newContacts: [
          {
            type: 'EMAIL' as const,
            value: 'info@bengaldecor.com.bd',
            source: 'COMPANY_WEBSITE',
            verifiedAt: new Date(),
            confidence: 'HIGH' as const
          },
          {
            type: 'WHATSAPP' as const,
            value: '8801711002233',
            source: 'COMPANY_WEBSITE',
            verifiedAt: new Date(),
            confidence: 'VERY_HIGH' as const
          }
        ]
      };

      const mergedWithWebsite = mergeBusinessRecords(mergedWithGoogle, websiteCandidate, dummyProductContext);

      // 3 distinct sources: OSM + Google + Company Website
      expect(mergedWithWebsite.sourceEvidences).toHaveLength(3);
      // Upgraded to VERY_HIGH
      expect(mergedWithWebsite.sourceConfidence).toBe('VERY_HIGH');
      // WhatsApp status explicitly verified
      expect(mergedWithWebsite.whatsappStatus).toBe('EXPLICIT_VERIFIED');

      // Enriched contacts now has Phone, Email, WhatsApp
      expect(mergedWithWebsite.enrichedContacts.some((c) => c.type === 'EMAIL')).toBe(true);
      expect(mergedWithWebsite.enrichedContacts.some((c) => c.type === 'WHATSAPP')).toBe(true);
      expect(mergedWithWebsite.enrichedContacts.some((c) => c.type === 'PHONE')).toBe(true);

      // Buyer score is updated
      expect(mergedWithWebsite.buyerScore).toBeGreaterThan(60);
    });

    it('merges Facebook Business and TikTok Lead Gen preserving all provenance evidences', () => {
      const fbBuyer: MergedBusinessRecord = {
        provider: 'FACEBOOK_BUSINESS',
        externalBusinessId: 'page_98765',
        businessName: 'Apex Lighting Hub',
        category: 'Lighting Store',
        address: 'Uttara Sector 3, Dhaka',
        city: 'Dhaka',
        phone: '01711998877',
        sourceEvidences: [
          {
            sourceType: 'FACEBOOK_BUSINESS',
            sourceName: 'Facebook Page',
            externalId: 'page_98765',
            observedAt: new Date(),
            evidenceType: 'PUBLIC_BUSINESS_PROFILE'
          }
        ],
        enrichedContacts: [
          {
            type: 'PHONE',
            value: '+8801711998877',
            source: 'FACEBOOK_BUSINESS',
            verifiedAt: new Date(),
            confidence: 'MEDIUM'
          }
        ],
        sourceConfidence: 'MEDIUM',
        whatsappStatus: 'NOT_VERIFIED'
      };

      const tiktokCandidate = {
        provider: 'TIKTOK_LEAD_GEN',
        externalBusinessId: 'tt_lead_112233',
        businessName: 'Apex Lighting Hub Uttara',
        phone: '+880 1711 998877', // Matches Tier 3 (Phone)
        newEvidence: {
          sourceType: 'TIKTOK_LEAD_GEN',
          sourceName: 'TikTok Lead Generation',
          externalId: 'tt_lead_112233',
          observedAt: new Date(),
          evidenceType: 'AUTHORIZED_INBOUND_LEAD'
        },
        newContacts: [
          {
            type: 'EMAIL' as const,
            value: 'apex.lighting@gmail.com',
            source: 'TIKTOK_LEAD_GEN',
            verifiedAt: new Date(),
            confidence: 'HIGH' as const
          }
        ]
      };

      const merged = mergeBusinessRecords(fbBuyer, tiktokCandidate, dummyProductContext);

      // Verify both evidences are preserved intact (Section 14)
      expect(merged.sourceEvidences).toHaveLength(2);
      expect(merged.sourceEvidences.some(e => e.sourceType === 'FACEBOOK_BUSINESS')).toBe(true);
      expect(merged.sourceEvidences.some(e => e.sourceType === 'TIKTOK_LEAD_GEN')).toBe(true);

      // Source confidence upgraded to HIGH
      expect(merged.sourceConfidence).toBe('HIGH');

      // Strict PHONE != WHATSAPP: phone is NOT converted to WhatsApp
      expect(merged.whatsappStatus).toBe('NOT_VERIFIED');
      expect(merged.enrichedContacts.some(c => c.type === 'WHATSAPP')).toBe(false);
      expect(merged.enrichedContacts.some(c => c.type === 'EMAIL')).toBe(true);
    });
  });
});
