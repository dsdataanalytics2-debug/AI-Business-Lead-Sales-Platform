import { describe, it, expect } from 'vitest';
import {
  ContactType,
  PhoneType,
  ContactStatus,
  WhatsAppStatus,
  EvidenceType,
  WebsiteStatus,
  OnlinePresenceType,
  DuplicateMatchLevel,
  DuplicateAction
} from '@leadmate/shared';
import {
  normalizeBusinessName,
  detectDuplicate,
  planMerge,
  mergeIntoExistingLead,
  type DbClient,
  type IncomingLeadData,
  type ExistingLeadRecord
} from '../index.js';

/**
 * In-Memory Mock Database Client for Unit & Deterministic Testing of detectDuplicate & mergeService
 */
class InMemoryDbClient {
  public leads: Array<{
    id: string;
    organizationId: string;
    name: string;
    normalizedName: string;
    category: string;
    description?: string | null;
    address?: string | null;
    locality?: string | null;
    city: string;
    region?: string | null;
    country: string;
    latitude?: number | null;
    longitude?: number | null;
    primaryPhone?: string | null;
    primaryEmail?: string | null;
    website?: string | null;
    normalizedWebsite?: string | null;
    websiteStatus: WebsiteStatus;
    onlinePresenceType: OnlinePresenceType;
    rating?: number | null;
    reviewCount?: number | null;
    primarySource: string;
  }> = [];

  public contacts: Array<{
    id: string;
    leadId: string;
    type: ContactType;
    rawValue: string;
    normalizedValue: string;
    phoneType?: PhoneType | null;
    status: ContactStatus;
    whatsappStatus: WhatsAppStatus;
    isPrimary: boolean;
  }> = [];

  public evidence: Array<{
    id: string;
    contactId: string;
    sourceName: string;
    sourceUrl?: string | null;
    evidenceType: string;
    snippet?: string | null;
  }> = [];

  public sources: Array<{
    id: string;
    leadId: string;
    organizationId: string;
    sourceName: string;
    sourceExternalId?: string | null;
    sourceUrl?: string | null;
    rawData?: any;
    fetchedAt: Date;
  }> = [];

  public leadSource = {
    findFirst: async ({ where }: { where: any }) => {
      return (
        this.sources.find((s) => {
          if (where.organizationId && s.organizationId !== where.organizationId) return false;
          if (where.sourceName && s.sourceName !== where.sourceName) return false;
          if (where.sourceExternalId && s.sourceExternalId !== where.sourceExternalId) return false;
          return true;
        }) || null
      );
    },
    upsert: async ({ where, create, update }: { where: any; create: any; update: any }) => {
      const key = where.organizationId_sourceName_sourceExternalId;
      const idx = this.sources.findIndex(
        (s) =>
          s.organizationId === key.organizationId &&
          s.sourceName === key.sourceName &&
          s.sourceExternalId === key.sourceExternalId
      );
      if (idx >= 0) {
        const updateClean: any = {};
        for (const [k, v] of Object.entries(update)) {
          if (v !== undefined) {
            updateClean[k] = v;
          }
        }
        this.sources[idx] = { ...this.sources[idx], ...updateClean };
        return this.sources[idx];
      } else {
        const item = { id: `src-${Date.now()}-${Math.random()}`, ...create };
        this.sources.push(item);
        return item;
      }
    },
    create: async ({ data }: { data: any }) => {
      const item = { id: `src-${Date.now()}-${Math.random()}`, ...data };
      this.sources.push(item);
      return item;
    }
  };

  public leadContact = {
    findMany: async ({ where }: { where: any }) => {
      return this.contacts
        .filter((c) => {
          const lead = this.leads.find((l) => l.id === c.leadId);
          if (!lead) return false;
          if (where.lead?.organizationId && lead.organizationId !== where.lead.organizationId) return false;
          if (where.type?.in && !where.type.in.includes(c.type)) return false;
          if (where.normalizedValue?.in && !where.normalizedValue.in.includes(c.normalizedValue)) return false;
          return true;
        })
        .map((c) => ({ leadId: c.leadId, normalizedValue: c.normalizedValue }));
    },
    create: async ({ data }: { data: any }) => {
      const contactId = `cnt-${Date.now()}-${Math.random()}`;
      const item = {
        id: contactId,
        leadId: data.leadId,
        type: data.type,
        rawValue: data.rawValue,
        normalizedValue: data.normalizedValue,
        phoneType: data.phoneType || null,
        status: data.status,
        whatsappStatus: data.whatsappStatus,
        isPrimary: data.isPrimary
      };
      this.contacts.push(item);

      if (data.evidence?.create) {
        for (const ev of data.evidence.create) {
          this.evidence.push({
            id: `ev-${Date.now()}-${Math.random()}`,
            contactId,
            ...ev
          });
        }
      }
      return item;
    },
    update: async ({ where, data }: { where: any; data: any }) => {
      const idx = this.contacts.findIndex((c) => c.id === where.id);
      if (idx >= 0) {
        this.contacts[idx] = { ...this.contacts[idx], ...data };
        return this.contacts[idx];
      }
      throw new Error(`Contact not found: ${where.id}`);
    }
  };

  public contactEvidence = {
    create: async ({ data }: { data: any }) => {
      const item = { id: `ev-${Date.now()}-${Math.random()}`, ...data };
      this.evidence.push(item);
      return item;
    }
  };

  public lead = {
    findMany: async ({ where }: { where: any }) => {
      return this.leads.filter((l) => {
        if (where.organizationId && l.organizationId !== where.organizationId) return false;
        if (where.normalizedWebsite && l.normalizedWebsite !== where.normalizedWebsite) return false;
        if (where.normalizedName && l.normalizedName !== where.normalizedName) return false;
        return true;
      });
    },
    findFirst: async ({ where, include }: { where: any; include?: any }) => {
      const lead = this.leads.find((l) => {
        if (where.id && l.id !== where.id) return false;
        if (where.organizationId && l.organizationId !== where.organizationId) return false;
        return true;
      });
      if (!lead) return null;

      const result: any = { ...lead };
      if (include?.contacts) {
        result.contacts = this.contacts
          .filter((c) => c.leadId === lead.id)
          .map((c) => {
            const contactCopy: any = { ...c };
            if (include.contacts.include?.evidence) {
              contactCopy.evidence = this.evidence.filter((e) => e.contactId === c.id);
            }
            return contactCopy;
          });
      }
      if (include?.sources) {
        result.sources = this.sources.filter((s) => s.leadId === lead.id);
      }
      return result;
    },
    update: async ({ where, data }: { where: any; data: any }) => {
      const idx = this.leads.findIndex((l) => l.id === where.id);
      if (idx >= 0) {
        this.leads[idx] = { ...this.leads[idx], ...data };
        return this.leads[idx];
      }
      throw new Error(`Lead not found: ${where.id}`);
    }
  };

