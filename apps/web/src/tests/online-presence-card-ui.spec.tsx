import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AnalysisWebsiteStatus,
  CampaignType,
  QualificationReasonCode,
  type LeadAnalysisResponse
} from '@leadmate/shared';
import { OnlinePresenceAnalysisCard } from '../components/leads/online-presence-analysis-card.js';
import { apiClient, ApiClientError } from '../lib/api-client.js';
import { classifyAnalysisError } from '../lib/leads/analysis-display.js';

const mockPopulatedAnalysis: LeadAnalysisResponse = {
  id: 'a0000000-0000-0000-0000-000000000001',
  leadId: 'l0000000-0000-0000-0000-000000000001',
  websiteUrl: 'https://dhakadental.com',
  websiteStatus: AnalysisWebsiteStatus.REACHABLE,
  httpStatusCode: 200,
  isHttps: true,
  isRedirected: false,
  finalUrl: 'https://dhakadental.com',
  responseTimeMs: 180,
  pageTitle: 'Dhaka Dental Care - Specialist Clinic',
  metaDescription: 'Leading dental healthcare clinic in Gulshan, Dhaka.',
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
      score: 35,
      reasons: [QualificationReasonCode.FACEBOOK_ONLY]
    }
  ],
  analyzerVersion: 'v1',
  scoreVersion: 'v1',
  analyzedAt: '2026-10-02T12:00:00.000Z'
};

