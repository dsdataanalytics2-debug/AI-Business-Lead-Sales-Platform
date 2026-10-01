import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma, {
  ContactType,
  PhoneType,
  ContactStatus,
  WhatsAppStatus,
  EvidenceType,
  WebsiteStatus,
  OnlinePresenceType
} from '../index.js';

describe('M1 Step 2: Database Schema & Migration Verification', () => {
  const orgAId = '00000000-0000-0000-0000-00000000000a';
  const orgBId = '00000000-0000-0000-0000-00000000000b';

  let leadAId: string;
  let leadBId: string;

  beforeAll(async () => {
    // Ensure Org A and Org B exist
    await prisma.organization.upsert({
      where: { id: orgAId },
      update: {},
      create: {
        id: orgAId,
        name: 'Organization A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.upsert({
      where: { id: orgBId },
      update: {},
      create: {
        id: orgBId,
        name: 'Organization B',
        timezone: 'Asia/Dhaka'
      }
    });
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.lead.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } }
    }).catch(() => {});

    await prisma.organization.deleteMany({
      where: { id: { in: [orgAId, orgBId] } }
    }).catch(() => {});

    await prisma.$disconnect();
  });

  it('1. Successfully creates Lead in Org A with nested LeadContact and ContactEvidence', async () => {
    const lead = await prisma.lead.create({
      data: {
        organizationId: orgAId,
        name: 'Mirpur Dental Care',
        normalizedName: 'mirpur dental care',
        category: 'Dental Clinic',
        locality: 'Mirpur 10',
        city: 'Dhaka',
        country: 'BD',
        primaryPhone: '+8801712345678',
        websiteStatus: WebsiteStatus.NONE_DETECTED,
        onlinePresenceType: OnlinePresenceType.NONE_DETECTED,
        primarySource: 'MOCK_SEARCH',
        contacts: {
          create: [
            {
              type: ContactType.PHONE,
              rawValue: '01712345678',
              normalizedValue: '+8801712345678',
              phoneType: PhoneType.MOBILE,
              status: ContactStatus.FOUND,
              whatsappStatus: WhatsAppStatus.UNKNOWN,
              isPrimary: true,
              evidence: {
                create: [
                  {
                    sourceName: 'MOCK_SEARCH',
                    evidenceType: EvidenceType.LISTING_FIELD,
                    snippet: 'Phone: 01712345678'
                  }
                ]
              }
            }
          ]
        }
      },
      include: {
        contacts: {
          include: { evidence: true }
        }
      }
    });

    leadAId = lead.id;
    expect(lead.id).toBeDefined();
    expect(lead.organizationId).toBe(orgAId);
    expect(lead.name).toBe('Mirpur Dental Care');
    expect(lead.contacts).toHaveLength(1);
    expect(lead.contacts[0].normalizedValue).toBe('+8801712345678');
    expect(lead.contacts[0].evidence).toHaveLength(1);
    expect(lead.contacts[0].evidence[0].sourceName).toBe('MOCK_SEARCH');
  });

  it('2. Cross-org LeadSource insertion is rejected by PostgreSQL composite foreign key constraint', async () => {
    // Attempt to insert a LeadSource pointing to Lead A (Org A) but with organizationId = Org B
    // PostgreSQL composite foreign key (lead_id, organization_id) -> leads(id, organization_id) MUST reject this
    let errorCaught: any = null;

    try {
      await prisma.leadSource.create({
        data: {
          leadId: leadAId,
          organizationId: orgBId,
          sourceName: 'GOOGLE_MAPS',
          sourceExternalId: 'cross-org-ext-001',
          sourceUrl: 'https://maps.example.com/001'
        }
      });
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeDefined();
    // Prisma error code P2003 indicates foreign key constraint violation
    expect(errorCaught.code).toBe('P2003');
  });

  it('3. LeadSource with matching Lead A and Org A succeeds', async () => {
    const source = await prisma.leadSource.create({
      data: {
        leadId: leadAId,
        organizationId: orgAId,
        sourceName: 'GOOGLE_MAPS',
        sourceExternalId: 'ext-org-a-001',
        sourceUrl: 'https://maps.example.com/a001',
        rawData: { title: 'Mirpur Dental Care' }
      }
    });

    expect(source.id).toBeDefined();
    expect(source.leadId).toBe(leadAId);
    expect(source.organizationId).toBe(orgAId);
    expect(source.sourceExternalId).toBe('ext-org-a-001');
  });

  it('4. Same sourceName + sourceExternalId in the SAME organization is rejected (duplicate constraint)', async () => {
    // Attempting to create duplicate lead source with same external ID in Org A should fail
    let duplicateError: any = null;

    try {
      await prisma.leadSource.create({
        data: {
          leadId: leadAId,
          organizationId: orgAId,
          sourceName: 'GOOGLE_MAPS',
          sourceExternalId: 'ext-org-a-001'
        }
      });
    } catch (err) {
      duplicateError = err;
    }

    expect(duplicateError).toBeDefined();
    // Prisma error code P2002 indicates unique constraint violation
    expect(duplicateError.code).toBe('P2002');
  });

  it('5. Same sourceName + sourceExternalId in DIFFERENT organizations is allowed', async () => {
    // Create Lead B belonging to Org B
    const leadB = await prisma.lead.create({
      data: {
        organizationId: orgBId,
        name: 'Gulshan Electronics',
        normalizedName: 'gulshan electronics',
        category: 'Electronics',
        city: 'Dhaka',
        primarySource: 'GOOGLE_MAPS'
      }
    });
    leadBId = leadB.id;

    // Create LeadSource with identical sourceName and sourceExternalId as Org A, but for Org B
    const sourceB = await prisma.leadSource.create({
      data: {
        leadId: leadB.id,
        organizationId: orgBId,
        sourceName: 'GOOGLE_MAPS',
        sourceExternalId: 'ext-org-a-001', // Same external ID as Org A
        sourceUrl: 'https://maps.example.com/a001'
      }
    });

    expect(sourceB.id).toBeDefined();
    expect(sourceB.organizationId).toBe(orgBId);
    expect(sourceB.sourceExternalId).toBe('ext-org-a-001');
  });

  it('6. Cascade deletion of Lead cascades to LeadContact, ContactEvidence, and LeadSource', async () => {
    const leadToDelete = await prisma.lead.create({
      data: {
        organizationId: orgAId,
        name: 'Temporary Clinic',
        normalizedName: 'temporary clinic',
        category: 'Clinic',
        city: 'Dhaka',
        primarySource: 'TEST',
        contacts: {
          create: [
            {
              type: ContactType.EMAIL,
              rawValue: 'temp@example.com',
              normalizedValue: 'temp@example.com',
              status: ContactStatus.FOUND,
              isPrimary: true,
              evidence: {
                create: [
                  {
                    sourceName: 'TEST',
                    evidenceType: EvidenceType.LISTING_FIELD
                  }
                ]
              }
            }
          ]
        },
        sources: {
          create: [
            {
              sourceName: 'TEST_PROVIDER',
              sourceExternalId: 'test-del-001'
            }
          ]
        }
      },
      include: {
        contacts: { include: { evidence: true } },
        sources: true
      }
    });

    const contactId = leadToDelete.contacts[0].id;
    const evidenceId = leadToDelete.contacts[0].evidence[0].id;
    const sourceId = leadToDelete.sources[0].id;

    // Delete lead
    await prisma.lead.delete({ where: { id: leadToDelete.id } });

    // Verify children are deleted via CASCADE
    const contactCheck = await prisma.leadContact.findUnique({ where: { id: contactId } });
    const evidenceCheck = await prisma.contactEvidence.findUnique({ where: { id: evidenceId } });
    const sourceCheck = await prisma.leadSource.findUnique({ where: { id: sourceId } });

    expect(contactCheck).toBeNull();
    expect(evidenceCheck).toBeNull();
    expect(sourceCheck).toBeNull();
  });
});
