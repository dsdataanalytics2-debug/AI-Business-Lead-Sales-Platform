import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma, {
  OutreachChannel,
  OutreachDeliveryStatus,
  SalesAssistantDraftType,
  SalesAssistantLanguage,
  SalesAssistantTone,
  SalesAssistantDraftStatus,
  Role,
  WebsiteStatus,
  OnlinePresenceType
} from '../index.js';
import { ensureTestDatabase } from '../test-guard.js';

describe('M6 Step 2: OutreachDelivery DB Persistence Layer Verification', () => {
  const orgAId = '00000000-0000-0000-0000-0000000000a6';
  const orgBId = '00000000-0000-0000-0000-0000000000b6';

  const userA1Id = '66666666-6666-6666-6666-6666666661a6';
  const userA2Id = '66666666-6666-6666-6666-6666666662a6';
  const userBId  = '66666666-6666-6666-6666-6666666663b6';

  let leadA1Id: string;
  let leadA2Id: string;
  let leadBId: string;

  let approvedDraftA1WhatsAppId: string;
  let approvedDraftA1EmailId: string;
  let approvedDraftBId: string;

  const sampleSha256Hash = 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0';
  const sampleFingerprint = 'f1e2d3c4b5a67890123456789abcdef0123456789abcdef0123456789abcdef0';

  beforeAll(async () => {
    await ensureTestDatabase(prisma);

    // Setup Org A & Org B
    await prisma.organization.upsert({
      where: { id: orgAId },
      update: {},
      create: { id: orgAId, name: 'Outreach Test Org A', timezone: 'Asia/Dhaka' }
    });
    await prisma.organization.upsert({
      where: { id: orgBId },
      update: {},
      create: { id: orgBId, name: 'Outreach Test Org B', timezone: 'Asia/Dhaka' }
    });

    // Setup Users in Org A & Org B
    await prisma.user.upsert({
      where: { id: userA1Id },
      update: {},
      create: {
        id: userA1Id,
        organizationId: orgAId,
        email: 'sales.a1@outreach-test.ai',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashA1',
        name: 'Sales A1',
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
        email: 'sales.a2@outreach-test.ai',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashA2',
        name: 'Sales A2',
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
        email: 'sales.b@outreach-test.ai',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhashB',
        name: 'Sales B',
        role: Role.SALES_EXECUTIVE,
        isActive: true
      }
    });

    // Clean any prior deliveries and drafts for test orgs
    await prisma.outreachDelivery.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
    await prisma.salesAssistantDraft.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });

    // Setup Leads in Org A & Org B
    const leadA1 = await prisma.lead.create({
      data: {
        organizationId: orgAId,
        name: 'Lead A1 Medical',
        normalizedName: 'lead a1 medical',
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
        name: 'Lead A2 Fashion',
        normalizedName: 'lead a2 fashion',
        category: 'Retail',
        primarySource: 'MANUAL',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.UNKNOWN
      }
    });
    leadA2Id = leadA2.id;

    const leadB = await prisma.lead.create({
      data: {
        organizationId: orgBId,
        name: 'Lead B Logistics',
        normalizedName: 'lead b logistics',
        category: 'Logistics',
        primarySource: 'MANUAL',
        websiteStatus: WebsiteStatus.UNKNOWN,
        onlinePresenceType: OnlinePresenceType.UNKNOWN
      }
    });
    leadBId = leadB.id;

    // Create approved drafts for test deliveries
    const draftA1WhatsApp = await prisma.salesAssistantDraft.create({
      data: {
        organizationId: orgAId,
        leadId: leadA1Id,
        createdByUserId: userA1Id,
        type: SalesAssistantDraftType.WHATSAPP,
        language: SalesAssistantLanguage.BANGLA,
        tone: SalesAssistantTone.PROFESSIONAL,
        content: 'Approved WhatsApp Message Content for Lead A1',
        status: SalesAssistantDraftStatus.APPROVED,
        approvedAt: new Date(),
        approvedByUserId: userA1Id
      }
    });
    approvedDraftA1WhatsAppId = draftA1WhatsApp.id;

    const draftA1Email = await prisma.salesAssistantDraft.create({
      data: {
        organizationId: orgAId,
        leadId: leadA1Id,
        createdByUserId: userA1Id,
        type: SalesAssistantDraftType.EMAIL,
        language: SalesAssistantLanguage.ENGLISH,
        tone: SalesAssistantTone.PERSUASIVE,
        emailSubject: 'Partnership Proposal for Lead A1',
        emailBody: 'Dear Lead A1 Team,\nHere is our business proposal.',
        status: SalesAssistantDraftStatus.APPROVED,
        approvedAt: new Date(),
        approvedByUserId: userA1Id
      }
    });
    approvedDraftA1EmailId = draftA1Email.id;

    const draftB = await prisma.salesAssistantDraft.create({
      data: {
        organizationId: orgBId,
        leadId: leadBId,
        createdByUserId: userBId,
        type: SalesAssistantDraftType.WHATSAPP,
        language: SalesAssistantLanguage.ENGLISH,
        tone: SalesAssistantTone.PROFESSIONAL,
        content: 'Approved WhatsApp Message Content for Org B',
        status: SalesAssistantDraftStatus.APPROVED,
        approvedAt: new Date(),
        approvedByUserId: userBId
      }
    });
    approvedDraftBId = draftB.id;
  });

  afterAll(async () => {
    await prisma.outreachDelivery.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
    await prisma.salesAssistantDraft.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
    await prisma.lead.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
  });

  /* ---------------------------------------------------------
   * 1. Enum Parity & Data Minimization
   * --------------------------------------------------------- */
  describe('1. Enums and Schema Structure', () => {
    it('verifies OutreachChannel enum values match shared specification', () => {
      expect(OutreachChannel.WHATSAPP).toBe('WHATSAPP');
      expect(OutreachChannel.EMAIL).toBe('EMAIL');
      expect(Object.values(OutreachChannel)).toHaveLength(2);
      expect(Object.values(OutreachChannel)).not.toContain('CALL');
      expect(Object.values(OutreachChannel)).not.toContain('SMS');
    });

    it('verifies OutreachDeliveryStatus enum values match shared specification', () => {
      expect(OutreachDeliveryStatus.REQUESTED).toBe('REQUESTED');
      expect(OutreachDeliveryStatus.QUEUED).toBe('QUEUED');
      expect(OutreachDeliveryStatus.PROCESSING).toBe('PROCESSING');
      expect(OutreachDeliveryStatus.SENT).toBe('SENT');
      expect(OutreachDeliveryStatus.DELIVERED).toBe('DELIVERED');
      expect(OutreachDeliveryStatus.FAILED).toBe('FAILED');
      expect(OutreachDeliveryStatus.CANCELLED).toBe('CANCELLED');
      expect(Object.values(OutreachDeliveryStatus)).toHaveLength(7);
      expect(Object.values(OutreachDeliveryStatus)).not.toContain('DRAFT');
      expect(Object.values(OutreachDeliveryStatus)).not.toContain('APPROVED');
      expect(Object.values(OutreachDeliveryStatus)).not.toContain('REJECTED');
      expect(Object.values(OutreachDeliveryStatus)).not.toContain('RETRY_SCHEDULED');
    });

    it('verifies schema excludes sensitive/vendor/raw columns (data minimization)', () => {
      const deliveryKeys = Object.keys(prisma.outreachDelivery.fields);
      const forbidden = [
        'rawProviderRequest',
        'rawProviderResponse',
        'authorization',
        'apiKey',
        'accessToken',
        'refreshToken',
        'secret',
        'systemPrompt',
        'reasoning',
        'chainOfThought',
        'customInstruction'
      ];
      for (const field of forbidden) {
        expect(deliveryKeys).not.toContain(field);
      }
    });

    it('matches @leadmate/shared enums exactly', async () => {
      const shared = await import('@leadmate/shared');
      expect(Object.values(OutreachChannel).sort()).toEqual(
        Object.values(shared.OutreachChannel).sort()
      );
      expect(Object.values(OutreachDeliveryStatus).sort()).toEqual(
        Object.values(shared.OutreachDeliveryStatus).sort()
      );
    });
  });

  /* ---------------------------------------------------------
   * 2. Basic CRUD, Defaults & Channel Snapshots
   * --------------------------------------------------------- */
  describe('2. Delivery Creation & Defaults', () => {
    it('creates minimal WHATSAPP delivery with default REQUESTED status and attemptCount 0', async () => {
      const delivery = await prisma.outreachDelivery.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          draftId: approvedDraftA1WhatsAppId,
          channel: OutreachChannel.WHATSAPP,
          recipientNormalized: '+8801712345678',
          snapshotContent: 'Approved WhatsApp Message Content for Lead A1',
          approvedDraftSnapshotHash: sampleSha256Hash,
          idempotencyKey: 'idemp-wa-001',
          requestFingerprint: sampleFingerprint,
          requestedByUserId: userA1Id
        }
      });

      expect(delivery.id).toBeDefined();
      expect(delivery.organizationId).toBe(orgAId);
      expect(delivery.leadId).toBe(leadA1Id);
      expect(delivery.draftId).toBe(approvedDraftA1WhatsAppId);
      expect(delivery.channel).toBe(OutreachChannel.WHATSAPP);
      expect(delivery.status).toBe(OutreachDeliveryStatus.REQUESTED);
      expect(delivery.attemptCount).toBe(0);
      expect(delivery.recipientNormalized).toBe('+8801712345678');
      expect(delivery.snapshotContent).toBe('Approved WhatsApp Message Content for Lead A1');
      expect(delivery.snapshotSubject).toBeNull();
      expect(delivery.snapshotBody).toBeNull();
      expect(delivery.approvedDraftSnapshotHash).toBe(sampleSha256Hash);
      expect(delivery.idempotencyKey).toBe('idemp-wa-001');
      expect(delivery.requestFingerprint).toBe(sampleFingerprint);
      expect(delivery.requestedByUserId).toBe(userA1Id);
      expect(delivery.providerName).toBeNull();
      expect(delivery.providerMessageId).toBeNull();
      expect(delivery.lastErrorCode).toBeNull();
      expect(delivery.safeLastErrorMessage).toBeNull();
      expect(delivery.requestedAt).toBeInstanceOf(Date);
      expect(delivery.createdAt).toBeInstanceOf(Date);
      expect(delivery.updatedAt).toBeInstanceOf(Date);
      expect(delivery.queuedAt).toBeNull();
      expect(delivery.processingAt).toBeNull();
      expect(delivery.sentAt).toBeNull();
      expect(delivery.deliveredAt).toBeNull();
      expect(delivery.failedAt).toBeNull();
      expect(delivery.cancelledAt).toBeNull();
    });

    it('creates EMAIL delivery with snapshotSubject and snapshotBody', async () => {
      const delivery = await prisma.outreachDelivery.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          draftId: approvedDraftA1EmailId,
          channel: OutreachChannel.EMAIL,
          recipientNormalized: 'contact@lead-a1-medical.com',
          snapshotSubject: 'Partnership Proposal for Lead A1',
          snapshotBody: 'Dear Lead A1 Team,\nHere is our business proposal.',
          approvedDraftSnapshotHash: sampleSha256Hash,
          idempotencyKey: 'idemp-email-001',
          requestFingerprint: sampleFingerprint,
          requestedByUserId: userA1Id
        }
      });

      expect(delivery.id).toBeDefined();
      expect(delivery.channel).toBe(OutreachChannel.EMAIL);
      expect(delivery.snapshotSubject).toBe('Partnership Proposal for Lead A1');
      expect(delivery.snapshotBody).toBe('Dear Lead A1 Team,\nHere is our business proposal.');
      expect(delivery.snapshotContent).toBeNull();
    });

    it('stores immutable snapshot content independently of draft record', async () => {
      const originalContent = 'Original Approved Snapshot Content';
      const delivery = await prisma.outreachDelivery.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          draftId: approvedDraftA1WhatsAppId,
          channel: OutreachChannel.WHATSAPP,
          recipientNormalized: '+8801700000000',
          snapshotContent: originalContent,
          approvedDraftSnapshotHash: sampleSha256Hash,
          idempotencyKey: 'idemp-snapshot-test',
          requestFingerprint: sampleFingerprint,
          requestedByUserId: userA1Id
        }
      });

      expect(delivery.snapshotContent).toBe(originalContent);
      // Verify row retains its snapshot
      const refetched = await prisma.outreachDelivery.findUnique({
        where: { id: delivery.id }
      });
      expect(refetched?.snapshotContent).toBe(originalContent);
    });
  });

  /* ---------------------------------------------------------
   * 3. Idempotency Key & Resend Semantics
   * --------------------------------------------------------- */
  describe('3. Idempotency Unique Constraints & Resend', () => {
    it('enforces @@unique([organizationId, idempotencyKey]) in same org', async () => {
      const key = 'shared-idemp-key-001';

      await prisma.outreachDelivery.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          draftId: approvedDraftA1WhatsAppId,
          channel: OutreachChannel.WHATSAPP,
          recipientNormalized: '+8801711111111',
          snapshotContent: 'Content 1',
          approvedDraftSnapshotHash: sampleSha256Hash,
          idempotencyKey: key,
          requestFingerprint: sampleFingerprint,
          requestedByUserId: userA1Id
        }
      });

      let duplicateError: unknown = null;
      try {
        await prisma.outreachDelivery.create({
          data: {
            organizationId: orgAId,
            leadId: leadA1Id,
            draftId: approvedDraftA1WhatsAppId,
            channel: OutreachChannel.WHATSAPP,
            recipientNormalized: '+8801711111111',
            snapshotContent: 'Content 2',
            approvedDraftSnapshotHash: sampleSha256Hash,
            idempotencyKey: key,
            requestFingerprint: sampleFingerprint,
            requestedByUserId: userA1Id
          }
        });
      } catch (err) {
        duplicateError = err;
      }

      expect(duplicateError).toBeTruthy();
      expect(String(duplicateError)).toMatch(/unique constraint|Unique constraint failed/i);
    });

    it('allows same idempotencyKey across different organizations', async () => {
      const crossOrgKey = 'cross-org-idemp-key-002';

      const delA = await prisma.outreachDelivery.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          draftId: approvedDraftA1WhatsAppId,
          channel: OutreachChannel.WHATSAPP,
          recipientNormalized: '+8801711111111',
          snapshotContent: 'Content Org A',
          approvedDraftSnapshotHash: sampleSha256Hash,
          idempotencyKey: crossOrgKey,
          requestFingerprint: sampleFingerprint,
          requestedByUserId: userA1Id
        }
      });

      const delB = await prisma.outreachDelivery.create({
        data: {
          organizationId: orgBId,
          leadId: leadBId,
          draftId: approvedDraftBId,
          channel: OutreachChannel.WHATSAPP,
          recipientNormalized: '+8801722222222',
          snapshotContent: 'Content Org B',
          approvedDraftSnapshotHash: sampleSha256Hash,
          idempotencyKey: crossOrgKey,
          requestFingerprint: sampleFingerprint,
          requestedByUserId: userBId
        }
      });

      expect(delA.id).toBeDefined();
      expect(delB.id).toBeDefined();
      expect(delA.idempotencyKey).toBe(crossOrgKey);
      expect(delB.idempotencyKey).toBe(crossOrgKey);
    });

    it('preserves case sensitivity for idempotencyKey (Key-AbCd123 vs key-abcd123)', async () => {
      const keyUpper = 'Key-AbCd123';
      const keyLower = 'key-abcd123';

      const del1 = await prisma.outreachDelivery.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          draftId: approvedDraftA1WhatsAppId,
          channel: OutreachChannel.WHATSAPP,
          recipientNormalized: '+8801711111111',
          snapshotContent: 'Content Case Upper',
          approvedDraftSnapshotHash: sampleSha256Hash,
          idempotencyKey: keyUpper,
          requestFingerprint: sampleFingerprint,
          requestedByUserId: userA1Id
        }
      });

      const del2 = await prisma.outreachDelivery.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          draftId: approvedDraftA1WhatsAppId,
          channel: OutreachChannel.WHATSAPP,
          recipientNormalized: '+8801711111111',
          snapshotContent: 'Content Case Lower',
          approvedDraftSnapshotHash: sampleSha256Hash,
          idempotencyKey: keyLower,
          requestFingerprint: sampleFingerprint,
          requestedByUserId: userA1Id
        }
      });

      expect(del1.idempotencyKey).toBe(keyUpper);
      expect(del2.idempotencyKey).toBe(keyLower);
      expect(del1.id).not.toBe(del2.id);
    });

    it('allows intentional resend of same draft/lead/recipient with new idempotencyKey', async () => {
      const resend1 = await prisma.outreachDelivery.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          draftId: approvedDraftA1WhatsAppId,
          channel: OutreachChannel.WHATSAPP,
          recipientNormalized: '+8801799999999',
          snapshotContent: 'Approved text',
          approvedDraftSnapshotHash: sampleSha256Hash,
          idempotencyKey: 'resend-attempt-001',
          requestFingerprint: sampleFingerprint,
          requestedByUserId: userA1Id
        }
      });

      const resend2 = await prisma.outreachDelivery.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          draftId: approvedDraftA1WhatsAppId,
          channel: OutreachChannel.WHATSAPP,
          recipientNormalized: '+8801799999999',
          snapshotContent: 'Approved text',
          approvedDraftSnapshotHash: sampleSha256Hash,
          idempotencyKey: 'resend-attempt-002',
          requestFingerprint: sampleFingerprint,
          requestedByUserId: userA1Id
        }
      });

      expect(resend1.id).toBeDefined();
      expect(resend2.id).toBeDefined();
      expect(resend1.id).not.toBe(resend2.id);
      expect(resend1.draftId).toBe(resend2.draftId);
      expect(resend1.leadId).toBe(resend2.leadId);
    });
  });

  /* ---------------------------------------------------------
   * 4. Multi-Tenant Referential Integrity Constraints
   * --------------------------------------------------------- */
  describe('4. Tenant Isolation & Composite FK Enforcement', () => {
    it('rejects cross-org lead reference (Org A delivery cannot reference Org B lead)', async () => {
      let crossOrgLeadError: unknown = null;
      try {
        await prisma.outreachDelivery.create({
          data: {
            organizationId: orgAId,
            leadId: leadBId, // Lead from Org B!
            draftId: approvedDraftA1WhatsAppId,
            channel: OutreachChannel.WHATSAPP,
            recipientNormalized: '+8801711111111',
            snapshotContent: 'Cross org lead test',
            approvedDraftSnapshotHash: sampleSha256Hash,
            idempotencyKey: 'cross-lead-test',
            requestFingerprint: sampleFingerprint,
            requestedByUserId: userA1Id
          }
        });
      } catch (err) {
        crossOrgLeadError = err;
      }

      expect(crossOrgLeadError).toBeTruthy();
      expect(String(crossOrgLeadError)).toMatch(/foreign key constraint|violates foreign key/i);
    });

    it('rejects cross-org user reference (Org A delivery cannot be requested by Org B user)', async () => {
      let crossOrgUserError: unknown = null;
      try {
        await prisma.outreachDelivery.create({
          data: {
            organizationId: orgAId,
            leadId: leadA1Id,
            draftId: approvedDraftA1WhatsAppId,
            channel: OutreachChannel.WHATSAPP,
            recipientNormalized: '+8801711111111',
            snapshotContent: 'Cross org user test',
            approvedDraftSnapshotHash: sampleSha256Hash,
            idempotencyKey: 'cross-user-test',
            requestFingerprint: sampleFingerprint,
            requestedByUserId: userBId // User from Org B!
          }
        });
      } catch (err) {
        crossOrgUserError = err;
      }

      expect(crossOrgUserError).toBeTruthy();
      expect(String(crossOrgUserError)).toMatch(/foreign key constraint|violates foreign key/i);
    });

    it('rejects cross-org draft reference (Org A delivery cannot reference Org B draft)', async () => {
      let crossOrgDraftError: unknown = null;
      try {
        await prisma.outreachDelivery.create({
          data: {
            organizationId: orgAId,
            leadId: leadA1Id,
            draftId: approvedDraftBId, // Draft from Org B!
            channel: OutreachChannel.WHATSAPP,
            recipientNormalized: '+8801711111111',
            snapshotContent: 'Cross org draft test',
            approvedDraftSnapshotHash: sampleSha256Hash,
            idempotencyKey: 'cross-draft-test',
            requestFingerprint: sampleFingerprint,
            requestedByUserId: userA1Id
          }
        });
      } catch (err) {
        crossOrgDraftError = err;
      }

      expect(crossOrgDraftError).toBeTruthy();
      expect(String(crossOrgDraftError)).toMatch(/foreign key constraint|violates foreign key/i);
    });

    it('rejects non-existent draft ID via foreign key', async () => {
      let nonExistentDraftError: unknown = null;
      try {
        await prisma.outreachDelivery.create({
          data: {
            organizationId: orgAId,
            leadId: leadA1Id,
            draftId: '00000000-0000-0000-0000-999999999999',
            channel: OutreachChannel.WHATSAPP,
            recipientNormalized: '+8801711111111',
            snapshotContent: 'Non-existent draft test',
            approvedDraftSnapshotHash: sampleSha256Hash,
            idempotencyKey: 'non-existent-draft-test',
            requestFingerprint: sampleFingerprint,
            requestedByUserId: userA1Id
          }
        });
      } catch (err) {
        nonExistentDraftError = err;
      }

      expect(nonExistentDraftError).toBeTruthy();
      expect(String(nonExistentDraftError)).toMatch(/foreign key constraint|violates foreign key/i);
    });
  });

  /* ---------------------------------------------------------
   * 5. Provider Correlation & Error Storage
   * --------------------------------------------------------- */
  describe('5. Provider Correlation, State Transitions & Error Storage', () => {
    it('allows updating providerName and providerMessageId after provider acceptance', async () => {
      const delivery = await prisma.outreachDelivery.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          draftId: approvedDraftA1WhatsAppId,
          channel: OutreachChannel.WHATSAPP,
          recipientNormalized: '+8801711111111',
          snapshotContent: 'Provider update test',
          approvedDraftSnapshotHash: sampleSha256Hash,
          idempotencyKey: 'idemp-provider-update',
          requestFingerprint: sampleFingerprint,
          requestedByUserId: userA1Id
        }
      });

      expect(delivery.providerName).toBeNull();
      expect(delivery.providerMessageId).toBeNull();

      const updated = await prisma.outreachDelivery.update({
        where: { id: delivery.id },
        data: {
          status: OutreachDeliveryStatus.SENT,
          providerName: 'MOCK_WHATSAPP',
          providerMessageId: 'wam_msg_test_123456',
          sentAt: new Date()
        }
      });

      expect(updated.status).toBe(OutreachDeliveryStatus.SENT);
      expect(updated.providerName).toBe('MOCK_WHATSAPP');
      expect(updated.providerMessageId).toBe('wam_msg_test_123456');
      expect(updated.sentAt).toBeInstanceOf(Date);
    });

    it('allows multiple rows with the same providerMessageId across non-unique index', async () => {
      const sharedMsgId = 'common_webhook_msg_id_999';

      const d1 = await prisma.outreachDelivery.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          draftId: approvedDraftA1WhatsAppId,
          channel: OutreachChannel.WHATSAPP,
          recipientNormalized: '+8801711111111',
          snapshotContent: 'Msg 1',
          approvedDraftSnapshotHash: sampleSha256Hash,
          idempotencyKey: 'idemp-msg-dup-1',
          requestFingerprint: sampleFingerprint,
          requestedByUserId: userA1Id,
          providerName: 'PROVIDER_A',
          providerMessageId: sharedMsgId
        }
      });

      const d2 = await prisma.outreachDelivery.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          draftId: approvedDraftA1WhatsAppId,
          channel: OutreachChannel.WHATSAPP,
          recipientNormalized: '+8801711111111',
          snapshotContent: 'Msg 2',
          approvedDraftSnapshotHash: sampleSha256Hash,
          idempotencyKey: 'idemp-msg-dup-2',
          requestFingerprint: sampleFingerprint,
          requestedByUserId: userA1Id,
          providerName: 'PROVIDER_B',
          providerMessageId: sharedMsgId
        }
      });

      expect(d1.providerMessageId).toBe(sharedMsgId);
      expect(d2.providerMessageId).toBe(sharedMsgId);
    });

    it('stores lastErrorCode and safeLastErrorMessage for error diagnosis', async () => {
      const delivery = await prisma.outreachDelivery.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          draftId: approvedDraftA1WhatsAppId,
          channel: OutreachChannel.WHATSAPP,
          recipientNormalized: '+8801711111111',
          snapshotContent: 'Error storage test',
          approvedDraftSnapshotHash: sampleSha256Hash,
          idempotencyKey: 'idemp-error-storage-test',
          requestFingerprint: sampleFingerprint,
          requestedByUserId: userA1Id,
          status: OutreachDeliveryStatus.FAILED,
          lastErrorCode: 'OUTREACH_PROVIDER_TIMEOUT',
          safeLastErrorMessage: 'Upstream provider connection timed out after 10000ms',
          failedAt: new Date()
        }
      });

      expect(delivery.status).toBe(OutreachDeliveryStatus.FAILED);
      expect(delivery.lastErrorCode).toBe('OUTREACH_PROVIDER_TIMEOUT');
      expect(delivery.safeLastErrorMessage).toBe('Upstream provider connection timed out after 10000ms');
      expect(delivery.failedAt).toBeInstanceOf(Date);
    });

    it('transitions through all canonical statuses without error', async () => {
      const delivery = await prisma.outreachDelivery.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          draftId: approvedDraftA1WhatsAppId,
          channel: OutreachChannel.WHATSAPP,
          recipientNormalized: '+8801711111111',
          snapshotContent: 'Lifecycle test',
          approvedDraftSnapshotHash: sampleSha256Hash,
          idempotencyKey: 'idemp-lifecycle-001',
          requestFingerprint: sampleFingerprint,
          requestedByUserId: userA1Id
        }
      });

      expect(delivery.status).toBe(OutreachDeliveryStatus.REQUESTED);

      // Transition to QUEUED
      const queued = await prisma.outreachDelivery.update({
        where: { id: delivery.id },
        data: { status: OutreachDeliveryStatus.QUEUED, queuedAt: new Date() }
      });
      expect(queued.status).toBe(OutreachDeliveryStatus.QUEUED);

      // Transition to PROCESSING
      const processing = await prisma.outreachDelivery.update({
        where: { id: delivery.id },
        data: { status: OutreachDeliveryStatus.PROCESSING, processingAt: new Date(), attemptCount: 1 }
      });
      expect(processing.status).toBe(OutreachDeliveryStatus.PROCESSING);
      expect(processing.attemptCount).toBe(1);

      // Transition to SENT
      const sent = await prisma.outreachDelivery.update({
        where: { id: delivery.id },
        data: { status: OutreachDeliveryStatus.SENT, sentAt: new Date() }
      });
      expect(sent.status).toBe(OutreachDeliveryStatus.SENT);

      // Transition to DELIVERED
      const delivered = await prisma.outreachDelivery.update({
        where: { id: delivery.id },
        data: { status: OutreachDeliveryStatus.DELIVERED, deliveredAt: new Date() }
      });
      expect(delivered.status).toBe(OutreachDeliveryStatus.DELIVERED);
    });
  });

  /* ---------------------------------------------------------
   * 6. Referential Integrity & Delete Behavior
   * --------------------------------------------------------- */
  describe('6. Referential Integrity & Delete Behavior', () => {
    it('restricts hard deletion of draft referenced by outreach delivery (onDelete: Restrict)', async () => {
      const tempDraft = await prisma.salesAssistantDraft.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          createdByUserId: userA1Id,
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL,
          content: 'Temp draft to test restrict',
          status: SalesAssistantDraftStatus.APPROVED
        }
      });

      const delivery = await prisma.outreachDelivery.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          draftId: tempDraft.id,
          channel: OutreachChannel.WHATSAPP,
          recipientNormalized: '+8801700000001',
          snapshotContent: 'Temp draft to test restrict',
          approvedDraftSnapshotHash: sampleSha256Hash,
          idempotencyKey: 'idemp-restrict-draft-test',
          requestFingerprint: sampleFingerprint,
          requestedByUserId: userA1Id
        }
      });

      let draftDeleteErr: unknown = null;
      try {
        await prisma.salesAssistantDraft.delete({ where: { id: tempDraft.id } });
      } catch (err) {
        draftDeleteErr = err;
      }

      expect(draftDeleteErr).toBeTruthy();
      expect(String(draftDeleteErr)).toMatch(/violates RESTRICT setting|foreign key constraint/i);

      // Cleanup delivery so test doesn't leak
      await prisma.outreachDelivery.delete({ where: { id: delivery.id } });
      await prisma.salesAssistantDraft.delete({ where: { id: tempDraft.id } });
    });

    it('restricts hard deletion of requestedBy user referenced by outreach delivery (onDelete: Restrict)', async () => {
      const tempUser = await prisma.user.create({
        data: {
          organizationId: orgAId,
          email: 'temp.outreach.user@test.ai',
          passwordHash: 'dummy',
          name: 'Temp Outreach User',
          role: Role.SALES_EXECUTIVE
        }
      });

      const delivery = await prisma.outreachDelivery.create({
        data: {
          organizationId: orgAId,
          leadId: leadA1Id,
          draftId: approvedDraftA1WhatsAppId,
          channel: OutreachChannel.WHATSAPP,
          recipientNormalized: '+8801700000002',
          snapshotContent: 'Temp user restrict test',
          approvedDraftSnapshotHash: sampleSha256Hash,
          idempotencyKey: 'idemp-restrict-user-test',
          requestFingerprint: sampleFingerprint,
          requestedByUserId: tempUser.id
        }
      });

      let userDeleteErr: unknown = null;
      try {
        await prisma.user.delete({ where: { id: tempUser.id } });
      } catch (err) {
        userDeleteErr = err;
      }

      expect(userDeleteErr).toBeTruthy();
      expect(String(userDeleteErr)).toMatch(/violates RESTRICT setting|foreign key constraint/i);

      // Cleanup
      await prisma.outreachDelivery.delete({ where: { id: delivery.id } });
      await prisma.user.delete({ where: { id: tempUser.id } });
    });

    it('cascades all deliveries when parent Lead is hard deleted', async () => {
      const tempLead = await prisma.lead.create({
        data: {
          organizationId: orgAId,
          name: 'Temp Lead For Cascade',
          normalizedName: 'temp lead for cascade',
          category: 'Retail',
          primarySource: 'MANUAL',
          websiteStatus: WebsiteStatus.UNKNOWN,
          onlinePresenceType: OnlinePresenceType.UNKNOWN
        }
      });

      const tempDraft = await prisma.salesAssistantDraft.create({
        data: {
          organizationId: orgAId,
          leadId: tempLead.id,
          createdByUserId: userA1Id,
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL,
          content: 'Temp draft for cascade',
          status: SalesAssistantDraftStatus.APPROVED
        }
      });

      const delivery = await prisma.outreachDelivery.create({
        data: {
          organizationId: orgAId,
          leadId: tempLead.id,
          draftId: tempDraft.id,
          channel: OutreachChannel.WHATSAPP,
          recipientNormalized: '+8801700000003',
          snapshotContent: 'Temp draft for cascade',
          approvedDraftSnapshotHash: sampleSha256Hash,
          idempotencyKey: 'idemp-cascade-lead-test',
          requestFingerprint: sampleFingerprint,
          requestedByUserId: userA1Id
        }
      });

      // Hard delete parent lead
      await prisma.lead.delete({ where: { id: tempLead.id } });

      // Delivery should have cascaded
      const foundDelivery = await prisma.outreachDelivery.findUnique({
        where: { id: delivery.id }
      });
      expect(foundDelivery).toBeNull();
    });

    it('cascades all deliveries when parent Organization is hard deleted', async () => {
      const isoOrgId = '00000000-0000-0000-0000-0000000000c6';
      const isoUserId = '66666666-6666-6666-6666-6666666664c6';

      await prisma.organization.create({
        data: { id: isoOrgId, name: 'Isolated Org M6 S2', timezone: 'Asia/Dhaka' }
      });
      await prisma.user.create({
        data: {
          id: isoUserId,
          organizationId: isoOrgId,
          email: 'isolated.m6s2@test.ai',
          passwordHash: 'dummy',
          name: 'Isolated User',
          role: Role.SALES_EXECUTIVE
        }
      });
      const isoLead = await prisma.lead.create({
        data: {
          organizationId: isoOrgId,
          name: 'Isolated Lead M6 S2',
          normalizedName: 'isolated lead m6 s2',
          category: 'Retail',
          primarySource: 'MANUAL',
          websiteStatus: WebsiteStatus.UNKNOWN,
          onlinePresenceType: OnlinePresenceType.UNKNOWN
        }
      });
      const isoDraft = await prisma.salesAssistantDraft.create({
        data: {
          organizationId: isoOrgId,
          leadId: isoLead.id,
          createdByUserId: isoUserId,
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL,
          content: 'Isolated draft content',
          status: SalesAssistantDraftStatus.APPROVED
        }
      });
      const isoDelivery = await prisma.outreachDelivery.create({
        data: {
          organizationId: isoOrgId,
          leadId: isoLead.id,
          draftId: isoDraft.id,
          channel: OutreachChannel.WHATSAPP,
          recipientNormalized: '+8801700000004',
          snapshotContent: 'Isolated draft content',
          approvedDraftSnapshotHash: sampleSha256Hash,
          idempotencyKey: 'idemp-iso-org-cascade',
          requestFingerprint: sampleFingerprint,
          requestedByUserId: isoUserId
        }
      });

      // Hard delete isolated org
      await prisma.organization.delete({ where: { id: isoOrgId } });

      const found = await prisma.outreachDelivery.findUnique({
        where: { id: isoDelivery.id }
      });
      expect(found).toBeNull();
    });
  });
});