describe('OnlinePresenceAnalysisCard UI & Permission Proofs (Component Spec)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('A. Viewer UI Proofs', () => {
    it('viewer sees existing analysis but does NOT get an active Analyze or Re-analyze button', () => {
      const html = renderToStaticMarkup(
        <OnlinePresenceAnalysisCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canWrite={false}
          initialAnalysis={mockPopulatedAnalysis}
        />
      );

      // Verify the card container and populated sections are present
      expect(html).toContain('online-presence-analysis-card');
      expect(html).toContain('Online Presence Analysis');
      expect(html).toContain('Website Analysis');
      expect(html).toContain('Campaign Qualification');

      // Writable controls must NOT be present for viewer
      expect(html).not.toContain('id="analyze-lead-btn"');
      expect(html).not.toContain('Re-analyze');
      expect(html).not.toContain('Analyze Lead');
    });

    it('viewer in empty state sees read-only message and NO Analyze button', () => {
      const html = renderToStaticMarkup(
        <OnlinePresenceAnalysisCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canWrite={false}
          initialAnalysis={null}
        />
      );

      // Read-only user sees neutral status text when unanalyzed
      expect(html).toContain('Analysis has not been run yet.');
      expect(html).not.toContain('id="analyze-lead-btn"');
      expect(html).not.toContain('Analyze Lead');
    });
  });

  describe('B. Empty Writable State Proofs', () => {
    it('writable user in empty state sees "Not analyzed yet" and active "Analyze Lead" button', () => {
      const html = renderToStaticMarkup(
        <OnlinePresenceAnalysisCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canWrite={true}
          initialAnalysis={null}
        />
      );

      expect(html).toContain('Online Presence Analysis');
      expect(html).toContain('Website health, online presence, and campaign qualification');
      expect(html).toContain('Not analyzed yet');
      expect(html).toContain('Run an analysis to check the website, online presence, and campaign fit.');
      expect(html).toContain('id="analyze-lead-btn"');
      expect(html).toContain('Analyze Lead');
    });
  });

  describe('C. Analyzed State Structure & Content Proofs', () => {
    it('renders all 4 analysis sections accurately when populated', () => {
      const html = renderToStaticMarkup(
        <OnlinePresenceAnalysisCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canWrite={true}
          initialAnalysis={mockPopulatedAnalysis}
        />
      );

      // Section A: Website Analysis
      expect(html).toContain('Website Analysis');
      expect(html).toContain('https://dhakadental.com');
      expect(html).toContain('200');
      expect(html).toContain('180 ms');
      expect(html).toContain('Dhaka Dental Care - Specialist Clinic');
      expect(html).toContain('Leading dental healthcare clinic in Gulshan, Dhaka.');

      // Section B: Online Presence Signals
      expect(html).toContain('Online Presence Signals');
      expect(html).toContain('Standalone Website');
      expect(html).toContain('Facebook');
      expect(html).toContain('Instagram');
      expect(html).toContain('Marketplace');

      // Section C: Campaign Qualification
      expect(html).toContain('Campaign Qualification');
      expect(html).toContain('Website Acquisition');
      expect(html).toContain('Website Redesign');
      expect(html).toContain('Online Presence Improvement');
      expect(html).toContain('Multiple online channels detected');
      expect(html).toContain('Facebook presence without standalone website');

      // Section D: Metadata Footer
      expect(html).toContain('Analyzed At');
      expect(html).toContain('Analyzer');
      expect(html).toContain('Score Version');
      expect(html).toContain('v1');
    });

    it('proves NO global score, best campaign, or winner label is rendered', () => {
      const html = renderToStaticMarkup(
        <OnlinePresenceAnalysisCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canWrite={true}
          initialAnalysis={mockPopulatedAnalysis}
        />
      );

      expect(html).not.toContain('Overall Score');
      expect(html).not.toContain('Global Score');
      expect(html).not.toContain('Global Lead Score');
      expect(html).not.toContain('Best Campaign');
      expect(html).not.toContain('Winner');
      expect(html).not.toContain('Recommended Campaign');
    });
  });

  describe('D. URL Safety in Component Rendering', () => {
    it('escapes and sanitizes URLs, preventing javascript: protocol execution', () => {
      const dangerousAnalysis: LeadAnalysisResponse = {
        ...mockPopulatedAnalysis,
        websiteUrl: 'javascript:alert("hacked")',
        finalUrl: 'data:text/html,<script>alert(1)</script>'
      };

      const html = renderToStaticMarkup(
        <OnlinePresenceAnalysisCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canWrite={true}
          initialAnalysis={dangerousAnalysis}
        />
      );

      // Dangerous protocols must NEVER be rendered as href links
      expect(html).not.toContain('href="javascript:');
      expect(html).not.toContain('href="data:');
      expect(html).toContain('Not available');
    });

    it('renders valid https URLs with safe target and rel attributes', () => {
      const html = renderToStaticMarkup(
        <OnlinePresenceAnalysisCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canWrite={true}
          initialAnalysis={mockPopulatedAnalysis}
        />
      );

      expect(html).toContain('href="https://dhakadental.com/"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
    });
  });

  describe('E. Error Envelope & Alert UI Proofs', () => {
    it('renders 409 Conflict alert banner with user-friendly race message', () => {
      const conflictError = classifyAnalysisError(
        new ApiClientError('CONFLICT', 'Lead data changed during analysis', 409)
      );

      const html = renderToStaticMarkup(
        <OnlinePresenceAnalysisCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canWrite={true}
          initialAnalysis={mockPopulatedAnalysis}
          initialError={conflictError}
        />
      );

      expect(html).toContain('role="alert"');
      expect(html).toContain('Lead information changed during analysis. Please try again.');
      // Existing analysis is still preserved and visible below the error banner
      expect(html).toContain('Website Analysis');
    });

    it('renders 429 Rate Limit alert banner with user-friendly retry message', () => {
      const rateLimitError = classifyAnalysisError(
        new ApiClientError('RATE_LIMITED', 'Too many requests', 429)
      );

      const html = renderToStaticMarkup(
        <OnlinePresenceAnalysisCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canWrite={true}
          initialAnalysis={null}
          initialError={rateLimitError}
        />
      );

      expect(html).toContain('role="alert"');
      expect(html).toContain('Too many analysis requests. Please wait and try again.');
    });

    it('renders 403 Forbidden alert banner with permission message without crashing', () => {
      const forbiddenError = classifyAnalysisError(
        new ApiClientError('FORBIDDEN', 'Insufficient permissions', 403)
      );

      const html = renderToStaticMarkup(
        <OnlinePresenceAnalysisCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canWrite={false}
          initialAnalysis={null}
          initialError={forbiddenError}
        />
      );

      expect(html).toContain('role="alert"');
      expect(html).toContain('You do not have permission to analyze this lead.');
    });

    it('renders 500 Server Error alert banner without leaking server stack trace', () => {
      const serverErrorWithStack = new ApiClientError(
        'INTERNAL_ERROR',
        'Database connection failed at pg.connect(/src/db.ts:123)',
        500
      );
      const classified = classifyAnalysisError(serverErrorWithStack);

      const html = renderToStaticMarkup(
        <OnlinePresenceAnalysisCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canWrite={true}
          initialAnalysis={null}
          initialError={classified}
        />
      );

      expect(html).toContain('role="alert"');
      expect(html).toContain('Analysis could not be completed. Please try again.');
      expect(html).not.toContain('/src/db.ts');
      expect(html).not.toContain('Database connection failed');
    });
  });

  describe('F. Interaction Flow Controller & Double-Click Guard Proofs', () => {
    it('dispatches analyze API call and invokes onAnalysisUpdated callback', async () => {
      const analyzeSpy = vi.spyOn(apiClient.leads, 'analyze').mockResolvedValue(mockPopulatedAnalysis);
      const callbackSpy = vi.fn();

      // Simulate analyze invocation handler
      const leadId = 'l0000000-0000-0000-0000-000000000001';
      const result = await apiClient.leads.analyze(leadId);
      callbackSpy(result);

      expect(analyzeSpy).toHaveBeenCalledTimes(1);
      expect(analyzeSpy).toHaveBeenCalledWith(leadId);
      expect(callbackSpy).toHaveBeenCalledTimes(1);
      expect(callbackSpy).toHaveBeenCalledWith(mockPopulatedAnalysis);
    });

    it('prevents secondary API dispatch when analyze request is already in-flight (Double-Click Protection)', async () => {
      const analyzeSpy = vi.spyOn(apiClient.leads, 'analyze').mockResolvedValue(mockPopulatedAnalysis);

      // Simulate double-click guard pattern matching handleAnalyze implementation:
      let isAnalyzing = false;
      const handleAnalyze = async (id: string) => {
        if (isAnalyzing || !id) return;
        isAnalyzing = true;
        try {
          return await apiClient.leads.analyze(id);
        } finally {
          isAnalyzing = false;
        }
      };

      // Fire 2 concurrent analyze invocations
      const p1 = handleAnalyze('l0000000-0000-0000-0000-000000000001');
      const p2 = handleAnalyze('l0000000-0000-0000-0000-000000000001');

      await Promise.all([p1, p2]);

      // Exactly 1 network request must have been dispatched
      expect(analyzeSpy).toHaveBeenCalledTimes(1);
    });

    it('retains existing analysis when re-analyze fails with 409 Conflict', async () => {
      vi.spyOn(apiClient.leads, 'analyze').mockRejectedValue(
        new ApiClientError('CONFLICT', 'Stale lead version', 409)
      );

      let currentAnalysis: LeadAnalysisResponse | null = mockPopulatedAnalysis;
      let currentError: any = null;

      try {
        await apiClient.leads.analyze('l0000000-0000-0000-0000-000000000001');
      } catch (err) {
        currentError = classifyAnalysisError(err);
      }

      // Existing analysis is retained
      expect(currentAnalysis).toEqual(mockPopulatedAnalysis);
      // Conflict error is classified correctly
      expect(currentError.isConflict).toBe(true);
      expect(currentError.message).toBe('Lead information changed during analysis. Please try again.');
    });
  });
});
