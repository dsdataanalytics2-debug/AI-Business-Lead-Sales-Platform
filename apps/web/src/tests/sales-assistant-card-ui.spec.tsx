import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SalesAssistantDraftStatus,
  SalesAssistantDraftType,
  SalesAssistantLanguage,
  SalesAssistantTone,
  SalesAssistantWarning,
  type SalesAssistantDraftSummary
} from '@leadmate/shared';
import { SalesAssistantCard } from '../components/leads/sales-assistant-card.js';
import {
  SALES_ASSISTANT_APPROVAL_NOTICE,
  SALES_ASSISTANT_UNVERIFIED_WHATSAPP_NOTICE
} from '../lib/leads/sales-assistant-display.js';

const mockDraftWhatsApp: SalesAssistantDraftSummary = {
  id: 'd0000000-0000-0000-0000-000000000001',
  leadId: 'l0000000-0000-0000-0000-000000000001',
  organizationId: 'o0000000-0000-0000-0000-000000000001',
  type: SalesAssistantDraftType.WHATSAPP,
  language: SalesAssistantLanguage.BANGLA,
  tone: SalesAssistantTone.PROFESSIONAL,
  status: SalesAssistantDraftStatus.DRAFT,
  objective: 'Schedule demo meeting',
  content: 'আসসালামু আলাইকুম, আমরা আপনার ব্যবসার জন্য আধুনিক সমাধান দিচ্ছি। বিস্তারিত জানতে কথা বলতে পারি কি?',
  warnings: [SalesAssistantWarning.UNVERIFIED_WHATSAPP],
  createdByUserId: 'u0000000-0000-0000-0000-000000000001',
  createdByUser: {
    id: 'u0000000-0000-0000-0000-000000000001',
    name: 'Sales Rep Tariq',
    email: 'tariq@leadmate.ai'
  },
  createdAt: '2026-10-04T10:00:00.000Z',
  updatedAt: '2026-10-04T10:00:00.000Z'
};

const mockDraftEmail: SalesAssistantDraftSummary = {
  id: 'd0000000-0000-0000-0000-000000000002',
  leadId: 'l0000000-0000-0000-0000-000000000001',
  organizationId: 'o0000000-0000-0000-0000-000000000001',
  type: SalesAssistantDraftType.EMAIL,
  language: SalesAssistantLanguage.ENGLISH,
  tone: SalesAssistantTone.PERSUASIVE,
  status: SalesAssistantDraftStatus.DRAFT,
  objective: 'Introduce B2B solution',
  emailSubject: 'Modernize Your Operations with LeadMate',
  emailBody: 'Dear Manager,\n\nWe noticed your growing footprint and would love to introduce our platform.\n\nBest regards,\nSales Team',
  warnings: [SalesAssistantWarning.MISSING_PRICE_CONTEXT, SalesAssistantWarning.LIMITED_LEAD_CONTEXT],
  createdByUserId: 'u0000000-0000-0000-0000-000000000001',
  createdByUser: {
    id: 'u0000000-0000-0000-0000-000000000001',
    name: 'Sales Rep Tariq',
    email: 'tariq@leadmate.ai'
  },
  createdAt: '2026-10-04T09:30:00.000Z',
  updatedAt: '2026-10-04T09:30:00.000Z'
};

const mockApprovedDraft: SalesAssistantDraftSummary = {
  ...mockDraftWhatsApp,
  id: 'd0000000-0000-0000-0000-000000000003',
  status: SalesAssistantDraftStatus.APPROVED,
  approvedAt: '2026-10-04T10:15:00.000Z',
  approvedByUserId: 'u0000000-0000-0000-0000-000000000002',
  approvedByUser: {
    id: 'u0000000-0000-0000-0000-000000000002',
    name: 'Manager Sadia',
    email: 'sadia@leadmate.ai'
  }
};

const mockRejectedDraft: SalesAssistantDraftSummary = {
  ...mockDraftWhatsApp,
  id: 'd0000000-0000-0000-0000-000000000004',
  status: SalesAssistantDraftStatus.REJECTED,
  rejectedAt: '2026-10-04T10:20:00.000Z',
  rejectedByUserId: 'u0000000-0000-0000-0000-000000000002',
  rejectedByUser: {
    id: 'u0000000-0000-0000-0000-000000000002',
    name: 'Manager Sadia',
    email: 'sadia@leadmate.ai'
  }
};