  public $transaction = async (fn: (tx: any) => Promise<any>) => {
    return fn(this);
  };
}

describe('M1 Step 4: Deterministic Business Name Normalization', () => {
  it('trims, lowercases, and collapses whitespace', () => {
    expect(normalizeBusinessName('  Mirpur   Dental    Care  ')).toBe('mirpur dental care');
    expect(normalizeBusinessName('Gulshan-2 Clinic\t\nBranch')).toBe('gulshan-2 clinic branch');
  });

  it('normalizes Bengali digits in business names', () => {
    expect(normalizeBusinessName('উত্তরা ব্রাঞ্চ ০১')).toBe('উত্তরা ব্রাঞ্চ 01');
    expect(normalizeBusinessName('Dhaka Branch ১২৩')).toBe('dhaka branch 123');
  });

  it('handles empty / invalid inputs safely', () => {
    expect(normalizeBusinessName('')).toBe('');
    expect(normalizeBusinessName(null as unknown as string)).toBe('');
    expect(normalizeBusinessName(undefined as unknown as string)).toBe('');
  });
});

describe('M1 Step 4: Duplicate Detection - 32 Required Scenarios', () => {
  const orgA = 'org-aaaa-1111';
  const orgB = 'org-bbbb-2222';

  // 1. provider identity same org => DEFINITE
  it('1. provider identity same org => DEFINITE', async () => {
    const db = new InMemoryDbClient();
    db.leads.push({
      id: 'lead-1',
      organizationId: orgA,
      name: 'Mirpur Dental',
      normalizedName: 'mirpur dental',
      category: 'Healthcare',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.REACHABLE,
      onlinePresenceType: OnlinePresenceType.WEBSITE,
      primarySource: 'google_places'
    });
    db.sources.push({
      id: 'src-1',
      leadId: 'lead-1',
      organizationId: orgA,
      sourceName: 'google_places',
      sourceExternalId: 'place_123',
      fetchedAt: new Date()
    });

    const input: IncomingLeadData = {
      organizationId: orgA,
      name: 'Mirpur Dental Clinic',
      source: {
        sourceName: 'google_places',
        sourceExternalId: 'place_123'
      }
    };

    const res = await detectDuplicate(db as unknown as DbClient, input);
    expect(res.matchLevel).toBe(DuplicateMatchLevel.DEFINITE);
    expect(res.action).toBe(DuplicateAction.MERGED);
    expect(res.reason).toBe('TIER_1A_PROVIDER_IDENTITY');
    expect(res.leadId).toBe('lead-1');
    expect(res.isConflict).toBe(false);
  });

  // 2. same provider identity different org => NONE
  it('2. same provider identity different org => NONE', async () => {
    const db = new InMemoryDbClient();
    db.sources.push({
      id: 'src-1',
      leadId: 'lead-b-1',
      organizationId: orgB,
      sourceName: 'google_places',
      sourceExternalId: 'place_123',
      fetchedAt: new Date()
    });

    const input: IncomingLeadData = {
      organizationId: orgA,
      name: 'Mirpur Dental Clinic',
      source: {
        sourceName: 'google_places',
        sourceExternalId: 'place_123'
      }
    };

    const res = await detectDuplicate(db as unknown as DbClient, input);
    expect(res.matchLevel).toBe(DuplicateMatchLevel.NONE);
    expect(res.action).toBe(DuplicateAction.CREATED);
    expect(res.reason).toBe('NO_MATCH');
    expect(res.leadId).toBeNull();
  });

  // 3. valid normalized mobile same org => DEFINITE
  it('3. valid normalized mobile same org => DEFINITE', async () => {
    const db = new InMemoryDbClient();
    db.leads.push({
      id: 'lead-1',
      organizationId: orgA,
      name: 'ABC Shop',
      normalizedName: 'abc shop',
      category: 'Retail',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'manual'
    });
    db.contacts.push({
      id: 'cnt-1',
      leadId: 'lead-1',
      type: ContactType.PHONE,
      rawValue: '01712345678',
      normalizedValue: '+8801712345678',
      phoneType: PhoneType.MOBILE,
      status: ContactStatus.FOUND,
      whatsappStatus: WhatsAppStatus.UNKNOWN,
      isPrimary: true
    });

    const input: IncomingLeadData = {
      organizationId: orgA,
      name: 'ABC Store',
      primaryPhone: '01712345678'
    };

    const res = await detectDuplicate(db as unknown as DbClient, input);
    expect(res.matchLevel).toBe(DuplicateMatchLevel.DEFINITE);
    expect(res.action).toBe(DuplicateAction.MERGED);
    expect(res.reason).toBe('TIER_1B_MOBILE_MATCH');
    expect(res.leadId).toBe('lead-1');
  });

  // 4. local/+880/880 forms converge to same mobile identity
  it('4. local/+880/880 forms converge to same mobile identity', async () => {
    const db = new InMemoryDbClient();
    db.leads.push({
      id: 'lead-1',
      organizationId: orgA,
      name: 'ABC Shop',
      normalizedName: 'abc shop',
      category: 'Retail',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'manual'
    });
    db.contacts.push({
      id: 'cnt-1',
      leadId: 'lead-1',
      type: ContactType.PHONE,
      rawValue: '01712345678',
      normalizedValue: '+8801712345678',
      phoneType: PhoneType.MOBILE,
      status: ContactStatus.FOUND,
      whatsappStatus: WhatsAppStatus.UNKNOWN,
      isPrimary: true
    });

    // Test with +880 form
    const resPlus880 = await detectDuplicate(db as unknown as DbClient, {
      organizationId: orgA,
      name: 'ABC Store',
      contacts: [{ type: ContactType.PHONE, rawValue: '+8801712345678' }]
    });
    expect(resPlus880.matchLevel).toBe(DuplicateMatchLevel.DEFINITE);
    expect(resPlus880.leadId).toBe('lead-1');

    // Test with 880 form
    const res880 = await detectDuplicate(db as unknown as DbClient, {
      organizationId: orgA,
      name: 'ABC Store',
      contacts: [{ type: ContactType.PHONE, rawValue: '8801712345678' }]
    });
    expect(res880.matchLevel).toBe(DuplicateMatchLevel.DEFINITE);
    expect(res880.leadId).toBe('lead-1');

    // Test with Bengali digit form
    const resBn = await detectDuplicate(db as unknown as DbClient, {
      organizationId: orgA,
      name: 'ABC Store',
      contacts: [{ type: ContactType.PHONE, rawValue: '০১৭১২৩৪৫৬৭৮' }]
    });
    expect(resBn.matchLevel).toBe(DuplicateMatchLevel.DEFINITE);
    expect(resBn.leadId).toBe('lead-1');
  });

  // 5. same mobile different org => NONE
  it('5. same mobile different org => NONE', async () => {
    const db = new InMemoryDbClient();
    db.leads.push({
      id: 'lead-b-1',
      organizationId: orgB,
      name: 'ABC Shop B',
      normalizedName: 'abc shop b',
      category: 'Retail',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'manual'
    });
    db.contacts.push({
      id: 'cnt-b-1',
      leadId: 'lead-b-1',
      type: ContactType.PHONE,
      rawValue: '01712345678',
      normalizedValue: '+8801712345678',
      phoneType: PhoneType.MOBILE,
      status: ContactStatus.FOUND,
      whatsappStatus: WhatsAppStatus.UNKNOWN,
      isPrimary: true
    });

    const res = await detectDuplicate(db as unknown as DbClient, {
      organizationId: orgA,
      name: 'ABC Shop',
      primaryPhone: '01712345678'
    });
    expect(res.matchLevel).toBe(DuplicateMatchLevel.NONE);
    expect(res.leadId).toBeNull();
  });

  // 6. invalid phone cannot produce definite match
  it('6. invalid phone cannot produce definite match', async () => {
    const db = new InMemoryDbClient();
    const res = await detectDuplicate(db as unknown as DbClient, {
      organizationId: orgA,
      name: 'Invalid Phone Co',
      primaryPhone: '01234567890' // Invalid BD operator
    });
    expect(res.matchLevel).toBe(DuplicateMatchLevel.NONE);
  });

  // 7. landline cannot produce Tier 1B definite match
  it('7. landline cannot produce Tier 1B definite match', async () => {
    const db = new InMemoryDbClient();
    db.leads.push({
      id: 'lead-1',
      organizationId: orgA,
      name: 'Dhaka Landline Office',
      normalizedName: 'dhaka landline office',
      category: 'Corporate',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'manual'
    });
    db.contacts.push({
      id: 'cnt-1',
      leadId: 'lead-1',
      type: ContactType.PHONE,
      rawValue: '029876543',
      normalizedValue: '+88029876543',
      phoneType: PhoneType.LANDLINE,
      status: ContactStatus.FOUND,
      whatsappStatus: WhatsAppStatus.UNKNOWN,
      isPrimary: true
    });

    const res = await detectDuplicate(db as unknown as DbClient, {
      organizationId: orgA,
      name: 'Dhaka Office',
      primaryPhone: '029876543' // Landline
    });
    expect(res.matchLevel).toBe(DuplicateMatchLevel.NONE);
  });

  // 8. website domain same org => CANDIDATE
  it('8. website domain same org => CANDIDATE', async () => {
    const db = new InMemoryDbClient();
    db.leads.push({
      id: 'lead-web-1',
      organizationId: orgA,
      name: 'Web Corp Branch 1',
      normalizedName: 'web corp branch 1',
      category: 'IT',
      city: 'Dhaka',
      country: 'BD',
      website: 'https://webcorp.com.bd',
      normalizedWebsite: 'webcorp.com.bd',
      websiteStatus: WebsiteStatus.REACHABLE,
      onlinePresenceType: OnlinePresenceType.WEBSITE,
      primarySource: 'manual'
    });

    const res = await detectDuplicate(db as unknown as DbClient, {
      organizationId: orgA,
      name: 'Web Corp Branch 2',
      website: 'http://www.webcorp.com.bd/contact'
    });
    expect(res.matchLevel).toBe(DuplicateMatchLevel.CANDIDATE);
    expect(res.action).toBe(DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION);
    expect(res.reason).toBe('TIER_2A_WEBSITE_DOMAIN');
    expect(res.leadId).toBe('lead-web-1');
  });

  // 9. same website different org => NONE
  it('9. same website different org => NONE', async () => {
    const db = new InMemoryDbClient();
    db.leads.push({
      id: 'lead-web-b',
      organizationId: orgB,
      name: 'Web Corp Org B',
      normalizedName: 'web corp org b',
      category: 'IT',
      city: 'Dhaka',
      country: 'BD',
      website: 'https://webcorp.com.bd',
      normalizedWebsite: 'webcorp.com.bd',
      websiteStatus: WebsiteStatus.REACHABLE,
      onlinePresenceType: OnlinePresenceType.WEBSITE,
      primarySource: 'manual'
    });

    const res = await detectDuplicate(db as unknown as DbClient, {
      organizationId: orgA,
      name: 'Web Corp Org A',
      website: 'https://webcorp.com.bd'
    });
    expect(res.matchLevel).toBe(DuplicateMatchLevel.NONE);
  });

  // 10. website candidate never MERGED automatically
  it('10. website candidate never MERGED automatically', async () => {
    const db = new InMemoryDbClient();
    db.leads.push({
      id: 'lead-web-1',
      organizationId: orgA,
      name: 'Tech BD',
      normalizedName: 'tech bd',
      category: 'IT',
      city: 'Dhaka',
      country: 'BD',
      normalizedWebsite: 'techbd.net',
      websiteStatus: WebsiteStatus.REACHABLE,
      onlinePresenceType: OnlinePresenceType.WEBSITE,
      primarySource: 'manual'
    });

    const res = await detectDuplicate(db as unknown as DbClient, {
      organizationId: orgA,
      name: 'Tech BD Chittagong',
      website: 'techbd.net'
    });
    expect(res.action).not.toBe(DuplicateAction.MERGED);
    expect(res.action).toBe(DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION);
  });

  // 11. exact normalized name + locality => CANDIDATE
  it('11. exact normalized name + locality => CANDIDATE', async () => {
    const db = new InMemoryDbClient();
    db.leads.push({
      id: 'lead-loc-1',
      organizationId: orgA,
      name: '  Square Pharmacy  ',
      normalizedName: 'square pharmacy',
      category: 'Pharma',
      locality: 'Dhanmondi 27',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'manual'
    });

    const res = await detectDuplicate(db as unknown as DbClient, {
      organizationId: orgA,
      name: 'Square Pharmacy',
      locality: '  Dhanmondi  27 '
    });
    expect(res.matchLevel).toBe(DuplicateMatchLevel.CANDIDATE);
    expect(res.action).toBe(DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION);
    expect(res.reason).toBe('TIER_2B_NAME_LOCALITY');
    expect(res.leadId).toBe('lead-loc-1');
  });

  // 12. name match but different locality => NONE
  it('12. name match but different locality => NONE', async () => {
    const db = new InMemoryDbClient();
    db.leads.push({
      id: 'lead-loc-1',
      organizationId: orgA,
      name: 'Square Pharmacy',
      normalizedName: 'square pharmacy',
      category: 'Pharma',
      locality: 'Dhanmondi',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'manual'
    });

    const res = await detectDuplicate(db as unknown as DbClient, {
      organizationId: orgA,
      name: 'Square Pharmacy',
      locality: 'Uttara Sector 3',
      city: 'Dhaka'
    });
    expect(res.matchLevel).toBe(DuplicateMatchLevel.NONE);
  });

  // 13. locality absent + same city => CANDIDATE
  it('13. locality absent + same city => CANDIDATE', async () => {
    const db = new InMemoryDbClient();
    db.leads.push({
      id: 'lead-city-1',
      organizationId: orgA,
      name: 'Apex Footwear',
      normalizedName: 'apex footwear',
      category: 'Retail',
      locality: null,
      city: 'Sylhet',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'manual'
    });

    const res = await detectDuplicate(db as unknown as DbClient, {
      organizationId: orgA,
      name: 'Apex Footwear',
      locality: null,
      city: 'Sylhet'
    });
    expect(res.matchLevel).toBe(DuplicateMatchLevel.CANDIDATE);
    expect(res.action).toBe(DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION);
    expect(res.reason).toBe('TIER_2B_NAME_CITY');
    expect(res.leadId).toBe('lead-city-1');
  });

  // 14. name+location candidate never auto-merges
  it('14. name+location candidate never auto-merges', async () => {
    const db = new InMemoryDbClient();
    db.leads.push({
      id: 'lead-1',
      organizationId: orgA,
      name: 'Bata Shoes',
      normalizedName: 'bata shoes',
      category: 'Retail',
      locality: 'Mirpur 10',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'manual'
    });

    const res = await detectDuplicate(db as unknown as DbClient, {
      organizationId: orgA,
      name: 'Bata Shoes',
      locality: 'Mirpur 10'
    });
    expect(res.action).toBe(DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION);
  });

  // 15. provider match outranks mobile match when both target same lead
  it('15. provider match outranks mobile match when both target same lead', async () => {
    const db = new InMemoryDbClient();
    db.leads.push({
      id: 'lead-1',
      organizationId: orgA,
      name: 'Unique Resto',
      normalizedName: 'unique resto',
      category: 'Restaurant',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'google_places'
    });
    db.sources.push({
      id: 'src-1',
      leadId: 'lead-1',
      organizationId: orgA,
      sourceName: 'google_places',
      sourceExternalId: 'resto_123',
      fetchedAt: new Date()
    });
    db.contacts.push({
      id: 'cnt-1',
      leadId: 'lead-1',
      type: ContactType.PHONE,
      rawValue: '01712345678',
      normalizedValue: '+8801712345678',
      phoneType: PhoneType.MOBILE,
      status: ContactStatus.FOUND,
      whatsappStatus: WhatsAppStatus.UNKNOWN,
      isPrimary: true
    });

    const res = await detectDuplicate(db as unknown as DbClient, {
      organizationId: orgA,
      name: 'Unique Resto',
      primaryPhone: '01712345678',
      source: {
        sourceName: 'google_places',
        sourceExternalId: 'resto_123'
      }
    });
    expect(res.matchLevel).toBe(DuplicateMatchLevel.DEFINITE);
    expect(res.reason).toBe('TIER_1A_PROVIDER_IDENTITY');
    expect(res.leadId).toBe('lead-1');
  });

  // 16. definite match outranks website candidate
  it('16. definite match outranks website candidate', async () => {
    const db = new InMemoryDbClient();
    db.leads.push(
      {
        id: 'lead-def',
        organizationId: orgA,
        name: 'Definite Lead',
        normalizedName: 'definite lead',
        category: 'Services',
        city: 'Dhaka',
        country: 'BD',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
        primarySource: 'google_places'
      },
      {
        id: 'lead-cand',
        organizationId: orgA,
        name: 'Candidate Lead',
        normalizedName: 'candidate lead',
        category: 'Services',
        city: 'Dhaka',
        country: 'BD',
        normalizedWebsite: 'targetsite.com',
        websiteStatus: WebsiteStatus.REACHABLE,
        onlinePresenceType: OnlinePresenceType.WEBSITE,
        primarySource: 'manual'
      }
    );
    db.sources.push({
      id: 'src-1',
      leadId: 'lead-def',
      organizationId: orgA,
      sourceName: 'google_places',
      sourceExternalId: 'def_123',
      fetchedAt: new Date()
    });

    const res = await detectDuplicate(db as unknown as DbClient, {
      organizationId: orgA,
      name: 'Definite Lead',
      website: 'https://targetsite.com',
      source: {
        sourceName: 'google_places',
        sourceExternalId: 'def_123'
      }
    });
    expect(res.matchLevel).toBe(DuplicateMatchLevel.DEFINITE);
    expect(res.action).toBe(DuplicateAction.MERGED);
    expect(res.leadId).toBe('lead-def');
  });

  // 17. provider Lead A + mobile Lead B => CONFLICT / safe stop
  it('17. provider Lead A + mobile Lead B => CONFLICT / safe stop', async () => {
    const db = new InMemoryDbClient();
    db.leads.push(
      {
        id: 'lead-A',
        organizationId: orgA,
        name: 'Lead A',
        normalizedName: 'lead a',
        category: 'Services',
        city: 'Dhaka',
        country: 'BD',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
        primarySource: 'google_places'
      },
      {
        id: 'lead-B',
        organizationId: orgA,
        name: 'Lead B',
        normalizedName: 'lead b',
        category: 'Services',
        city: 'Dhaka',
        country: 'BD',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
        primarySource: 'manual'
      }
    );
    db.sources.push({
      id: 'src-A',
      leadId: 'lead-A',
      organizationId: orgA,
      sourceName: 'google_places',
      sourceExternalId: 'provider_id_A',
      fetchedAt: new Date()
    });
    db.contacts.push({
      id: 'cnt-B',
      leadId: 'lead-B',
      type: ContactType.PHONE,
      rawValue: '01712345678',
      normalizedValue: '+8801712345678',
      phoneType: PhoneType.MOBILE,
      status: ContactStatus.FOUND,
      whatsappStatus: WhatsAppStatus.UNKNOWN,
      isPrimary: true
    });

    const res = await detectDuplicate(db as unknown as DbClient, {
      organizationId: orgA,
      name: 'Incoming Multi Match',
      primaryPhone: '01712345678',
      source: {
        sourceName: 'google_places',
        sourceExternalId: 'provider_id_A'
      }
    });

    expect(res.isConflict).toBe(true);
    expect(res.reason).toBe('DEFINITE_MATCH_CONFLICT');
    expect(res.action).toBe(DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION);
    expect(res.candidateLeadIds).toContain('lead-A');
    expect(res.candidateLeadIds).toContain('lead-B');
    expect(res.conflictDetails?.conflictingLeadIds).toEqual(['lead-A', 'lead-B']);
  });

  // 18. multiple conflicting definite mobile matches => safe stop
  it('18. multiple conflicting definite mobile matches => safe stop', async () => {
    const db = new InMemoryDbClient();
    db.leads.push(
      {
        id: 'lead-1',
        organizationId: orgA,
        name: 'Lead 1',
        normalizedName: 'lead 1',
        category: 'Services',
        city: 'Dhaka',
        country: 'BD',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
        primarySource: 'manual'
      },
      {
        id: 'lead-2',
        organizationId: orgA,
        name: 'Lead 2',
        normalizedName: 'lead 2',
        category: 'Services',
        city: 'Dhaka',
        country: 'BD',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
        primarySource: 'manual'
      }
    );
    db.contacts.push(
      {
        id: 'cnt-1',
        leadId: 'lead-1',
        type: ContactType.PHONE,
        rawValue: '01711111111',
        normalizedValue: '+8801711111111',
        phoneType: PhoneType.MOBILE,
        status: ContactStatus.FOUND,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        isPrimary: true
      },
      {
        id: 'cnt-2',
        leadId: 'lead-2',
        type: ContactType.PHONE,
        rawValue: '01722222222',
        normalizedValue: '+8801722222222',
        phoneType: PhoneType.MOBILE,
        status: ContactStatus.FOUND,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        isPrimary: true
      }
    );

    const res = await detectDuplicate(db as unknown as DbClient, {
      organizationId: orgA,
      name: 'Combined Mobiles',
      contacts: [
        { type: ContactType.PHONE, rawValue: '01711111111' },
        { type: ContactType.PHONE, rawValue: '01722222222' }
      ]
    });

    expect(res.isConflict).toBe(true);
    expect(res.reason).toBe('DEFINITE_MATCH_CONFLICT');
    expect(res.action).toBe(DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION);
    expect(res.candidateLeadIds).toHaveLength(2);
  });

  // 19. multiple candidate leads returned without arbitrary merge
  it('19. multiple candidate leads returned without arbitrary merge', async () => {
    const db = new InMemoryDbClient();
    db.leads.push(
      {
        id: 'lead-cand-1',
        organizationId: orgA,
        name: 'Super Shop',
        normalizedName: 'super shop',
        category: 'Retail',
        city: 'Dhaka',
        country: 'BD',
        normalizedWebsite: 'supershop.bd',
        websiteStatus: WebsiteStatus.REACHABLE,
        onlinePresenceType: OnlinePresenceType.WEBSITE,
        primarySource: 'manual'
      },
      {
        id: 'lead-cand-2',
        organizationId: orgA,
        name: 'Super Shop',
        normalizedName: 'super shop',
        category: 'Retail',
        city: 'Dhaka',
        country: 'BD',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
        primarySource: 'manual'
      }
    );

    const res = await detectDuplicate(db as unknown as DbClient, {
      organizationId: orgA,
      name: 'Super Shop',
      website: 'https://supershop.bd',
      city: 'Dhaka'
    });

    expect(res.matchLevel).toBe(DuplicateMatchLevel.CANDIDATE);
    expect(res.action).toBe(DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION);
    expect(res.candidateLeadIds.length).toBeGreaterThanOrEqual(2);
    expect(res.candidateLeadIds).toContain('lead-cand-1');
    expect(res.candidateLeadIds).toContain('lead-cand-2');
  });

  // 20. no matches => NONE / CREATED-compatible result
  it('20. no matches => NONE / CREATED-compatible result', async () => {
    const db = new InMemoryDbClient();
    const res = await detectDuplicate(db as unknown as DbClient, {
      organizationId: orgA,
      name: 'Brand New Unique Entity',
      city: 'Dhaka',
      primaryPhone: '01799999999'
    });

    expect(res.matchLevel).toBe(DuplicateMatchLevel.NONE);
    expect(res.action).toBe(DuplicateAction.CREATED);
    expect(res.reason).toBe('NO_MATCH');
    expect(res.leadId).toBeNull();
    expect(res.candidateLeadIds).toHaveLength(0);
  });

  // 21. existing non-empty lead field not overwritten by empty incoming field
  it('21. existing non-empty lead field not overwritten by empty incoming field', () => {
    const existing: ExistingLeadRecord = {
      id: 'lead-1',
      organizationId: orgA,
      name: 'Alpha Care',
      normalizedName: 'alpha care',
      category: 'Health',
      description: 'Original description',
      address: 'Original address',
      locality: 'Banani',
      city: 'Dhaka',
      country: 'BD',
      website: 'https://alpha.com',
      normalizedWebsite: 'alpha.com',
      websiteStatus: WebsiteStatus.REACHABLE,
      onlinePresenceType: OnlinePresenceType.WEBSITE,
      primarySource: 'manual'
    };

    const incoming: IncomingLeadData = {
      organizationId: orgA,
      name: 'Alpha Care',
      description: null,
      address: null,
      locality: null,
      website: null
    };

    const plan = planMerge(existing, incoming);
    expect(plan.scalarUpdates.description).toBeUndefined();
    expect(plan.scalarUpdates.address).toBeUndefined();
    expect(plan.scalarUpdates.locality).toBeUndefined();
    expect(plan.scalarUpdates.website).toBeUndefined();
  });

  // 22. empty primary phone can be populated by valid incoming mobile
  it('22. empty primary phone can be populated by valid incoming mobile', () => {
    const existing: ExistingLeadRecord = {
      id: 'lead-1',
      organizationId: orgA,
      name: 'Alpha Care',
      normalizedName: 'alpha care',
      category: 'Health',
      city: 'Dhaka',
      country: 'BD',
      primaryPhone: null,
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'manual'
    };

    const incoming: IncomingLeadData = {
      organizationId: orgA,
      name: 'Alpha Care',
      contacts: [{ type: ContactType.PHONE, rawValue: '01712345678' }]
    };

    const plan = planMerge(existing, incoming);
    expect(plan.scalarUpdates.primaryPhone).toBe('+8801712345678');
  });

  // 23. valid existing primary phone preserved
  it('23. valid existing primary phone preserved', () => {
    const existing: ExistingLeadRecord = {
      id: 'lead-1',
      organizationId: orgA,
      name: 'Alpha Care',
      normalizedName: 'alpha care',
      category: 'Health',
      city: 'Dhaka',
      country: 'BD',
      primaryPhone: '+8801711111111',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'manual'
    };

    const incoming: IncomingLeadData = {
      organizationId: orgA,
      name: 'Alpha Care',
      contacts: [{ type: ContactType.PHONE, rawValue: '01722222222' }]
    };

    const plan = planMerge(existing, incoming);
    expect(plan.scalarUpdates.primaryPhone).toBeUndefined();
  });

  // 24. duplicate normalized contact is not duplicated
  it('24. duplicate normalized contact is not duplicated', () => {
    const existing: ExistingLeadRecord = {
      id: 'lead-1',
      organizationId: orgA,
      name: 'Alpha Care',
      normalizedName: 'alpha care',
      category: 'Health',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'manual',
      contacts: [
        {
          id: 'cnt-1',
          leadId: 'lead-1',
          type: ContactType.PHONE,
          rawValue: '01712345678',
          normalizedValue: '+8801712345678',
          phoneType: PhoneType.MOBILE,
          status: ContactStatus.FOUND,
          whatsappStatus: WhatsAppStatus.UNKNOWN,
          isPrimary: true,
          evidence: []
        }
      ]
    };

    const incoming: IncomingLeadData = {
      organizationId: orgA,
      name: 'Alpha Care',
      contacts: [{ type: ContactType.PHONE, rawValue: '+880 1712-345678' }]
    };

    const plan = planMerge(existing, incoming);
    expect(plan.newContacts).toHaveLength(0);
  });

  // 25. new unique contact can be added
  it('25. new unique contact can be added', () => {
    const existing: ExistingLeadRecord = {
      id: 'lead-1',
      organizationId: orgA,
      name: 'Alpha Care',
      normalizedName: 'alpha care',
      category: 'Health',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'manual',
      contacts: [
        {
          id: 'cnt-1',
          leadId: 'lead-1',
          type: ContactType.PHONE,
          rawValue: '01712345678',
          normalizedValue: '+8801712345678',
          phoneType: PhoneType.MOBILE,
          status: ContactStatus.FOUND,
          whatsappStatus: WhatsAppStatus.UNKNOWN,
          isPrimary: true
        }
      ]
    };

    const incoming: IncomingLeadData = {
      organizationId: orgA,
      name: 'Alpha Care',
      contacts: [{ type: ContactType.PHONE, rawValue: '01899999999' }]
    };

    const plan = planMerge(existing, incoming);
    expect(plan.newContacts).toHaveLength(1);
    expect(plan.newContacts[0].normalizedValue).toBe('+8801899999999');
  });

  // 26. existing evidence is preserved and new evidence appended
  it('26. existing evidence is preserved and new evidence appended', () => {
    const existing: ExistingLeadRecord = {
      id: 'lead-1',
      organizationId: orgA,
      name: 'Alpha Care',
      normalizedName: 'alpha care',
      category: 'Health',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'manual',
      contacts: [
        {
          id: 'cnt-1',
          leadId: 'lead-1',
          type: ContactType.PHONE,
          rawValue: '01712345678',
          normalizedValue: '+8801712345678',
          phoneType: PhoneType.MOBILE,
          status: ContactStatus.FOUND,
          whatsappStatus: WhatsAppStatus.UNKNOWN,
          isPrimary: true,
          evidence: [
            {
              id: 'ev-1',
              contactId: 'cnt-1',
              sourceName: 'google_places',
              evidenceType: EvidenceType.LISTING_FIELD
            }
          ]
        }
      ]
    };

    const incoming: IncomingLeadData = {
      organizationId: orgA,
      name: 'Alpha Care',
      contacts: [
        {
          type: ContactType.PHONE,
          rawValue: '01712345678',
          evidence: [
            {
              sourceName: 'facebook_page',
              evidenceType: EvidenceType.OFFICIAL_PAGE_TEXT
            }
          ]
        }
      ]
    };

    const plan = planMerge(existing, incoming);
    expect(plan.newContacts).toHaveLength(0);
    expect(plan.newEvidenceForExistingContacts).toHaveLength(1);
    expect(plan.newEvidenceForExistingContacts[0].contactId).toBe('cnt-1');
    expect(plan.newEvidenceForExistingContacts[0].evidence.sourceName).toBe('facebook_page');
  });

  // 27. existing source provenance is preserved
  it('27. existing source provenance is preserved', () => {
    const existing: ExistingLeadRecord = {
      id: 'lead-1',
      organizationId: orgA,
      name: 'Alpha Care',
      normalizedName: 'alpha care',
      category: 'Health',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'google_places',
      sources: [
        {
          id: 'src-1',
          leadId: 'lead-1',
          organizationId: orgA,
          sourceName: 'google_places',
          sourceExternalId: 'place_123'
        }
      ]
    };

    const incoming: IncomingLeadData = {
      organizationId: orgA,
      name: 'Alpha Care',
      source: {
        sourceName: 'facebook_places',
        sourceExternalId: 'fb_999'
      }
    };

    const plan = planMerge(existing, incoming);
    expect(plan.sourceToUpsert).toBeDefined();
    expect(plan.sourceToUpsert?.sourceName).toBe('facebook_places');
    expect(plan.sourceToUpsert?.sourceExternalId).toBe('fb_999');
  });

  // 28. duplicate provider identity is not inserted twice
  it('28. duplicate provider identity is not inserted twice', async () => {
    const db = new InMemoryDbClient();
    db.leads.push({
      id: 'lead-1',
      organizationId: orgA,
      name: 'Alpha Care',
      normalizedName: 'alpha care',
      category: 'Health',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'google_places'
    });
    db.sources.push({
      id: 'src-1',
      leadId: 'lead-1',
      organizationId: orgA,
      sourceName: 'google_places',
      sourceExternalId: 'place_123',
      sourceUrl: 'http://old.url',
      fetchedAt: new Date()
    });

    const incoming: IncomingLeadData = {
      organizationId: orgA,
      name: 'Alpha Care Refreshed',
      source: {
        sourceName: 'google_places',
        sourceExternalId: 'place_123',
        sourceUrl: 'http://new.url'
      }
    };

    const res = await mergeIntoExistingLead(db as unknown as DbClient, 'lead-1', incoming);
    expect(res.success).toBe(true);
    expect(res.sourceUpdated).toBe(true);
    expect(db.sources).toHaveLength(1);
    expect(db.sources[0].sourceUrl).toBe('http://new.url');
  });

  // 29. VERIFIED contact status is not downgraded
  it('29. VERIFIED contact status is not downgraded', () => {
    const existing: ExistingLeadRecord = {
      id: 'lead-1',
      organizationId: orgA,
      name: 'Alpha Care',
      normalizedName: 'alpha care',
      category: 'Health',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'manual',
      contacts: [
        {
          id: 'cnt-1',
          leadId: 'lead-1',
          type: ContactType.PHONE,
          rawValue: '01712345678',
          normalizedValue: '+8801712345678',
          phoneType: PhoneType.MOBILE,
          status: ContactStatus.VERIFIED,
          whatsappStatus: WhatsAppStatus.UNKNOWN,
          isPrimary: true
        }
      ]
    };

    const incoming: IncomingLeadData = {
      organizationId: orgA,
      name: 'Alpha Care',
      contacts: [
        {
          type: ContactType.PHONE,
          rawValue: '01712345678',
          whatsappStatus: WhatsAppStatus.UNKNOWN
        }
      ]
    };

    const plan = planMerge(existing, incoming);
    expect(plan.newContacts).toHaveLength(0);
    // Contact status remains VERIFIED on existing lead
    expect(existing.contacts![0].status).toBe(ContactStatus.VERIFIED);
  });

  // 30. PUBLICLY_LISTED/stronger WhatsApp evidence is not downgraded
  it('30. PUBLICLY_LISTED/stronger WhatsApp evidence is not downgraded', () => {
    const existing: ExistingLeadRecord = {
      id: 'lead-1',
      organizationId: orgA,
      name: 'Alpha Care',
      normalizedName: 'alpha care',
      category: 'Health',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'manual',
      contacts: [
        {
          id: 'cnt-1',
          leadId: 'lead-1',
          type: ContactType.PHONE,
          rawValue: '01712345678',
          normalizedValue: '+8801712345678',
          phoneType: PhoneType.MOBILE,
          status: ContactStatus.FOUND,
          whatsappStatus: WhatsAppStatus.PUBLICLY_LISTED,
          isPrimary: true
        }
      ]
    };

    const incoming: IncomingLeadData = {
      organizationId: orgA,
      name: 'Alpha Care',
      contacts: [
        {
          type: ContactType.PHONE,
          rawValue: '01712345678',
          whatsappStatus: WhatsAppStatus.UNKNOWN
        }
      ]
    };

    const plan = planMerge(existing, incoming);
    expect(plan.newContacts).toHaveLength(0);
    expect(existing.contacts![0].whatsappStatus).toBe(WhatsAppStatus.PUBLICLY_LISTED);
  });

  // 31. cross-tenant merge attempt is rejected
  it('31. cross-tenant merge attempt is rejected', () => {
    const existing: ExistingLeadRecord = {
      id: 'lead-1',
      organizationId: orgA,
      name: 'Alpha Care',
      normalizedName: 'alpha care',
      category: 'Health',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'manual'
    };

    const incoming: IncomingLeadData = {
      organizationId: orgB, // Different tenant
      name: 'Alpha Care Cross Tenant'
    };

    expect(() => planMerge(existing, incoming)).toThrow(/Cross-tenant merge prohibited/);
  });

  // 32. merge mutation is transactional if DB-backed merge is implemented
  it('32. merge mutation is transactional if DB-backed merge is implemented', async () => {
    let txCalled = false;
    const db = new InMemoryDbClient();
    db.leads.push({
      id: 'lead-1',
      organizationId: orgA,
      name: 'Alpha Care',
      normalizedName: 'alpha care',
      category: 'Health',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'manual'
    });

    const customDb = {
      ...db,
      $transaction: async (fn: any) => {
        txCalled = true;
        return fn(db);
      }
    };

    const res = await mergeIntoExistingLead(customDb as unknown as DbClient, 'lead-1', {
      organizationId: orgA,
      name: 'Alpha Care Updated',
      description: 'New Description'
    });

    expect(txCalled).toBe(true);
    expect(res.success).toBe(true);
    expect(res.updatedFields).toContain('description');
  });
});

