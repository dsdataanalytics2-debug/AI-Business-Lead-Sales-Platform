import { describe, it, expect } from 'vitest';
import {
  ContactType,
  ContactStatus,
  WhatsAppStatus,
  type LeadContact
} from '@leadmate/shared';
import {
  buildManualContactPayload,
  resolveAddContactOutcome
} from '../lib/leads/manual-contact-payload.js';

const mockContact = (
  id: string,
  rawValue: string,
  isPrimary = false,
  status = ContactStatus.FOUND
): LeadContact => ({
  id,
  leadId: '00000000-0000-0000-0000-000000000001',
  type: ContactType.PHONE,
  rawValue,
  normalizedValue: '+8801711000001',
  phoneType: null,
  status,
  whatsappStatus: WhatsAppStatus.UNKNOWN,
  isPrimary,
  isSuppressed: false,
  suppressionReason: null,
  evidence: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

describe('Manual Contact Payload & Outcome Resolver (Pure Unit Tests)', () => {
  it('1. should construct payload with only allowed fields and trimmed rawValue', () => {
    const payload = buildManualContactPayload({
      type: ContactType.PHONE,
      rawValue: '  01711000001  ',
      isPrimary: true
    });

    expect(payload).toEqual({
      type: ContactType.PHONE,
      rawValue: '01711000001',
      isPrimary: true
    });

    // Ensure no untrusted fields leaked
    const rawObj = payload as unknown as Record<string, unknown>;
    expect(rawObj.whatsappStatus).toBeUndefined();
    expect(rawObj.sourceName).toBeUndefined();
    expect(rawObj.status).toBeUndefined();
    expect(rawObj.isSuppressed).toBeUndefined();
  });

  it('2. should resolve CREATED outcome when newly created contact ID is fresh', () => {
    const existing = [mockContact('contact-1', '01711000001', false)];
    const fresh = mockContact('contact-2', '01711000002', false);

    const outcome = resolveAddContactOutcome(existing, fresh);
    expect(outcome).toBe('CREATED');
  });

  it('3. should resolve ALREADY_EXISTS outcome when returned contact ID matches existing list and primary status did not change', () => {
    const existing = [
      mockContact('contact-1', '01711000001', false),
      mockContact('contact-2', '01711000002', false)
    ];
    // Re-adding existing contact without promoting it
    const returned = mockContact('contact-2', '01711000002', false);

    const outcome = resolveAddContactOutcome(existing, returned);
    expect(outcome).toBe('ALREADY_EXISTS');
  });

  it('4. should resolve PROMOTED_TO_PRIMARY outcome when existing non-primary contact is promoted to primary', () => {
    const existing = [
      mockContact('contact-1', '01711000001', true),
      mockContact('contact-2', '01711000002', false)
    ];
    // Re-adding contact-2 with isPrimary: true
    const returned = mockContact('contact-2', '01711000002', true);

    const outcome = resolveAddContactOutcome(existing, returned);
    expect(outcome).toBe('PROMOTED_TO_PRIMARY');
  });

  it('5. should resolve CREATED_INVALID_FORMAT outcome when returned contact status is INVALID_FORMAT', () => {
    const existing = [mockContact('contact-1', '01711000001', false)];
    const invalidContact = mockContact('contact-3', '99999999999999999', false, ContactStatus.INVALID_FORMAT);

    const outcome = resolveAddContactOutcome(existing, invalidContact);
    expect(outcome).toBe('CREATED_INVALID_FORMAT');
  });
});
