import { describe, it, expect } from 'vitest';
import {
  SalesAssistantDraftStatus,
  SalesAssistantDraftType,
  SalesAssistantLanguage,
  SalesAssistantTone,
  SalesAssistantWarning,
  type SalesAssistantDraftSummary
} from '@leadmate/shared';
import { ApiClientError } from '@/lib/api-client';
import {
  SALES_ASSISTANT_APPROVAL_NOTICE,
  SALES_ASSISTANT_UNVERIFIED_WHATSAPP_NOTICE,
  getSalesAssistantWarningMessage,
  formatSalesAssistantDraftTypeLabel,
  formatSalesAssistantLanguageLabel,
  formatSalesAssistantToneLabel,
  getSalesAssistantStatusBadgeClasses,
  formatDraftForClipboard,
  classifySalesAssistantError
} from '@/lib/leads/sales-assistant-display';

describe('Sales Assistant Display & Formatting Spec', () => {
  describe('1. Warning Message Mapping', () => {
    it('maps MISSING_PRODUCT_CONTEXT correctly', () => {
      expect(
        getSalesAssistantWarningMessage(SalesAssistantWarning.MISSING_PRODUCT_CONTEXT)
      ).toBe('Product/service context is limited.');
    });

    it('maps MISSING_PRICE_CONTEXT correctly', () => {
      expect(
        getSalesAssistantWarningMessage(SalesAssistantWarning.MISSING_PRICE_CONTEXT)
      ).toBe('Verified pricing information is unavailable.');
    });

    it('maps UNVERIFIED_WHATSAPP correctly', () => {
      expect(
        getSalesAssistantWarningMessage(SalesAssistantWarning.UNVERIFIED_WHATSAPP)
      ).toBe('No verified/public WhatsApp contact is available.');
      expect(SALES_ASSISTANT_UNVERIFIED_WHATSAPP_NOTICE).toBe(
        'No verified WhatsApp contact is available for this lead. This draft is for review only.'
      );
    });

    it('maps UNSUPPORTED_CLAIM_REMOVED correctly', () => {
      expect(
        getSalesAssistantWarningMessage(SalesAssistantWarning.UNSUPPORTED_CLAIM_REMOVED)
      ).toBe('An unsupported claim was removed from the draft.');
    });

    it('maps LIMITED_LEAD_CONTEXT correctly', () => {
      expect(
        getSalesAssistantWarningMessage(SalesAssistantWarning.LIMITED_LEAD_CONTEXT)
      ).toBe('This lead has limited verified context.');
    });
  });

  describe('2. Label Formatting', () => {
    it('formats draft types into user-friendly labels', () => {
      expect(formatSalesAssistantDraftTypeLabel(SalesAssistantDraftType.WHATSAPP)).toBe('WhatsApp');
      expect(formatSalesAssistantDraftTypeLabel(SalesAssistantDraftType.EMAIL)).toBe('Email');
      expect(formatSalesAssistantDraftTypeLabel(SalesAssistantDraftType.CALL_SCRIPT)).toBe('Call Script');
      expect(formatSalesAssistantDraftTypeLabel(SalesAssistantDraftType.PROPOSAL)).toBe('Proposal');
      expect(formatSalesAssistantDraftTypeLabel(SalesAssistantDraftType.FOLLOW_UP)).toBe('Follow-up');
    });

    it('formats languages into user-friendly labels', () => {
      expect(formatSalesAssistantLanguageLabel(SalesAssistantLanguage.BANGLA)).toBe('Bangla');
      expect(formatSalesAssistantLanguageLabel(SalesAssistantLanguage.ENGLISH)).toBe('English');
      expect(formatSalesAssistantLanguageLabel(SalesAssistantLanguage.MIXED)).toBe('Mixed (Banglish)');
    });

    it('formats tones into user-friendly labels', () => {
      expect(formatSalesAssistantToneLabel(SalesAssistantTone.PROFESSIONAL)).toBe('Professional');
      expect(formatSalesAssistantToneLabel(SalesAssistantTone.FRIENDLY)).toBe('Friendly');
      expect(formatSalesAssistantToneLabel(SalesAssistantTone.CONCISE)).toBe('Concise');
      expect(formatSalesAssistantToneLabel(SalesAssistantTone.PERSUASIVE)).toBe('Persuasive');
    });
  });

  describe('3. Status Badge Classes', () => {
    it('provides distinct badge styling for DRAFT, APPROVED, and REJECTED', () => {
      const draftClasses = getSalesAssistantStatusBadgeClasses(SalesAssistantDraftStatus.DRAFT);
      const approvedClasses = getSalesAssistantStatusBadgeClasses(SalesAssistantDraftStatus.APPROVED);
      const rejectedClasses = getSalesAssistantStatusBadgeClasses(SalesAssistantDraftStatus.REJECTED);

      expect(draftClasses).toContain('amber');
      expect(approvedClasses).toContain('emerald');
      expect(rejectedClasses).toContain('rose');
    });
  });

  describe('4. Clipboard Copy Formatting', () => {
    const baseDraft: SalesAssistantDraftSummary = {
      id: 'd0000000-0000-0000-0000-000000000001',
      leadId: 'l0000000-0000-0000-0000-000000000001',
      organizationId: 'o0000000-0000-0000-0000-000000000001',
      type: SalesAssistantDraftType.WHATSAPP,
      language: SalesAssistantLanguage.BANGLA,
      tone: SalesAssistantTone.PROFESSIONAL,
      status: SalesAssistantDraftStatus.DRAFT,
      content: 'আসসালামু আলাইকুম, আমরা আপনার ব্যবসার জন্য আধুনিক সমাধান দিচ্ছি।',
      warnings: [],
      createdByUserId: 'u0000000-0000-0000-0000-000000000001',
      createdAt: '2026-10-04T10:00:00.000Z',
      updatedAt: '2026-10-04T10:00:00.000Z'
    };

    it('formats non-email draft as plain content', () => {
      const formatted = formatDraftForClipboard(baseDraft);
      expect(formatted).toBe('আসসালামু আলাইকুম, আমরা আপনার ব্যবসার জন্য আধুনিক সমাধান দিচ্ছি।');
    });

    it('formats email draft with Subject and Body structure', () => {
      const emailDraft: SalesAssistantDraftSummary = {
        ...baseDraft,
        type: SalesAssistantDraftType.EMAIL,
        content: null,
        emailSubject: 'ব্যবসা প্রসারে ডিজিটাল প্ল্যাটফর্ম',
        emailBody: 'প্রিয় মহোদয়,\n\nআমরা আপনার প্রতিষ্ঠানের জন্য বিশেষ প্রস্তাবনা পাঠাচ্ছি।'
      };

      const formatted = formatDraftForClipboard(emailDraft);
      expect(formatted).toBe(
        'Subject: ব্যবসা প্রসারে ডিজিটাল প্ল্যাটফর্ম\n\nপ্রিয় মহোদয়,\n\nআমরা আপনার প্রতিষ্ঠানের জন্য বিশেষ প্রস্তাবনা পাঠাচ্ছি।'
      );
    });
  });

  describe('5. Error Classification', () => {
    it('classifies 409 CONFLICT with friendly refresh guidance', () => {
      const err = new ApiClientError('CONFLICT', 'Conflict', 409);
      const classified = classifySalesAssistantError(err);
      expect(classified.isConflict).toBe(true);
      expect(classified.message).toBe(
        'This draft has already been reviewed. Refreshing its latest status.'
      );
    });

    it('classifies 429 RATE_LIMITED with wait guidance', () => {
      const err = new ApiClientError('RATE_LIMITED', 'Too many requests', 429);
      const classified = classifySalesAssistantError(err);
      expect(classified.isRateLimited).toBe(true);
      expect(classified.message).toBe('Too many requests. Please wait a moment and try again.');
    });

    it('classifies 504 AI_PROVIDER_TIMEOUT with timeout guidance', () => {
      const err = new ApiClientError('AI_PROVIDER_TIMEOUT', 'Timeout', 504);
      const classified = classifySalesAssistantError(err);
      expect(classified.isTimeout).toBe(true);
      expect(classified.message).toBe('AI provider timed out. Please wait a moment and try again.');
    });

    it('classifies 503 AI_PROVIDER_UNAVAILABLE with service guidance', () => {
      const err = new ApiClientError('AI_PROVIDER_UNAVAILABLE', 'Unavailable', 503);
      const classified = classifySalesAssistantError(err);
      expect(classified.isUnavailable).toBe(true);
      expect(classified.message).toBe(
        'AI sales assistant is temporarily unavailable. Please try again shortly.'
      );
    });

    it('classifies 403 FORBIDDEN with permission notice', () => {
      const err = new ApiClientError('FORBIDDEN', 'Forbidden', 403);
      const classified = classifySalesAssistantError(err);
      expect(classified.isForbidden).toBe(true);
      expect(classified.message).toBe(
        'You do not have permission to perform this sales assistant action.'
      );
    });

    it('classifies 404 NOT_FOUND safely', () => {
      const err = new ApiClientError('NOT_FOUND', 'Not found', 404);
      const classified = classifySalesAssistantError(err);
      expect(classified.isNotFound).toBe(true);
      expect(classified.message).toBe('Lead or sales assistant draft not found.');
    });
  });
});
