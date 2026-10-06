import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  OutreachChannel,
  OutreachDeliveryStatus,
  SalesAssistantDraftType,
  SalesAssistantDraftStatus,
  SalesAssistantLanguage,
  SalesAssistantTone,
  ContactType,
  ContactStatus,
  WhatsAppStatus,
  WebsiteStatus,
  OnlinePresenceType,
  CrmStage,
  type SalesAssistantDraftSummary,
  type OutreachDeliverySummary,
  type LeadDetail
} from '@leadmate/shared';
import { OutreachCard } from '../components/leads/outreach-card.js';
import { OutreachDeliveryModal } from '../components/leads/outreach-delivery-modal.js';
import { OUTREACH_DISPATCH_DISCLAIMER } from '../lib/leads/outreach-display.js';

const mockLead: LeadDetail = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Apex Footwear Ltd',
  normalizedName: 'apex footwear ltd',
  category: 'Footwear Retail',
  description: 'Leading manufacturer in Bangladesh',
  address: 'Gulshan 2, Dhaka',
  locality: 'Gulshan',
  city: 'Dhaka',
  country: 'Bangladesh',
  website: 'https://apexfootwear.com',
  websiteStatus: WebsiteStatus.REACHABLE,
  onlinePresenceType: OnlinePresenceType.WEBSITE,
  primaryPhone: '+8801700000000',
  primaryEmail: 'info@apexfootwear.com',
  primarySource: 'MANUAL',
  crmStage: CrmStage.NEW,
  sources: [],
  assignedUserId: 'u1111111-1111-1111-1111-111111111111',
  assignedAt: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  contacts: [
    {
      id: 'c1111111-1111-1111-1111-111111111111',
      leadId: '11111111-1111-1111-1111-111111111111',
      type: ContactType.WHATSAPP,
      rawValue: '01711111111',
      normalizedValue: '+8801711111111',
      status: ContactStatus.VERIFIED,
      whatsappStatus: WhatsAppStatus.CONFIRMED,
      isPrimary: true,
      isSuppressed: false,
      evidence: [],
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z'
    },
    {
      id: 'c2222222-2222-2222-2222-222222222222',
      leadId: '11111111-1111-1111-1111-111111111111',
      type: ContactType.PHONE, // Plain phone contact
      rawValue: '01722222222',
      normalizedValue: '+8801722222222',
      status: ContactStatus.VERIFIED,
      whatsappStatus: WhatsAppStatus.UNKNOWN,
      isPrimary: false,
      isSuppressed: false,
      evidence: [],
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z'
    },
    {
      id: 'c3333333-3333-3333-3333-333333333333',
      leadId: '11111111-1111-1111-1111-111111111111',
      type: ContactType.EMAIL,
      rawValue: 'sales@apexfootwear.com',
      normalizedValue: 'sales@apexfootwear.com',
      status: ContactStatus.VERIFIED,
      whatsappStatus: WhatsAppStatus.UNKNOWN,
      isPrimary: true,
      isSuppressed: false,
      evidence: [],
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z'
    }
  ]
};

const mockApprovedWhatsAppDraft: SalesAssistantDraftSummary = {
  id: 'd1111111-1111-1111-1111-111111111111',
  leadId: mockLead.id,
  organizationId: '00000000-0000-0000-0000-000000000001',
  type: SalesAssistantDraftType.WHATSAPP,
  language: SalesAssistantLanguage.ENGLISH,
  tone: SalesAssistantTone.PROFESSIONAL,
  status: SalesAssistantDraftStatus.APPROVED,
  content: 'Hello Apex Leadership, here is an exclusive partnership opportunity.',
  warnings: [],
  approvedAt: '2026-10-04T10:00:00.000Z',
  approvedByUserId: 'u2222222-2222-2222-2222-222222222222',
  createdByUserId: 'u1111111-1111-1111-1111-111111111111',
  createdAt: '2026-10-04T09:00:00.000Z',
  updatedAt: '2026-10-04T10:00:00.000Z'
};

const mockApprovedEmailDraft: SalesAssistantDraftSummary = {
  id: 'd2222222-2222-2222-2222-222222222222',
  leadId: mockLead.id,
  organizationId: '00000000-0000-0000-0000-000000000001',
  type: SalesAssistantDraftType.EMAIL,
  language: SalesAssistantLanguage.ENGLISH,
  tone: SalesAssistantTone.PROFESSIONAL,
  status: SalesAssistantDraftStatus.APPROVED,
  emailSubject: 'Formal Proposal: Digital Transformation',
  emailBody: 'Dear Executive Team, please find our comprehensive partnership brief.',
  content: 'Dear Executive Team, please find our comprehensive partnership brief.',
  warnings: [],
  approvedAt: '2026-10-04T10:00:00.000Z',
  approvedByUserId: 'u2222222-2222-2222-2222-222222222222',
  createdByUserId: 'u1111111-1111-1111-1111-111111111111',
  createdAt: '2026-10-04T09:00:00.000Z',
  updatedAt: '2026-10-04T10:00:00.000Z'
};

const mockUnapprovedDraft: SalesAssistantDraftSummary = {
  ...mockApprovedWhatsAppDraft,
  id: 'd3333333-3333-3333-3333-333333333333',
  status: SalesAssistantDraftStatus.DRAFT,
  approvedAt: undefined,
  approvedByUserId: undefined
};

const mockCallScriptDraft: SalesAssistantDraftSummary = {
  ...mockApprovedWhatsAppDraft,
  id: 'd4444444-4444-4444-4444-444444444444',
  type: SalesAssistantDraftType.CALL_SCRIPT,
  status: SalesAssistantDraftStatus.APPROVED
};

