import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DemoWebsiteStatus,
  DemoWebsiteProvider,
  Permissions,
  type Permission,
  type DemoWebsiteSummary
} from '@leadmate/shared';
import { DemoWebsiteCard } from '../components/leads/demo-website-card.js';
import { DEMO_DISCLAIMER_TEXT } from '../lib/leads/demo-website-display.js';

const mockReadyDemo: DemoWebsiteSummary = {
  id: 'd0000000-0000-0000-0000-000000000001',
  leadId: 'l0000000-0000-0000-0000-000000000001',
  organizationId: 'o0000000-0000-0000-0000-000000000001',
  status: DemoWebsiteStatus.READY,
  provider: DemoWebsiteProvider.MOCK,
  providerSiteId: 'mock_site_123',
  demoUrl: 'https://demo.local/sites/mock_site_123',
  requestedByUserId: 'u0000000-0000-0000-0000-000000000001',
  requestedByUser: {
    id: 'u0000000-0000-0000-0000-000000000001',
    name: 'Sales Rep Tariq',
    email: 'tariq@leadmate.ai'
  },
  readyAt: '2026-10-02T10:00:00.000Z',
  expiresAt: '2026-10-09T10:00:00.000Z',
  createdAt: '2026-10-02T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z'
};

const mockFailedDemo: DemoWebsiteSummary = {
  ...mockReadyDemo,
  status: DemoWebsiteStatus.FAILED,
  demoUrl: null,
  lastErrorCode: 'INTERNAL_ERROR',
  lastErrorMessageSafe: 'Missing essential business details to generate preview'
};

const mockExpiredDemo: DemoWebsiteSummary = {
  ...mockReadyDemo,
  status: DemoWebsiteStatus.EXPIRED,
  expiresAt: '2026-10-01T10:00:00.000Z'
};

const mockRemovedDemo: DemoWebsiteSummary = {
  ...mockReadyDemo,
  status: DemoWebsiteStatus.REMOVED,
  demoUrl: null
};

const mockCreatingDemo: DemoWebsiteSummary = {
  ...mockReadyDemo,
  status: DemoWebsiteStatus.CREATING,
  demoUrl: null
};

const mockRequestedDemo: DemoWebsiteSummary = {
  ...mockReadyDemo,
  status: DemoWebsiteStatus.REQUESTED,
  demoUrl: null
};

