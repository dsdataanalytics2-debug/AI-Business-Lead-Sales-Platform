import { describe, it, expect } from 'vitest';
import { OutreachErrorCode } from '@leadmate/shared';
import { normalizeResendEmailWebhookPayload } from '../outreach/resend-email-normalizer.js';
import { RESEND_EMAIL_PROVIDER_NAME } from '../outreach/resend-email-provider.js';

describe('M6 Step 9B: Resend Email Webhook Normalizer', () => {
  const deliveredPayload = {
    id: 'evt_resend_delivered_101',
    type: 'email.delivered',
    created_at: '2026-10-07T12:00:00.000Z',
    data: {
      email_id: 're_msg_email_888',
      from: 'alerts@leadmate.ai',
      to: ['client@example.com'],
      subject: 'Welcome to LeadMate'
    }
  };

  const bouncedPayload = {
    id: 'evt_resend_bounced_202',
    type: 'email.bounced',
    created_at: '2026-10-07T12:05:00.000Z',
    data: {
      email_id: 're_msg_email_999',
      from: 'alerts@leadmate.ai',
      to: ['bounced@example.com'],
      subject: 'Welcome to LeadMate',
      bounce_type: 'Permanent'
    }
  };

  const failedPayload = {
    id: 'evt_resend_failed_303',
    type: 'email.failed',
    created_at: '2026-10-07T12:10:00.000Z',
    data: {
      email_id: 're_msg_email_777',
      from: 'alerts@leadmate.ai',
      to: ['failed@example.com'],
      subject: 'Welcome to LeadMate',
      message: 'MX record lookup failed'
    }
  };

  const suppressedPayload = {
    id: 'evt_resend_suppressed_404',
    type: 'email.suppressed',
    created_at: '2026-10-07T12:15:00.000Z',
    data: {
      email_id: 're_msg_email_666',
      from: 'alerts@leadmate.ai',
      to: ['suppressed@example.com'],
      subject: 'Welcome to LeadMate'
    }
  };

  describe('1. Delivered Event Normalization', () => {
    it('normalizes email.delivered to DELIVERED status event', () => {
      const events = normalizeResendEmailWebhookPayload(deliveredPayload);

      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event.providerName).toBe(RESEND_EMAIL_PROVIDER_NAME);
      expect(event.eventType).toBe('DELIVERED');
      expect(event.providerMessageId).toBe('re_msg_email_888');
      expect(event.eventId).toBe('resend:evt_resend_delivered_101');
      expect(event.timestamp?.toISOString()).toBe('2026-10-07T12:00:00.000Z');
      expect((event as any).organizationId).toBeUndefined();
    });
  });

  describe('2. Bounced, Failed & Suppressed Event Normalization', () => {
    it('normalizes email.bounced to FAILED status with OUTREACH_RECIPIENT_REJECTED', () => {
      const events = normalizeResendEmailWebhookPayload(bouncedPayload);

      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event.providerName).toBe(RESEND_EMAIL_PROVIDER_NAME);
      expect(event.eventType).toBe('FAILED');
      expect(event.providerMessageId).toBe('re_msg_email_999');
      expect(event.eventId).toBe('resend:evt_resend_bounced_202');
      expect(event.safeErrorCode).toBe(OutreachErrorCode.OUTREACH_RECIPIENT_REJECTED);
      expect(event.safeErrorMessage).toContain('Permanent');
    });

    it('normalizes email.failed to FAILED status with OUTREACH_DELIVERY_FAILED', () => {
      const events = normalizeResendEmailWebhookPayload(failedPayload);

      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event.providerName).toBe(RESEND_EMAIL_PROVIDER_NAME);
      expect(event.eventType).toBe('FAILED');
      expect(event.providerMessageId).toBe('re_msg_email_777');
      expect(event.eventId).toBe('resend:evt_resend_failed_303');
      expect(event.safeErrorCode).toBe(OutreachErrorCode.OUTREACH_DELIVERY_FAILED);
      expect(event.safeErrorMessage).toContain('MX record lookup failed');
    });

    it('normalizes email.suppressed to FAILED status with OUTREACH_RECIPIENT_REJECTED', () => {
      const events = normalizeResendEmailWebhookPayload(suppressedPayload);

      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event.providerName).toBe(RESEND_EMAIL_PROVIDER_NAME);
      expect(event.eventType).toBe('FAILED');
      expect(event.providerMessageId).toBe('re_msg_email_666');
      expect(event.eventId).toBe('resend:evt_resend_suppressed_404');
      expect(event.safeErrorCode).toBe(OutreachErrorCode.OUTREACH_RECIPIENT_REJECTED);
      expect(event.safeErrorMessage).toContain('suppressed');
    });
  });

  describe('3. Non-Terminal & Analytics Events Ignored', () => {
    it('safely ignores email.sent, email.delivery_delayed, email.opened, email.clicked, email.complained', () => {
      const ignoredEvents = [
        { type: 'email.sent', data: { email_id: 'id1' } },
        { type: 'email.delivery_delayed', data: { email_id: 'id2' } },
        { type: 'email.opened', data: { email_id: 'id3' } },
        { type: 'email.clicked', data: { email_id: 'id4' } },
        { type: 'email.complained', data: { email_id: 'id5' } }
      ];

      for (const payload of ignoredEvents) {
        const result = normalizeResendEmailWebhookPayload(payload);
        expect(result).toHaveLength(0);
      }
    });
  });

  describe('4. providerMessageId Extraction Integrity Across All Terminal Events', () => {
    it('extracts correct providerMessageId from data.email_id or data.id', () => {
      const terminalTypes = ['email.delivered', 'email.bounced', 'email.failed', 'email.suppressed'];

      for (const type of terminalTypes) {
        const payloadWithEmailId = {
          type,
          data: { email_id: `msg_email_id_for_${type}` }
        };
        const res1 = normalizeResendEmailWebhookPayload(payloadWithEmailId);
        expect(res1).toHaveLength(1);
        expect(res1[0].providerMessageId).toBe(`msg_email_id_for_${type}`);

        const payloadWithId = {
          type,
          data: { id: `msg_id_for_${type}` }
        };
        const res2 = normalizeResendEmailWebhookPayload(payloadWithId);
        expect(res2).toHaveLength(1);
        expect(res2[0].providerMessageId).toBe(`msg_id_for_${type}`);
      }
    });

    it('rejects terminal events with missing or empty providerMessageId', () => {
      const payloadWithoutId = {
        type: 'email.delivered',
        data: { from: 'test@example.com' }
      };
      expect(normalizeResendEmailWebhookPayload(payloadWithoutId)).toHaveLength(0);

      const payloadWithEmptyId = {
        type: 'email.bounced',
        data: { email_id: '   ' }
      };
      expect(normalizeResendEmailWebhookPayload(payloadWithEmptyId)).toHaveLength(0);
    });
  });

  describe('5. Deterministic Event ID Derivation', () => {
    it('uses event.id when provided', () => {
      const events = normalizeResendEmailWebhookPayload(deliveredPayload);
      expect(events[0].eventId).toBe('resend:evt_resend_delivered_101');
    });

    it('derives deterministic eventId when top-level event.id is missing', () => {
      const payloadWithoutId = {
        type: 'email.delivered',
        created_at: '2026-10-07T12:00:00.000Z',
        data: {
          email_id: 're_msg_no_id_123',
          to: ['someone@example.com']
        }
      };

      const events1 = normalizeResendEmailWebhookPayload(payloadWithoutId);
      const events2 = normalizeResendEmailWebhookPayload(payloadWithoutId);

      expect(events1).toHaveLength(1);
      expect(events1[0].eventId).toBe(events2[0].eventId);
      expect(events1[0].eventId).toContain('resend:re_msg_no_id_123:email.delivered:');
    });
  });

  describe('6. Batch Payloads & Malformed Input Handling', () => {
    it('processes array of events correctly', () => {
      const batch = [
        deliveredPayload,
        bouncedPayload,
        failedPayload,
        suppressedPayload,
        { type: 'email.sent', data: { email_id: 'id_sent' } }
      ];
      const events = normalizeResendEmailWebhookPayload(batch);

      expect(events).toHaveLength(4);
      expect(events[0].eventType).toBe('DELIVERED');
      expect(events[1].eventType).toBe('FAILED');
      expect(events[2].eventType).toBe('FAILED');
      expect(events[3].eventType).toBe('FAILED');
    });

    it('returns empty array for invalid, missing, or malformed payloads', () => {
      expect(normalizeResendEmailWebhookPayload(null)).toEqual([]);
      expect(normalizeResendEmailWebhookPayload(undefined)).toEqual([]);
      expect(normalizeResendEmailWebhookPayload('string')).toEqual([]);
      expect(normalizeResendEmailWebhookPayload(12345)).toEqual([]);
      expect(normalizeResendEmailWebhookPayload({})).toEqual([]);
      expect(normalizeResendEmailWebhookPayload({ type: 'email.delivered' })).toEqual([]);
      expect(normalizeResendEmailWebhookPayload({ type: 'email.delivered', data: {} })).toEqual([]);
    });
  });
});
