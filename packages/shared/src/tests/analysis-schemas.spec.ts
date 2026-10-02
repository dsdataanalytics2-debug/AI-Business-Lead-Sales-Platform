import { describe, it, expect } from 'vitest';
import {
  campaignScoreSchema,
  leadAnalysisResponseSchema,
  AnalysisWebsiteStatus,
  CampaignType,
  QualificationReasonCode
} from '../index.js';

describe('M2 Step 1: Shared Analysis & Qualification Schemas', () => {
  /* -----------------------------------------------------------------
   * 1. CampaignScoreSchema Validation
   * ----------------------------------------------------------------- */
  it('1. Valid campaign score contract parses successfully', () => {
    const valid = {
      campaignType: CampaignType.WEBSITE_ACQUISITION,
      score: 85,
      reasons: [
        QualificationReasonCode.NO_WEBSITE,
        QualificationReasonCode.FACEBOOK_ONLY,
        QualificationReasonCode.HAS_MOBILE_PHONE
      ]
    };

    const parsed = campaignScoreSchema.parse(valid);
    expect(parsed.campaignType).toBe(CampaignType.WEBSITE_ACQUISITION);
    expect(parsed.score).toBe(85);
    expect(parsed.reasons).toHaveLength(3);
  });

  it('2. Negative score rejected (< 0)', () => {
    const invalid = {
      campaignType: CampaignType.WEBSITE_REDESIGN,
      score: -5,
      reasons: []
    };
    expect(() => campaignScoreSchema.parse(invalid)).toThrow();
  });

  it('3. Excessive score rejected (> 100)', () => {
    const invalid = {
      campaignType: CampaignType.WEBSITE_REDESIGN,
      score: 105,
      reasons: []
    };
    expect(() => campaignScoreSchema.parse(invalid)).toThrow();
  });

  it('4. Unknown campaign type rejected', () => {
    const invalid = {
      campaignType: 'UNKNOWN_CAMPAIGN_TYPE',
      score: 50,
      reasons: []
    };
    expect(() => campaignScoreSchema.parse(invalid)).toThrow();
  });

  it('5. Unknown qualification reason code rejected', () => {
    const invalid = {
      campaignType: CampaignType.ONLINE_PRESENCE_IMPROVEMENT,
      score: 40,
      reasons: ['NON_EXISTENT_REASON_CODE']
    };
    expect(() => campaignScoreSchema.parse(invalid)).toThrow();
  });

  /* -----------------------------------------------------------------
   * 2. LeadAnalysisResponseSchema Validation & Security
   * ----------------------------------------------------------------- */
  it('6. Valid full analysis response contract parses successfully', () => {
    const valid = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      leadId: '223e4567-e89b-12d3-a456-426614174000',
      websiteUrl: 'https://example.com.bd',
      websiteStatus: AnalysisWebsiteStatus.REACHABLE,
      httpStatusCode: 200,
      isHttps: true,
      isRedirected: false,
      finalUrl: 'https://example.com.bd',
      responseTimeMs: 320,
      pageTitle: 'Example Business Dhaka',
      metaDescription: 'Best services in Dhaka',
      hasWebsite: true,
      hasFacebook: true,
      hasInstagram: false,
      hasMarketplace: false,
      campaignScores: [
        {
          campaignType: CampaignType.WEBSITE_ACQUISITION,
          score: 0,
          reasons: []
        },
        {
          campaignType: CampaignType.WEBSITE_REDESIGN,
          score: 25,
          reasons: [QualificationReasonCode.MULTI_CHANNEL_PRESENCE]
        },
        {
          campaignType: CampaignType.ONLINE_PRESENCE_IMPROVEMENT,
          score: 10,
          reasons: [QualificationReasonCode.HAS_MOBILE_PHONE]
        }
      ],
      analyzerVersion: 'v1',
      scoreVersion: 'v1',
      analyzedAt: new Date().toISOString()
    };

    const parsed = leadAnalysisResponseSchema.parse(valid);
    expect(parsed.id).toBe(valid.id);
    expect(parsed.leadId).toBe(valid.leadId);
    expect(parsed.websiteStatus).toBe(AnalysisWebsiteStatus.REACHABLE);
    expect(parsed.campaignScores).toHaveLength(3);
  });

  it('7. Analysis response strictly rejects organizationId (data minimization)', () => {
    const injected = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      leadId: '223e4567-e89b-12d3-a456-426614174000',
      organizationId: '323e4567-e89b-12d3-a456-426614174000', // Injected
      websiteUrl: null,
      websiteStatus: AnalysisWebsiteStatus.NOT_APPLICABLE,
      httpStatusCode: null,
      isHttps: false,
      isRedirected: false,
      finalUrl: null,
      responseTimeMs: null,
      pageTitle: null,
      metaDescription: null,
      hasWebsite: false,
      hasFacebook: false,
      hasInstagram: false,
      hasMarketplace: false,
      campaignScores: [],
      analyzerVersion: 'v1',
      scoreVersion: 'v1',
      analyzedAt: new Date().toISOString()
    };

    expect(() => leadAnalysisResponseSchema.parse(injected)).toThrow();
  });

  it('8. Analysis response strictly rejects overallFitScore (no global score)', () => {
    const injected = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      leadId: '223e4567-e89b-12d3-a456-426614174000',
      overallFitScore: 85, // Injected global score
      websiteUrl: null,
      websiteStatus: AnalysisWebsiteStatus.NOT_APPLICABLE,
      httpStatusCode: null,
      isHttps: false,
      isRedirected: false,
      finalUrl: null,
      responseTimeMs: null,
      pageTitle: null,
      metaDescription: null,
      hasWebsite: false,
      hasFacebook: false,
      hasInstagram: false,
      hasMarketplace: false,
      campaignScores: [],
      analyzerVersion: 'v1',
      scoreVersion: 'v1',
      analyzedAt: new Date().toISOString()
    };

    expect(() => leadAnalysisResponseSchema.parse(injected)).toThrow();
  });

  it('9. Invalid websiteStatus enum rejected', () => {
    const invalid = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      leadId: '223e4567-e89b-12d3-a456-426614174000',
      websiteUrl: null,
      websiteStatus: 'UNKNOWN_WEBSITE_STATUS',
      httpStatusCode: null,
      isHttps: false,
      isRedirected: false,
      finalUrl: null,
      responseTimeMs: null,
      pageTitle: null,
      metaDescription: null,
      hasWebsite: false,
      hasFacebook: false,
      hasInstagram: false,
      hasMarketplace: false,
      campaignScores: [],
      analyzerVersion: 'v1',
      scoreVersion: 'v1',
      analyzedAt: new Date().toISOString()
    };

    expect(() => leadAnalysisResponseSchema.parse(invalid)).toThrow();
  });
});
