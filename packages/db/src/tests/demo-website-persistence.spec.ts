import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma, {
  DemoWebsiteStatus,
  DemoWebsiteProvider,
  Role,
  WebsiteStatus,
  OnlinePresenceType
} from '../index.js';
import { ensureTestDatabase } from '../test-guard.js';

describe('M4 Step 2: DemoWebsite DB Persistence Layer Verification', () => {
  const orgAId = '00000000-0000-0000-0000-00000000000a';
  const orgBId = '00000000-0000-0000-0000-00000000000b';

  const userA1Id = '11111111-1111-1111-1111-11111111111a';
  const userA2Id = '11111111-1111-1111-1111-11111111112a';
  const userBId = '11111111-1111-1111-1111-11111111111b';

  let leadA1Id: string;
  let leadA2Id: string;
  let leadBId: string;

  beforeAll(async () => {
    await ensureTestDatabase(prisma);

    // Setup Org A & Org B
    await prisma.organization.upsert({
      where: { id: orgAId },
      update: {},
      create: {
        id: orgAId,
        name: 'DemoWebsite Test Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.upsert({
      where: { id: orgBId },
      update: {},
      create: {
        id: orgBId,
        name: 'DemoWebsite Test Org B',
        timezone: 'Asia/Dhaka'
      }
    });

    // Setup Users in Org A & Org B
    await prisma.user.upsert({
      where: { id: userA1Id },
      update: {},
      create: {
        id: userA1Id,
        organizationId: orgAId,
        email: 'sales.exec.a1@demowebsite-test.ai',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash1',
        name: 'Sales Exec A1',
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });

    await prisma.user.upsert({
      where: { id: userA2Id },
      update: {},
      create: {
        id: userA2Id,
        organizationId: orgAId,
        email: 'sales.exec.a2@demowebsite-test.ai',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash2',
        name: 'Sales Exec A2',
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });

    await prisma.user.upsert({
      where: { id: userBId },
      update: {},
      create: {
        id: userBId,
        organizationId: orgBId,
        email: 'sales.exec.b@demowebsite-test.ai',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashb',
        name: 'Sales Exec B',
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });

    // Clean any prior demo websites
    await prisma.demoWebsite.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } }
    });

    // Create Leads
    const leadA1 = await prisma.lead.create({
      data: {
        organizationId: orgAId,
        name: 'Lead A1 Medical Clinic',
        normalizedName: 'lead a1 medical clinic',
        category: 'Healthcare',
        primarySource: 'MANUAL',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.UNKNOWN
      }
    });
    leadA1Id = leadA1.id;

    const leadA2 = await prisma.lead.create({
      data: {
        organizationId: orgAId,
        name: 'Lead A2 Dental Care',
        normalizedName: 'lead a2 dental care',
        category: 'Healthcare',
        primarySource: 'MANUAL',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.UNKNOWN
      }
    });
    leadA2Id = leadA2.id;

    const leadB = await prisma.lead.create({
      data: {
        organizationId: orgBId,
        name: 'Lead B Org Hospital',
        normalizedName: 'lead b org hospital',
        category: 'Healthcare',
        primarySource: 'MANUAL',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.UNKNOWN
      }
    });
    leadBId = leadB.id;
  });

  afterAll(async () => {
    // Teardown created test data
    await prisma.demoWebsite.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } }
    });
    await prisma.lead.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } }
    });
    await prisma.user.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } }
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgAId, orgBId] } }
    });
  });

  /* -----------------------------------------------------------------
   * 1. Schema & Enums Verification
   * ----------------------------------------------------------------- */
  describe('1. Enums and Schema Structure', () => {
    it('verifies DemoWebsiteStatus enum values match shared specification', () => {
      expect(DemoWebsiteStatus.REQUESTED).toBe('REQUESTED');
      expect(DemoWebsiteStatus.CREATING).toBe('CREATING');
      expect(DemoWebsiteStatus.READY).toBe('READY');
      expect(DemoWebsiteStatus.FAILED).toBe('FAILED');
      expect(DemoWebsiteStatus.EXPIRED).toBe('EXPIRED');
      expect(DemoWebsiteStatus.REMOVED).toBe('REMOVED');
      expect(Object.values(DemoWebsiteStatus)).toHaveLength(6);
    });

    it('verifies DemoWebsiteProvider enum values', () => {
      expect(DemoWebsiteProvider.STOREMATE).toBe('STOREMATE');
      expect(DemoWebsiteProvider.MOCK).toBe('MOCK');
      expect(Object.values(DemoWebsiteProvider)).toHaveLength(2);
    });
  });

  /* -----------------------------------------------------------------
   * 2. Basic CRUD & Defaults
   * ----------------------------------------------------------------- */
  describe('2. Basic CRUD & Defaults', () => {
    it('creates demo website with default status REQUESTED and default provider MOCK', async () => {
      const demo = await prisma.demoWebsite.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          requestedByUserId: userA1Id
        }
      });

      expect(demo.id).toBeDefined();
      expect(demo.organizationId).toBe(orgAId);
      expect(demo.leadId).toBe(leadA1Id);
      expect(demo.requestedByUserId).toBe(userA1Id);
      expect(demo.status).toBe(DemoWebsiteStatus.REQUESTED);
      expect(demo.provider).toBe(DemoWebsiteProvider.MOCK);
      expect(demo.providerSiteId).toBeNull();
      expect(demo.demoUrl).toBeNull();
      expect(demo.readyAt).toBeNull();
      expect(demo.expiresAt).toBeNull();
      expect(demo.lastErrorCode).toBeNull();
      expect(demo.lastErrorMessageSafe).toBeNull();
      expect(demo.createdAt).toBeInstanceOf(Date);
      expect(demo.updatedAt).toBeInstanceOf(Date);
    });

    it('updates demo website with ready status, url, providerSiteId, and expiry', async () => {
      const readyDate = new Date();
      const expiryDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

      const updated = await prisma.demoWebsite.update({
        where: {
          leadId_organizationId: {
            leadId: leadA1Id,
            organizationId: orgAId
          }
        },
        data: {
          status: DemoWebsiteStatus.READY,
          provider: DemoWebsiteProvider.STOREMATE,
          providerSiteId: 'sm_site_12345',
          demoUrl: 'https://demo-clinic.storemate.cloud',
          readyAt: readyDate,
          expiresAt: expiryDate
        }
      });

      expect(updated.status).toBe(DemoWebsiteStatus.READY);
      expect(updated.provider).toBe(DemoWebsiteProvider.STOREMATE);
      expect(updated.providerSiteId).toBe('sm_site_12345');
      expect(updated.demoUrl).toBe('https://demo-clinic.storemate.cloud');
      expect(updated.readyAt?.getTime()).toBe(readyDate.getTime());
      expect(updated.expiresAt?.getTime()).toBe(expiryDate.getTime());
    });

    it('records safe error state on failed demo website', async () => {
      const updated = await prisma.demoWebsite.update({
        where: {
          leadId_organizationId: {
            leadId: leadA1Id,
            organizationId: orgAId
          }
        },
        data: {
          status: DemoWebsiteStatus.FAILED,
          demoUrl: null,
          lastErrorCode: 'STOREMATE_TIMEOUT',
          lastErrorMessageSafe: 'StoreMate site generation timed out after 30 seconds'
        }
      });

      expect(updated.status).toBe(DemoWebsiteStatus.FAILED);
      expect(updated.demoUrl).toBeNull();
      expect(updated.lastErrorCode).toBe('STOREMATE_TIMEOUT');
      expect(updated.lastErrorMessageSafe).toBe('StoreMate site generation timed out after 30 seconds');
    });
  });

  /* -----------------------------------------------------------------
   * 3. One Demo per Lead Uniqueness Constraint
   * ----------------------------------------------------------------- */
  describe('3. One Demo per Lead Uniqueness Constraint', () => {
    it('rejects creating a second demo website for the same (leadId, organizationId)', async () => {
      let duplicateError: unknown = null;
      try {
        await prisma.demoWebsite.create({
          data: {
            organizationId: orgAId,
            leadId: leadA1Id,
            requestedByUserId: userA2Id
          }
        });
      } catch (err) {
        duplicateError = err;
      }

      expect(duplicateError).toBeTruthy();
      expect(String(duplicateError)).toMatch(/Unique constraint failed on the fields: \(`lead_id`,`organization_id`\)|unique constraint/i);
    });

    it('allows a separate lead in the same organization to have its own demo website', async () => {
      const demo2 = await prisma.demoWebsite.create({
        data: {
          organizationId: orgAId,
          leadId: leadA2Id,
          requestedByUserId: userA2Id,
          status: DemoWebsiteStatus.CREATING
        }
      });

      expect(demo2.id).toBeDefined();
      expect(demo2.leadId).toBe(leadA2Id);
      expect(demo2.status).toBe(DemoWebsiteStatus.CREATING);
    });
  });

  /* -----------------------------------------------------------------
   * 4. Tenant-Safe Composite Foreign Keys
   * ----------------------------------------------------------------- */
  describe('4. Tenant-Safe Composite Foreign Keys', () => {
    it('rejects cross-org lead reference (Demo in Org A cannot reference Lead B in Org B)', async () => {
      let crossOrgLeadError: unknown = null;
      try {
        await prisma.demoWebsite.create({
          data: {
            organizationId: orgAId,
            leadId: leadBId, // Lead B belongs to Org B
            requestedByUserId: userA1Id
          }
        });
      } catch (err) {
        crossOrgLeadError = err;
      }

      expect(crossOrgLeadError).toBeTruthy();
      expect(String(crossOrgLeadError)).toMatch(/foreign key constraint/i);
    });

    it('rejects cross-org requestedByUser reference (Demo in Org A cannot be requested by User B in Org B)', async () => {
      const tempLead = await prisma.lead.create({
        data: {
          organizationId: orgAId,
          name: 'Temp Org A Lead',
          normalizedName: 'temp org a lead',
          category: 'Retail',
          primarySource: 'MANUAL',
          websiteStatus: WebsiteStatus.UNKNOWN,
          onlinePresenceType: OnlinePresenceType.UNKNOWN
        }
      });

      let crossOrgUserError: unknown = null;
      try {
        await prisma.demoWebsite.create({
          data: {
            organizationId: orgAId,
            leadId: tempLead.id,
            requestedByUserId: userBId // User B belongs to Org B
          }
        });
      } catch (err) {
        crossOrgUserError = err;
      }

      expect(crossOrgUserError).toBeTruthy();
      expect(String(crossOrgUserError)).toMatch(/foreign key constraint/i);

      await prisma.lead.delete({ where: { id: tempLead.id } });
    });
  });

  /* -----------------------------------------------------------------
   * 5. Referential Integrity & Cascade Actions
   * ----------------------------------------------------------------- */
  describe('5. Referential Integrity Actions', () => {
    it('cascades deletion of DemoWebsite when parent Lead is hard deleted (onDelete: Cascade)', async () => {
      const tempLead = await prisma.lead.create({
        data: {
          organizationId: orgAId,
          name: 'Lead To Delete',
          normalizedName: 'lead to delete',
          category: 'Retail',
          primarySource: 'MANUAL',
          websiteStatus: WebsiteStatus.UNKNOWN,
          onlinePresenceType: OnlinePresenceType.UNKNOWN
        }
      });

      const demo = await prisma.demoWebsite.create({
        data: {
          organizationId: orgAId,
          leadId: tempLead.id,
          requestedByUserId: userA1Id,
          status: DemoWebsiteStatus.READY,
          demoUrl: 'https://temp-demo.storemate.cloud'
        }
      });

      // Delete parent lead
      await prisma.lead.delete({
        where: { id: tempLead.id }
      });

      // Confirm demo website was cascaded
      const foundDemo = await prisma.demoWebsite.findUnique({
        where: { id: demo.id }
      });
      expect(foundDemo).toBeNull();
    });

    it('restricts hard deletion of user referenced in DemoWebsite (onDelete: Restrict)', async () => {
      const tempUser = await prisma.user.create({
        data: {
          organizationId: orgAId,
          email: 'temp.user.delete.demo@demowebsite-test.ai',
          passwordHash: 'dummy',
          name: 'Temp User Demo',
          role: Role.SALES_EXECUTIVE
        }
      });

      const tempLead = await prisma.lead.create({
        data: {
          organizationId: orgAId,
          name: 'Temp Lead For User Restrict',
          normalizedName: 'temp lead for user restrict',
          category: 'Retail',
          primarySource: 'MANUAL',
          websiteStatus: WebsiteStatus.UNKNOWN,
          onlinePresenceType: OnlinePresenceType.UNKNOWN
        }
      });

      await prisma.demoWebsite.create({
        data: {
          organizationId: orgAId,
          leadId: tempLead.id,
          requestedByUserId: tempUser.id
        }
      });

      let deleteUserError: unknown = null;
      try {
        await prisma.user.delete({
          where: { id: tempUser.id }
        });
      } catch (err) {
        deleteUserError = err;
      }

      expect(deleteUserError).toBeTruthy();
      expect(String(deleteUserError)).toMatch(/violates RESTRICT setting|foreign key constraint/i);

      // Clean up temp lead (which cascades demo) and then temp user
      await prisma.lead.delete({ where: { id: tempLead.id } });
      await prisma.user.delete({ where: { id: tempUser.id } });
    });

    it('allows user soft-deactivation (isActive = false) while preserving DemoWebsite relation', async () => {
      // Soft-deactivate userA2
      const updatedUser = await prisma.user.update({
        where: { id: userA2Id },
        data: { isActive: false }
      });
      expect(updatedUser.isActive).toBe(false);

      // Verify DemoWebsite for leadA2 (requested by userA2) remains completely accessible
      const demo = await prisma.demoWebsite.findUnique({
        where: {
          leadId_organizationId: {
            leadId: leadA2Id,
            organizationId: orgAId
          }
        },
        include: {
          requestedByUser: true
        }
      });

      expect(demo).not.toBeNull();
      expect(demo?.requestedByUser.id).toBe(userA2Id);
      expect(demo?.requestedByUser.isActive).toBe(false);

      // Reactivate userA2 for future tests
      await prisma.user.update({
        where: { id: userA2Id },
        data: { isActive: true }
      });
    });

    it('cascades deletion of DemoWebsite when parent Organization is deleted (onDelete: Cascade)', async () => {
      const isolatedOrgId = '00000000-0000-0000-0000-00000000000c';
      const isolatedUserId = '11111111-1111-1111-1111-11111111111c';

      await prisma.organization.create({
        data: {
          id: isolatedOrgId,
          name: 'Isolated Cascade Org',
          timezone: 'Asia/Dhaka'
        }
      });

      await prisma.user.create({
        data: {
          id: isolatedUserId,
          organizationId: isolatedOrgId,
          email: 'isolated.user@demowebsite-test.ai',
          passwordHash: 'dummy',
          name: 'Isolated User',
          role: Role.SALES_EXECUTIVE
        }
      });

      const isolatedLead = await prisma.lead.create({
        data: {
          organizationId: isolatedOrgId,
          name: 'Isolated Lead',
          normalizedName: 'isolated lead',
          category: 'Retail',
          primarySource: 'MANUAL',
          websiteStatus: WebsiteStatus.UNKNOWN,
          onlinePresenceType: OnlinePresenceType.UNKNOWN
        }
      });

      const isolatedDemo = await prisma.demoWebsite.create({
        data: {
          organizationId: isolatedOrgId,
          leadId: isolatedLead.id,
          requestedByUserId: isolatedUserId
        }
      });

      // Hard delete isolated organization
      await prisma.organization.delete({
        where: { id: isolatedOrgId }
      });

      // Confirm demo website was cascaded
      const foundDemo = await prisma.demoWebsite.findUnique({
        where: { id: isolatedDemo.id }
      });
      expect(foundDemo).toBeNull();
    });
  });
});