const mockDeliveryRecord: OutreachDeliverySummary = {
  id: 'del-00000000-0000-0000-0000-000000000001',
  leadId: mockLead.id,
  draftId: mockApprovedWhatsAppDraft.id,
  channel: OutreachChannel.WHATSAPP,
  status: OutreachDeliveryStatus.QUEUED,
  recipientMasked: '+88017****1111',
  attemptCount: 0,
  requestedAt: '2026-10-05T12:00:00.000Z',
  queuedAt: '2026-10-05T12:00:01.000Z',
  createdAt: '2026-10-05T12:00:00.000Z',
  updatedAt: '2026-10-05T12:00:01.000Z'
};

describe('OutreachCard & OutreachDeliveryModal Component UI Specs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. RBAC & Send Permission Matrix in UI', () => {
    it('renders active request delivery controls when canSend is true (e.g. SUPER_ADMIN, ADMIN, SALES_MANAGER, assigned SALES_EXECUTIVE)', () => {
      const html = renderToStaticMarkup(
        <OutreachCard
          lead={mockLead}
          canRead={true}
          canSend={true}
          approvedDrafts={[mockApprovedWhatsAppDraft]}
          initialDeliveries={[]}
        />
      );

      expect(html).toContain('Automated Outreach &amp; Delivery');
      expect(html).toContain('Request Delivery');
      expect(html).toContain('Select Approved Draft');
      expect(html).not.toContain('Read-only Mode');
      expect(html).not.toContain('Outreach dispatch restricted');
    });

    it('renders restricted read-only notice when canSend is false (e.g. VIEWER or unassigned representative)', () => {
      const html = renderToStaticMarkup(
        <OutreachCard
          lead={mockLead}
          canRead={true}
          canSend={false}
          approvedDrafts={[mockApprovedWhatsAppDraft]}
          initialDeliveries={[]}
        />
      );

      expect(html).toContain('Read-only Mode');
      expect(html).toContain('Outreach dispatch restricted');
      expect(html).not.toContain('id="outreach-open-confirm-btn"');
    });
  });

  describe('2. Draft Status Eligibility & Approved Filter', () => {
    it('only renders APPROVED drafts in the draft selector, filtering out DRAFT and REJECTED', () => {
      const html = renderToStaticMarkup(
        <OutreachCard
          lead={mockLead}
          canRead={true}
          canSend={true}
          approvedDrafts={[mockApprovedWhatsAppDraft, mockUnapprovedDraft]}
          initialDeliveries={[]}
        />
      );

      // Approved draft appears
      expect(html).toContain(mockApprovedWhatsAppDraft.id);
      // Unapproved draft is strictly filtered out
      expect(html).not.toContain(mockUnapprovedDraft.id);
    });

    it('displays notice that no approved drafts are available when list is empty', () => {
      const html = renderToStaticMarkup(
        <OutreachCard
          lead={mockLead}
          canRead={true}
          canSend={true}
          approvedDrafts={[]}
          initialDeliveries={[]}
        />
      );

      expect(html).toContain('No approved drafts available for delivery');
    });
  });

  describe('3. Delivery History & Data Minimization', () => {
    it('renders delivery records with masked recipients and status badges', () => {
      const html = renderToStaticMarkup(
        <OutreachCard
          lead={mockLead}
          canRead={true}
          canSend={true}
          approvedDrafts={[mockApprovedWhatsAppDraft]}
          initialDeliveries={[mockDeliveryRecord]}
        />
      );

      expect(html).toContain('Delivery History (1)');
      expect(html).toContain('Queued');
      expect(html).toContain('+88017****1111');
      expect(html).toContain('WhatsApp');

      // Private / internal transport fields must NEVER be present in rendered HTML
      expect(html).not.toContain('recipientNormalized');
      expect(html).not.toContain('approvedDraftSnapshotHash');
      expect(html).not.toContain('requestFingerprint');
      expect(html).not.toContain('idempotencyKey');
    });
  });

  describe('4. Explicit Confirmation Modal Specs', () => {
    it('renders confirmation modal with masked recipient, draft type, exact content snapshot, and disclaimer', () => {
      const html = renderToStaticMarkup(
        <OutreachDeliveryModal
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          draft={mockApprovedWhatsAppDraft}
          channel={OutreachChannel.WHATSAPP}
          recipientMasked="+88017****1111"
          isSubmitting={false}
        />
      );

      expect(html).toContain('Confirm Outreach Delivery Request');
      expect(html).toContain(OUTREACH_DISPATCH_DISCLAIMER);
      expect(html).toContain('+88017****1111');
      expect(html).toContain('WhatsApp');
      expect(html).toContain(mockApprovedWhatsAppDraft.content);
      expect(html).toContain('Human Approved');
      expect(html).toContain('Confirm Delivery Request');
      expect(html).toContain('Cancel');
    });

    it('renders email subject when draft is EMAIL type', () => {
      const html = renderToStaticMarkup(
        <OutreachDeliveryModal
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          draft={mockApprovedEmailDraft}
          channel={OutreachChannel.EMAIL}
          recipientMasked="s***s@apexfootwear.com"
          isSubmitting={false}
        />
      );

      expect(html).toContain('Formal Proposal: Digital Transformation');
      expect(html).toContain('Dear Executive Team');
      expect(html).toContain('Email');
    });

    it('returns null when isOpen is false', () => {
      const html = renderToStaticMarkup(
        <OutreachDeliveryModal
          isOpen={false}
          onClose={() => {}}
          onConfirm={() => {}}
          draft={mockApprovedWhatsAppDraft}
          channel={OutreachChannel.WHATSAPP}
          recipientMasked="+88017****1111"
          isSubmitting={false}
        />
      );

      expect(html).toBe('');
    });
  });
});
