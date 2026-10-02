import { describe, it, expect } from 'vitest';
import {
  WebsiteStatus,
  OnlinePresenceType,
  leadUpdateRequestSchema,
  type LeadDetail
} from '@leadmate/shared';
import {
  buildLeadPatchPayload,
  type EditLeadFormState
} from '../lib/leads/lead-patch-payload.js';

const mockDetail = (overrides: Partial<LeadDetail> = {}): LeadDetail => ({
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Original Hospital',
  normalizedName: 'original hospital',
  category: 'Healthcare',
  locality: 'Dhanmondi',
  city: 'Dhaka',
  region: 'Dhaka',
  country: 'Bangladesh',
  primaryPhone: '+8801711000001',
  primaryEmail: 'info@original.com',
  website: 'https://original.com',
  websiteStatus: WebsiteStatus.REACHABLE,
  onlinePresenceType: OnlinePresenceType.WEBSITE,
  rating: 4.8,
  reviewCount: 45,
  primarySource: 'GOOGLE_MAPS',
  description: 'Original description text',
  address: 'Road 27, House 10, Dhanmondi',
  contacts: [],
  sources: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides
});

const defaultForm = (lead: LeadDetail): EditLeadFormState => ({
  name: lead.name,
  category: lead.category,
  description: lead.description || '',
  address: lead.address || '',
  locality: lead.locality || '',
  city: lead.city,
  website: lead.website || ''
});

describe('Lead PATCH Payload Builder (Pure Unit Tests)', () => {
  it('1. should return an empty object when form values are identical to original lead', () => {
    const lead = mockDetail();
    const form = defaultForm(lead);

    const payload = buildLeadPatchPayload(lead, form);
    expect(payload).toEqual({});
  });

  it('2. should include changed required string fields with trimmed whitespace', () => {
    const lead = mockDetail();
    const form = {
      ...defaultForm(lead),
      name: '  Updated Care Hospital  ',
      city: '  Chittagong  '
    };

    const payload = buildLeadPatchPayload(lead, form);
    expect(payload).toEqual({
      name: 'Updated Care Hospital',
      city: 'Chittagong'
    });

    const validated = leadUpdateRequestSchema.safeParse(payload);
    expect(validated.success).toBe(true);
  });

  it('3. should omit empty or whitespace-only name/category/city (never sending null or empty string)', () => {
    const lead = mockDetail();
    const form = {
      ...defaultForm(lead),
      name: '   ',
      category: ''
    };

    const payload = buildLeadPatchPayload(lead, form);
    // name and category must NOT be included as empty strings or nulls
    expect(payload.name).toBeUndefined();
    expect(payload.category).toBeUndefined();
    expect(payload).toEqual({});
  });

  it('4. should explicitly set nullable fields to null when cleared from an existing value', () => {
    const lead = mockDetail({
      description: 'Existing description',
      address: 'Existing address',
      locality: 'Existing locality',
      website: 'https://existing.com'
    });

    const form = {
      ...defaultForm(lead),
      description: '   ', // Cleared with whitespace
      address: '',        // Cleared with empty string
      locality: '',
      website: '   '
    };

    const payload = buildLeadPatchPayload(lead, form);
    expect(payload).toEqual({
      description: null,
      address: null,
      locality: null,
      website: null
    });

    const validated = leadUpdateRequestSchema.safeParse(payload);
    expect(validated.success).toBe(true);
  });

  it('5. should omit nullable fields if they were already null and left empty/whitespace in form', () => {
    const lead = mockDetail({
      description: null,
      address: null,
      locality: null,
      website: null
    });

    const form = {
      ...defaultForm(lead),
      description: '   ',
      address: '',
      locality: '   ',
      website: ''
    };

    const payload = buildLeadPatchPayload(lead, form);
    expect(payload).toEqual({});
  });

  it('6. should update nullable fields to trimmed non-empty values when changed', () => {
    const lead = mockDetail({
      description: null,
      website: 'https://old.com'
    });

    const form = {
      ...defaultForm(lead),
      description: '  New clean description  ',
      website: '  https://newdomain.com  '
    };

    const payload = buildLeadPatchPayload(lead, form);
    expect(payload).toEqual({
      description: 'New clean description',
      website: 'https://newdomain.com'
    });

    const validated = leadUpdateRequestSchema.safeParse(payload);
    expect(validated.success).toBe(true);
  });

  it('7. should never include protected or read-only database keys in payload', () => {
    const lead = mockDetail();
    const form = {
      ...defaultForm(lead),
      name: 'Renamed Hospital'
    };

    const payload = buildLeadPatchPayload(lead, form) as Record<string, unknown>;
    expect(payload.id).toBeUndefined();
    expect(payload.organizationId).toBeUndefined();
    expect(payload.primaryPhone).toBeUndefined();
    expect(payload.primaryEmail).toBeUndefined();
    expect(payload.rating).toBeUndefined();
    expect(payload.reviewCount).toBeUndefined();
    expect(payload.primarySource).toBeUndefined();
    expect(payload.createdAt).toBeUndefined();
    expect(payload.updatedAt).toBeUndefined();
    expect(payload.contacts).toBeUndefined();
    expect(payload.sources).toBeUndefined();
  });
});
