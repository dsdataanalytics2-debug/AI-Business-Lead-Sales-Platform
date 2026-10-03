import { describe, it, expect } from 'vitest';
import { DemoWebsiteStatus, DemoWebsiteProvider } from '@leadmate/shared';
import { ApiClientError } from '../lib/api-client.js';
import {
  DEMO_DISCLAIMER_TEXT,
  formatDemoStatusLabel,
  getDemoStatusBadgeClasses,
  formatDemoProviderLabel,
  classifyDemoWebsiteError,
  getSafeDemoWebsiteUrl
} from '../lib/leads/demo-website-display.js';

describe('DemoWebsiteDisplay Helpers (M4 Step 5)', () => {
  describe('1. Disclaimer Constant Invariant', () => {
    it('guarantees exact DEMO — NOT OFFICIAL disclaimer text', () => {
      expect(DEMO_DISCLAIMER_TEXT).toBe('DEMO — NOT OFFICIAL');
    });
  });

  describe('2. Status Labels & Badges', () => {
    it('formats all canonical status labels correctly', () => {
      expect(formatDemoStatusLabel(DemoWebsiteStatus.REQUESTED)).toBe('Requested');
      expect(formatDemoStatusLabel(DemoWebsiteStatus.CREATING)).toBe('Creating');
      expect(formatDemoStatusLabel(DemoWebsiteStatus.READY)).toBe('Ready');
      expect(formatDemoStatusLabel(DemoWebsiteStatus.FAILED)).toBe('Failed');
      expect(formatDemoStatusLabel(DemoWebsiteStatus.EXPIRED)).toBe('Expired');
      expect(formatDemoStatusLabel(DemoWebsiteStatus.REMOVED)).toBe('Removed');
    });

    it('returns distinct badge styles for all lifecycle statuses', () => {
      expect(getDemoStatusBadgeClasses(DemoWebsiteStatus.READY)).toContain('emerald');
      expect(getDemoStatusBadgeClasses(DemoWebsiteStatus.CREATING)).toContain('indigo');
      expect(getDemoStatusBadgeClasses(DemoWebsiteStatus.REQUESTED)).toContain('sky');
      expect(getDemoStatusBadgeClasses(DemoWebsiteStatus.EXPIRED)).toContain('amber');
      expect(getDemoStatusBadgeClasses(DemoWebsiteStatus.FAILED)).toContain('rose');
      expect(getDemoStatusBadgeClasses(DemoWebsiteStatus.REMOVED)).toContain('slate');
    });
  });

  describe('3. Provider Labels', () => {
    it('formats MOCK and STOREMATE provider labels', () => {
      expect(formatDemoProviderLabel(DemoWebsiteProvider.MOCK)).toBe('Mock Demo');
      expect(formatDemoProviderLabel(DemoWebsiteProvider.STOREMATE)).toBe('StoreMate');
      expect(formatDemoProviderLabel(null)).toBe('Mock Demo');
    });
  });

  describe('4. Error Classification', () => {
    it('classifies 401 UNAUTHENTICATED', () => {
      const err = new ApiClientError('UNAUTHENTICATED', 'Session expired', 401);
      const classified = classifyDemoWebsiteError(err);
      expect(classified.isAuth).toBe(true);
      expect(classified.message).toContain('Session expired');
    });

    it('classifies 403 FORBIDDEN', () => {
      const err = new ApiClientError('FORBIDDEN', 'Permission required', 403);
      const classified = classifyDemoWebsiteError(err);
      expect(classified.isForbidden).toBe(true);
      expect(classified.message).toContain('permission');
    });

    it('classifies 404 NOT_FOUND', () => {
      const err = new ApiClientError('NOT_FOUND', 'Not found', 404);
      const classified = classifyDemoWebsiteError(err);
      expect(classified.isNotFound).toBe(true);
    });

    it('classifies 422 VALIDATION_ERROR', () => {
      const err = new ApiClientError('VALIDATION_ERROR', 'Headline too long', 422);
      const classified = classifyDemoWebsiteError(err);
      expect(classified.isValidation).toBe(true);
      expect(classified.message).toBe('Headline too long');
    });

    it('classifies 503 STOREMATE_UNAVAILABLE', () => {
      const err = new ApiClientError('STOREMATE_UNAVAILABLE', 'StoreMate blocked', 503);
      const classified = classifyDemoWebsiteError(err);
      expect(classified.isUnavailable).toBe(true);
      expect(classified.message).toBe('Demo website service is currently unavailable.');
    });

    it('classifies generic network error', () => {
      const classified = classifyDemoWebsiteError(new Error('Failed to fetch'));
      expect(classified.isNetwork).toBe(true);
      expect(classified.message).toContain('Network error');
    });
  });

  describe('5. HTTPS-Only Demo Website URL Safety Invariant', () => {
    it('allows valid HTTPS URLs', () => {
      const safe = getSafeDemoWebsiteUrl('https://demo.local/sites/mock_site_123');
      expect(safe).not.toBeNull();
      expect(safe?.href).toBe('https://demo.local/sites/mock_site_123');
      expect(safe?.label).toBe('demo.local/sites/mock_site_123');
    });

    it('blocks plain HTTP URLs for demo website links', () => {
      expect(getSafeDemoWebsiteUrl('http://insecure-demo.local/sites/mock_site_123')).toBeNull();
    });

    it('blocks dangerous and non-web protocols', () => {
      expect(getSafeDemoWebsiteUrl('javascript:alert(1)')).toBeNull();
      expect(getSafeDemoWebsiteUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
      expect(getSafeDemoWebsiteUrl('file:///etc/passwd')).toBeNull();
      expect(getSafeDemoWebsiteUrl('vbscript:msgbox(1)')).toBeNull();
      expect(getSafeDemoWebsiteUrl('blob:https://demo.local/abc')).toBeNull();
    });

    it('blocks malformed and empty URLs', () => {
      expect(getSafeDemoWebsiteUrl('')).toBeNull();
      expect(getSafeDemoWebsiteUrl(null)).toBeNull();
      expect(getSafeDemoWebsiteUrl(undefined)).toBeNull();
      expect(getSafeDemoWebsiteUrl('not a url %%%')).toBeNull();
      expect(getSafeDemoWebsiteUrl('https://user:pass@demo.local')).toBeNull();
    });
  });
});
