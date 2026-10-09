import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma, {
  ContactType,
  PhoneType,
  ContactStatus,
  WhatsAppStatus,
  EvidenceType,
  SignalConfidence,
  BuyerType,
  OpportunityStatus,
  BuyerIntentSignalType,
  CrmStage,
  DataSourceRole,
  DataSourceStatus
} from '../index.js';
import { ensureTestDatabase } from '../test-guard.js';

describe('M8 Step 2: Database Schema Migration & Tenant Isolation Verification', () => {
  const orgAId = '00000000-0000-0000-0000-00000000008a';
  const orgBId = '00000000-0000-0000-0000-00000000008b';

  let leadAId: string;
  let leadBId: string;
  let opportunityAId: string;

  beforeAll(async () => {
    await ensureTestDatabase(prisma);

    // Clean up test orgs if leftover
    await prisma.opportunity.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } }
    }).catch(() => {});

    await prisma.dataSourceConfig.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } }
    }).catch(() => {});

    await prisma.lead.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } }
    }).catch(() => {});

    await prisma.organization.deleteMany({
      where: { id: { in: [orgAId, orgBId] } }
    }).catch(() => {});

    // Create test organizations
    await prisma.organization.create({
      data: {
        id: orgAId,
        name: 'M8 Test Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.create({
      data: {
        id: orgBId,
        name: 'M8 Test Org B',
        timezone: 'Asia/Dhaka'
      }
    });

    // Create Leads
    const leadA = await prisma.lead.create({
      data: {
        id: '10000000-0000-0000-0000-00000000008a',
        organizationId: orgAId,
        name: 'Bengal Fabrics Ltd',
        normalizedName: 'bengal fabrics ltd',
        category: 'Textiles',
        primarySource: 'MOCK_DISCOVERY'
      }
    });
    leadAId = leadA.id;

    const leadB = await prisma.lead.create({
      data: {
        id: '10000000-0000-0000-0000-00000000008b',
        organizationId: orgBId,
        name: 'Padma Yarn Traders',
        normalizedName: 'padma yarn traders',
        category: 'Textiles',
        primarySource: 'MOCK_DISCOVERY'
      }
    });
    leadBId = leadB.id;
  });

  afterAll(async () => {
    try {
      await ensureTestDatabase(prisma);
      await prisma.dataSourceConfig.deleteMany({
        where: { name: { in: ['test-global-provider', 'm8-test-global-provider', 'google-places'] } }
      }).catch(() => {});

      await prisma.organization.deleteMany({
        where: { id: { in: [orgAId, orgBId] } }
      }).catch(() => {});
    } finally {
      await prisma.$disconnect();
    }
  });

  /* -----------------------------------------------------------------
   * 1. DataSourceConfig Tenant Scoping & Uniqueness
   * ----------------------------------------------------------------- */
  describe('DataSourceConfig Tenant Scoping & Global Uniqueness', () => {
    it('1.1 creates global and tenant-specific data source configs without collision', async () => {
      // Global data source config (organizationId = null)
      const globalConfig = await prisma.dataSourceConfig.create({
        data: {
          name: 'test-global-provider',
          provider: 'test-provider',
          role: DataSourceRole.DISCOVERY,
          status: DataSourceStatus.APPROVED,
          isEnabled: true
        }
      });
      expect(globalConfig.id).toBeDefined();
      expect(globalConfig.organizationId).toBeNull();

      // Tenant-specific config for Org A with SAME name
      const tenantAConfig = await prisma.dataSourceConfig.create({
        data: {
          organizationId: orgAId,
          name: 'test-global-provider',
          provider: 'test-provider',
          role: DataSourceRole.BOTH,
          status: DataSourceStatus.APPROVED,
          isEnabled: true,
          credentialMasked: 'AIza••••••••9x2A',
          credentialLastFour: '9x2A',
          encryptedCredential: 'enc:test:payload',
          lastTestedAt: new Date()
        }
      });
      expect(tenantAConfig.id).toBeDefined();
      expect(tenantAConfig.organizationId).toBe(orgAId);

      // Tenant-specific config for Org B with SAME name
      const tenantBConfig = await prisma.dataSourceConfig.create({
        data: {
          organizationId: orgBId,
          name: 'test-global-provider',
          provider: 'test-provider',
          role: DataSourceRole.BOTH,
          status: DataSourceStatus.APPROVED,
          isEnabled: false
        }
      });
      expect(tenantBConfig.id).toBeDefined();
      expect(tenantBConfig.organizationId).toBe(orgBId);
    });

    it('1.2 GLOBAL: enforces uniqueness for system/global datasource rows (organizationId = null)', async () => {
      // First insert with organizationId = null succeeds
      const firstGlobal = await prisma.dataSourceConfig.create({
        data: {
          name: 'm8-test-global-provider',
          provider: 'test-provider',
          role: DataSourceRole.DISCOVERY,
          status: DataSourceStatus.APPROVED,
          isEnabled: true
        }
      });
      expect(firstGlobal.id).toBeDefined();
      expect(firstGlobal.organizationId).toBeNull();

      // Second insert with organizationId = null and same name must fail via partial unique index
      let globalDuplicateError: any = null;
      try {
        await prisma.dataSourceConfig.create({
          data: {
            name: 'm8-test-global-provider',
            provider: 'test-provider',
            role: DataSourceRole.DISCOVERY,
            status: DataSourceStatus.APPROVED,
            isEnabled: true
          }
        });
      } catch (err) {
        globalDuplicateError = err;
      }

      expect(globalDuplicateError).toBeDefined();
      // Prisma P2002 error or unique constraint violation
      expect(globalDuplicateError.message).toMatch(/Unique constraint|unique|P2002/i);
    });

    it('1.3 TENANT: Org A + google-places succeeds, Org B + google-places succeeds, second Org A fails', async () => {
      // Org A + "google-places" succeeds
      const orgAConfig = await prisma.dataSourceConfig.create({
        data: {
          organizationId: orgAId,
          name: 'google-places',
          provider: 'google-places',
          role: DataSourceRole.BOTH,
          status: DataSourceStatus.APPROVED,
          isEnabled: true
        }
      });
      expect(orgAConfig.id).toBeDefined();
      expect(orgAConfig.organizationId).toBe(orgAId);

      // Org B + "google-places" succeeds
      const orgBConfig = await prisma.dataSourceConfig.create({
        data: {
          organizationId: orgBId,
          name: 'google-places',
          provider: 'google-places',
          role: DataSourceRole.BOTH,
          status: DataSourceStatus.APPROVED,
          isEnabled: false
        }
      });
      expect(orgBConfig.id).toBeDefined();
      expect(orgBConfig.organizationId).toBe(orgBId);

      // Second Org A + "google-places" must fail with unique constraint error (P2002)
      let duplicateOrgAError: any = null;
      try {
        await prisma.dataSourceConfig.create({
          data: {
            organizationId: orgAId,
            name: 'google-places',
            provider: 'google-places',
            role: DataSourceRole.BOTH,
            status: DataSourceStatus.APPROVED,
            isEnabled: true
          }
        });
      } catch (err) {
        duplicateOrgAError = err;
      }

      expect(duplicateOrgAError).toBeDefined();
      expect(duplicateOrgAError.code).toBe('P2002');
    });
  });


  /* -----------------------------------------------------------------
   * 2. ContactEvidence Confidence & LeadContact lastCheckedAt
   * ----------------------------------------------------------------- */
  describe('Contact Provenance & Freshness Fields', () => {
    it('2.1 creates LeadContact with null lastCheckedAt by default, and updates correctly', async () => {
      const contact = await prisma.leadContact.create({
        data: {
          leadId: leadAId,
          type: ContactType.PHONE,
          rawValue: '+8801700000001',
          normalizedValue: '+8801700000001',
          status: ContactStatus.FOUND,
          whatsappStatus: WhatsAppStatus.UNKNOWN
        }
      });

      expect(contact.id).toBeDefined();
      expect(contact.lastCheckedAt).toBeNull();

      const checkedTime = new Date('2026-10-09T10:00:00Z');
      const updated = await prisma.leadContact.update({
        where: { id: contact.id },
        data: { lastCheckedAt: checkedTime }
      });

      expect(updated.lastCheckedAt).toEqual(checkedTime);
    });

    it('2.2 defaults ContactEvidence confidence to MEDIUM, and accepts HIGH/LOW', async () => {
      const contact = await prisma.leadContact.create({
        data: {
          leadId: leadAId,
          type: ContactType.EMAIL,
          rawValue: 'info@bengalfabrics.com',
          normalizedValue: 'info@bengalfabrics.com',
          status: ContactStatus.FOUND
        }
      });

      // Default confidence
      const evidenceDefault = await prisma.contactEvidence.create({
        data: {
          contactId: contact.id,
          sourceName: 'PUBLIC_DIRECTORY',
          evidenceType: EvidenceType.OFFICIAL_PAGE_TEXT
        }
      });
      expect(evidenceDefault.confidence).toBe(SignalConfidence.MEDIUM);

      // Explicit HIGH confidence
      const evidenceHigh = await prisma.contactEvidence.create({
        data: {
          contactId: contact.id,
          sourceName: 'WA_ME_BUTTON',
          evidenceType: EvidenceType.WA_ME_LINK,
          confidence: SignalConfidence.HIGH
        }
      });
      expect(evidenceHigh.confidence).toBe(SignalConfidence.HIGH);

      // Explicit LOW confidence
      const evidenceLow = await prisma.contactEvidence.create({
        data: {
          contactId: contact.id,
          sourceName: 'THIRD_PARTY_SNIPPET',
          evidenceType: EvidenceType.LISTING_FIELD,
          confidence: SignalConfidence.LOW
        }
      });
      expect(evidenceLow.confidence).toBe(SignalConfidence.LOW);
    });
  });

  /* -----------------------------------------------------------------
   * 3. Opportunity Model & Multi-Tenant Foreign Key Enforcement
   * ----------------------------------------------------------------- */
  describe('Opportunity Model & Tenant Isolation', () => {
    it('3.1 creates Opportunity in Org A linked to Lead A', async () => {
      const opp = await prisma.opportunity.create({
        data: {
          organizationId: orgAId,
          leadId: leadAId,
          productInterest: 'Raw Cotton Yarn 30s',
          buyerType: BuyerType.WHOLESALER,
          need: 'Requires 5 metric tons monthly for denim production',
          intentScore: 85,
          strongestSignal: 'e-GP Tender RFQ #49281',
          stage: CrmStage.QUALIFIED,
          status: OpportunityStatus.OPEN
        }
      });

      opportunityAId = opp.id;
      expect(opp.id).toBeDefined();
      expect(opp.organizationId).toBe(orgAId);
      expect(opp.leadId).toBe(leadAId);
      expect(opp.productInterest).toBe('Raw Cotton Yarn 30s');
      expect(opp.buyerType).toBe(BuyerType.WHOLESALER);
      expect(opp.stage).toBe(CrmStage.QUALIFIED);
      expect(opp.status).toBe(OpportunityStatus.OPEN);
      expect(opp.intentScore).toBe(85);
    });

    it('3.2 blocks cross-tenant Opportunity linkage via composite foreign key', async () => {
      // Attempt to link Lead A (Org A) to an Opportunity in Org B
      let crossOrgError: any = null;
      try {
        await prisma.opportunity.create({
          data: {
            organizationId: orgBId,
            leadId: leadAId, // belongs to Org A!
            productInterest: 'Illegal Cross-Org Link'
          }
        });
      } catch (err) {
        crossOrgError = err;
      }

      expect(crossOrgError).toBeDefined();
      expect(crossOrgError.code).toBe('P2003');
    });
  });

  /* -----------------------------------------------------------------
   * 4. BuyerIntentSignal Model & Tenant Isolation
   * ----------------------------------------------------------------- */
  describe('BuyerIntentSignal Model & Tenant Isolation', () => {
    it('4.1 creates BuyerIntentSignal in Org A linked to Lead A and Opportunity A', async () => {
      const signal = await prisma.buyerIntentSignal.create({
        data: {
          organizationId: orgAId,
          leadId: leadAId,
          opportunityId: opportunityAId,
          sourceName: 'e-GP Bangladesh',
          sourceUrl: 'https://eprocure.gov.bd/tender/49281',
          signalType: BuyerIntentSignalType.PUBLIC_PROCUREMENT,
          description: 'Supply of Cotton Yarn for State Textile Mills',
          confidence: SignalConfidence.HIGH,
          scoreContribution: 40
        }
      });

      expect(signal.id).toBeDefined();
      expect(signal.organizationId).toBe(orgAId);
      expect(signal.leadId).toBe(leadAId);
      expect(signal.opportunityId).toBe(opportunityAId);
      expect(signal.signalType).toBe(BuyerIntentSignalType.PUBLIC_PROCUREMENT);
      expect(signal.confidence).toBe(SignalConfidence.HIGH);
      expect(signal.scoreContribution).toBe(40);
    });

    it('4.2 blocks cross-tenant BuyerIntentSignal linkage to Opportunity via composite foreign key', async () => {
      // Attempt to link Opportunity A (Org A) to a Signal in Org B
      let crossOrgSignalError: any = null;
      try {
        await prisma.buyerIntentSignal.create({
          data: {
            organizationId: orgBId,
            opportunityId: opportunityAId, // belongs to Org A!
            sourceName: 'Illegal Cross-Org Signal',
            signalType: BuyerIntentSignalType.OTHER
          }
        });
      } catch (err) {
        crossOrgSignalError = err;
      }

      expect(crossOrgSignalError).toBeDefined();
      expect(crossOrgSignalError.code).toBe('P2003');
    });
  });

  /* -----------------------------------------------------------------
   * 5. Cascade Deletion Behavior
   * ----------------------------------------------------------------- */
  describe('Cascade Deletion Behavior', () => {
    it('5.1 deleting a Lead cascades to Opportunity and its BuyerIntentSignals', async () => {
      // Lead A currently has Opportunity A which has 1 signal
      const countBefore = await prisma.opportunity.count({
        where: { id: opportunityAId }
      });
      expect(countBefore).toBe(1);

      await prisma.lead.delete({
        where: { id: leadAId }
      });

      // Verify Opportunity is deleted by cascade
      const oppAfter = await prisma.opportunity.findUnique({
        where: { id: opportunityAId }
      });
      expect(oppAfter).toBeNull();

      // Verify Signal is deleted by cascade
      const signalAfter = await prisma.buyerIntentSignal.findFirst({
        where: { opportunityId: opportunityAId }
      });
      expect(signalAfter).toBeNull();
    });
  });
});