describe('DemoWebsiteCard UI & Permission Proofs (Component Spec)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /* =========================================================================
   * 1. Disclaimer & Invariant Checks
   * ========================================================================= */
  describe('1. Product Invariant Disclaimer', () => {
    it('always prominently displays "DEMO — NOT OFFICIAL" disclaimer in card header', () => {
      const html = renderToStaticMarkup(
        <DemoWebsiteCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          initialDemo={mockReadyDemo}
        />
      );

      expect(html).toContain('id="demo-disclaimer-badge"');
      expect(html).toContain(DEMO_DISCLAIMER_TEXT);
    });
  });

  /* =========================================================================
   * 2. Empty / No Demo (404) State
   * ========================================================================= */
  describe('2. Empty State (No Demo Generated Yet)', () => {
    it('renders clean empty state with "Generate Demo" button when user has DEMOS_GENERATE', () => {
      const html = renderToStaticMarkup(
        <DemoWebsiteCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          initialDemo={null}
        />
      );

      expect(html).toContain('Demo website has not been generated yet.');
      expect(html).toContain('id="demo-generate-btn"');
      expect(html).toContain('Generate Demo');
    });

    it('renders empty state without "Generate Demo" button when user lacks DEMOS_GENERATE (e.g. VIEWER)', () => {
      const html = renderToStaticMarkup(
        <DemoWebsiteCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={false}
          initialDemo={null}
        />
      );

      expect(html).toContain('Demo website has not been generated yet.');
      expect(html).not.toContain('id="demo-generate-btn"');
      expect(html).toContain('Demo generation requires sales executive or managerial permission.');
    });
  });

  /* =========================================================================
   * 3. Canonical Lifecycle States
   * ========================================================================= */
  describe('3. Canonical Lifecycle State Renderings', () => {
    it('renders READY state with status badge, Open Demo link, and dates', () => {
      const html = renderToStaticMarkup(
        <DemoWebsiteCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          canManage={true}
          initialDemo={mockReadyDemo}
        />
      );

      expect(html).toContain('id="demo-status-badge"');
      expect(html).toContain('Ready');
      expect(html).toContain('id="demo-open-btn"');
      expect(html).toContain('Open Demo');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).toContain('https://demo.local/sites/mock_site_123');
      expect(html).toContain('id="demo-regenerate-btn"');
      expect(html).toContain('id="demo-expire-btn"');
      expect(html).toContain('id="demo-remove-btn"');
    });

    it('renders CREATING state with loading progress and disables mutation actions', () => {
      const html = renderToStaticMarkup(
        <DemoWebsiteCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          canManage={true}
          initialDemo={mockCreatingDemo}
        />
      );

      expect(html).toContain('Creating');
      expect(html).toContain('Demo Generation In Progress');
      expect(html).not.toContain('id="demo-open-btn"');
      expect(html).not.toContain('id="demo-generate-btn"');
      expect(html).not.toContain('id="demo-regenerate-btn"');
    });

    it('renders REQUESTED state with requested status badge', () => {
      const html = renderToStaticMarkup(
        <DemoWebsiteCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          initialDemo={mockRequestedDemo}
        />
      );

      expect(html).toContain('Requested');
      expect(html).not.toContain('id="demo-generate-btn"');
    });

    it('renders FAILED state with safe error message and Retry action', () => {
      const html = renderToStaticMarkup(
        <DemoWebsiteCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          initialDemo={mockFailedDemo}
        />
      );

      expect(html).toContain('Failed');
      expect(html).toContain('Demo Generation Failed');
      expect(html).toContain('Missing essential business details to generate preview');
      expect(html).toContain('id="demo-regenerate-btn"');
      expect(html).toContain('Retry Generation');
      expect(html).not.toContain('id="demo-open-btn"');
    });

    it('renders EXPIRED state with expired alert and Regenerate action', () => {
      const html = renderToStaticMarkup(
        <DemoWebsiteCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          canManage={true}
          initialDemo={mockExpiredDemo}
        />
      );

      expect(html).toContain('Expired');
      expect(html).toContain('Demo Access Expired');
      expect(html).toContain('id="demo-regenerate-btn"');
      expect(html).toContain('Regenerate');
      expect(html).toContain('id="demo-remove-btn"');
      expect(html).not.toContain('id="demo-open-btn"');
    });

    it('renders REMOVED state as terminal with unpublished notice and no mutation controls', () => {
      const html = renderToStaticMarkup(
        <DemoWebsiteCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          canManage={true}
          initialDemo={mockRemovedDemo}
        />
      );

      expect(html).toContain('Removed');
      expect(html).toContain('Demo Unpublished');
      expect(html).toContain('soft-removed and unpublished');
      expect(html).not.toContain('id="demo-generate-btn"');
      expect(html).not.toContain('id="demo-regenerate-btn"');
      expect(html).not.toContain('id="demo-expire-btn"');
      expect(html).not.toContain('id="demo-remove-btn"');
      expect(html).not.toContain('id="demo-open-btn"');
    });
  });

  /* =========================================================================
   * 4. RBAC Permission Matrix Proofs
   * ========================================================================= */
  describe('4. RBAC Permission UI Proofs', () => {
    it('VIEWER (LEADS_READ only): can see status and Open Demo, cannot see Regenerate, Expire, Remove', () => {
      const html = renderToStaticMarkup(
        <DemoWebsiteCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={false}
          canManage={false}
          initialDemo={mockReadyDemo}
        />
      );

      expect(html).toContain('Ready');
      expect(html).toContain('id="demo-open-btn"');
      expect(html).not.toContain('id="demo-regenerate-btn"');
      expect(html).not.toContain('id="demo-expire-btn"');
      expect(html).not.toContain('id="demo-remove-btn"');
    });

    it('SALES_EXECUTIVE (LEADS_READ + DEMOS_GENERATE): can Regenerate and Open Demo, cannot see Expire or Remove', () => {
      const html = renderToStaticMarkup(
        <DemoWebsiteCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          canManage={false}
          initialDemo={mockReadyDemo}
        />
      );

      expect(html).toContain('id="demo-open-btn"');
      expect(html).toContain('id="demo-regenerate-btn"');
      expect(html).not.toContain('id="demo-expire-btn"');
      expect(html).not.toContain('id="demo-remove-btn"');
    });

    it('SALES_MANAGER / ADMIN (LEADS_READ + DEMOS_GENERATE + DEMOS_MANAGE): full control over all demo actions', () => {
      const html = renderToStaticMarkup(
        <DemoWebsiteCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          canManage={true}
          initialDemo={mockReadyDemo}
        />
      );

      expect(html).toContain('id="demo-open-btn"');
      expect(html).toContain('id="demo-regenerate-btn"');
      expect(html).toContain('id="demo-expire-btn"');
      expect(html).toContain('id="demo-remove-btn"');
    });
  });

  /* =========================================================================
   * 5. URL Safety Checks
   * ========================================================================= */
  describe('5. URL Safety Checks', () => {
    it('renders valid https:// URL as safe clickable Open Demo link', () => {
      const html = renderToStaticMarkup(
        <DemoWebsiteCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          initialDemo={{
            ...mockReadyDemo,
            demoUrl: 'https://preview.leadmate.ai/site_abc'
          }}
        />
      );

      expect(html).toContain('id="demo-open-btn"');
      expect(html).toContain('href="https://preview.leadmate.ai/site_abc"');
    });

    it('rejects javascript: URL and omits Open Demo button', () => {
      const html = renderToStaticMarkup(
        <DemoWebsiteCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          initialDemo={{
            ...mockReadyDemo,
            demoUrl: 'javascript:alert(1)'
          }}
        />
      );

      expect(html).not.toContain('id="demo-open-btn"');
      expect(html).toContain('Not available');
    });

    it('rejects data: URL and omits Open Demo button', () => {
      const html = renderToStaticMarkup(
        <DemoWebsiteCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          initialDemo={{
            ...mockReadyDemo,
            demoUrl: 'data:text/html,<script>alert(1)</script>'
          }}
        />
      );

      expect(html).not.toContain('id="demo-open-btn"');
      expect(html).toContain('Not available');
    });

    it('handles malformed URL gracefully without crashing and omits Open Demo button', () => {
      const html = renderToStaticMarkup(
        <DemoWebsiteCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          initialDemo={{
            ...mockReadyDemo,
            demoUrl: 'not an url @@@'
          }}
        />
      );

      expect(html).not.toContain('id="demo-open-btn"');
    });
  });

  /* =========================================================================
   * 6. Error Banner
   * ========================================================================= */
  describe('6. Error Banner Display', () => {
    it('displays error banner when initialError is present', () => {
      const html = renderToStaticMarkup(
        <DemoWebsiteCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          initialDemo={null}
          initialError={{
            message: 'Demo website service is currently unavailable.',
            isAuth: false,
            isForbidden: false,
            isNotFound: false,
            isValidation: false,
            isUnavailable: true,
            isNetwork: false
          }}
        />
      );

      expect(html).toContain('role="alert"');
      expect(html).toContain('Demo website service is currently unavailable.');
    });
  });
});
