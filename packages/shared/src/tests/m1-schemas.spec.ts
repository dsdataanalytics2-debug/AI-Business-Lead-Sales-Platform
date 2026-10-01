import { describe, it, expect } from 'vitest';
import {
  businessSearchQuerySchema,
  saveLeadRequestSchema,
  leadListQuerySchema,
  leadUpdateRequestSchema,
  manualContactRequestSchema,
  leadDetailSchema,
  duplicateResultSchema,
  ContactType,
  PhoneType,
  ContactStatus,
  WhatsAppStatus,
  EvidenceType,
  WebsiteStatus,
  OnlinePresenceType,
  SuppressionReason,
  DuplicateMatchLevel,
  DuplicateAction
} from '../index.js';

describe('M1 Step 1: Shared Domain Schemas & Contracts Verification', () => {
  /* -----------------------------------------------------------------
   * 1. Business Search Query Validation
   * ----------------------------------------------------------------- */
  it('1. Valid business search query accepted', () => {
    const valid = {
      q: 'Dental Clinic',
      location: 'Mirpur, Dhaka',
      category: 'Healthcare',
      limit: 25
    };
    const parsed = businessSearchQuerySchema.parse(valid);
    expect(parsed.q).toBe('Dental Clinic');
    expect(parsed.location).toBe('Mirpur, Dhaka');
    expect(parsed.limit).toBe(25);
  });

  it('2. Empty q rejected', () => {
    const invalid = { q: '   ', location: 'Dhaka' };
    expect(() => businessSearchQuerySchema.parse(invalid)).toThrow();
  });

  it('3. Empty location rejected', () => {
    const invalid = { q: 'Dental', location: '' };
    expect(() => businessSearchQuerySchema.parse(invalid)).toThrow();
  });

  it('4. Cursor pagination accepted in business search query', () => {
    const cursor = '123e4567-e89b-12d3-a456-426614174000';
    const parsed = businessSearchQuerySchema.parse({
      q: 'Restaurant',
      location: 'Gulshan',
      cursor,
      limit: 10
    });
    expect(parsed.cursor).toBe(cursor);
    expect(parsed.limit).toBe(10);
  });

  it('5. Limit above allowed maximum (200) rejected', () => {
    const invalid = { q: 'Clinic', location: 'Dhaka', limit: 201 };
    expect(() => businessSearchQuerySchema.parse(invalid)).toThrow();
  });

  /* -----------------------------------------------------------------
   * 2. SaveLeadRequest Security Contracts
   * ----------------------------------------------------------------- */
  it('6. SaveLeadRequest accepts valid { provider, externalId }', () => {
    const valid = {
      provider: 'MOCK_SEARCH',
      externalId: 'mock-dhk-001'
    };
    const parsed = saveLeadRequestSchema.parse(valid);
    expect(parsed.provider).toBe('MOCK_SEARCH');
    expect(parsed.externalId).toBe('mock-dhk-001');
  });

  it('7. SaveLeadRequest rejects injected authoritative fields (phone, rating, website, rawData)', () => {
    const injected = {
      provider: 'MOCK_SEARCH',
      externalId: 'mock-dhk-001',
      phone: '+8801711111111',
      rating: 5.0,
      website: 'https://hacked.com',
      rawData: { secret: true }
    };
    expect(() => saveLeadRequestSchema.parse(injected)).toThrow();
  });

  /* -----------------------------------------------------------------
   * 3. LeadListQuery Boolean Parameter Parsing
   * ----------------------------------------------------------------- */
  it('8. hasPhone="false" parses strictly to boolean false', () => {
    const parsed = leadListQuerySchema.parse({
      hasPhone: 'false',
      hasEmail: '0'
    });
    expect(parsed.hasPhone).toBe(false);
    expect(parsed.hasEmail).toBe(false);
  });

  it('9. hasPhone="true" parses strictly to boolean true', () => {
    const parsed = leadListQuerySchema.parse({
      hasPhone: 'true',
      hasWhatsApp: '1',
      hasEmail: true
    });
    expect(parsed.hasPhone).toBe(true);
    expect(parsed.hasWhatsApp).toBe(true);
    expect(parsed.hasEmail).toBe(true);
  });

  /* -----------------------------------------------------------------
   * 4. LeadUpdateRequest Validation
   * ----------------------------------------------------------------- */
  it('10. Empty LeadUpdateRequest rejected (at least one field required)', () => {
    expect(() => leadUpdateRequestSchema.parse({})).toThrow();
  });

  it('11. LeadUpdateRequest rejects organizationId injection', () => {
    const injected = {
      name: 'Updated Name',
      organizationId: '00000000-0000-0000-0000-000000000001'
    };
    expect(() => leadUpdateRequestSchema.parse(injected)).toThrow();
  });

  it('12. LeadUpdateRequest rejects primarySource and CRM fields', () => {
    const injected = {
      name: 'Updated Name',
      primarySource: 'ATTACKER',
      crmStage: 'WON',
      assignedUserId: '123e4567-e89b-12d3-a456-426614174000'
    };
    expect(() => leadUpdateRequestSchema.parse(injected)).toThrow();
  });

  /* -----------------------------------------------------------------
   * 5. ManualContactRequest Security Validation
   * ----------------------------------------------------------------- */
  it('13. ManualContactRequest cannot set VERIFIED status (status field rejected)', () => {
    const injected = {
      type: ContactType.PHONE,
      rawValue: '01712345678',
      status: ContactStatus.VERIFIED
    };
    expect(() => manualContactRequestSchema.parse(injected)).toThrow();
  });

  /* -----------------------------------------------------------------
   * 6. Duplicate Result Contract Verification
   * ----------------------------------------------------------------- */
  it('14. Valid duplicate NONE contract parses successfully', () => {
    const result = duplicateResultSchema.parse({
      matchLevel: DuplicateMatchLevel.NONE,
      action: DuplicateAction.CREATED
    });
    expect(result.matchLevel).toBe(DuplicateMatchLevel.NONE);
    expect(result.action).toBe(DuplicateAction.CREATED);
  });

  it('15. Valid duplicate DEFINITE contract parses successfully', () => {
    const result = duplicateResultSchema.parse({
      matchLevel: DuplicateMatchLevel.DEFINITE,
      action: DuplicateAction.MERGED,
      reason: 'Matched existing phone number',
      existingLeadId: '123e4567-e89b-12d3-a456-426614174000'
    });
    expect(result.matchLevel).toBe(DuplicateMatchLevel.DEFINITE);
    expect(result.action).toBe(DuplicateAction.MERGED);
  });

  it('16. Valid duplicate CANDIDATE contract parses successfully', () => {
    const result = duplicateResultSchema.parse({
      matchLevel: DuplicateMatchLevel.CANDIDATE,
      action: DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION,
      reason: 'Same website domain with different branch location',
      existingLeadId: '123e4567-e89b-12d3-a456-426614174000'
    });
    expect(result.matchLevel).toBe(DuplicateMatchLevel.CANDIDATE);
    expect(result.action).toBe(DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION);
  });

  /* -----------------------------------------------------------------
   * 7. Suppression & Data Minimization Verification
   * ----------------------------------------------------------------- */
  it('17. Suppression metadata coexists with ContactStatus.FOUND without corrupting status', () => {
    const leadDetail = leadDetailSchema.parse({
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Mirpur Dental Care',
      normalizedName: 'mirpur dental care',
      category: 'Dental Clinic',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.NONE_DETECTED,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'MOCK_SEARCH',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      contacts: [
        {
          id: '223e4567-e89b-12d3-a456-426614174000',
          leadId: '123e4567-e89b-12d3-a456-426614174000',
          type: ContactType.PHONE,
          rawValue: '01712345678',
          normalizedValue: '+8801712345678',
          phoneType: PhoneType.MOBILE,
          status: ContactStatus.FOUND, // Preserved true technical status
          whatsappStatus: WhatsAppStatus.UNKNOWN,
          isPrimary: true,
          isSuppressed: true, // Independent suppression flag
          suppressionReason: SuppressionReason.DO_NOT_CONTACT,
          evidence: [
            {
              id: '323e4567-e89b-12d3-a456-426614174000',
              contactId: '223e4567-e89b-12d3-a456-426614174000',
              sourceName: 'MOCK_SEARCH',
              evidenceType: EvidenceType.LISTING_FIELD,
              discoveredAt: new Date().toISOString()
            }
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      sources: []
    });

    expect(leadDetail.contacts[0].status).toBe(ContactStatus.FOUND);
    expect(leadDetail.contacts[0].isSuppressed).toBe(true);
    expect(leadDetail.contacts[0].suppressionReason).toBe(SuppressionReason.DO_NOT_CONTACT);
  });

  it('18. rawData is not part of the public LeadDetail or LeadSourceSummary contract', () => {
    const rawObject = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Mirpur Dental Care',
      normalizedName: 'mirpur dental care',
      category: 'Dental Clinic',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.NONE_DETECTED,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'MOCK_SEARCH',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      contacts: [],
      sources: [
        {
          id: '423e4567-e89b-12d3-a456-426614174000',
          leadId: '123e4567-e89b-12d3-a456-426614174000',
          sourceName: 'MOCK_SEARCH',
          fetchedAt: new Date().toISOString(),
          rawData: { secretInternalPayload: 'do_not_leak' } // Injected raw payload
        }
      ]
    };

    const parsed = leadDetailSchema.parse(rawObject);
    // Verify TypeScript & runtime shape of sources does not include rawData
    expect((parsed.sources[0] as any).rawData).toBeUndefined();
  });
});
