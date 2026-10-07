import { describe, it, expect } from 'vitest';
import {
  normalizeMetaWhatsAppWebhookPayload,
  type MetaWebhookPayload
} from '../outreach/meta-whatsapp-normalizer.js';
import { META_WHATSAPP_PROVIDER_NAME } from '../outreach/meta-whatsapp-provider.js';
import { OutreachErrorCode } from '@leadmate/shared';

describe('Meta WhatsApp Webhook Normalizer', () => {
  it('normalizes delivered status event with deterministic eventId and correct provider correlation', () => {
    const payload: MetaWebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '15550234567',
                  phone_number_id: '123456789'
                },
                statuses: [
                  {
                    id: 'wamid.HBgLMTIzNDU2Nzg5MDEyMzQ1',
                    status: 'delivered',
                    timestamp: '1728280000',
                    recipient_id: '8801711223344'
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const events = normalizeMetaWhatsAppWebhookPayload(payload);
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event.providerName).toBe(META_WHATSAPP_PROVIDER_NAME);
    expect(event.providerMessageId).toBe('wamid.HBgLMTIzNDU2Nzg5MDEyMzQ1');
    expect(event.eventType).toBe('DELIVERED');
    expect(event.eventId).toBe('meta-wa:wamid.HBgLMTIzNDU2Nzg5MDEyMzQ1:delivered:1728280000');
    expect(event.timestamp).toEqual(new Date(1728280000 * 1000));
    // Zero organizationId present on normalized event
    expect((event as any).organizationId).toBeUndefined();
  });

  it('normalizes failed status event with error mapping', () => {
    const payload: MetaWebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                statuses: [
                  {
                    id: 'wamid.HBgLFAIL999',
                    status: 'failed',
                    timestamp: 1728280500,
                    errors: [
                      {
                        code: 131026,
                        title: 'Undeliverable',
                        message: 'Message undeliverable to recipient'
                      }
                    ]
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const events = normalizeMetaWhatsAppWebhookPayload(payload);
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event.providerName).toBe(META_WHATSAPP_PROVIDER_NAME);
    expect(event.providerMessageId).toBe('wamid.HBgLFAIL999');
    expect(event.eventType).toBe('FAILED');
    expect(event.safeErrorCode).toBe(OutreachErrorCode.OUTREACH_RECIPIENT_REJECTED);
    expect(event.safeErrorMessage).toBe('Recipient number unreachable or cannot receive WhatsApp message');
  });

  it('safely ignores non-terminal events such as sent, read, and incoming messages', () => {
    const payload: MetaWebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                statuses: [
                  {
                    id: 'wamid.HBgLSENT01',
                    status: 'sent',
                    timestamp: '1728280100'
                  },
                  {
                    id: 'wamid.HBgLREAD01',
                    status: 'read',
                    timestamp: '1728280200'
                  }
                ],
                messages: [
                  {
                    from: '8801711223344',
                    id: 'wamid.INCOMING_USER_MSG',
                    text: { body: 'Thanks!' },
                    type: 'text'
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const events = normalizeMetaWhatsAppWebhookPayload(payload);
    expect(events).toHaveLength(0);
  });

  it('handles batch of mixed events without one failing the others', () => {
    const payload: MetaWebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [
                  {
                    id: 'wamid.BATCH_01',
                    status: 'delivered',
                    timestamp: 1728281000
                  },
                  {
                    id: 'wamid.BATCH_02',
                    status: 'read', // Ignored
                    timestamp: 1728281005
                  },
                  {
                    id: 'wamid.BATCH_03',
                    status: 'failed',
                    timestamp: 1728281010,
                    errors: [{ code: 131047 }]
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const events = normalizeMetaWhatsAppWebhookPayload(payload);
    expect(events).toHaveLength(2);
    expect(events[0].providerMessageId).toBe('wamid.BATCH_01');
    expect(events[0].eventType).toBe('DELIVERED');
    expect(events[1].providerMessageId).toBe('wamid.BATCH_03');
    expect(events[1].eventType).toBe('FAILED');
    expect(events[1].safeErrorCode).toBe(OutreachErrorCode.OUTREACH_CONTENT_REJECTED);
  });

  it('returns empty array for invalid or empty payloads without throwing', () => {
    expect(normalizeMetaWhatsAppWebhookPayload(null)).toEqual([]);
    expect(normalizeMetaWhatsAppWebhookPayload(undefined)).toEqual([]);
    expect(normalizeMetaWhatsAppWebhookPayload({})).toEqual([]);
    expect(normalizeMetaWhatsAppWebhookPayload({ entry: [] })).toEqual([]);
  });
});
