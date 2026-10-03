import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma, {
  DemoWebsiteStatus,
  DemoWebsiteProvider,
  Role,
  WebsiteStatus,
  OnlinePresenceType,
  ContactType,
  ContactStatus,
  WhatsAppStatus
} from '@leadmate/db';
import {
  demoWebsiteSummarySchema,
  DemoWebsiteErrorCode
} from '@leadmate/shared';
import {
  MockDemoWebsiteProvider,
  getDemoWebsiteProvider,
  StoreMateUnavailableError
} from '@leadmate/storemate';
import {
  DemoWebsiteService,
  buildOutboundDemoPayload,
  calculateDemoExpiresAt,
  getConfiguredTtlDays
} from '../services/demo-website.service.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { ensureTestDatabase } from '@leadmate/db/test-guard';

describe('M4 Step 3: DemoWebsiteService Domain Layer Verification', () => {
  const service = new DemoWebsiteService();

  const orgAId = '00000000-0000-0000-0000-00000000000a';
  const orgBId = '00000000-0000-0000-0000-00000000000b';

  const userA1Id = '11111111-1111-1111-1111-11111111111a';
  const userA2Id = '11111111-1111-1111-1111-11111111112a';
  const inactiveUserAId = '11111111-1111-1111-1111-11111111113a';
  const userBId = '11111111-1111-1111-1111-11111111111b';

  let leadA1Id: string;
  let leadA2Id: string;
  let leadA3Id: string;
  let leadA4Id: string;
  let leadBId: string;

  beforeAll(async () => {
    await ensureTestDatabase(prisma);

    // Setup Organizations
    await prisma.organization.upsert({
      where: { id: orgAId },
      update: {},
      create: {
        id: orgAId,
        name: 'Service Test Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.upsert({
      where: { id: orgBId },
      update: {},
      create: {
        id: orgBId,
        name: 'Service Test Org B',
        timezone: 'Asia/Dhaka'
      }
    });

    // Setup Users
    await prisma.user.upsert({
      where: { id: userA1Id },
      update: {},
      create: {
        id: userA1Id,
        organizationId: orgAId,
        email: 'sales.lead.a1@demosvc-test.ai',
        passwordHash: 'dummy',
        name: 'Sales Rep A1',
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
        email: 'sales.lead.a2@demosvc-test.ai',
        passwordHash: 'dummy',
        name: 'Sales Rep A2',
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });

    await prisma.user.upsert({
      where: { id: inactiveUserAId },
      update: {},
      create: {
        id: inactiveUserAId,
        organizationId: orgAId,
        email: 'inactive.user.a@demosvc-test.ai',
        passwordHash: 'dummy',
        name: 'Inactive User A',
        role: Role.SALES_EXECUTIVE,
        isActive: false
      }
    });

    await prisma.user.upsert({
      where: { id: userBId },
      update: {},
      create: {
        id: userBId,
        organizationId: orgBId,
        email: 'sales.lead.b@demosvc-test.ai',
        passwordHash: 'dummy',
        name: 'Sales Rep B',
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });

    // Clean prior test records
    await prisma.demoWebsite.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } }
    });

    // Setup Leads
    const leadA1 = await prisma.lead.create({
      data: {
        organizationId: orgAId,
        name: 'Green Hospital Dhaka',
        normalizedName: 'green hospital dhaka',
        category: 'Hospital & Clinic',
        description: 'Multi-specialty modern hospital providing 24/7 care.',
        address: 'Dhanmondi 32',
        locality: 'Dhanmondi',
        city: 'Dhaka',
        region: 'Dhaka Division',
        country: 'BD',
        primaryPhone: '+8801711000001',
        primaryEmail: 'info@greenhospital.com',
        primarySource: 'MANUAL',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.UNKNOWN,
        contacts: {
          create: [
            {
              type: ContactType.PHONE,
              rawValue: '+8801711000001',
              normalizedValue: '+8801711000001',
              status: ContactStatus.VERIFIED
            },
            {
              type: ContactType.WHATSAPP,
              rawValue: '+8801711000002',
              normalizedValue: '+8801711000002',
              status: ContactStatus.VERIFIED,
              whatsappStatus: WhatsAppStatus.CONFIRMED
            }
          ]
        }
      }
    });
    leadA1Id = leadA1.id;

    const leadA2 = await prisma.lead.create({
      data: {
        organizationId: orgAId,
        name: 'Phone Only Hardware Store',
        normalizedName: 'phone only hardware store',
        category: 'Hardware & Tools',
        primaryPhone: '+8801811000003',
        primarySource: 'MANUAL',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.UNKNOWN,
        contacts: {
          create: [
            {
              type: ContactType.PHONE,
              rawValue: '+8801811000003',
              normalizedValue: '+8801811000003',
              status: ContactStatus.FOUND
            }
          ]
        }
      }
    });
    leadA2Id = leadA2.id;

    const leadA3 = await prisma.lead.create({
      data: {
        organizationId: orgAId,
        name: 'Concurrent Race Motors',
        normalizedName: 'concurrent race motors',
        category: 'Automotive',
        primaryPhone: '+8801911000004',
        primarySource: 'MANUAL',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.UNKNOWN
      }
    });
    leadA3Id = leadA3.id;

    const leadA4 = await prisma.lead.create({
      data: {
        organizationId: orgAId,
        name: 'InFlight Demo Bakery',
        normalizedName: 'inflight demo bakery',
        category: 'Bakery',
        primaryPhone: '+8801911000005',
        primarySource: 'MANUAL',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.UNKNOWN
      }
    });
    leadA4Id = leadA4.id;

    const leadB = await prisma.lead.create({
      data: {
        organizationId: orgBId,
        name: 'Org B Electronics Mart',
        normalizedName: 'org b electronics mart',
        category: 'Electronics',
        primarySource: 'MANUAL',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.UNKNOWN
      }
    });
    leadBId = leadB.id;
  });

  afterAll(async () => {
    await prisma.demoWebsite.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } }
    });
    await prisma.leadContact.deleteMany({
      where: { lead: { organizationId: { in: [orgAId, orgBId] } } }
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
   * 1. TTL and Helper Functions
   * ----------------------------------------------------------------- */
  describe('1. TTL and Expiration Helpers', () => {
    it('returns default 14 days TTL when environment variable is not set', () => {
      const original = process.env.STOREMATE_DEMO_TTL_DAYS;
      delete process.env.STOREMATE_DEMO_TTL_DAYS;
      expect(getConfiguredTtlDays()).toBe(14);
      process.env.STOREMATE_DEMO_TTL_DAYS = original;
    });

    it('calculates expiresAt accurately based on ready timestamp and TTL', () => {
      const readyAt = new Date('2026-10-03T12:00:00.000Z');
      const expiresAt = calculateDemoExpiresAt(readyAt, 14);
      expect(expiresAt.toISOString()).toBe('2026-10-17T12:00:00.000Z');
    });
  });

  /* -----------------------------------------------------------------
   * 2. Outbound Payload Construction & PHONE != WHATSAPP Invariant
   * ----------------------------------------------------------------- */
  describe('2. Outbound Payload Construction & Contact Trust Invariants', () => {
    it('populates verified WhatsApp when explicit WhatsApp contact exists', async () => {
      const lead = await prisma.lead.findUniqueOrThrow({
        where: { id: leadA1Id },
        include: { contacts: true }
      });

      const payload = buildOutboundDemoPayload(lead);
      expect(payload.business.name).toBe('Green Hospital Dhaka');
      expect(payload.contact.phone).toBe('+8801711000001');
      expect(payload.social?.whatsapp).toBe('+8801711000002');
      expect(payload.metadata.isDemo).toBe(true);
      expect(payload.metadata.noindex).toBe(true);
      expect(payload.metadata.nofollow).toBe(true);
    });

    it('PHONE != WHATSAPP: does NOT populate WhatsApp when only PHONE contact exists', async () => {
      const lead = await prisma.lead.findUniqueOrThrow({
        where: { id: leadA2Id },
        include: { contacts: true }
      });

      const payload = buildOutboundDemoPayload(lead);
      expect(payload.business.name).toBe('Phone Only Hardware Store');
      expect(payload.contact.phone).toBe('+8801811000003');
      expect(payload.social?.whatsapp).toBeUndefined();
    });
  });

  /* -----------------------------------------------------------------
   * 3. Successful Demo Creation Flow (Mock Provider)
   * ----------------------------------------------------------------- */
  describe('3. Successful Demo Creation Flow (Mock Provider)', () => {
    it('creates and transitions demo website to READY with safe summary', async () => {
      const result = await service.requestDemoWebsite(
        { organizationId: orgAId, userId: userA1Id },
        leadA1Id
      );

      expect(result.id).toBeDefined();
      expect(result.leadId).toBe(leadA1Id);
      expect(result.organizationId).toBe(orgAId);
      expect(result.status).toBe(DemoWebsiteStatus.READY);
      expect(result.provider).toBe(DemoWebsiteProvider.MOCK);
      expect(result.providerSiteId).toMatch(/^mock_site_/);
      expect(result.demoUrl).toMatch(/^https:\/\/demo\.local\/sites\//);
      expect(result.readyAt).toBeInstanceOf(Date);
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(result.lastErrorCode).toBeNull();
      expect(result.lastErrorMessageSafe).toBeNull();

      // Validate result conforms strictly to shared schema
      const schemaCheck = demoWebsiteSummarySchema.safeParse(result);
      expect(schemaCheck.success).toBe(true);
    });

    it('getDemoWebsite returns the created demo summary', async () => {
      const result = await service.getDemoWebsite(
        { organizationId: orgAId, userId: userA1Id },
        leadA1Id
      );

      expect(result.leadId).toBe(leadA1Id);
      expect(result.status).toBe(DemoWebsiteStatus.READY);
      expect(result.requestedByUser?.name).toBe('Sales Rep A1');
    });
  });

  /* -----------------------------------------------------------------
   * 4. Idempotency & Concurrency Safety
   * ----------------------------------------------------------------- */
  describe('4. Idempotency & Concurrency Safety', () => {
    class CountingMockProvider extends MockDemoWebsiteProvider {
      public createCallCount = 0;
      private readonly delayMs: number;

      constructor(delayMs = 0) {
        super();
        this.delayMs = delayMs;
      }

      override async createDemo(input: any) {
        this.createCallCount++;
        if (this.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.delayMs));
        }
        return super.createDemo(input);
      }
    }

    it('returns existing READY demo on repeated request without creating duplicate records or extra provider calls', async () => {
      const initial = await service.getDemoWebsite(
        { organizationId: orgAId, userId: userA1Id },
        leadA1Id
      );

      const countingProvider = new CountingMockProvider();
      const repeated = await service.requestDemoWebsite(
        { organizationId: orgAId, userId: userA2Id },
        leadA1Id,
        undefined,
        countingProvider
      );

      expect(repeated.id).toBe(initial.id);
      expect(new Date(repeated.readyAt!).getTime()).toBe(new Date(initial.readyAt!).getTime());
      expect(repeated.providerSiteId).toBe(initial.providerSiteId);
      expect(countingProvider.createCallCount).toBe(0);

      // Verify exact DB count is 1 for this lead
      const count = await prisma.demoWebsite.count({
        where: { organizationId: orgAId, leadId: leadA1Id }
      });
      expect(count).toBe(1);
    });

    it('returns existing in-flight CREATING demo on subsequent request without invoking provider create again', async () => {
      // Setup leadA4 directly in CREATING state
      const creatingRecord = await prisma.demoWebsite.create({
        data: {
          organizationId: orgAId,
          leadId: leadA4Id,
          requestedByUserId: userA1Id,
          provider: DemoWebsiteProvider.MOCK,
          status: DemoWebsiteStatus.CREATING
        }
      });

      const countingProvider = new CountingMockProvider();
      const res = await service.requestDemoWebsite(
        { organizationId: orgAId, userId: userA2Id },
        leadA4Id,
        undefined,
        countingProvider
      );

      expect(res.id).toBe(creatingRecord.id);
      expect(res.status).toBe(DemoWebsiteStatus.CREATING);
      expect(countingProvider.createCallCount).toBe(0);

      const count = await prisma.demoWebsite.count({
        where: { organizationId: orgAId, leadId: leadA4Id }
      });
      expect(count).toBe(1);
    });

    it('handles simultaneous initial creation race safely (exactly 1 DB row, exactly 1 provider create invocation)', async () => {
      const countingProvider = new CountingMockProvider(40);

      // Launch two concurrent initial creation requests on fresh leadA3
      const [res1, res2] = await Promise.all([
        service.requestDemoWebsite(
          { organizationId: orgAId, userId: userA1Id },
          leadA3Id,
          undefined,
          countingProvider
        ),
        service.requestDemoWebsite(
          { organizationId: orgAId, userId: userA2Id },
          leadA3Id,
          undefined,
          countingProvider
        )
      ]);

      expect(res1.id).toBe(res2.id);
      expect(res1.leadId).toBe(leadA3Id);
      expect(res2.leadId).toBe(leadA3Id);

      // Provider create must have been invoked EXACTLY once across the two concurrent requests
      expect(countingProvider.createCallCount).toBe(1);

      // Exactly 1 DB row must exist for this (organizationId, leadId)
      const count = await prisma.demoWebsite.count({
        where: { organizationId: orgAId, leadId: leadA3Id }
      });
      expect(count).toBe(1);
    });
  });

  /* -----------------------------------------------------------------
   * 5. Provider Failure Handling & Controlled Retry
   * ----------------------------------------------------------------- */
  describe('5. Provider Failure Handling & Retry', () => {
    const failingProvider = new MockDemoWebsiteProvider({
      simulateFailure: true,
      failureErrorCode: DemoWebsiteErrorCode.STOREMATE_TIMEOUT,
      failureErrorMessage: 'Simulated timeout during generation'
    });

    it('records FAILED status and safe error code when provider fails', async () => {
      const failedResult = await service.requestDemoWebsite(
        { organizationId: orgAId, userId: userA1Id },
        leadA2Id,
        undefined,
        failingProvider
      );

      expect(failedResult.status).toBe(DemoWebsiteStatus.FAILED);
      expect(failedResult.demoUrl).toBeNull();
      expect(failedResult.readyAt).toBeNull();
      expect(failedResult.expiresAt).toBeNull();
      expect(failedResult.lastErrorCode).toBe(DemoWebsiteErrorCode.STOREMATE_TIMEOUT);
      expect(failedResult.lastErrorMessageSafe).toBe('Simulated timeout during generation');
    });

    it('successfully retries from FAILED state and recovers to READY', async () => {
      const recoveredResult = await service.regenerateDemoWebsite(
        { organizationId: orgAId, userId: userA1Id },
        leadA2Id
      );

      expect(recoveredResult.status).toBe(DemoWebsiteStatus.READY);
      expect(recoveredResult.demoUrl).toMatch(/^https:\/\/demo\.local\/sites\//);
      expect(recoveredResult.readyAt).toBeInstanceOf(Date);
      expect(recoveredResult.expiresAt).toBeInstanceOf(Date);
      expect(recoveredResult.lastErrorCode).toBeNull();
      expect(recoveredResult.lastErrorMessageSafe).toBeNull();
    });
  });

  /* -----------------------------------------------------------------
   * 6. Lifecycle Management: Expire & Remove
   * ----------------------------------------------------------------- */
  describe('6. Lifecycle Management: Expire & Remove', () => {
    it('transitions READY demo to EXPIRED with deterministic no-op on repeat', async () => {
      const expired = await service.expireDemoWebsite(
        { organizationId: orgAId, userId: userA1Id },
        leadA1Id
      );
      expect(expired.status).toBe(DemoWebsiteStatus.EXPIRED);

      // Repeat expire is idempotent no-op
      const repeatExpired = await service.expireDemoWebsite(
        { organizationId: orgAId, userId: userA1Id },
        leadA1Id
      );
      expect(repeatExpired.status).toBe(DemoWebsiteStatus.EXPIRED);
    });

    it('transitions EXPIRED demo to REMOVED, clears demoUrl, without hard deleting DB record', async () => {
      const removed = await service.removeDemoWebsite(
        { organizationId: orgAId, userId: userA1Id },
        leadA1Id
      );
      expect(removed.status).toBe(DemoWebsiteStatus.REMOVED);
      expect(removed.demoUrl).toBeNull();

      // Repeat remove is idempotent no-op
      const repeatRemoved = await service.removeDemoWebsite(
        { organizationId: orgAId, userId: userA1Id },
        leadA1Id
      );
      expect(repeatRemoved.status).toBe(DemoWebsiteStatus.REMOVED);

      // Verify row still exists in DB
      const dbRow = await prisma.demoWebsite.findUnique({
        where: { leadId_organizationId: { leadId: leadA1Id, organizationId: orgAId } }
      });
      expect(dbRow).not.toBeNull();
      expect(dbRow?.status).toBe(DemoWebsiteStatus.REMOVED);
    });

    it('rejects illegal transition from REMOVED to EXPIRED', async () => {
      await expect(
        service.expireDemoWebsite(
          { organizationId: orgAId, userId: userA1Id },
          leadA1Id
        )
      ).rejects.toThrow(ValidationError);
    });
  });

  /* -----------------------------------------------------------------
   * 7. Requester Validation & Security
   * ----------------------------------------------------------------- */
  describe('7. Requester Validation & Security', () => {
    it('rejects request from inactive user with ValidationError', async () => {
      await expect(
        service.requestDemoWebsite(
          { organizationId: orgAId, userId: inactiveUserAId },
          leadA1Id
        )
      ).rejects.toThrow(ValidationError);
    });

    it('rejects request when user does not exist in organization', async () => {
      await expect(
        service.requestDemoWebsite(
          { organizationId: orgAId, userId: '99999999-9999-9999-9999-999999999999' },
          leadA1Id
        )
      ).rejects.toThrow(NotFoundError);
    });
  });

  /* -----------------------------------------------------------------
   * 8. Multi-Tenant Isolation
   * ----------------------------------------------------------------- */
  describe('8. Multi-Tenant Isolation', () => {
    it('Org A user cannot request demo for Org B lead (NotFoundError)', async () => {
      await expect(
        service.requestDemoWebsite(
          { organizationId: orgAId, userId: userA1Id },
          leadBId
        )
      ).rejects.toThrow(NotFoundError);
    });

    it('Org A user cannot read Org B lead demo (NotFoundError)', async () => {
      // First create demo in Org B
      await service.requestDemoWebsite(
        { organizationId: orgBId, userId: userBId },
        leadBId
      );

      // Org A query on Org B lead
      await expect(
        service.getDemoWebsite(
          { organizationId: orgAId, userId: userA1Id },
          leadBId
        )
      ).rejects.toThrow(NotFoundError);
    });

    it('Org A user cannot expire or remove Org B lead demo (NotFoundError)', async () => {
      await expect(
        service.expireDemoWebsite(
          { organizationId: orgAId, userId: userA1Id },
          leadBId
        )
      ).rejects.toThrow(NotFoundError);

      await expect(
        service.removeDemoWebsite(
          { organizationId: orgAId, userId: userA1Id },
          leadBId
        )
      ).rejects.toThrow(NotFoundError);
    });
  });

  /* -----------------------------------------------------------------
   * 9. Blocked StoreMate Live Provider Enforcement
   * ----------------------------------------------------------------- */
  describe('9. Blocked StoreMate Live Provider Enforcement', () => {
    it('throws StoreMateUnavailableError when STOREMATE provider is invoked', () => {
      expect(() => {
        getDemoWebsiteProvider(DemoWebsiteProvider.STOREMATE as any);
      }).toThrow(StoreMateUnavailableError);
    });
  });
});
