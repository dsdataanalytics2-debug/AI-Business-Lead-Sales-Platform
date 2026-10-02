import { describe, it, expect } from 'vitest';
import {
  calculateCampaignScores,
  SCORE_VERSION
} from '../analysis/qualification-engine.js';
import {
  AnalysisWebsiteStatus,
  CampaignType,
  QualificationReasonCode,
  ContactType,
  PhoneType,
  ContactStatus,
  WhatsAppStatus,
  type QualificationScoringInput
} from '@leadmate/shared';

describe('M2 Step 1: Pure Deterministic Qualification Scoring Engine', () => {
  /* -----------------------------------------------------------------
   * 1. Version Export Verification
   * ----------------------------------------------------------------- */
  it('1. Exports canonical score version v1', () => {
    expect(SCORE_VERSION).toBe('v1');
  });

  /* -----------------------------------------------------------------
   * 2. Campaign Gating Tests
   * ----------------------------------------------------------------- */
  describe('Campaign Gating', () => {
    it('2. Acquisition eligible for NOT_APPLICABLE, UNREACHABLE, and TIMEOUT', () => {
      const statuses = [
        AnalysisWebsiteStatus.NOT_APPLICABLE,
        AnalysisWebsiteStatus.UNREACHABLE,
        AnalysisWebsiteStatus.TIMEOUT
      ];

      for (const status of statuses) {
        const input: QualificationScoringInput = {
          websiteStatus: status,
          hasWebsite: status !== AnalysisWebsiteStatus.NOT_APPLICABLE,
          hasFacebook: false,
          hasInstagram: false,
          hasMarketplace: false,
          contacts: []
        };
        const scores = calculateCampaignScores(input);
        const acq = scores.find((s) => s.campaignType === CampaignType.WEBSITE_ACQUISITION);
        expect(acq).toBeDefined();
        expect(acq!.score).toBeGreaterThan(0);
        expect(acq!.reasons.length).toBeGreaterThan(0);
      }
    });

    it('3. Acquisition gated out (score 0, reasons []) for REACHABLE', () => {
      const input: QualificationScoringInput = {
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        hasWebsite: true,
        hasFacebook: true,
        hasInstagram: false,
        hasMarketplace: false,
        rating: 5.0,
        reviewCount: 50,
        contacts: [
          {
            type: ContactType.PHONE,
            normalizedValue: '+8801712345678',
            phoneType: PhoneType.MOBILE,
            status: ContactStatus.FOUND,
            isPrimary: true,
            isSuppressed: false
          }
        ]
      };
      const scores = calculateCampaignScores(input);
      const acq = scores.find((s) => s.campaignType === CampaignType.WEBSITE_ACQUISITION);
      expect(acq!.score).toBe(0);
      expect(acq!.reasons).toEqual([]);
    });

    it('4. Inconclusive states strictly gate out Acquisition even with full signals', () => {
      const inconclusiveStatuses = [
        AnalysisWebsiteStatus.ACCESS_RESTRICTED,
        AnalysisWebsiteStatus.BLOCKED_SSRF,
        AnalysisWebsiteStatus.INVALID_URL,
        AnalysisWebsiteStatus.NON_HTML
      ];

      for (const status of inconclusiveStatuses) {
        const input: QualificationScoringInput = {
          websiteStatus: status,
          hasWebsite: true,
          hasFacebook: true,
          hasInstagram: true,
          hasMarketplace: true,
          rating: 5.0,
          reviewCount: 100,
          contacts: [
            {
              type: ContactType.PHONE,
              normalizedValue: '+8801712345678',
              phoneType: PhoneType.MOBILE,
              status: ContactStatus.VERIFIED,
              isPrimary: true,
              isSuppressed: false
            },
            {
              type: ContactType.EMAIL,
              normalizedValue: 'info@example.com',
              status: ContactStatus.FOUND,
              isPrimary: true,
              isSuppressed: false
            },
            {
              type: ContactType.WHATSAPP,
              normalizedValue: '+8801712345678',
              status: ContactStatus.FOUND,
              whatsappStatus: WhatsAppStatus.CONFIRMED,
              isPrimary: false,
              isSuppressed: false
            }
          ]
        };

        const scores = calculateCampaignScores(input);
        const acq = scores.find((s) => s.campaignType === CampaignType.WEBSITE_ACQUISITION);
        expect(acq!.score).toBe(0);
        expect(acq!.reasons).toEqual([]);
      }
    });

    it('5. Redesign applies rules ONLY when REACHABLE; all other statuses evaluate to 0 / []', () => {
      const nonReachableStatuses = [
        AnalysisWebsiteStatus.NOT_APPLICABLE,
        AnalysisWebsiteStatus.UNREACHABLE,
        AnalysisWebsiteStatus.TIMEOUT,
        AnalysisWebsiteStatus.ACCESS_RESTRICTED,
        AnalysisWebsiteStatus.BLOCKED_SSRF,
        AnalysisWebsiteStatus.INVALID_URL,
        AnalysisWebsiteStatus.NON_HTML
      ];

      for (const status of nonReachableStatuses) {
        const input: QualificationScoringInput = {
          websiteStatus: status,
          isHttps: false, // Would be +35 if reachable
          metaDescription: null, // Would be +25 if reachable
          pageTitle: 'Short', // Would be +15 if reachable
          responseTimeMs: 3000, // Would be +10 if reachable
          hasWebsite: status !== AnalysisWebsiteStatus.NOT_APPLICABLE,
          hasFacebook: true,
          hasInstagram: false,
          hasMarketplace: false,
          contacts: [
            {
              type: ContactType.PHONE,
              normalizedValue: '+8801712345678',
              phoneType: PhoneType.MOBILE,
              status: ContactStatus.FOUND,
              isPrimary: true,
              isSuppressed: false
            }
          ]
        };

        const scores = calculateCampaignScores(input);
        const redesign = scores.find((s) => s.campaignType === CampaignType.WEBSITE_REDESIGN);
        expect(redesign!.score).toBe(0);
        expect(redesign!.reasons).toEqual([]);
      }
    });
  });

  /* -----------------------------------------------------------------
   * 3. Individual Scoring Rule Assertions
   * ----------------------------------------------------------------- */
  describe('Exact Rule Scoring', () => {
    it('6. Evaluates NO_WEBSITE (+40) for NOT_APPLICABLE', () => {
      const scores = calculateCampaignScores({
        websiteStatus: AnalysisWebsiteStatus.NOT_APPLICABLE,
        hasWebsite: false,
        hasFacebook: false,
        hasInstagram: false,
        hasMarketplace: false,
        contacts: []
      });
      const acq = scores.find((s) => s.campaignType === CampaignType.WEBSITE_ACQUISITION)!;
      expect(acq.score).toBe(40);
      expect(acq.reasons).toEqual([QualificationReasonCode.NO_WEBSITE]);
    });

    it('7. Evaluates WEBSITE_UNREACHABLE (+35) for UNREACHABLE', () => {
      const scores = calculateCampaignScores({
        websiteStatus: AnalysisWebsiteStatus.UNREACHABLE,
        hasWebsite: true,
        hasFacebook: false,
        hasInstagram: false,
        hasMarketplace: false,
        contacts: []
      });
      const acq = scores.find((s) => s.campaignType === CampaignType.WEBSITE_ACQUISITION)!;
      expect(acq.score).toBe(35);
      expect(acq.reasons).toEqual([QualificationReasonCode.WEBSITE_UNREACHABLE]);
    });

    it('8. Evaluates WEBSITE_TIMEOUT (+30) for TIMEOUT', () => {
      const scores = calculateCampaignScores({
        websiteStatus: AnalysisWebsiteStatus.TIMEOUT,
        hasWebsite: true,
        hasFacebook: false,
        hasInstagram: false,
        hasMarketplace: false,
        contacts: []
      });
      const acq = scores.find((s) => s.campaignType === CampaignType.WEBSITE_ACQUISITION)!;
      expect(acq.score).toBe(30);
      expect(acq.reasons).toEqual([QualificationReasonCode.WEBSITE_TIMEOUT]);
    });

    it('9. Evaluates FACEBOOK_ONLY (+20 acq / +35 presence) when FB exists without website', () => {
      const scores = calculateCampaignScores({
        websiteStatus: AnalysisWebsiteStatus.NOT_APPLICABLE,
        hasWebsite: false,
        hasFacebook: true,
        hasInstagram: false,
        hasMarketplace: false,
        contacts: []
      });
      const acq = scores.find((s) => s.campaignType === CampaignType.WEBSITE_ACQUISITION)!;
      expect(acq.score).toBe(60); // 40 (NO_WEBSITE) + 20 (FACEBOOK_ONLY)
      expect(acq.reasons).toContain(QualificationReasonCode.FACEBOOK_ONLY);

      const presence = scores.find((s) => s.campaignType === CampaignType.ONLINE_PRESENCE_IMPROVEMENT)!;
      expect(presence.score).toBe(35);
      expect(presence.reasons).toContain(QualificationReasonCode.FACEBOOK_ONLY);
    });

    it('10. Evaluates INSTAGRAM_ONLY (+30 presence) when Insta exists without website or FB', () => {
      const scores = calculateCampaignScores({
        websiteStatus: AnalysisWebsiteStatus.NOT_APPLICABLE,
        hasWebsite: false,
        hasFacebook: false,
        hasInstagram: true,
        hasMarketplace: false,
        contacts: []
      });
      const presence = scores.find((s) => s.campaignType === CampaignType.ONLINE_PRESENCE_IMPROVEMENT)!;
      expect(presence.score).toBe(30);
      expect(presence.reasons).toEqual([QualificationReasonCode.INSTAGRAM_ONLY]);
    });

    it('11. Evaluates HIGH_RATING_NO_WEB (+15) only when rating >= 4.0 and reviewCount >= 5 with broken/no site', () => {
      const scores = calculateCampaignScores({
        websiteStatus: AnalysisWebsiteStatus.NOT_APPLICABLE,
        hasWebsite: false,
        hasFacebook: false,
        hasInstagram: false,
        hasMarketplace: false,
        rating: 4.5,
        reviewCount: 12,
        contacts: []
      });
      const acq = scores.find((s) => s.campaignType === CampaignType.WEBSITE_ACQUISITION)!;
      expect(acq.score).toBe(55); // 40 (NO_WEBSITE) + 15 (HIGH_RATING_NO_WEB)
      expect(acq.reasons).toContain(QualificationReasonCode.HIGH_RATING_NO_WEB);
    });

    it('12. Evaluates Redesign defect signals on REACHABLE site (NO_HTTPS, NO_META, SHORT_TITLE, SLOW_RESPONSE, MULTI_CHANNEL)', () => {
      const scores = calculateCampaignScores({
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        isHttps: false, // +35
        metaDescription: null, // +25
        pageTitle: 'Shop', // +15 (< 10 chars)
        responseTimeMs: 2800, // +10 (> 2500 ms)
        hasWebsite: true,
        hasFacebook: true, // +15
        hasInstagram: false,
        hasMarketplace: false,
        contacts: []
      });
      const redesign = scores.find((s) => s.campaignType === CampaignType.WEBSITE_REDESIGN)!;
      expect(redesign.score).toBe(100); // 35 + 25 + 15 + 10 + 15 = 100
      expect(redesign.reasons).toEqual([
        QualificationReasonCode.NO_HTTPS,
        QualificationReasonCode.NO_META_DESCRIPTION,
        QualificationReasonCode.SHORT_PAGE_TITLE,
        QualificationReasonCode.SLOW_RESPONSE,
        QualificationReasonCode.MULTI_CHANNEL_PRESENCE
      ]);
    });

    it('13. Evaluates HAS_ESTABLISHED_REVIEWS (+20) for reviewCount >= 10 in presence improvement', () => {
      const scores = calculateCampaignScores({
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        isHttps: true,
        pageTitle: 'Comprehensive Dental Care Centre Gulshan',
        metaDescription: 'Trusted dental healthcare in Dhaka',
        hasWebsite: true,
        hasFacebook: false,
        hasInstagram: false,
        hasMarketplace: false,
        reviewCount: 15,
        contacts: []
      });
      const presence = scores.find((s) => s.campaignType === CampaignType.ONLINE_PRESENCE_IMPROVEMENT)!;
      expect(presence.score).toBe(20);
      expect(presence.reasons).toEqual([QualificationReasonCode.HAS_ESTABLISHED_REVIEWS]);
    });
  });

  /* -----------------------------------------------------------------
   * 4. Contact Trust & Normalized Value Rules
   * ----------------------------------------------------------------- */
  describe('Contact Trust & Normalized Value Rules', () => {
    it('14. Valid canonical BD mobile (+8801XXXXXXXXX) scores for FOUND and VERIFIED', () => {
      const baseInput: QualificationScoringInput = {
        websiteStatus: AnalysisWebsiteStatus.NOT_APPLICABLE,
        hasWebsite: false,
        hasFacebook: false,
        hasInstagram: false,
        hasMarketplace: false,
        contacts: []
      };

      // Test FOUND + valid canonical
      const foundScores = calculateCampaignScores({
        ...baseInput,
        contacts: [
          {
            type: ContactType.PHONE,
            normalizedValue: '+8801712345678',
            phoneType: PhoneType.MOBILE,
            status: ContactStatus.FOUND,
            isPrimary: true,
            isSuppressed: false
          }
        ]
      });
      const acqFound = foundScores.find((s) => s.campaignType === CampaignType.WEBSITE_ACQUISITION)!;
      expect(acqFound.reasons).toContain(QualificationReasonCode.HAS_MOBILE_PHONE);

      // Test VERIFIED + valid canonical
      const verifiedScores = calculateCampaignScores({
        ...baseInput,
        contacts: [
          {
            type: ContactType.PHONE,
            normalizedValue: '+8801812345678',
            phoneType: PhoneType.MOBILE,
            status: ContactStatus.VERIFIED,
            isPrimary: true,
            isSuppressed: false
          }
        ]
      });
      const acqVerified = verifiedScores.find((s) => s.campaignType === CampaignType.WEBSITE_ACQUISITION)!;
      expect(acqVerified.reasons).toContain(QualificationReasonCode.HAS_MOBILE_PHONE);
    });

    it('15. Malformed normalizedValue, INVALID_FORMAT, suppressed, and LANDLINE phones do NOT score HAS_MOBILE_PHONE', () => {
      const invalidContacts = [
        {
          // Malformed / non-canonical normalizedValue
          type: ContactType.PHONE,
          normalizedValue: '+1234567890',
          phoneType: PhoneType.MOBILE,
          status: ContactStatus.FOUND,
          isPrimary: true,
          isSuppressed: false
        },
        {
          // Invalid operator prefix
          type: ContactType.PHONE,
          normalizedValue: '+8801112345678',
          phoneType: PhoneType.MOBILE,
          status: ContactStatus.FOUND,
          isPrimary: true,
          isSuppressed: false
        },
        {
          // INVALID_FORMAT status
          type: ContactType.PHONE,
          normalizedValue: '+8801712345678',
          phoneType: PhoneType.MOBILE,
          status: ContactStatus.INVALID_FORMAT,
          isPrimary: true,
          isSuppressed: false
        },
        {
          // Suppressed
          type: ContactType.PHONE,
          normalizedValue: '+8801712345678',
          phoneType: PhoneType.MOBILE,
          status: ContactStatus.FOUND,
          isPrimary: true,
          isSuppressed: true
        },
        {
          // Landline phone
          type: ContactType.PHONE,
          normalizedValue: '+88029876543',
          phoneType: PhoneType.LANDLINE,
          status: ContactStatus.FOUND,
          isPrimary: true,
          isSuppressed: false
        }
      ];

      for (const contact of invalidContacts) {
        const scores = calculateCampaignScores({
          websiteStatus: AnalysisWebsiteStatus.NOT_APPLICABLE,
          hasWebsite: false,
          hasFacebook: false,
          hasInstagram: false,
          hasMarketplace: false,
          contacts: [contact]
        });
        const acq = scores.find((s) => s.campaignType === CampaignType.WEBSITE_ACQUISITION)!;
        expect(acq.reasons).not.toContain(QualificationReasonCode.HAS_MOBILE_PHONE);
      }
    });

    it('16. Valid primary email scores; malformed, non-primary, or suppressed email does NOT score HAS_PRIMARY_EMAIL', () => {
      const baseInput: QualificationScoringInput = {
        websiteStatus: AnalysisWebsiteStatus.NOT_APPLICABLE,
        hasWebsite: false,
        hasFacebook: false,
        hasInstagram: false,
        hasMarketplace: false,
        contacts: []
      };

      // Valid primary FOUND email
      const validScores = calculateCampaignScores({
        ...baseInput,
        contacts: [
          {
            type: ContactType.EMAIL,
            normalizedValue: 'info@example.com',
            status: ContactStatus.FOUND,
            isPrimary: true,
            isSuppressed: false
          }
        ]
      });
      expect(validScores[0].reasons).toContain(QualificationReasonCode.HAS_PRIMARY_EMAIL);

      // Malformed email
      const malformedScores = calculateCampaignScores({
        ...baseInput,
        contacts: [
          {
            type: ContactType.EMAIL,
            normalizedValue: 'not-an-email',
            status: ContactStatus.FOUND,
            isPrimary: true,
            isSuppressed: false
          }
        ]
      });
      expect(malformedScores[0].reasons).not.toContain(QualificationReasonCode.HAS_PRIMARY_EMAIL);

      // Non-primary email
      const nonPrimaryScores = calculateCampaignScores({
        ...baseInput,
        contacts: [
          {
            type: ContactType.EMAIL,
            normalizedValue: 'info@example.com',
            status: ContactStatus.FOUND,
            isPrimary: false,
            isSuppressed: false
          }
        ]
      });
      expect(nonPrimaryScores[0].reasons).not.toContain(QualificationReasonCode.HAS_PRIMARY_EMAIL);

      // Suppressed primary email
      const suppressedScores = calculateCampaignScores({
        ...baseInput,
        contacts: [
          {
            type: ContactType.EMAIL,
            normalizedValue: 'info@example.com',
            status: ContactStatus.FOUND,
            isPrimary: true,
            isSuppressed: true
          }
        ]
      });
      expect(suppressedScores[0].reasons).not.toContain(QualificationReasonCode.HAS_PRIMARY_EMAIL);
    });

    it('17. WhatsApp trust rules: valid WHATSAPP type with canonical BD mobile qualifies; malformed, landline, PHONE, EMAIL, and UNKNOWN rejected', () => {
      const baseInput: QualificationScoringInput = {
        websiteStatus: AnalysisWebsiteStatus.NOT_APPLICABLE,
        hasWebsite: false,
        hasFacebook: false,
        hasInstagram: false,
        hasMarketplace: false,
        contacts: []
      };

      // 1. WHATSAPP + PUBLICLY_LISTED + FOUND + valid canonical BD mobile => qualifies
      const listedScores = calculateCampaignScores({
        ...baseInput,
        contacts: [
          {
            type: ContactType.WHATSAPP,
            normalizedValue: '+8801712345678',
            status: ContactStatus.FOUND,
            whatsappStatus: WhatsAppStatus.PUBLICLY_LISTED,
            isPrimary: false,
            isSuppressed: false
          }
        ]
      });
      expect(listedScores[0].reasons).toContain(QualificationReasonCode.HAS_WHATSAPP);

      // 2. WHATSAPP + CONFIRMED + VERIFIED + valid canonical BD mobile => qualifies
      const confirmedVerifiedScores = calculateCampaignScores({
        ...baseInput,
        contacts: [
          {
            type: ContactType.WHATSAPP,
            normalizedValue: '+8801812345678',
            status: ContactStatus.VERIFIED,
            whatsappStatus: WhatsAppStatus.CONFIRMED,
            isPrimary: false,
            isSuppressed: false
          }
        ]
      });
      expect(confirmedVerifiedScores[0].reasons).toContain(QualificationReasonCode.HAS_WHATSAPP);

      // 3. WHATSAPP + UNKNOWN => rejected
      const unknownScores = calculateCampaignScores({
        ...baseInput,
        contacts: [
          {
            type: ContactType.WHATSAPP,
            normalizedValue: '+8801712345678',
            status: ContactStatus.FOUND,
            whatsappStatus: WhatsAppStatus.UNKNOWN,
            isPrimary: false,
            isSuppressed: false
          }
        ]
      });
      expect(unknownScores[0].reasons).not.toContain(QualificationReasonCode.HAS_WHATSAPP);

      // 4. WHATSAPP + malformed normalizedValue => rejected
      const malformedScores = calculateCampaignScores({
        ...baseInput,
        contacts: [
          {
            type: ContactType.WHATSAPP,
            normalizedValue: '+1234567890', // Non-BD
            status: ContactStatus.FOUND,
            whatsappStatus: WhatsAppStatus.CONFIRMED,
            isPrimary: false,
            isSuppressed: false
          }
        ]
      });
      expect(malformedScores[0].reasons).not.toContain(QualificationReasonCode.HAS_WHATSAPP);

      // 5. WHATSAPP + landline normalizedValue => rejected
      const landlineScores = calculateCampaignScores({
        ...baseInput,
        contacts: [
          {
            type: ContactType.WHATSAPP,
            normalizedValue: '+88029876543', // Landline
            status: ContactStatus.FOUND,
            whatsappStatus: WhatsAppStatus.CONFIRMED,
            isPrimary: false,
            isSuppressed: false
          }
        ]
      });
      expect(landlineScores[0].reasons).not.toContain(QualificationReasonCode.HAS_WHATSAPP);

      // 6. WHATSAPP + suppressed => rejected
      const suppressedScores = calculateCampaignScores({
        ...baseInput,
        contacts: [
          {
            type: ContactType.WHATSAPP,
            normalizedValue: '+8801712345678',
            status: ContactStatus.FOUND,
            whatsappStatus: WhatsAppStatus.CONFIRMED,
            isPrimary: false,
            isSuppressed: true // Suppressed
          }
        ]
      });
      expect(suppressedScores[0].reasons).not.toContain(QualificationReasonCode.HAS_WHATSAPP);

      // 7. PHONE + PUBLICLY_LISTED + valid mobile => rejected (PHONE != WHATSAPP)
      const phoneWithWaStatusScores = calculateCampaignScores({
        ...baseInput,
        contacts: [
          {
            type: ContactType.PHONE,
            phoneType: PhoneType.MOBILE,
            normalizedValue: '+8801712345678',
            status: ContactStatus.FOUND,
            whatsappStatus: WhatsAppStatus.PUBLICLY_LISTED,
            isPrimary: false,
            isSuppressed: false
          }
        ]
      });
      expect(phoneWithWaStatusScores[0].reasons).not.toContain(QualificationReasonCode.HAS_WHATSAPP);

      // 8. EMAIL + CONFIRMED => rejected
      const emailWithWaStatusScores = calculateCampaignScores({
        ...baseInput,
        contacts: [
          {
            type: ContactType.EMAIL,
            normalizedValue: 'info@example.com',
            status: ContactStatus.FOUND,
            whatsappStatus: WhatsAppStatus.CONFIRMED,
            isPrimary: false,
            isSuppressed: false
          }
        ]
      });
      expect(emailWithWaStatusScores[0].reasons).not.toContain(QualificationReasonCode.HAS_WHATSAPP);
    });
  });

  /* -----------------------------------------------------------------
   * 5. Defensive Normalization & Clamping
   * ----------------------------------------------------------------- */
  describe('Defensive Normalization & Score Clamping', () => {
    it('18. Whitespace-only pageTitle and metaDescription are treated as missing', () => {
      const scores = calculateCampaignScores({
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        isHttps: true,
        pageTitle: '    ', // Treated as missing (< 10 chars)
        metaDescription: '   \t\n  ', // Treated as missing
        hasWebsite: true,
        hasFacebook: false,
        hasInstagram: false,
        hasMarketplace: false,
        contacts: []
      });

      const redesign = scores.find((s) => s.campaignType === CampaignType.WEBSITE_REDESIGN)!;
      expect(redesign.reasons).toContain(QualificationReasonCode.NO_META_DESCRIPTION);
      expect(redesign.reasons).toContain(QualificationReasonCode.SHORT_PAGE_TITLE);
    });

    it('19. Score is strictly clamped to 100 max when raw points exceed 100', () => {
      const scores = calculateCampaignScores({
        websiteStatus: AnalysisWebsiteStatus.NOT_APPLICABLE, // +40
        hasWebsite: false,
        hasFacebook: true, // +20
        hasInstagram: false,
        hasMarketplace: false,
        rating: 5.0, // +15
        reviewCount: 20,
        contacts: [
          {
            type: ContactType.PHONE,
            normalizedValue: '+8801712345678',
            phoneType: PhoneType.MOBILE,
            status: ContactStatus.FOUND,
            isPrimary: true,
            isSuppressed: false // +15
          },
          {
            type: ContactType.EMAIL,
            normalizedValue: 'info@example.com',
            status: ContactStatus.FOUND,
            isPrimary: true,
            isSuppressed: false // +10
          },
          {
            type: ContactType.WHATSAPP,
            normalizedValue: '+8801712345678',
            status: ContactStatus.FOUND,
            whatsappStatus: WhatsAppStatus.CONFIRMED,
            isPrimary: false,
            isSuppressed: false // +10
          }
        ]
      });

      const acq = scores.find((s) => s.campaignType === CampaignType.WEBSITE_ACQUISITION)!;
      // Raw points: 40 + 20 + 15 + 15 + 10 + 10 = 110
      expect(acq.score).toBe(100);
      expect(acq.reasons).toHaveLength(6);
    });
  });

  /* -----------------------------------------------------------------
   * 6. Determinism & Immutability
   * ----------------------------------------------------------------- */
  describe('Output Determinism & Immutability', () => {
    it('20. Produces identical output across repeated runs on frozen input', () => {
      const input: QualificationScoringInput = Object.freeze({
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        isHttps: false,
        responseTimeMs: 3100,
        pageTitle: Object.freeze('Dental Care') as any,
        metaDescription: null,
        hasWebsite: true,
        hasFacebook: true,
        hasInstagram: false,
        hasMarketplace: false,
        rating: 4.8,
        reviewCount: 30,
        contacts: Object.freeze([
          Object.freeze({
            type: ContactType.PHONE,
            normalizedValue: '+8801712345678',
            phoneType: PhoneType.MOBILE,
            status: ContactStatus.FOUND,
            isPrimary: true,
            isSuppressed: false
          })
        ]) as any
      });

      const run1 = calculateCampaignScores(input);
      const run2 = calculateCampaignScores(input);

      expect(run1).toEqual(run2);

      // Verify exact canonical campaign order
      expect(run1[0].campaignType).toBe(CampaignType.WEBSITE_ACQUISITION);
      expect(run1[1].campaignType).toBe(CampaignType.WEBSITE_REDESIGN);
      expect(run1[2].campaignType).toBe(CampaignType.ONLINE_PRESENCE_IMPROVEMENT);
    });
  });
});
