import { describe, it, expect } from 'vitest';
import {
  OutreachChannel,
  OutreachDeliveryStatus,
  OutreachErrorCode,
  ContactType,
  ContactStatus,
  WhatsAppStatus,
  WebsiteStatus,
  OnlinePresenceType,
  CrmStage,
  type LeadDetail
} from '@leadmate/shared';
import {
  OUTREACH_DISPATCH_DISCLAIMER,
  formatOutreachStatusLabel,
  formatOutreachStatusDescription,
  getOutreachStatusBadgeClasses,
  formatOutreachChannelLabel,
  resolveRecipientCandidates,
  classifyOutreachError
} from '../lib/leads/outreach-display.js';
import { ApiClientError } from '../lib/api-client.js';

describe('M6 Step 6: Outreach Display & Helper Logic', () => {
  const mockLead: LeadDetail = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Apex Footwear Ltd',
    normalizedName: 'apex footwear ltd',
    category: 'Footwear Retail',
    description: 'Leading footwear manufacturer in Bangladesh',
    address: 'Gulshan 2, Dhaka',
    locality: 'Gulshan',
    city: 'Dhaka',
    country: 'Bangladesh',
    website: 'https://apexfootwear.com',
    websiteStatus: WebsiteStatus.REACHABLE,
    onlinePresenceType: OnlinePresenceType.WEBSITE,
    primaryPhone: '+8801700000000',
    primaryEmail: 'corporate@apexfootwear.com',
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
        type: ContactType.PHONE, // Plain voice phone
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

  describe('1. Status Labels & Descriptions', () => {
    it('formats human-readable labels for all 7 frozen delivery statuses', () => {
      expect(formatOutreachStatusLabel(OutreachDeliveryStatus.REQUESTED)).toBe('Requested');
      expect(formatOutreachStatusLabel(OutreachDeliveryStatus.QUEUED)).toBe('Queued');
      expect(formatOutreachStatusLabel(OutreachDeliveryStatus.PROCESSING)).toBe('Processing');
      expect(formatOutreachStatusLabel(OutreachDeliveryStatus.SENT)).toBe('Sent to Provider');
      expect(formatOutreachStatusLabel(OutreachDeliveryStatus.DELIVERED)).toBe('Delivered');
      expect(formatOutreachStatusLabel(OutreachDeliveryStatus.FAILED)).toBe('Failed');
      expect(formatOutreachStatusLabel(OutreachDeliveryStatus.CANCELLED)).toBe('Cancelled');
    });

    it('formats state descriptions without falsely claiming message is delivered for REQUESTED or QUEUED', () => {
      expect(formatOutreachStatusDescription(OutreachDeliveryStatus.REQUESTED)).toBe(
        'Delivery request created'
      );
      expect(formatOutreachStatusDescription(OutreachDeliveryStatus.QUEUED)).toBe(
        'Queued for delivery'
      );
      expect(formatOutreachStatusDescription(OutreachDeliveryStatus.QUEUED)).not.toContain('sent');
      expect(formatOutreachStatusDescription(OutreachDeliveryStatus.QUEUED)).not.toContain('delivered');
    });

    it('provides distinct badge CSS styling classes per status', () => {
      expect(getOutreachStatusBadgeClasses(OutreachDeliveryStatus.REQUESTED)).toContain('text-sky-300');
      expect(getOutreachStatusBadgeClasses(OutreachDeliveryStatus.QUEUED)).toContain('text-indigo-300');
      expect(getOutreachStatusBadgeClasses(OutreachDeliveryStatus.PROCESSING)).toContain('text-amber-300');
      expect(getOutreachStatusBadgeClasses(OutreachDeliveryStatus.SENT)).toContain('text-blue-300');
      expect(getOutreachStatusBadgeClasses(OutreachDeliveryStatus.DELIVERED)).toContain('text-emerald-300');
      expect(getOutreachStatusBadgeClasses(OutreachDeliveryStatus.FAILED)).toContain('text-rose-300');
      expect(getOutreachStatusBadgeClasses(OutreachDeliveryStatus.CANCELLED)).toContain('text-slate-400');
    });

    it('formats channel labels properly', () => {
      expect(formatOutreachChannelLabel(OutreachChannel.WHATSAPP)).toBe('WhatsApp');
      expect(formatOutreachChannelLabel(OutreachChannel.EMAIL)).toBe('Email');
    });

    it('exposes unambiguous human dispatch disclaimer', () => {
      expect(OUTREACH_DISPATCH_DISCLAIMER).toContain('queues this approved message');
      expect(OUTREACH_DISPATCH_DISCLAIMER).toContain('does not mean the message has been physically delivered');
    });
  });

  describe('2. Recipient Resolution & PHONE != WHATSAPP Preservation', () => {
    it('resolves WhatsApp candidates strictly from WHATSAPP contacts and excludes plain PHONE contacts', () => {
      const candidates = resolveRecipientCandidates(mockLead, OutreachChannel.WHATSAPP);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].contactId).toBe('c1111111-1111-1111-1111-111111111111');
      expect(candidates[0].maskedLabel).toBe('+88017****1111');
      expect(candidates[0].type).toBe(ContactType.WHATSAPP);

      // Plain phone contact (01722222222) MUST NOT appear
      expect(candidates.some((c) => c.rawValue === '01722222222')).toBe(false);
      expect(candidates.some((c) => c.contactId === 'c2222222-2222-2222-2222-222222222222')).toBe(false);
    });

    it('resolves WhatsApp candidate with non-VERIFIED status but PUBLICLY_LISTED whatsappStatus', () => {
      const leadWithPublicWhatsApp: LeadDetail = {
        ...mockLead,
        contacts: [
          {
            id: 'c-pub-1',
            leadId: mockLead.id,
            type: ContactType.WHATSAPP,
            rawValue: '01833333333',
            normalizedValue: '+8801833333333',
            status: ContactStatus.FOUND, // Non-VERIFIED
            whatsappStatus: WhatsAppStatus.PUBLICLY_LISTED, // Trusted provenance
            isPrimary: true,
            isSuppressed: false,
            evidence: [],
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z'
          },
          {
            id: 'c-phone-verified',
            leadId: mockLead.id,
            type: ContactType.PHONE,
            rawValue: '01844444444',
            normalizedValue: '+8801844444444',
            status: ContactStatus.VERIFIED, // VERIFIED phone must NEVER be treated as WhatsApp
            whatsappStatus: WhatsAppStatus.UNKNOWN,
            isPrimary: false,
            isSuppressed: false,
            evidence: [],
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z'
          }
        ]
      };

      const candidates = resolveRecipientCandidates(leadWithPublicWhatsApp, OutreachChannel.WHATSAPP);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].contactId).toBe('c-pub-1');
      expect(candidates[0].rawValue).toBe('01833333333');
      expect(candidates[0].maskedLabel).toBe('+88018****3333');

      // Phone contact with status VERIFIED must NOT appear as WhatsApp candidate (PHONE != WHATSAPP)
      expect(candidates.some((c) => c.contactId === 'c-phone-verified')).toBe(false);
      expect(candidates.some((c) => c.rawValue === '01844444444')).toBe(false);
    });

    it('resolves Email candidates including non-VERIFIED EMAIL contacts without inventing verification requirements', () => {
      const leadWithUnverifiedEmail: LeadDetail = {
        ...mockLead,
        primaryEmail: null,
        contacts: [
          {
            id: 'c-email-found',
            leadId: mockLead.id,
            type: ContactType.EMAIL,
            rawValue: 'contact@shopbd.com',
            normalizedValue: 'contact@shopbd.com',
            status: ContactStatus.FOUND, // Non-VERIFIED status: backend considers valid ContactType.EMAIL
            whatsappStatus: WhatsAppStatus.UNKNOWN,
            isPrimary: false,
            isSuppressed: false,
            evidence: [],
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z'
          },
          {
            id: 'c-email-invalid',
            leadId: mockLead.id,
            type: ContactType.EMAIL,
            rawValue: 'not-an-email',
            normalizedValue: 'not-an-email',
            status: ContactStatus.FOUND,
            whatsappStatus: WhatsAppStatus.UNKNOWN,
            isPrimary: false,
            isSuppressed: false,
            evidence: [],
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z'
          }
        ]
      };

      const candidates = resolveRecipientCandidates(leadWithUnverifiedEmail, OutreachChannel.EMAIL);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].contactId).toBe('c-email-found');
      expect(candidates[0].rawValue).toBe('contact@shopbd.com');
      // Invalid email without '@' must NOT appear
      expect(candidates.some((c) => c.contactId === 'c-email-invalid')).toBe(false);
    });

    it('resolves primaryEmail fallback when lead has zero ContactType.EMAIL contacts and valid primaryEmail', () => {
      const leadWithOnlyPrimaryEmail: LeadDetail = {
        ...mockLead,
        primaryEmail: 'corporate@apexfootwear.com',
        contacts: [
          // Only WHATSAPP and PHONE contacts, zero EMAIL contacts
          mockLead.contacts[0],
          mockLead.contacts[1]
        ]
      };

      const candidates = resolveRecipientCandidates(leadWithOnlyPrimaryEmail, OutreachChannel.EMAIL);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].contactId).toBeUndefined(); // fallback has no contactId
      expect(candidates[0].rawValue).toBe('corporate@apexfootwear.com');
      expect(candidates[0].isPrimary).toBe(true);
      expect(candidates[0].maskedLabel).toContain('@apexfootwear.com');
    });

    it('excludes primaryEmail when one or more valid ContactType.EMAIL contacts exist', () => {
      // mockLead has 1 valid EMAIL contact (sales@apexfootwear.com) AND a different primaryEmail (corporate@apexfootwear.com)
      const candidates = resolveRecipientCandidates(mockLead, OutreachChannel.EMAIL);

      // Must only contain the explicit EMAIL contact; primaryEmail MUST NOT appear as extra candidate
      expect(candidates).toHaveLength(1);
      expect(candidates[0].contactId).toBe('c3333333-3333-3333-3333-333333333333');
      expect(candidates[0].rawValue).toBe('sales@apexfootwear.com');
      expect(candidates.some((c) => c.rawValue.includes('corporate'))).toBe(false);
      expect(candidates.some((c) => c.contactId === undefined)).toBe(false);
    });

    it('resolves multiple ContactType.EMAIL contacts without injecting primaryEmail fallback', () => {
      const leadWithMultipleEmails: LeadDetail = {
        ...mockLead,
        primaryEmail: 'corporate@apexfootwear.com',
        contacts: [
          {
            id: 'c-email-1',
            leadId: mockLead.id,
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
          },
          {
            id: 'c-email-2',
            leadId: mockLead.id,
            type: ContactType.EMAIL,
            rawValue: 'support@apexfootwear.com',
            normalizedValue: 'support@apexfootwear.com',
            status: ContactStatus.FOUND,
            whatsappStatus: WhatsAppStatus.UNKNOWN,
            isPrimary: false,
            isSuppressed: false,
            evidence: [],
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z'
          }
        ]
      };

      const candidates = resolveRecipientCandidates(leadWithMultipleEmails, OutreachChannel.EMAIL);
      expect(candidates).toHaveLength(2);
      expect(candidates[0].contactId).toBe('c-email-1');
      expect(candidates[1].contactId).toBe('c-email-2');
      // primaryEmail MUST NOT be injected
      expect(candidates.some((c) => c.rawValue.includes('corporate'))).toBe(false);
    });

    it('excludes suppressed contacts from recipient candidate list', () => {
      const leadWithSuppressed: LeadDetail = {
        ...mockLead,
        primaryEmail: null,
        contacts: [
          {
            id: 'c-wa-suppressed',
            leadId: mockLead.id,
            type: ContactType.WHATSAPP,
            rawValue: '01711111111',
            normalizedValue: '+8801711111111',
            status: ContactStatus.VERIFIED,
            whatsappStatus: WhatsAppStatus.CONFIRMED,
            isPrimary: true,
            isSuppressed: true, // SUPPRESSED
            evidence: [],
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z'
          },
          {
            id: 'c-email-suppressed',
            leadId: mockLead.id,
            type: ContactType.EMAIL,
            rawValue: 'sales@apexfootwear.com',
            normalizedValue: 'sales@apexfootwear.com',
            status: ContactStatus.VERIFIED,
            whatsappStatus: WhatsAppStatus.UNKNOWN,
            isPrimary: true,
            isSuppressed: true, // SUPPRESSED
            evidence: [],
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z'
          }
        ]
      };

      expect(resolveRecipientCandidates(leadWithSuppressed, OutreachChannel.WHATSAPP)).toHaveLength(0);
      expect(resolveRecipientCandidates(leadWithSuppressed, OutreachChannel.EMAIL)).toHaveLength(0);
    });

    it('returns empty candidates list when lead has no verified contacts for channel', () => {
      const emptyLead: LeadDetail = {
        ...mockLead,
        contacts: [],
        primaryEmail: null
      };

      expect(resolveRecipientCandidates(emptyLead, OutreachChannel.WHATSAPP)).toHaveLength(0);
      expect(resolveRecipientCandidates(emptyLead, OutreachChannel.EMAIL)).toHaveLength(0);
    });
  });

  describe('3. Error Classification & User Safety', () => {
    it('classifies OUTREACH_DRAFT_NOT_APPROVED safely', () => {
      const err = new ApiClientError(
        OutreachErrorCode.OUTREACH_DRAFT_NOT_APPROVED,
        'Draft not approved',
        409,
        undefined,
        'req-123'
      );
      const classified = classifyOutreachError(err);
      expect(classified.code).toBe(OutreachErrorCode.OUTREACH_DRAFT_NOT_APPROVED);
      expect(classified.message).toBe('This draft must be approved before delivery can be requested.');
      expect(classified.requestId).toBe('req-123');
    });

    it('classifies OUTREACH_IDEMPOTENCY_KEY_REUSED safely', () => {
      const err = new ApiClientError(
        OutreachErrorCode.OUTREACH_IDEMPOTENCY_KEY_REUSED,
        'Idempotency key reused',
        409
      );
      const classified = classifyOutreachError(err);
      expect(classified.code).toBe(OutreachErrorCode.OUTREACH_IDEMPOTENCY_KEY_REUSED);
      expect(classified.message).toContain('Please start a new delivery request');
    });

    it('classifies OUTREACH_RECIPIENT_SUPPRESSED safely', () => {
      const err = new ApiClientError(
        OutreachErrorCode.OUTREACH_RECIPIENT_SUPPRESSED,
        'Recipient suppressed',
        422
      );
      const classified = classifyOutreachError(err);
      expect(classified.code).toBe(OutreachErrorCode.OUTREACH_RECIPIENT_SUPPRESSED);
      expect(classified.message).toBe('Delivery is blocked because this recipient is on the suppression list.');
    });

    it('classifies OUTREACH_DELIVERY_FAILED as a retryable queue error', () => {
      const err = new ApiClientError(
        OutreachErrorCode.OUTREACH_DELIVERY_FAILED,
        'Queueing failed',
        500
      );
      const classified = classifyOutreachError(err);
      expect(classified.code).toBe(OutreachErrorCode.OUTREACH_DELIVERY_FAILED);
      expect(classified.isRetryableQueueError).toBe(true);
      expect(classified.message).toContain('Delivery request was created but could not be queued');
    });

    it('classifies FORBIDDEN permission denial', () => {
      const err = new ApiClientError('FORBIDDEN', 'Access forbidden', 403);
      const classified = classifyOutreachError(err);
      expect(classified.code).toBe('FORBIDDEN');
      expect(classified.message).toContain('You do not have permission');
    });
  });
});
