import { describe, it, expect } from 'vitest';
import {
  AnalysisWebsiteStatus,
  CampaignType,
  QualificationReasonCode,
  OnlinePresenceType
} from '@leadmate/shared';
import { ApiClientError } from '../lib/api-client.js';
import {
  formatWebsiteStatusLabel,
  getWebsiteStatusBadgeClasses,
  formatCampaignTypeLabel,
  formatReasonCodeLabel,
  formatOnlinePresenceTypeLabel,
  classifyAnalysisError
} from '../lib/leads/analysis-display.js';

describe('Online Presence Analysis Display & Label Formatters (Unit Tests)', () => {
  describe('formatWebsiteStatusLabel', () => {
    it('maps all AnalysisWebsiteStatus values to human labels', () => {
      expect(formatWebsiteStatusLabel(AnalysisWebsiteStatus.NOT_APPLICABLE)).toBe('No Website');
      expect(formatWebsiteStatusLabel(AnalysisWebsiteStatus.REACHABLE)).toBe('Reachable');
      expect(formatWebsiteStatusLabel(AnalysisWebsiteStatus.UNREACHABLE)).toBe('Unreachable');
      expect(formatWebsiteStatusLabel(AnalysisWebsiteStatus.TIMEOUT)).toBe('Timed Out');
      expect(formatWebsiteStatusLabel(AnalysisWebsiteStatus.ACCESS_RESTRICTED)).toBe('Access Restricted');
      expect(formatWebsiteStatusLabel(AnalysisWebsiteStatus.BLOCKED_SSRF)).toBe('Blocked for Safety');
      expect(formatWebsiteStatusLabel(AnalysisWebsiteStatus.INVALID_URL)).toBe('Invalid URL');
      expect(formatWebsiteStatusLabel(AnalysisWebsiteStatus.NON_HTML)).toBe('Non-HTML Website');
    });

    it('returns "Not available" for null/undefined', () => {
      expect(formatWebsiteStatusLabel(null)).toBe('Not available');
      expect(formatWebsiteStatusLabel(undefined)).toBe('Not available');
    });

    it('gracefully handles unknown status', () => {
      expect(formatWebsiteStatusLabel('CUSTOM_STATE' as any)).toBe('CUSTOM STATE');
    });
  });

  describe('getWebsiteStatusBadgeClasses', () => {
    it('returns emerald classes for REACHABLE', () => {
      expect(getWebsiteStatusBadgeClasses(AnalysisWebsiteStatus.REACHABLE)).toContain('emerald');
    });

    it('returns red classes for UNREACHABLE and TIMEOUT', () => {
      expect(getWebsiteStatusBadgeClasses(AnalysisWebsiteStatus.UNREACHABLE)).toContain('red');
      expect(getWebsiteStatusBadgeClasses(AnalysisWebsiteStatus.TIMEOUT)).toContain('red');
    });

    it('returns amber classes for security/safety/restricted states', () => {
      expect(getWebsiteStatusBadgeClasses(AnalysisWebsiteStatus.BLOCKED_SSRF)).toContain('amber');
      expect(getWebsiteStatusBadgeClasses(AnalysisWebsiteStatus.ACCESS_RESTRICTED)).toContain('amber');
      expect(getWebsiteStatusBadgeClasses(AnalysisWebsiteStatus.INVALID_URL)).toContain('amber');
      expect(getWebsiteStatusBadgeClasses(AnalysisWebsiteStatus.NON_HTML)).toContain('amber');
    });

    it('returns slate classes for NOT_APPLICABLE', () => {
      expect(getWebsiteStatusBadgeClasses(AnalysisWebsiteStatus.NOT_APPLICABLE)).toContain('slate');
    });
  });

  describe('formatCampaignTypeLabel', () => {
    it('maps all CampaignType enums to human labels', () => {
      expect(formatCampaignTypeLabel(CampaignType.WEBSITE_ACQUISITION)).toBe('Website Acquisition');
      expect(formatCampaignTypeLabel(CampaignType.WEBSITE_REDESIGN)).toBe('Website Redesign');
      expect(formatCampaignTypeLabel(CampaignType.ONLINE_PRESENCE_IMPROVEMENT)).toBe('Online Presence Improvement');
    });

    it('returns "Unknown Campaign" for null/undefined', () => {
      expect(formatCampaignTypeLabel(null)).toBe('Unknown Campaign');
      expect(formatCampaignTypeLabel(undefined)).toBe('Unknown Campaign');
    });
  });

  describe('formatReasonCodeLabel', () => {
    it('maps all canonical V1 qualification reason codes correctly', () => {
      expect(formatReasonCodeLabel(QualificationReasonCode.NO_WEBSITE)).toBe('No website detected');
      expect(formatReasonCodeLabel(QualificationReasonCode.WEBSITE_UNREACHABLE)).toBe('Website unreachable');
      expect(formatReasonCodeLabel(QualificationReasonCode.WEBSITE_TIMEOUT)).toBe('Website timed out');
      expect(formatReasonCodeLabel(QualificationReasonCode.NO_HTTPS)).toBe('HTTPS not enabled');
      expect(formatReasonCodeLabel(QualificationReasonCode.NO_META_DESCRIPTION)).toBe('Meta description missing');
      expect(formatReasonCodeLabel(QualificationReasonCode.SHORT_PAGE_TITLE)).toBe('Page title is too short');
      expect(formatReasonCodeLabel(QualificationReasonCode.SLOW_RESPONSE)).toBe('Slow website response');
      expect(formatReasonCodeLabel(QualificationReasonCode.FACEBOOK_ONLY)).toBe('Facebook presence without standalone website');
      expect(formatReasonCodeLabel(QualificationReasonCode.INSTAGRAM_ONLY)).toBe('Instagram presence without standalone website');
      expect(formatReasonCodeLabel(QualificationReasonCode.MULTI_CHANNEL_PRESENCE)).toBe('Multiple online channels detected');
      expect(formatReasonCodeLabel(QualificationReasonCode.HIGH_RATING_NO_WEB)).toBe('Strong rating but no working website');
      expect(formatReasonCodeLabel(QualificationReasonCode.HAS_ESTABLISHED_REVIEWS)).toBe('Established customer reviews');
      expect(formatReasonCodeLabel(QualificationReasonCode.HAS_MOBILE_PHONE)).toBe('Mobile phone available');
      expect(formatReasonCodeLabel(QualificationReasonCode.HAS_PRIMARY_EMAIL)).toBe('Primary email available');
      expect(formatReasonCodeLabel(QualificationReasonCode.HAS_WHATSAPP)).toBe('WhatsApp contact available');
    });

    it('gracefully handles unknown future reason code without throwing', () => {
      expect(formatReasonCodeLabel('FUTURE_FEATURE_SIGNAL' as any)).toBe('Future feature signal');
    });

    it('returns "Unknown signal" for null/undefined', () => {
      expect(formatReasonCodeLabel(null)).toBe('Unknown signal');
      expect(formatReasonCodeLabel(undefined)).toBe('Unknown signal');
    });
  });

  describe('formatOnlinePresenceTypeLabel', () => {
    it('maps all OnlinePresenceType enums to human labels', () => {
      expect(formatOnlinePresenceTypeLabel(OnlinePresenceType.WEBSITE)).toBe('Website');
      expect(formatOnlinePresenceTypeLabel(OnlinePresenceType.FACEBOOK_ONLY)).toBe('Facebook Only');
      expect(formatOnlinePresenceTypeLabel(OnlinePresenceType.INSTAGRAM_ONLY)).toBe('Instagram Only');
      expect(formatOnlinePresenceTypeLabel(OnlinePresenceType.MARKETPLACE_ONLY)).toBe('Marketplace Only');
      expect(formatOnlinePresenceTypeLabel(OnlinePresenceType.NONE_DETECTED)).toBe('None Detected');
      expect(formatOnlinePresenceTypeLabel(OnlinePresenceType.UNKNOWN)).toBe('Unknown');
    });
  });

  describe('classifyAnalysisError', () => {
    it('classifies 409 CONFLICT with friendly recovery message', () => {
      const err = new ApiClientError('CONFLICT', 'Lead changed', 409, undefined, 'req-409');
      const classified = classifyAnalysisError(err);
      expect(classified.isConflict).toBe(true);
      expect(classified.message).toBe('Lead information changed during analysis. Please try again.');
      expect(classified.requestId).toBe('req-409');
    });

    it('classifies 429 RATE_LIMITED with wait message', () => {
      const err = new ApiClientError('RATE_LIMITED', 'Too many requests', 429, { retryAfterSeconds: 30 }, 'req-429');
      const classified = classifyAnalysisError(err);
      expect(classified.isRateLimit).toBe(true);
      expect(classified.message).toBe('Too many analysis requests. Please wait and try again.');
    });

    it('classifies 403 FORBIDDEN with permission message', () => {
      const err = new ApiClientError('FORBIDDEN', 'Denied', 403);
      const classified = classifyAnalysisError(err);
      expect(classified.isForbidden).toBe(true);
      expect(classified.message).toBe('You do not have permission to analyze this lead.');
    });

    it('classifies 404 NOT_FOUND with lead not found message', () => {
      const err = new ApiClientError('NOT_FOUND', 'Not found', 404);
      const classified = classifyAnalysisError(err);
      expect(classified.isNotFound).toBe(true);
      expect(classified.message).toBe('Lead not found.');
    });

    it('classifies 500 / unexpected error with generic retry message', () => {
      const err = new ApiClientError('INTERNAL_ERROR', 'Server crash', 500);
      const classified = classifyAnalysisError(err);
      expect(classified.message).toBe('Analysis could not be completed. Please try again.');
    });

    it('classifies non-ApiClientError with generic retry message', () => {
      const classified = classifyAnalysisError(new Error('Network disconnected'));
      expect(classified.message).toBe('Analysis could not be completed. Please try again.');
    });
  });
});