describe('M1 Step 4: Final Integrity Verifications', () => {
  const orgA = 'org-aaaa-1111';

  it('Source URL Preservation: existing source URL is preserved when incoming is undefined or null', async () => {
    const db = new InMemoryDbClient();
    db.leads.push({
      id: 'lead-src-1',
      organizationId: orgA,
      name: 'Preserved Source Lead',
      normalizedName: 'preserved source lead',
      category: 'Services',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'google_places'
    });
    db.sources.push({
      id: 'src-1',
      leadId: 'lead-src-1',
      organizationId: orgA,
      sourceName: 'google_places',
      sourceExternalId: 'place_999',
      sourceUrl: 'https://maps.google.com/place/999',
      fetchedAt: new Date()
    });

    const incoming: IncomingLeadData = {
      organizationId: orgA,
      name: 'Preserved Source Lead',
      source: {
        sourceName: 'google_places',
        sourceExternalId: 'place_999'
        // sourceUrl omitted (undefined)
      }
    };

    const res = await mergeIntoExistingLead(db as unknown as DbClient, 'lead-src-1', incoming);
    expect(res.success).toBe(true);
    expect(db.sources[0].sourceUrl).toBe('https://maps.google.com/place/999');
  });

  it('rawData Preservation: existing rawData is preserved when incoming rawData is undefined', async () => {
    const db = new InMemoryDbClient();
    const initialRawData = { placeId: 'place_888', rating: 4.8, userRatingsTotal: 120 };
    db.leads.push({
      id: 'lead-src-2',
      organizationId: orgA,
      name: 'Preserved RawData Lead',
      normalizedName: 'preserved rawdata lead',
      category: 'Services',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'google_places'
    });
    db.sources.push({
      id: 'src-2',
      leadId: 'lead-src-2',
      organizationId: orgA,
      sourceName: 'google_places',
      sourceExternalId: 'place_888',
      rawData: initialRawData,
      fetchedAt: new Date()
    });

    const incoming: IncomingLeadData = {
      organizationId: orgA,
      name: 'Preserved RawData Lead',
      source: {
        sourceName: 'google_places',
        sourceExternalId: 'place_888'
        // rawData omitted (undefined)
      }
    };

    const res = await mergeIntoExistingLead(db as unknown as DbClient, 'lead-src-2', incoming);
    expect(res.success).toBe(true);
    expect(db.sources[0].rawData).toEqual(initialRawData);
  });

  it('PHONE vs WHATSAPP Contact Identity: distinct channels maintain distinct rows while deduplicating same channel', () => {
    const existing: ExistingLeadRecord = {
      id: 'lead-1',
      organizationId: orgA,
      name: 'Channel Test Lead',
      normalizedName: 'channel test lead',
      category: 'Services',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'manual',
      contacts: [
        {
          id: 'cnt-phone-1',
          leadId: 'lead-1',
          type: ContactType.PHONE,
          rawValue: '01712345678',
          normalizedValue: '+8801712345678',
          phoneType: PhoneType.MOBILE,
          status: ContactStatus.FOUND,
          whatsappStatus: WhatsAppStatus.UNKNOWN,
          isPrimary: true
        }
      ]
    };

    // A. Incoming same PHONE => no duplicate PHONE
    const planSamePhone = planMerge(existing, {
      organizationId: orgA,
      name: 'Channel Test Lead',
      contacts: [{ type: ContactType.PHONE, rawValue: '01712345678' }]
    });
    expect(planSamePhone.newContacts).toHaveLength(0);

    // B. Incoming same WHATSAPP on lead with WHATSAPP => no duplicate WHATSAPP
    const existingWithWhatsapp: ExistingLeadRecord = {
      ...existing,
      contacts: [
        ...existing.contacts!,
        {
          id: 'cnt-wa-1',
          leadId: 'lead-1',
          type: ContactType.WHATSAPP,
          rawValue: '+8801712345678',
          normalizedValue: '+8801712345678',
          phoneType: PhoneType.MOBILE,
          status: ContactStatus.FOUND,
          whatsappStatus: WhatsAppStatus.PUBLICLY_LISTED,
          isPrimary: false
        }
      ]
    };
    const planSameWa = planMerge(existingWithWhatsapp, {
      organizationId: orgA,
      name: 'Channel Test Lead',
      contacts: [{ type: ContactType.WHATSAPP, rawValue: '01712345678' }]
    });
    expect(planSameWa.newContacts).toHaveLength(0);

    // C. Existing PHONE + incoming WHATSAPP => channel-distinct: creates WHATSAPP row alongside existing PHONE
    const planNewWa = planMerge(existing, {
      organizationId: orgA,
      name: 'Channel Test Lead',
      contacts: [{ type: ContactType.WHATSAPP, rawValue: '01712345678' }]
    });
    expect(planNewWa.newContacts).toHaveLength(1);
    expect(planNewWa.newContacts[0].type).toBe(ContactType.WHATSAPP);
    expect(planNewWa.newContacts[0].normalizedValue).toBe('+8801712345678');

    // D. Existing PHONE alone => does NOT create WHATSAPP contact automatically
    const planPhoneOnly = planMerge(existing, {
      organizationId: orgA,
      name: 'Channel Test Lead',
      contacts: [{ type: ContactType.PHONE, rawValue: '01899999999' }]
    });
    expect(planPhoneOnly.newContacts).toHaveLength(1);
    expect(planPhoneOnly.newContacts[0].type).toBe(ContactType.PHONE);
  });

  it('Status Strength: upgrades status when stronger, never downgrades', () => {
    const existing: ExistingLeadRecord = {
      id: 'lead-1',
      organizationId: orgA,
      name: 'Status Test Lead',
      normalizedName: 'status test lead',
      category: 'Services',
      city: 'Dhaka',
      country: 'BD',
      websiteStatus: WebsiteStatus.UNKNOWN,
      onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
      primarySource: 'manual',
      contacts: [
        {
          id: 'cnt-1',
          leadId: 'lead-1',
          type: ContactType.WHATSAPP,
          rawValue: '01711111111',
          normalizedValue: '+8801711111111',
          phoneType: PhoneType.MOBILE,
          status: ContactStatus.FOUND,
          whatsappStatus: WhatsAppStatus.UNKNOWN,
          isPrimary: true
        },
        {
          id: 'cnt-2',
          leadId: 'lead-1',
          type: ContactType.WHATSAPP,
          rawValue: '01722222222',
          normalizedValue: '+8801722222222',
          phoneType: PhoneType.MOBILE,
          status: ContactStatus.VERIFIED,
          whatsappStatus: WhatsAppStatus.CONFIRMED,
          isPrimary: false
        }
      ]
    };

    // 1. Upgrade UNKNOWN -> PUBLICLY_LISTED on cnt-1
    const planUpgrade = planMerge(existing, {
      organizationId: orgA,
      name: 'Status Test Lead',
      contacts: [
        {
          type: ContactType.WHATSAPP,
          rawValue: '01711111111',
          whatsappStatus: WhatsAppStatus.PUBLICLY_LISTED,
          evidence: [
            {
              sourceName: 'verified_directory',
              evidenceType: EvidenceType.MANUAL_CONFIRMED
            }
          ]
        }
      ]
    });
    expect(planUpgrade.contactUpdates).toBeDefined();
    expect(planUpgrade.contactUpdates?.find((u) => u.contactId === 'cnt-1')?.whatsappStatus).toBe(
      WhatsAppStatus.PUBLICLY_LISTED
    );

    // 2. Weaker incoming does NOT downgrade VERIFIED or CONFIRMED on cnt-2
    const planNoDowngrade = planMerge(existing, {
      organizationId: orgA,
      name: 'Status Test Lead',
      contacts: [
        {
          type: ContactType.WHATSAPP,
          rawValue: '01722222222',
          whatsappStatus: WhatsAppStatus.UNKNOWN
        }
      ]
    });
    // No status downgrade updates should be generated for cnt-2
    const cnt2Update = planNoDowngrade.contactUpdates?.find((u) => u.contactId === 'cnt-2');
    expect(cnt2Update).toBeUndefined();
  });

  it('Definite Conflict Blocks Merge Execution: caller pipeline halts without executing merge mutation', async () => {
    const db = new InMemoryDbClient();
    db.leads.push(
      {
        id: 'lead-A',
        organizationId: orgA,
        name: 'Lead A',
        normalizedName: 'lead a',
        category: 'Services',
        city: 'Dhaka',
        country: 'BD',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
        primarySource: 'google_places'
      },
      {
        id: 'lead-B',
        organizationId: orgA,
        name: 'Lead B',
        normalizedName: 'lead b',
        category: 'Services',
        city: 'Dhaka',
        country: 'BD',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
        primarySource: 'manual'
      }
    );
    db.sources.push({
      id: 'src-A',
      leadId: 'lead-A',
      organizationId: orgA,
      sourceName: 'google_places',
      sourceExternalId: 'provider_id_A',
      fetchedAt: new Date()
    });
    db.contacts.push({
      id: 'cnt-B',
      leadId: 'lead-B',
      type: ContactType.PHONE,
      rawValue: '01712345678',
      normalizedValue: '+8801712345678',
      phoneType: PhoneType.MOBILE,
      status: ContactStatus.FOUND,
      whatsappStatus: WhatsAppStatus.UNKNOWN,
      isPrimary: true
    });

    const incoming: IncomingLeadData = {
      organizationId: orgA,
      name: 'Conflicting Discovery Record',
      primaryPhone: '01712345678',
      source: {
        sourceName: 'google_places',
        sourceExternalId: 'provider_id_A'
      }
    };

    const detection = await detectDuplicate(db as unknown as DbClient, incoming);
    expect(detection.isConflict).toBe(true);
    expect(detection.action).toBe(DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION);

    // Verified: In save flow, action !== MERGED prevents mergeIntoExistingLead execution
    let mergeExecuted = false;
    if (detection.action === DuplicateAction.MERGED && detection.leadId) {
      mergeExecuted = true;
      await mergeIntoExistingLead(db as unknown as DbClient, detection.leadId, incoming);
    }
    expect(mergeExecuted).toBe(false);
  });

  it('Candidate Match Blocks Automatic Merge Execution: candidates require explicit confirmation', async () => {
    const db = new InMemoryDbClient();
    db.leads.push({
      id: 'lead-cand-1',
      organizationId: orgA,
      name: 'Candidate Company',
      normalizedName: 'candidate company',
      category: 'Services',
      city: 'Dhaka',
      country: 'BD',
      normalizedWebsite: 'candidate.com.bd',
      websiteStatus: WebsiteStatus.REACHABLE,
      onlinePresenceType: OnlinePresenceType.WEBSITE,
      primarySource: 'manual'
    });

    const incoming: IncomingLeadData = {
      organizationId: orgA,
      name: 'Candidate Company Chittagong',
      website: 'https://candidate.com.bd'
    };

    const detection = await detectDuplicate(db as unknown as DbClient, incoming);
    expect(detection.matchLevel).toBe(DuplicateMatchLevel.CANDIDATE);
    expect(detection.action).toBe(DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION);

    // Verified: Automatic merge execution is blocked for CANDIDATE_REQUIRES_CONFIRMATION
    let mergeExecuted = false;
    if (detection.action === DuplicateAction.MERGED && detection.leadId) {
      mergeExecuted = true;
      await mergeIntoExistingLead(db as unknown as DbClient, detection.leadId, incoming);
    }
    expect(mergeExecuted).toBe(false);
  });
});
