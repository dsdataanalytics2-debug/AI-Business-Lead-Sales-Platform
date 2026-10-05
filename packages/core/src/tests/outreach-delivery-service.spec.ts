import { describe, it, expect, beforeEach } from 'vitest';
import {
  Role,
  ContactType,
  ContactStatus,
  WhatsAppStatus,
  SuppressionType,
  SuppressionReason,
  ChannelScope,
  SalesAssistantDraftStatus,
  SalesAssistantDraftType,
  OutreachChannel,
  OutreachDeliveryStatus,
  OutreachErrorCode
} from '@leadmate/shared';
import {
  computeApprovedDraftSnapshotHash,
  computeRequestFingerprint,
  InMemoryOutreachDeliveryQueue,
  OutreachDeliveryService,
  OutreachServiceError,
  type RequestOutreachDeliveryInput
} from '../index.js';

interface InMemoryDbState {
  leads: any[];
  drafts: any[];
  suppressions: any[];
  deliveries: any[];
}

function createMockPrismaClient(state: InMemoryDbState) {
  return {
    lead: {
      findUnique: async ({ where }: { where: { id_organizationId: { id: string; organizationId: string } } }) => {
        const found = state.leads.find(
          (l) => l.id === where.id_organizationId.id && l.organizationId === where.id_organizationId.organizationId
        );
        return found ? JSON.parse(JSON.stringify(found)) : null;
      }
    },
    salesAssistantDraft: {
      findUnique: async ({ where }: { where: { id_organizationId: { id: string; organizationId: string } } }) => {
        const found = state.drafts.find(
          (d) => d.id === where.id_organizationId.id && d.organizationId === where.id_organizationId.organizationId
        );
        return found ? JSON.parse(JSON.stringify(found)) : null;
      }
    },
    suppressionList: {
      findFirst: async ({ where }: { where: any }) => {
        const matches = state.suppressions.filter((s) => {
          if (s.organizationId !== where.organizationId) return false;

          // Normalized value match
          if (where.normalizedValue?.in) {
            if (!where.normalizedValue.in.includes(s.normalizedValue)) return false;
          } else if (where.normalizedValue && s.normalizedValue !== where.normalizedValue) {
            return false;
          }

          // Type match
          if (where.type?.in) {
            if (!where.type.in.includes(s.type)) return false;
          }

          // Channel scope match
          if (where.channelScope?.in) {
            if (!where.channelScope.in.includes(s.channelScope)) return false;
          }

          // Expiration match
          if (where.OR && s.expiresAt) {
            const now = where.OR[1]?.expiresAt?.gt;
            if (now && new Date(s.expiresAt) <= new Date(now)) {
              return false; // Expired
            }
          }

          return true;
        });

        return matches.length > 0 ? JSON.parse(JSON.stringify(matches[0])) : null;
      }
    },
    outreachDelivery: {
      findUnique: async ({ where }: { where: any }) => {
        if (where.organizationId_idempotencyKey) {
          const found = state.deliveries.find(
            (d) =>
              d.organizationId === where.organizationId_idempotencyKey.organizationId &&
              d.idempotencyKey === where.organizationId_idempotencyKey.idempotencyKey
          );
          return found ? JSON.parse(JSON.stringify(found)) : null;
        }
        if (where.id) {
          const found = state.deliveries.find((d) => d.id === where.id);
          return found ? JSON.parse(JSON.stringify(found)) : null;
        }
        return null;
      },
      create: async ({ data }: { data: any }) => {
        // Enforce unique constraint [organizationId, idempotencyKey]
        const existing = state.deliveries.find(
          (d) => d.organizationId === data.organizationId && d.idempotencyKey === data.idempotencyKey
        );
        if (existing) {
          const error: any = new Error('Unique constraint failed on the fields: (`organization_id`,`idempotency_key`)');
          error.code = 'P2002';
          throw error;
        }

        const newRecord = {
          id: `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          queuedAt: null,
          processingAt: null,
          sentAt: null,
          deliveredAt: null,
          failedAt: null,
          cancelledAt: null,
          lastErrorCode: null,
          safeLastErrorMessage: null,
          ...data
        };
        state.deliveries.push(newRecord);
        return JSON.parse(JSON.stringify(newRecord));
      },
      update: async ({ where, data }: { where: { id: string }; data: any }) => {
        const idx = state.deliveries.findIndex((d) => d.id === where.id);
        if (idx === -1) throw new Error(`OutreachDelivery not found: ${where.id}`);
        state.deliveries[idx] = {
          ...state.deliveries[idx],
          ...data,
          updatedAt: new Date()
        };
        return JSON.parse(JSON.stringify(state.deliveries[idx]));
      },
      updateMany: async ({ where, data }: { where: any; data: any }) => {
        let count = 0;
        state.deliveries.forEach((d, idx) => {
          let match = true;
          if (where.id && d.id !== where.id) match = false;
          if (where.organizationId && d.organizationId !== where.organizationId) match = false;
          if (where.status && d.status !== where.status) match = false;
          if (match) {
            state.deliveries[idx] = {
              ...state.deliveries[idx],
              ...data,
              updatedAt: new Date()
            };
            count++;
          }
        });
        return { count };
      }
    }
  } as any;
}

describe('M6 Step 4: Outreach Delivery Service & Idempotent Enqueue', () => {
  const fixedClockDate = new Date('2026-10-05T12:00:00.000Z');
  const fixedClock = () => fixedClockDate;

  let dbState: InMemoryDbState;
  let mockPrisma: any;
  let queue: InMemoryOutreachDeliveryQueue;
  let service: OutreachDeliveryService;

  const validOrgId = '00000000-0000-0000-0000-000000000001';
  const validAdminId = 'user-admin-001';
  const validExecId = 'user-exec-001';
  const validLeadId = 'lead-test-001';
  const validDraftId = 'draft-test-001';
  const validWaContactId = 'contact-wa-001';
  const validEmailContactId = 'contact-email-001';

  beforeEach(() => {
    dbState = {
      leads: [
        {
          id: validLeadId,
          organizationId: validOrgId,
          name: 'Apex Footwear Ltd',
          primaryPhone: '+8801700000001',
          primaryEmail: 'info@apexfootwear.com',
          assignedUserId: validExecId,
          contacts: [
            {
              id: validWaContactId,
              leadId: validLeadId,
              type: ContactType.WHATSAPP,
              rawValue: '01700000001',
              normalizedValue: '+8801700000001',
              status: ContactStatus.VERIFIED,
              whatsappStatus: WhatsAppStatus.CONFIRMED,
              isPrimary: true
            },
            {
              id: validEmailContactId,
              leadId: validLeadId,
              type: ContactType.EMAIL,
              rawValue: 'sales@apexfootwear.com',
              normalizedValue: 'sales@apexfootwear.com',
              status: ContactStatus.VERIFIED,
              whatsappStatus: WhatsAppStatus.UNKNOWN,
              isPrimary: true
            }
          ]
        }
      ],
      drafts: [
        {
          id: validDraftId,
          organizationId: validOrgId,
          leadId: validLeadId,
          createdByUserId: validExecId,
          type: SalesAssistantDraftType.WHATSAPP,
          status: SalesAssistantDraftStatus.APPROVED,
          content: 'Hello! This is an approved WhatsApp message.',
          emailSubject: null,
          emailBody: null,
          approvedAt: new Date('2026-10-05T10:00:00.000Z'),
          approvedByUserId: validAdminId
        }
      ],
      suppressions: [],
      deliveries: []
    };

    mockPrisma = createMockPrismaClient(dbState);
    queue = new InMemoryOutreachDeliveryQueue();
    service = new OutreachDeliveryService({
      prisma: mockPrisma,
      queue,
      clock: fixedClock
    });
  });

  const baseValidInput: RequestOutreachDeliveryInput = {
    organizationId: validOrgId,
    authenticatedUserId: validAdminId,
    authenticatedUserRole: Role.ADMIN,
    leadId: validLeadId,
    draftId: validDraftId,
    channel: OutreachChannel.WHATSAPP,
    recipientContactId: validWaContactId,
    idempotencyKey: 'idemp-key-1001'
  };

  describe('1. Canonical Serialization & Hash Tests', () => {
    it('generates deterministic approvedDraftSnapshotHash for identical payload', () => {
      const hash1 = computeApprovedDraftSnapshotHash({
        channel: OutreachChannel.WHATSAPP,
        subject: null,
        body: null,
        content: 'Exact approved message text'
      });

      const hash2 = computeApprovedDraftSnapshotHash({
        channel: OutreachChannel.WHATSAPP,
        subject: null,
        body: null,
        content: 'Exact approved message text'
      });

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('proves same content + different recipient generates SAME snapshot hash', async () => {
      const hashRecipientA = computeApprovedDraftSnapshotHash({
        channel: OutreachChannel.WHATSAPP,
        subject: null,
        body: null,
        content: 'Common message content'
      });

      const hashRecipientB = computeApprovedDraftSnapshotHash({
        channel: OutreachChannel.WHATSAPP,
        subject: null,
        body: null,
        content: 'Common message content'
      });

      expect(hashRecipientA).toBe(hashRecipientB);

      // End-to-end service proof: dispatching same content to different recipients produces same approvedDraftSnapshotHash
      const send1 = await service.requestDelivery({
        ...baseValidInput,
        idempotencyKey: 'idemp-recip-a'
      });

      // Add second lead & wa contact with same content
      const lead2Id = 'lead-002';
      const wa2Id = 'contact-wa-002';
      dbState.leads.push({
        id: lead2Id,
        organizationId: validOrgId,
        name: 'Second Company Ltd',
        primaryPhone: '+8801700000002',
        primaryEmail: 'info@second.com',
        assignedUserId: validExecId,
        contacts: [
          {
            id: wa2Id,
            leadId: lead2Id,
            type: ContactType.WHATSAPP,
            rawValue: '01700000002',
            normalizedValue: '+8801700000002',
            status: ContactStatus.VERIFIED,
            whatsappStatus: WhatsAppStatus.CONFIRMED,
            isPrimary: true
          }
        ]
      });
      const draft2Id = 'draft-002';
      dbState.drafts.push({
        id: draft2Id,
        organizationId: validOrgId,
        leadId: lead2Id,
        createdByUserId: validExecId,
        type: SalesAssistantDraftType.WHATSAPP,
        status: SalesAssistantDraftStatus.APPROVED,
        content: 'Hello! This is an approved WhatsApp message.', // Same content as draft 1
        emailSubject: null,
        emailBody: null,
        approvedAt: new Date('2026-10-05T10:00:00.000Z'),
        approvedByUserId: validAdminId
      });

      const send2 = await service.requestDelivery({
        ...baseValidInput,
        leadId: lead2Id,
        draftId: draft2Id,
        recipientContactId: wa2Id,
        idempotencyKey: 'idemp-recip-b'
      });

      const record1 = dbState.deliveries.find((d) => d.id === send1.id);
      const record2 = dbState.deliveries.find((d) => d.id === send2.id);
      expect(record1.approvedDraftSnapshotHash).toBe(record2.approvedDraftSnapshotHash);
    });

    it('proves same content + different lead generates SAME snapshot hash', async () => {
      const hash1 = computeApprovedDraftSnapshotHash({
        channel: OutreachChannel.WHATSAPP,
        subject: null,
        body: null,
        content: 'Lead agnostic message'
      });
      const hash2 = computeApprovedDraftSnapshotHash({
        channel: OutreachChannel.WHATSAPP,
        subject: null,
        body: null,
        content: 'Lead agnostic message'
      });
      expect(hash1).toBe(hash2);
    });

    it('proves same content + different draftId generates SAME snapshot hash', async () => {
      const hash1 = computeApprovedDraftSnapshotHash({
        channel: OutreachChannel.EMAIL,
        subject: 'Weekly Digest',
        body: '<p>Weekly updates</p>',
        content: null
      });
      const hash2 = computeApprovedDraftSnapshotHash({
        channel: OutreachChannel.EMAIL,
        subject: 'Weekly Digest',
        body: '<p>Weekly updates</p>',
        content: null
      });
      expect(hash1).toBe(hash2);
    });

    it('produces different snapshot hash when body/content changes', () => {
      const hash1 = computeApprovedDraftSnapshotHash({
        channel: OutreachChannel.WHATSAPP,
        subject: null,
        body: null,
        content: 'Original content'
      });

      const hash2 = computeApprovedDraftSnapshotHash({
        channel: OutreachChannel.WHATSAPP,
        subject: null,
        body: null,
        content: 'Modified content'
      });

      expect(hash1).not.toBe(hash2);
    });

    it('produces different snapshot hash when subject changes for email', () => {
      const hash1 = computeApprovedDraftSnapshotHash({
        channel: OutreachChannel.EMAIL,
        subject: 'Subject A',
        body: 'Email body',
        content: null
      });

      const hash2 = computeApprovedDraftSnapshotHash({
        channel: OutreachChannel.EMAIL,
        subject: 'Subject B',
        body: 'Email body',
        content: null
      });

      expect(hash1).not.toBe(hash2);
    });

    it('produces different snapshot hash when channel changes', () => {
      const hash1 = computeApprovedDraftSnapshotHash({
        channel: OutreachChannel.WHATSAPP,
        subject: null,
        body: null,
        content: 'Follow-up text'
      });

      const hash2 = computeApprovedDraftSnapshotHash({
        channel: OutreachChannel.EMAIL,
        subject: null,
        body: 'Follow-up text',
        content: null
      });

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('2. Request Fingerprint Tests', () => {
    it('produces identical fingerprint for identical semantic request', () => {
      const fp1 = computeRequestFingerprint({
        organizationId: 'org-01',
        leadId: 'lead-01',
        draftId: 'draft-01',
        channel: OutreachChannel.WHATSAPP,
        recipientNormalized: '+8801700000001',
        recipientContactId: 'contact-01'
      });

      const fp2 = computeRequestFingerprint({
        organizationId: 'org-01',
        leadId: 'lead-01',
        draftId: 'draft-01',
        channel: OutreachChannel.WHATSAPP,
        recipientNormalized: '+8801700000001',
        recipientContactId: 'contact-01'
      });

      expect(fp1).toBe(fp2);
      expect(fp1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces different fingerprint when recipient changes', () => {
      const fp1 = computeRequestFingerprint({
        organizationId: 'org-01',
        leadId: 'lead-01',
        draftId: 'draft-01',
        channel: OutreachChannel.WHATSAPP,
        recipientNormalized: '+8801700000001'
      });

      const fp2 = computeRequestFingerprint({
        organizationId: 'org-01',
        leadId: 'lead-01',
        draftId: 'draft-01',
        channel: OutreachChannel.WHATSAPP,
        recipientNormalized: '+8801700000002'
      });

      expect(fp1).not.toBe(fp2);
    });

    it('produces different fingerprint when recipientContactId changes', () => {
      const fp1 = computeRequestFingerprint({
        organizationId: 'org-01',
        leadId: 'lead-01',
        draftId: 'draft-01',
        channel: OutreachChannel.WHATSAPP,
        recipientNormalized: '+8801700000001',
        recipientContactId: 'contact-wa-01'
      });

      const fp2 = computeRequestFingerprint({
        organizationId: 'org-01',
        leadId: 'lead-01',
        draftId: 'draft-01',
        channel: OutreachChannel.WHATSAPP,
        recipientNormalized: '+8801700000001',
        recipientContactId: 'contact-wa-02'
      });

      expect(fp1).not.toBe(fp2);
    });

    it('produces different fingerprint when leadId changes', () => {
      const fp1 = computeRequestFingerprint({
        organizationId: 'org-01',
        leadId: 'lead-01',
        draftId: 'draft-01',
        channel: OutreachChannel.WHATSAPP,
        recipientNormalized: '+8801700000001'
      });

      const fp2 = computeRequestFingerprint({
        organizationId: 'org-01',
        leadId: 'lead-02',
        draftId: 'draft-01',
        channel: OutreachChannel.WHATSAPP,
        recipientNormalized: '+8801700000001'
      });

      expect(fp1).not.toBe(fp2);
    });

    it('produces different fingerprint when draftId changes', () => {
      const fp1 = computeRequestFingerprint({
        organizationId: 'org-01',
        leadId: 'lead-01',
        draftId: 'draft-01',
        channel: OutreachChannel.WHATSAPP,
        recipientNormalized: '+8801700000001'
      });

      const fp2 = computeRequestFingerprint({
        organizationId: 'org-01',
        leadId: 'lead-01',
        draftId: 'draft-02',
        channel: OutreachChannel.WHATSAPP,
        recipientNormalized: '+8801700000001'
      });

      expect(fp1).not.toBe(fp2);
    });

    it('produces different fingerprint when organizationId changes', () => {
      const fp1 = computeRequestFingerprint({
        organizationId: 'org-01',
        leadId: 'lead-01',
        draftId: 'draft-01',
        channel: OutreachChannel.WHATSAPP,
        recipientNormalized: '+8801700000001'
      });

      const fp2 = computeRequestFingerprint({
        organizationId: 'org-02',
        leadId: 'lead-01',
        draftId: 'draft-01',
        channel: OutreachChannel.WHATSAPP,
        recipientNormalized: '+8801700000001'
      });

      expect(fp1).not.toBe(fp2);
    });

    it('produces different fingerprint when channel changes', () => {
      const fp1 = computeRequestFingerprint({
        organizationId: 'org-01',
        leadId: 'lead-01',
        draftId: 'draft-01',
        channel: OutreachChannel.WHATSAPP,
        recipientNormalized: '+8801700000001'
      });

      const fp2 = computeRequestFingerprint({
        organizationId: 'org-01',
        leadId: 'lead-01',
        draftId: 'draft-01',
        channel: OutreachChannel.EMAIL,
        recipientNormalized: '+8801700000001'
      });

      expect(fp1).not.toBe(fp2);
    });
  });

  describe('3. Role Authorization & Sales Executive Assignment', () => {
    it('allows ADMIN to dispatch approved outreach delivery', async () => {
      const summary = await service.requestDelivery(baseValidInput);

      expect(summary.status).toBe(OutreachDeliveryStatus.QUEUED);
      expect(summary.leadId).toBe(validLeadId);
      expect(summary.draftId).toBe(validDraftId);
      expect(summary.channel).toBe(OutreachChannel.WHATSAPP);
      expect(summary.recipientMasked).toBe('+88017****0001');
      expect(summary.queuedAt).toBeDefined();

      // Assert queue has exact payload { deliveryId }
      expect(queue.jobs).toHaveLength(1);
      expect(queue.jobs[0].payload).toEqual({ deliveryId: summary.id });
    });

    it('allows SALES_MANAGER to dispatch outreach for any tenant lead without direct assignment', async () => {
      const summary = await service.requestDelivery({
        ...baseValidInput,
        authenticatedUserId: 'user-manager-001',
        authenticatedUserRole: Role.SALES_MANAGER,
        idempotencyKey: 'idemp-mgr-001'
      });

      expect(summary.status).toBe(OutreachDeliveryStatus.QUEUED);
    });

    it('allows SALES_EXECUTIVE to dispatch outreach for leads assigned to them', async () => {
      const summary = await service.requestDelivery({
        ...baseValidInput,
        authenticatedUserId: validExecId,
        authenticatedUserRole: Role.SALES_EXECUTIVE,
        idempotencyKey: 'idemp-exec-assigned-001'
      });

      expect(summary.status).toBe(OutreachDeliveryStatus.QUEUED);
    });

    it('denies SALES_EXECUTIVE when lead is assigned to another user', async () => {
      await expect(
        service.requestDelivery({
          ...baseValidInput,
          authenticatedUserId: 'other-unassigned-exec-002',
          authenticatedUserRole: Role.SALES_EXECUTIVE,
          idempotencyKey: 'idemp-exec-unassigned-001'
        })
      ).rejects.toThrow('Sales Executives can only initiate outreach for leads assigned to them');

      expect(queue.jobs).toHaveLength(0);
      expect(dbState.deliveries).toHaveLength(0);
    });

    it('denies VIEWER from initiating outreach deliveries', async () => {
      await expect(
        service.requestDelivery({
          ...baseValidInput,
          authenticatedUserRole: Role.VIEWER,
          idempotencyKey: 'idemp-viewer-001'
        })
      ).rejects.toThrow('Role VIEWER is not authorized');

      expect(queue.jobs).toHaveLength(0);
      expect(dbState.deliveries).toHaveLength(0);
    });
  });

  describe('4. Tenant Isolation & Cross-Tenant Defense', () => {
    it('fails closed when attempting to send for lead from another organization', async () => {
      await expect(
        service.requestDelivery({
          ...baseValidInput,
          organizationId: 'different-org-999',
          idempotencyKey: 'idemp-cross-org-001'
        })
      ).rejects.toThrow('Lead not found in organization');

      expect(queue.jobs).toHaveLength(0);
    });

    it('fails closed when draft belongs to another organization', async () => {
      // Modify draft organization
      dbState.drafts[0].organizationId = 'different-org-999';

      await expect(service.requestDelivery(baseValidInput)).rejects.toThrow(
        'Sales assistant draft not found in organization'
      );

      expect(queue.jobs).toHaveLength(0);
    });
  });

  describe('5. Draft Approval & Invariant Enforcements', () => {
    it('rejects draft in DRAFT status with OUTREACH_DRAFT_NOT_APPROVED', async () => {
      dbState.drafts[0].status = SalesAssistantDraftStatus.DRAFT;
      dbState.drafts[0].approvedAt = null;
      dbState.drafts[0].approvedByUserId = null;

      try {
        await service.requestDelivery(baseValidInput);
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(OutreachServiceError);
        expect(err.code).toBe(OutreachErrorCode.OUTREACH_DRAFT_NOT_APPROVED);
        expect(err.statusCode).toBe(409);
      }

      expect(queue.jobs).toHaveLength(0);
    });

    it('rejects draft in REJECTED status with OUTREACH_DRAFT_NOT_APPROVED', async () => {
      dbState.drafts[0].status = SalesAssistantDraftStatus.REJECTED;

      await expect(service.requestDelivery(baseValidInput)).rejects.toThrow(
        'Only approved sales assistant drafts can be dispatched'
      );
    });

    it('rejects draft belonging to a different lead with OUTREACH_DRAFT_NOT_APPROVED', async () => {
      dbState.drafts[0].leadId = 'other-lead-xyz';

      await expect(service.requestDelivery(baseValidInput)).rejects.toThrow(
        'Sales assistant draft does not belong to the specified lead'
      );
    });
  });

  describe('6. Channel Compatibility Matrix', () => {
    it('allows WHATSAPP draft on WHATSAPP channel, rejects on EMAIL', async () => {
      dbState.drafts[0].type = SalesAssistantDraftType.WHATSAPP;

      // WHATSAPP -> WHATSAPP allowed
      const waResult = await service.requestDelivery({
        ...baseValidInput,
        channel: OutreachChannel.WHATSAPP,
        idempotencyKey: 'idemp-wa-compat-01'
      });
      expect(waResult.status).toBe(OutreachDeliveryStatus.QUEUED);

      // WHATSAPP -> EMAIL rejected
      await expect(
        service.requestDelivery({
          ...baseValidInput,
          channel: OutreachChannel.EMAIL,
          recipientContactId: validEmailContactId,
          idempotencyKey: 'idemp-wa-compat-02'
        })
      ).rejects.toThrow('Channel EMAIL is incompatible with draft type WHATSAPP');
    });

    it('allows EMAIL draft on EMAIL channel, rejects on WHATSAPP', async () => {
      const emailDraftId = 'draft-email-001';
      dbState.drafts.push({
        id: emailDraftId,
        organizationId: validOrgId,
        leadId: validLeadId,
        createdByUserId: validExecId,
        type: SalesAssistantDraftType.EMAIL,
        status: SalesAssistantDraftStatus.APPROVED,
        content: null,
        emailSubject: 'Proposal for Apex Footwear',
        emailBody: 'Dear Team, here is our commercial offer.',
        approvedAt: new Date('2026-10-05T10:00:00.000Z'),
        approvedByUserId: validAdminId
      });

      // EMAIL -> EMAIL allowed
      const emailResult = await service.requestDelivery({
        ...baseValidInput,
        draftId: emailDraftId,
        channel: OutreachChannel.EMAIL,
        recipientContactId: validEmailContactId,
        idempotencyKey: 'idemp-email-compat-01'
      });
      expect(emailResult.status).toBe(OutreachDeliveryStatus.QUEUED);

      // EMAIL -> WHATSAPP rejected
      await expect(
        service.requestDelivery({
          ...baseValidInput,
          draftId: emailDraftId,
          channel: OutreachChannel.WHATSAPP,
          recipientContactId: validWaContactId,
          idempotencyKey: 'idemp-email-compat-02'
        })
      ).rejects.toThrow('Channel WHATSAPP is incompatible with draft type EMAIL');
    });

    it('allows PROPOSAL draft on EMAIL only', async () => {
      const proposalDraftId = 'draft-prop-001';
      dbState.drafts.push({
        id: proposalDraftId,
        organizationId: validOrgId,
        leadId: validLeadId,
        createdByUserId: validExecId,
        type: SalesAssistantDraftType.PROPOSAL,
        status: SalesAssistantDraftStatus.APPROVED,
        content: null,
        emailSubject: 'Formal Business Proposal',
        emailBody: 'Proposal Body Content',
        approvedAt: new Date('2026-10-05T10:00:00.000Z'),
        approvedByUserId: validAdminId
      });

      // PROPOSAL -> EMAIL allowed
      const propResult = await service.requestDelivery({
        ...baseValidInput,
        draftId: proposalDraftId,
        channel: OutreachChannel.EMAIL,
        recipientContactId: validEmailContactId,
        idempotencyKey: 'idemp-prop-compat-01'
      });
      expect(propResult.status).toBe(OutreachDeliveryStatus.QUEUED);

      // PROPOSAL -> WHATSAPP rejected
      await expect(
        service.requestDelivery({
          ...baseValidInput,
          draftId: proposalDraftId,
          channel: OutreachChannel.WHATSAPP,
          recipientContactId: validWaContactId,
          idempotencyKey: 'idemp-prop-compat-02'
        })
      ).rejects.toThrow('Channel WHATSAPP is incompatible with draft type PROPOSAL');
    });

    it('allows FOLLOW_UP draft on both WHATSAPP and EMAIL', async () => {
      const followUpDraftId = 'draft-fu-001';
      dbState.drafts.push({
        id: followUpDraftId,
        organizationId: validOrgId,
        leadId: validLeadId,
        createdByUserId: validExecId,
        type: SalesAssistantDraftType.FOLLOW_UP,
        status: SalesAssistantDraftStatus.APPROVED,
        content: 'Following up on our conversation',
        emailSubject: 'Follow-up Note',
        emailBody: 'Following up on our conversation via email',
        approvedAt: new Date('2026-10-05T10:00:00.000Z'),
        approvedByUserId: validAdminId
      });

      // FOLLOW_UP -> WHATSAPP allowed
      const fuWa = await service.requestDelivery({
        ...baseValidInput,
        draftId: followUpDraftId,
        channel: OutreachChannel.WHATSAPP,
        recipientContactId: validWaContactId,
        idempotencyKey: 'idemp-fu-wa-01'
      });
      expect(fuWa.status).toBe(OutreachDeliveryStatus.QUEUED);

      // FOLLOW_UP -> EMAIL allowed
      const fuEmail = await service.requestDelivery({
        ...baseValidInput,
        draftId: followUpDraftId,
        channel: OutreachChannel.EMAIL,
        recipientContactId: validEmailContactId,
        idempotencyKey: 'idemp-fu-email-01'
      });
      expect(fuEmail.status).toBe(OutreachDeliveryStatus.QUEUED);
    });

    it('rejects CALL_SCRIPT draft on all delivery channels', async () => {
      const callScriptId = 'draft-call-001';
      dbState.drafts.push({
        id: callScriptId,
        organizationId: validOrgId,
        leadId: validLeadId,
        createdByUserId: validExecId,
        type: SalesAssistantDraftType.CALL_SCRIPT,
        status: SalesAssistantDraftStatus.APPROVED,
        content: 'Sales call guidance script',
        approvedAt: new Date('2026-10-05T10:00:00.000Z'),
        approvedByUserId: validAdminId
      });

      await expect(
        service.requestDelivery({
          ...baseValidInput,
          draftId: callScriptId,
          channel: OutreachChannel.WHATSAPP,
          idempotencyKey: 'idemp-call-wa'
        })
      ).rejects.toThrow('Channel WHATSAPP is incompatible with draft type CALL_SCRIPT');

      await expect(
        service.requestDelivery({
          ...baseValidInput,
          draftId: callScriptId,
          channel: OutreachChannel.EMAIL,
          idempotencyKey: 'idemp-call-email'
        })
      ).rejects.toThrow('Channel EMAIL is incompatible with draft type CALL_SCRIPT');
    });
  });

  describe('7. Recipient Resolution & PHONE != WHATSAPP Invariant', () => {
    it('enforces PHONE != WHATSAPP: rejects ordinary phone contact for WhatsApp dispatch', async () => {
      // Add ordinary phone contact
      const plainPhoneContactId = 'contact-plain-phone-001';
      dbState.leads[0].contacts.push({
        id: plainPhoneContactId,
        leadId: validLeadId,
        type: ContactType.PHONE,
        rawValue: '+8801712345678',
        normalizedValue: '+8801712345678',
        status: ContactStatus.VERIFIED,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        isPrimary: false
      });

      await expect(
        service.requestDelivery({
          ...baseValidInput,
          recipientContactId: plainPhoneContactId,
          idempotencyKey: 'idemp-phone-not-wa'
        })
      ).rejects.toThrow('Selected contact is not a WhatsApp contact (PHONE != WHATSAPP)');
    });

    it('auto-resolves unambiguous WhatsApp contact when recipientContactId is omitted', async () => {
      const summary = await service.requestDelivery({
        ...baseValidInput,
        recipientContactId: undefined,
        idempotencyKey: 'idemp-auto-wa'
      });

      expect(summary.status).toBe(OutreachDeliveryStatus.QUEUED);
      expect(summary.recipientContactId).toBe(validWaContactId);
      expect(summary.recipientMasked).toBe('+88017****0001');
    });

    it('normalizes email recipient to trimmed lowercase', async () => {
      const emailDraftId = 'draft-email-norm';
      dbState.drafts.push({
        id: emailDraftId,
        organizationId: validOrgId,
        leadId: validLeadId,
        createdByUserId: validExecId,
        type: SalesAssistantDraftType.EMAIL,
        status: SalesAssistantDraftStatus.APPROVED,
        content: null,
        emailSubject: 'Subject',
        emailBody: 'Body',
        approvedAt: new Date('2026-10-05T10:00:00.000Z'),
        approvedByUserId: validAdminId
      });

      // Contact with mixed case and whitespace
      const cId = 'contact-cased-email';
      dbState.leads[0].contacts.push({
        id: cId,
        leadId: validLeadId,
        type: ContactType.EMAIL,
        rawValue: '  Sales.Team@ApexFootwear.COM  ',
        normalizedValue: '  Sales.Team@ApexFootwear.COM  ',
        status: ContactStatus.VERIFIED,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        isPrimary: false
      });

      await service.requestDelivery({
        ...baseValidInput,
        draftId: emailDraftId,
        channel: OutreachChannel.EMAIL,
        recipientContactId: cId,
        idempotencyKey: 'idemp-email-norm'
      });

      const saved = dbState.deliveries.find((d) => d.idempotencyKey === 'idemp-email-norm');
      expect(saved.recipientNormalized).toBe('sales.team@apexfootwear.com');
    });
  });

  describe('8. Suppression List Gate A', () => {
    it('blocks WhatsApp delivery when recipient is suppressed on Gate A', async () => {
      dbState.suppressions.push({
        id: 'supp-001',
        organizationId: validOrgId,
        type: SuppressionType.WHATSAPP,
        normalizedValue: '+8801700000001',
        channelScope: ChannelScope.ALL,
        reason: SuppressionReason.OPT_OUT,
        addedBy: 'admin',
        addedAt: new Date(),
        expiresAt: null
      });

      try {
        await service.requestDelivery(baseValidInput);
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(OutreachServiceError);
        expect(err.code).toBe(OutreachErrorCode.OUTREACH_RECIPIENT_SUPPRESSED);
        expect(err.statusCode).toBe(422);
      }

      expect(queue.jobs).toHaveLength(0);
      expect(dbState.deliveries).toHaveLength(0);
    });

    it('blocks Email delivery when domain is suppressed on Gate A', async () => {
      const emailDraftId = 'draft-email-supp';
      dbState.drafts.push({
        id: emailDraftId,
        organizationId: validOrgId,
        leadId: validLeadId,
        createdByUserId: validExecId,
        type: SalesAssistantDraftType.EMAIL,
        status: SalesAssistantDraftStatus.APPROVED,
        content: null,
        emailSubject: 'Subject',
        emailBody: 'Body',
        approvedAt: new Date('2026-10-05T10:00:00.000Z'),
        approvedByUserId: validAdminId
      });

      dbState.suppressions.push({
        id: 'supp-dom-001',
        organizationId: validOrgId,
        type: SuppressionType.DOMAIN,
        normalizedValue: 'apexfootwear.com',
        channelScope: ChannelScope.EMAIL,
        reason: SuppressionReason.DO_NOT_CONTACT,
        addedBy: 'admin',
        addedAt: new Date(),
        expiresAt: null
      });

      await expect(
        service.requestDelivery({
          ...baseValidInput,
          draftId: emailDraftId,
          channel: OutreachChannel.EMAIL,
          recipientContactId: validEmailContactId,
          idempotencyKey: 'idemp-supp-email'
        })
      ).rejects.toThrow('Recipient is suppressed from Email outreach delivery');

      expect(queue.jobs).toHaveLength(0);
    });

    it('allows delivery when suppression record is expired', async () => {
      dbState.suppressions.push({
        id: 'supp-expired',
        organizationId: validOrgId,
        type: SuppressionType.WHATSAPP,
        normalizedValue: '+8801700000001',
        channelScope: ChannelScope.ALL,
        reason: SuppressionReason.OPT_OUT,
        addedBy: 'admin',
        addedAt: new Date('2026-01-01'),
        expiresAt: new Date('2026-06-01') // Expired before fixed test clock 2026-10-05
      });

      const summary = await service.requestDelivery(baseValidInput);
      expect(summary.status).toBe(OutreachDeliveryStatus.QUEUED);
    });
  });

  describe('9. Idempotency Key Semantics & Concurrency Safety', () => {
    it('returns identical delivery on repeated request with same key and parameters', async () => {
      const first = await service.requestDelivery(baseValidInput);
      expect(queue.jobs).toHaveLength(1);

      const second = await service.requestDelivery(baseValidInput);
      expect(second.id).toBe(first.id);
      expect(second.status).toBe(OutreachDeliveryStatus.QUEUED);

      // Does not enqueue second job into queue
      expect(queue.jobs).toHaveLength(1);
    });

    it('rejects same idempotency key with different request parameters with OUTREACH_IDEMPOTENCY_KEY_REUSED', async () => {
      await service.requestDelivery(baseValidInput);

      // Create a second draft
      const otherDraftId = 'draft-other-999';
      dbState.drafts.push({
        id: otherDraftId,
        organizationId: validOrgId,
        leadId: validLeadId,
        createdByUserId: validExecId,
        type: SalesAssistantDraftType.WHATSAPP,
        status: SalesAssistantDraftStatus.APPROVED,
        content: 'Alternative text',
        approvedAt: new Date('2026-10-05T10:00:00.000Z'),
        approvedByUserId: validAdminId
      });

      try {
        await service.requestDelivery({
          ...baseValidInput,
          draftId: otherDraftId
        });
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(OutreachServiceError);
        expect(err.code).toBe(OutreachErrorCode.OUTREACH_IDEMPOTENCY_KEY_REUSED);
        expect(err.statusCode).toBe(409);
      }
    });

    it('prioritizes OUTREACH_IDEMPOTENCY_KEY_REUSED over suppression when request fingerprint changes', async () => {
      await service.requestDelivery(baseValidInput);

      // Add suppression for recipient
      dbState.suppressions.push({
        id: 'supp-both',
        organizationId: validOrgId,
        type: SuppressionType.WHATSAPP,
        normalizedValue: '+8801700000001',
        channelScope: ChannelScope.ALL,
        reason: SuppressionReason.OPT_OUT,
        addedBy: 'admin',
        addedAt: new Date(),
        expiresAt: null
      });

      // Re-using same key for another draft throws IDEMPOTENCY_KEY_REUSED (not hidden by suppression)
      const otherDraftId = 'draft-other-conflict';
      dbState.drafts.push({
        id: otherDraftId,
        organizationId: validOrgId,
        leadId: validLeadId,
        createdByUserId: validExecId,
        type: SalesAssistantDraftType.WHATSAPP,
        status: SalesAssistantDraftStatus.APPROVED,
        content: 'Conflict message',
        approvedAt: new Date('2026-10-05T10:00:00.000Z'),
        approvedByUserId: validAdminId
      });

      try {
        await service.requestDelivery({
          ...baseValidInput,
          draftId: otherDraftId
        });
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(OutreachServiceError);
        expect(err.code).toBe(OutreachErrorCode.OUTREACH_IDEMPOTENCY_KEY_REUSED);
        expect(err.statusCode).toBe(409);
      }
    });

    it('allows intentional resend when a NEW idempotency key is provided', async () => {
      const first = await service.requestDelivery({
        ...baseValidInput,
        idempotencyKey: 'idemp-first-send'
      });

      const second = await service.requestDelivery({
        ...baseValidInput,
        idempotencyKey: 'idemp-second-send-resend'
      });

      expect(second.id).not.toBe(first.id);
      expect(queue.jobs).toHaveLength(2);
      expect(dbState.deliveries).toHaveLength(2);
    });
  });

  describe('10. Queue Failure, Race Conditions & State Preservation', () => {
    it('preserves delivery in REQUESTED status when queue enqueue fails, and recovers on retry', async () => {
      // Simulate queue failure on first call
      queue.simulateFailure(new Error('Redis connection timeout'));

      await expect(service.requestDelivery(baseValidInput)).rejects.toThrow(
        'Outreach delivery created but background queueing failed'
      );

      // Delivery record exists in REQUESTED status in DB
      expect(dbState.deliveries).toHaveLength(1);
      const delivery = dbState.deliveries[0];
      expect(delivery.status).toBe(OutreachDeliveryStatus.REQUESTED);
      expect(delivery.queuedAt).toBeNull();
      expect(queue.jobs).toHaveLength(0);

      // Second call with same idempotency key retries enqueue
      const recovered = await service.requestDelivery(baseValidInput);

      expect(recovered.id).toBe(delivery.id);
      expect(recovered.status).toBe(OutreachDeliveryStatus.QUEUED);
      expect(recovered.queuedAt).toBeDefined();

      expect(queue.jobs).toHaveLength(1);
      expect(queue.jobs[0].payload).toEqual({ deliveryId: delivery.id });
    });

    it('blocks REQUESTED recovery retry when recipient is suppressed after initial enqueue failure', async () => {
      // 1. Initial attempt fails to enqueue, leaving delivery in REQUESTED status
      queue.simulateFailure(new Error('Redis connection drop'));
      await expect(service.requestDelivery(baseValidInput)).rejects.toThrow(
        'Outreach delivery created but background queueing failed'
      );

      const del = dbState.deliveries.find((d) => d.idempotencyKey === baseValidInput.idempotencyKey);
      expect(del.status).toBe(OutreachDeliveryStatus.REQUESTED);
      expect(queue.jobs).toHaveLength(0);

      // 2. Recipient is suppressed before retry
      dbState.suppressions.push({
        id: 'supp-before-retry',
        organizationId: validOrgId,
        type: SuppressionType.WHATSAPP,
        normalizedValue: '+8801700000001',
        channelScope: ChannelScope.ALL,
        reason: SuppressionReason.OPT_OUT,
        addedBy: 'admin',
        addedAt: new Date(),
        expiresAt: null
      });

      // 3. Retry same request + same Idempotency-Key
      try {
        await service.requestDelivery(baseValidInput);
        expect.unreachable('Should have thrown OUTREACH_RECIPIENT_SUPPRESSED');
      } catch (err: any) {
        expect(err).toBeInstanceOf(OutreachServiceError);
        expect(err.code).toBe(OutreachErrorCode.OUTREACH_RECIPIENT_SUPPRESSED);
        expect(err.statusCode).toBe(422);
      }

      // Delivery remains in REQUESTED status in DB, no queue call made
      expect(del.status).toBe(OutreachDeliveryStatus.REQUESTED);
      expect(queue.jobs).toHaveLength(0);
      expect(dbState.deliveries).toHaveLength(1);
    });

    it('preserves CANCELLED status when another actor cancels delivery before queue state persistence runs', async () => {
      const originalEnqueue = queue.enqueue.bind(queue);
      queue.enqueue = async (payload) => {
        const res = await originalEnqueue(payload);
        // Simulate concurrent actor cancelling the delivery record in DB
        const delIdx = dbState.deliveries.findIndex((d) => d.id === payload.deliveryId);
        if (delIdx >= 0) {
          dbState.deliveries[delIdx].status = OutreachDeliveryStatus.CANCELLED;
          dbState.deliveries[delIdx].cancelledAt = fixedClockDate;
        }
        return res;
      };

      const summary = await service.requestDelivery(baseValidInput);

      // Must preserve CANCELLED and not force back to QUEUED
      expect(summary.status).toBe(OutreachDeliveryStatus.CANCELLED);
      expect(summary.cancelledAt).toBeDefined();

      const inDb = dbState.deliveries.find((d) => d.id === summary.id);
      expect(inDb.status).toBe(OutreachDeliveryStatus.CANCELLED);
      expect(inDb.queuedAt).toBeNull();
    });

    it('preserves newer PROCESSING / SENT / DELIVERED / FAILED states if worker advances state concurrently', async () => {
      const originalEnqueue = queue.enqueue.bind(queue);
      queue.enqueue = async (payload) => {
        const res = await originalEnqueue(payload);
        // Simulate background worker immediately picking up and processing delivery to SENT
        const delIdx = dbState.deliveries.findIndex((d) => d.id === payload.deliveryId);
        if (delIdx >= 0) {
          dbState.deliveries[delIdx].status = OutreachDeliveryStatus.SENT;
          dbState.deliveries[delIdx].sentAt = fixedClockDate;
        }
        return res;
      };

      const summary = await service.requestDelivery(baseValidInput);

      // Must preserve SENT and not overwrite with QUEUED
      expect(summary.status).toBe(OutreachDeliveryStatus.SENT);
      expect(summary.sentAt).toBeDefined();

      const inDb = dbState.deliveries.find((d) => d.id === summary.id);
      expect(inDb.status).toBe(OutreachDeliveryStatus.SENT);
    });

    it('proves non-REQUESTED replay returns historical delivery even if recipient was suppressed after creation', async () => {
      const first = await service.requestDelivery(baseValidInput);
      expect(first.status).toBe(OutreachDeliveryStatus.QUEUED);
      expect(queue.jobs).toHaveLength(1);

      // Recipient is suppressed AFTER initial delivery is queued
      dbState.suppressions.push({
        id: 'supp-after-creation',
        organizationId: validOrgId,
        type: SuppressionType.WHATSAPP,
        normalizedValue: '+8801700000001',
        channelScope: ChannelScope.ALL,
        reason: SuppressionReason.OPT_OUT,
        addedBy: 'admin',
        addedAt: new Date(),
        expiresAt: null
      });

      // Replaying with identical key returns the historical QUEUED delivery without throwing OUTREACH_RECIPIENT_SUPPRESSED
      const replay = await service.requestDelivery(baseValidInput);
      expect(replay.id).toBe(first.id);
      expect(replay.status).toBe(OutreachDeliveryStatus.QUEUED);
      // Queue does not get a second job
      expect(queue.jobs).toHaveLength(1);
    });
  });

  describe('11. Snapshot Exactness & Public Privacy Boundary', () => {
    it('persists exact approved draft snapshot without alteration or appending URLs', async () => {
      const summary = await service.requestDelivery(baseValidInput);

      const saved = dbState.deliveries.find((d) => d.id === summary.id);
      expect(saved.snapshotContent).toBe('Hello! This is an approved WhatsApp message.');
      expect(saved.snapshotSubject).toBeNull();
      expect(saved.snapshotBody).toBeNull();
    });

    it('public summary strictly masks recipient and excludes private fields', async () => {
      const summary = await service.requestDelivery(baseValidInput);

      expect(summary.recipientMasked).toBe('+88017****0001');

      // Assert private transport/internal fields are absent on public summary
      const summaryObj = summary as any;
      expect(summaryObj.recipientNormalized).toBeUndefined();
      expect(summaryObj.snapshotContent).toBeUndefined();
      expect(summaryObj.snapshotSubject).toBeUndefined();
      expect(summaryObj.snapshotBody).toBeUndefined();
      expect(summaryObj.approvedDraftSnapshotHash).toBeUndefined();
      expect(summaryObj.idempotencyKey).toBeUndefined();
      expect(summaryObj.requestFingerprint).toBeUndefined();
      expect(summaryObj.providerMessageId).toBeUndefined();
    });
  });

  describe('12. Idempotency Key Validation & Additional Invariants', () => {
    it('rejects idempotency key shorter than 8 characters', async () => {
      await expect(
        service.requestDelivery({
          ...baseValidInput,
          idempotencyKey: 'short'
        })
      ).rejects.toThrow('Idempotency-Key must be at least 8 characters');
    });

    it('rejects idempotency key containing invalid characters', async () => {
      await expect(
        service.requestDelivery({
          ...baseValidInput,
          idempotencyKey: 'invalid key with spaces'
        })
      ).rejects.toThrow('Idempotency-Key contains invalid characters');
    });

    it('rejects approved WhatsApp draft with empty content', async () => {
      dbState.drafts[0].content = '   ';

      await expect(service.requestDelivery(baseValidInput)).rejects.toThrow(
        'Approved WhatsApp draft is missing content'
      );
    });

    it('rejects approved Email draft with empty body', async () => {
      const emailDraftId = 'draft-empty-body';
      dbState.drafts.push({
        id: emailDraftId,
        organizationId: validOrgId,
        leadId: validLeadId,
        createdByUserId: validExecId,
        type: SalesAssistantDraftType.EMAIL,
        status: SalesAssistantDraftStatus.APPROVED,
        content: null,
        emailSubject: 'Subject',
        emailBody: '',
        approvedAt: new Date('2026-10-05T10:00:00.000Z'),
        approvedByUserId: validAdminId
      });

      await expect(
        service.requestDelivery({
          ...baseValidInput,
          draftId: emailDraftId,
          channel: OutreachChannel.EMAIL,
          recipientContactId: validEmailContactId,
          idempotencyKey: 'idemp-empty-body'
        })
      ).rejects.toThrow('Approved Email draft is missing body');
    });

    it('auto-resolves from lead.primaryEmail when no LeadContact row exists', async () => {
      const emailDraftId = 'draft-primary-email-lead';
      dbState.drafts.push({
        id: emailDraftId,
        organizationId: validOrgId,
        leadId: validLeadId,
        createdByUserId: validExecId,
        type: SalesAssistantDraftType.EMAIL,
        status: SalesAssistantDraftStatus.APPROVED,
        content: null,
        emailSubject: 'Subject',
        emailBody: 'Body',
        approvedAt: new Date('2026-10-05T10:00:00.000Z'),
        approvedByUserId: validAdminId
      });

      // Remove email contacts from lead
      dbState.leads[0].contacts = dbState.leads[0].contacts.filter((c: any) => c.type !== ContactType.EMAIL);
      dbState.leads[0].primaryEmail = 'ceo@apexfootwear.com';

      const summary = await service.requestDelivery({
        ...baseValidInput,
        draftId: emailDraftId,
        channel: OutreachChannel.EMAIL,
        recipientContactId: undefined,
        idempotencyKey: 'idemp-primary-email'
      });

      expect(summary.status).toBe(OutreachDeliveryStatus.QUEUED);
      expect(summary.recipientContactId).toBeUndefined();
      expect(summary.recipientMasked).toBe('c***o@apexfootwear.com');

      const saved = dbState.deliveries.find((d) => d.idempotencyKey === 'idemp-primary-email');
      expect(saved.recipientContactId).toBeNull();
      expect(saved.recipientNormalized).toBe('ceo@apexfootwear.com');
    });

    it('fails closed when multiple email contacts exist without clear isPrimary flag', async () => {
      const emailDraftId = 'draft-multi-email';
      dbState.drafts.push({
        id: emailDraftId,
        organizationId: validOrgId,
        leadId: validLeadId,
        createdByUserId: validExecId,
        type: SalesAssistantDraftType.EMAIL,
        status: SalesAssistantDraftStatus.APPROVED,
        content: null,
        emailSubject: 'Subject',
        emailBody: 'Body',
        approvedAt: new Date('2026-10-05T10:00:00.000Z'),
        approvedByUserId: validAdminId
      });

      // Add second email contact with isPrimary = false
      dbState.leads[0].contacts.push({
        id: 'contact-email-002',
        leadId: validLeadId,
        type: ContactType.EMAIL,
        rawValue: 'support@apexfootwear.com',
        normalizedValue: 'support@apexfootwear.com',
        status: ContactStatus.VERIFIED,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        isPrimary: false
      });
      // Mark first as not primary too
      dbState.leads[0].contacts[1].isPrimary = false;

      await expect(
        service.requestDelivery({
          ...baseValidInput,
          draftId: emailDraftId,
          channel: OutreachChannel.EMAIL,
          recipientContactId: undefined,
          idempotencyKey: 'idemp-ambiguous-emails'
        })
      ).rejects.toThrow('Multiple email contacts found; recipientContactId must be specified');
    });
  });
});