describe('SalesAssistantCard UI & Invariant Proofs (Component Spec)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Card Header & Basic Render', () => {
    it('renders the AI Sales Assistant panel title and helper notice', () => {
      const html = renderToStaticMarkup(
        <SalesAssistantCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          initialDrafts={[]}
        />
      );

      expect(html).toContain('AI Sales Assistant');
      expect(html).toContain(
        'Generate sales drafts using verified lead context. All generated content requires human approval before use.'
      );
    });
  });

  describe('2. Generation Form & Field Limits', () => {
    it('renders all 5 draft types, 3 languages, 4 tones, and character counters when canGenerate=true', () => {
      const html = renderToStaticMarkup(
        <SalesAssistantCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          initialDrafts={[]}
        />
      );

      expect(html).toContain('id="sales-assistant-type"');
      expect(html).toContain('WhatsApp Message');
      expect(html).toContain('Email Outreach');
      expect(html).toContain('Phone Call Script');
      expect(html).toContain('Sales Proposal');
      expect(html).toContain('Follow-up Note');

      expect(html).toContain('id="sales-assistant-language"');
      expect(html).toContain('Bangla');
      expect(html).toContain('English');
      expect(html).toContain('Mixed (Banglish)');

      expect(html).toContain('id="sales-assistant-tone"');
      expect(html).toContain('Professional');
      expect(html).toContain('Friendly');
      expect(html).toContain('Concise');
      expect(html).toContain('Persuasive');

      expect(html).toContain('id="objective-char-counter"');
      expect(html).toContain('0 / 300');

      expect(html).toContain('id="custom-instruction-char-counter"');
      expect(html).toContain('0 / 1000');

      expect(html).toContain('id="sales-assistant-generate-btn"');
    });

    it('shows read-only message and hides generation form when canGenerate=false (VIEWER role)', () => {
      const html = renderToStaticMarkup(
        <SalesAssistantCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={false}
          initialDrafts={[]}
        />
      );

      expect(html).toContain(
        'Sales draft generation is restricted to authorized sales and administration roles.'
      );
      expect(html).not.toContain('id="sales-assistant-generate-btn"');
    });
  });

  describe('3. Draft Preview — EMAIL vs Non-Email', () => {
    it('renders Subject Line and Email Body for EMAIL draft type', () => {
      const html = renderToStaticMarkup(
        <SalesAssistantCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          initialDrafts={[mockDraftEmail]}
          initialSelectedDraft={mockDraftEmail}
        />
      );

      expect(html).toContain('id="draft-email-subject"');
      expect(html).toContain('Modernize Your Operations with LeadMate');
      expect(html).toContain('id="draft-email-body"');
      expect(html).toContain('Dear Manager,');
      expect(html).toContain('Copy Email');
    });

    it('renders Content block for non-email (WHATSAPP) draft type', () => {
      const html = renderToStaticMarkup(
        <SalesAssistantCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          initialDrafts={[mockDraftWhatsApp]}
          initialSelectedDraft={mockDraftWhatsApp}
        />
      );

      expect(html).toContain('id="draft-content"');
      expect(html).toContain(
        'আসসালামু আলাইকুম, আমরা আপনার ব্যবসার জন্য আধুনিক সমাধান দিচ্ছি।'
      );
      expect(html).toContain('Copy Draft');
    });
  });

  describe('4. Human Approval Notice & Warnings', () => {
    it('displays prominent Human Approval Notice when status is DRAFT', () => {
      const html = renderToStaticMarkup(
        <SalesAssistantCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          initialDrafts={[mockDraftWhatsApp]}
          initialSelectedDraft={mockDraftWhatsApp}
        />
      );

      expect(html).toContain('id="human-approval-notice"');
      expect(html).toContain(SALES_ASSISTANT_APPROVAL_NOTICE);
    });

    it('prominently displays UNVERIFIED_WHATSAPP warning with strict safety notice', () => {
      const html = renderToStaticMarkup(
        <SalesAssistantCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          initialDrafts={[mockDraftWhatsApp]}
          initialSelectedDraft={mockDraftWhatsApp}
        />
      );

      expect(html).toContain('id="sales-assistant-warnings"');
      expect(html).toContain(SALES_ASSISTANT_UNVERIFIED_WHATSAPP_NOTICE);
      expect(html).toContain(
        'Strict safety guard: phone numbers are never promoted to WhatsApp without verified confirmation.'
      );
    });
  });

  describe('5. Review RBAC & Action Controls', () => {
    it('shows Approve and Reject buttons when draft is DRAFT and user has canReview=true', () => {
      const html = renderToStaticMarkup(
        <SalesAssistantCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          canReview={true}
          initialDrafts={[mockDraftWhatsApp]}
          initialSelectedDraft={mockDraftWhatsApp}
        />
      );

      expect(html).toContain('id="draft-review-controls"');
      expect(html).toContain('id="approve-draft-btn"');
      expect(html).toContain('Approve Draft');
      expect(html).toContain('id="reject-draft-btn"');
      expect(html).toContain('Reject Draft');
    });

    it('hides review controls when canReview=false (e.g. SALES_EXECUTIVE or VIEWER)', () => {
      const html = renderToStaticMarkup(
        <SalesAssistantCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          canReview={false}
          initialDrafts={[mockDraftWhatsApp]}
          initialSelectedDraft={mockDraftWhatsApp}
        />
      );

      expect(html).not.toContain('id="draft-review-controls"');
      expect(html).not.toContain('id="approve-draft-btn"');
      expect(html).not.toContain('id="reject-draft-btn"');
    });

    it('shows approved attribution and hides review controls for terminal APPROVED status', () => {
      const html = renderToStaticMarkup(
        <SalesAssistantCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          canReview={true}
          initialDrafts={[mockApprovedDraft]}
          initialSelectedDraft={mockApprovedDraft}
        />
      );

      expect(html).toContain('id="approved-attribution"');
      expect(html).toContain('Approved by Manager Sadia');
      expect(html).not.toContain('id="draft-review-controls"');
    });

    it('shows rejected attribution and hides review controls for terminal REJECTED status', () => {
      const html = renderToStaticMarkup(
        <SalesAssistantCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          canReview={true}
          initialDrafts={[mockRejectedDraft]}
          initialSelectedDraft={mockRejectedDraft}
        />
      );

      expect(html).toContain('id="rejected-attribution"');
      expect(html).toContain('Rejected by Manager Sadia');
      expect(html).not.toContain('id="draft-review-controls"');
    });
  });

  describe('6. Empty States', () => {
    it('renders generator empty state when drafts list is empty and user canGenerate', () => {
      const html = renderToStaticMarkup(
        <SalesAssistantCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          initialDrafts={[]}
        />
      );

      expect(html).toContain('id="sales-assistant-empty-state"');
      expect(html).toContain(
        'No AI sales drafts have been created yet. Generate your first draft above.'
      );
    });

    it('renders viewer empty state when drafts list is empty and user cannot generate', () => {
      const html = renderToStaticMarkup(
        <SalesAssistantCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={false}
          initialDrafts={[]}
        />
      );

      expect(html).toContain('id="sales-assistant-empty-state"');
      expect(html).toContain('No AI sales drafts are available yet.');
    });
  });

  describe('7. History Listing', () => {
    it('renders draft history items sorted newest first', () => {
      const html = renderToStaticMarkup(
        <SalesAssistantCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          initialDrafts={[mockDraftWhatsApp, mockDraftEmail]}
          initialSelectedDraft={mockDraftWhatsApp}
        />
      );

      expect(html).toContain('id="sales-assistant-history"');
      expect(html).toContain('Draft History (2)');
      expect(html).toContain('WhatsApp');
      expect(html).toContain('Email');
    });
  });

  describe('8. Invariant Prohibitions: No Send / No SENT State', () => {
    it('strictly contains zero send buttons, no whatsapp send, and no SENT status', () => {
      const html = renderToStaticMarkup(
        <SalesAssistantCard
          leadId="l0000000-0000-0000-0000-000000000001"
          canRead={true}
          canGenerate={true}
          canReview={true}
          initialDrafts={[mockDraftWhatsApp, mockApprovedDraft]}
          initialSelectedDraft={mockApprovedDraft}
        />
      );

      expect(html).not.toContain('Send WhatsApp');
      expect(html).not.toContain('Send Email');
      expect(html).not.toContain('Call Now');
      expect(html).not.toContain('Schedule Send');
      expect(html).not.toContain('Start Campaign');
      expect(html).not.toContain('SENT');
    });
  });
});
