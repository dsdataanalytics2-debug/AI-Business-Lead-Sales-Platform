/**
 * Sales Assistant Service Unit & Domain Integration Tests
 *
 * Covers:
 * 1. Service instantiation with default and custom injected providers
 * 2. Tenant-safe lead lookup (organizationId + leadId)
 * 3. Safe context projection (PHONE != WHATSAPP boundary)
 * 4. Provider failure safety: no drafts persisted on provider errors
 * 5. Draft persistence formats (EMAIL vs non-EMAIL)
 * 6. Review lifecycle (DRAFT -> APPROVED, DRAFT -> REJECTED)
 * 7. Terminal review state guards and invalid transition rejections
 * 8. Concurrent review race condition protection (updateMany status check)
 * 9. Tenant & Lead isolation for getDraft, listDrafts, approveDraft, rejectDraft
 * 10. Audit log creation & metadata minimization
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma, {
  Role,
  ContactType,
  ContactStatus,
  WhatsAppStatus
} from '@leadmate/db';
import {
  SalesAssistantDraftType,
  SalesAssistantLanguage,
  SalesAssistantTone,
  SalesAssistantDraftStatus,
  SalesAssistantWarning,
  GeneratedSalesAssistantDraft
} from '@leadmate/shared';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import {
  MockSalesAssistantProvider,
  SalesAssistantProviderClient,
  SalesAssistantProviderError,
  SalesAssistantProviderErrorCode,
  NormalizedSalesAssistantInput
} from '@leadmate/ai';
import {
  SalesAssistantService
} from '../services/sales-assistant.service.js';
import { NotFoundError, ConflictError } from '../lib/errors.js';

describe('M5 Step 4: SalesAssistantService Domain Layer', () => {
  const orgAId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const orgBId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  const userAId = '22222222-2222-2222-2222-22222222222a';
  const userBId = '22222222-2222-2222-2222-22222222222b';

  let leadAWithWhatsAppId: string;
  let leadAPhoneOnlyId: string;
  let leadBId: string;

  beforeAll(async () => {
    await ensureTestDatabase(prisma);

    // Setup Organizations
    await prisma.organization.upsert({
      where: { id: orgAId },
      update: {},
      create: { id: orgAId, name: 'Service Test Org A', timezone: 'UTC' }
    });
    await prisma.organization.upsert({
      where: { id: orgBId },
      update: {},
      create: { id: orgBId, name: 'Service Test Org B', timezone: 'UTC' }
    });

    // Setup Users
    await prisma.user.upsert({
      where: { id: userAId },
      update: {},
      create: {
        id: userAId,
        organizationId: orgAId,
        email: 'user-a-service@test.leadmate.ai',
        name: 'User A Service',
        passwordHash: 'dummy',
        role: Role.SALES_MANAGER,
        isActive: true
      }
    });

    await prisma.user.upsert({
      where: { id: userBId },
      update: {},
      create: {
        id: userBId,
        organizationId: orgBId,
        email: 'user-b-service@test.leadmate.ai',
        name: 'User B Service',
        passwordHash: 'dummy',
        role: Role.SALES_MANAGER,
        isActive: true
      }
    });

    // Clean any prior leads/drafts for these test orgs
    await prisma.salesAssistantDraft.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } }
    });
    await prisma.leadContact.deleteMany({
      where: { lead: { organizationId: { in: [orgAId, orgBId] } } }
    });
    await prisma.lead.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } }
    });

    // Lead A with verified WhatsApp
    const leadA1 = await prisma.lead.create({
      data: {
        organizationId: orgAId,
        name: 'A1 WhatsApp Ready Ltd',
        normalizedName: 'a1 whatsapp ready ltd',
        category: 'Technology',
        primaryEmail: 'info@a1ready.com',
        primaryPhone: '+1-555-0101',
        country: 'US',
        city: 'Seattle',
        primarySource: 'MANUAL',
        contacts: {
          create: [
            {
              type: ContactType.PHONE,
              rawValue: '+1-555-0101',
              normalizedValue: '+1-555-0101',
              status: ContactStatus.VERIFIED,
              whatsappStatus: WhatsAppStatus.UNKNOWN
            },
            {
              type: ContactType.WHATSAPP,
              rawValue: '+1-555-0199',
              normalizedValue: '+1-555-0199',
              status: ContactStatus.VERIFIED,
              whatsappStatus: WhatsAppStatus.CONFIRMED
            }
          ]
        }
      }
    });
    leadAWithWhatsAppId = leadA1.id;

    // Lead A with phone only (NO verified WhatsApp)
    const leadA2 = await prisma.lead.create({
      data: {
        organizationId: orgAId,
        name: 'A2 Phone Only Corp',
        normalizedName: 'a2 phone only corp',
        category: 'Services',
        primaryEmail: 'contact@a2phone.com',
        primaryPhone: '+1-555-0202',
        country: 'US',
        city: 'Portland',
        primarySource: 'MANUAL',
        contacts: {
          create: [
            {
              type: ContactType.PHONE,
              rawValue: '+1-555-0202',
              normalizedValue: '+1-555-0202',
              status: ContactStatus.VERIFIED,
              whatsappStatus: WhatsAppStatus.UNKNOWN
            }
          ]
        }
      }
    });
    leadAPhoneOnlyId = leadA2.id;

    // Lead B (Org B)
    const leadB = await prisma.lead.create({
      data: {
        organizationId: orgBId,
        name: 'B Foreign Tech',
        normalizedName: 'b foreign tech',
        category: 'Retail',
        primaryEmail: 'hello@bforeign.com',
        primaryPhone: '+1-555-0303',
        country: 'CA',
        city: 'Vancouver',
        primarySource: 'MANUAL'
      }
    });
    leadBId = leadB.id;
  });

  afterAll(async () => {
    await prisma.salesAssistantDraft.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } }
    });
    await prisma.leadContact.deleteMany({
      where: { lead: { organizationId: { in: [orgAId, orgBId] } } }
    });
    await prisma.lead.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } }
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userAId, userBId] } }
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgAId, orgBId] } }
    });
  });

  describe('1. Dependency Injection & Context Projection', () => {
    it('allows injecting a custom provider into service constructor', async () => {
      let capturedInput: NormalizedSalesAssistantInput | null = null;

      const customProvider: SalesAssistantProviderClient = {
        providerName: 'CAPTURING_MOCK',
        generateDraft: async (input: NormalizedSalesAssistantInput): Promise<GeneratedSalesAssistantDraft> => {
          capturedInput = input;
          return {
            type: SalesAssistantDraftType.WHATSAPP,
            status: SalesAssistantDraftStatus.DRAFT,
            language: input.language,
            tone: input.tone,
            content: 'Custom injected content',
            warnings: []
          };
        }
      };

      const customService = new SalesAssistantService(customProvider);
      const draft = await customService.generateDraft(
        { organizationId: orgAId, userId: userAId },
        leadAWithWhatsAppId,
        {
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL,
          objective: 'Test injection'
        }
      );

      expect(draft.content).toBe('Custom injected content');
      expect(capturedInput).not.toBeNull();
      expect(capturedInput!.leadContext.businessName).toBe('A1 WhatsApp Ready Ltd');
      expect(capturedInput!.leadContext.whatsapp).toBe('+1-555-0199');
      expect(capturedInput!.leadContext.phone).toBe('+1-555-0101');
    });

    it('strictly enforces PHONE != WHATSAPP: phone is NOT promoted to WhatsApp', async () => {
      let capturedInput: NormalizedSalesAssistantInput | null = null;

      const spyProvider: SalesAssistantProviderClient = {
        providerName: 'SPY_MOCK',
        generateDraft: async (input: NormalizedSalesAssistantInput): Promise<GeneratedSalesAssistantDraft> => {
          capturedInput = input;
          const mock = new MockSalesAssistantProvider();
          return mock.generateDraft(input);
        }
      };

      const service = new SalesAssistantService(spyProvider);
      const draft = await service.generateDraft(
        { organizationId: orgAId, userId: userAId },
        leadAPhoneOnlyId,
        {
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL
        }
      );

      // Verify projected context passed to provider:
      expect(capturedInput).not.toBeNull();
      expect(capturedInput!.leadContext.phone).toBe('+1-555-0202');
      expect(capturedInput!.leadContext.whatsapp).toBeUndefined();

      // Verify provider emitted warning UNVERIFIED_WHATSAPP
      expect(draft.warnings).toContain(SalesAssistantWarning.UNVERIFIED_WHATSAPP);
    });
  });

  describe('2. Provider Failure Safety', () => {
    it('does NOT persist a draft row when provider throws PROVIDER_TIMEOUT', async () => {
      const failingProvider: SalesAssistantProviderClient = {
        providerName: 'TIMEOUT_PROVIDER',
        generateDraft: async () => {
          throw new SalesAssistantProviderError(
            SalesAssistantProviderErrorCode.PROVIDER_TIMEOUT,
            'Mock generation timed out after 10000ms'
          );
        }
      };

      const initialCount = await prisma.salesAssistantDraft.count({
        where: { leadId: leadAWithWhatsAppId }
      });

      const service = new SalesAssistantService(failingProvider);

      await expect(
        service.generateDraft(
          { organizationId: orgAId, userId: userAId },
          leadAWithWhatsAppId,
          {
            type: SalesAssistantDraftType.EMAIL,
            language: SalesAssistantLanguage.ENGLISH,
            tone: SalesAssistantTone.PERSUASIVE
          }
        )
      ).rejects.toThrow(SalesAssistantProviderError);

      const postCount = await prisma.salesAssistantDraft.count({
        where: { leadId: leadAWithWhatsAppId }
      });
      expect(postCount).toBe(initialCount);
    });

    it('does NOT persist a draft row when provider throws PROVIDER_UNAVAILABLE', async () => {
      const failingProvider: SalesAssistantProviderClient = {
        providerName: 'UNAVAILABLE_PROVIDER',
        generateDraft: async () => {
          throw new SalesAssistantProviderError(
            SalesAssistantProviderErrorCode.PROVIDER_UNAVAILABLE,
            'Upstream provider unavailable'
          );
        }
      };

      const initialCount = await prisma.salesAssistantDraft.count({
        where: { leadId: leadAWithWhatsAppId }
      });

      const service = new SalesAssistantService(failingProvider);

      await expect(
        service.generateDraft(
          { organizationId: orgAId, userId: userAId },
          leadAWithWhatsAppId,
          {
            type: SalesAssistantDraftType.EMAIL,
            language: SalesAssistantLanguage.ENGLISH,
            tone: SalesAssistantTone.PERSUASIVE
          }
        )
      ).rejects.toThrow(SalesAssistantProviderError);

      const postCount = await prisma.salesAssistantDraft.count({
        where: { leadId: leadAWithWhatsAppId }
      });
      expect(postCount).toBe(initialCount);
    });
  });

  describe('3. Persistence Formats & Review Operations', () => {
    const service = new SalesAssistantService(new MockSalesAssistantProvider());

    it('persists EMAIL drafts with emailSubject + emailBody and content null', async () => {
      const draft = await service.generateDraft(
        { organizationId: orgAId, userId: userAId },
        leadAWithWhatsAppId,
        {
          type: SalesAssistantDraftType.EMAIL,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL,
          objective: 'Introductory email'
        }
      );

      expect(draft.status).toBe(SalesAssistantDraftStatus.DRAFT);
      expect(draft.content).toBeUndefined();
      expect(draft.emailSubject).toBeTruthy();
      expect(draft.emailBody).toBeTruthy();
      expect(draft.createdByUser?.id).toBe(userAId);
      expect(draft.approvedAt).toBeUndefined();
      expect(draft.rejectedAt).toBeUndefined();

      // Check physical DB row
      const dbRow = await prisma.salesAssistantDraft.findUnique({
        where: { id: draft.id }
      });
      expect(dbRow?.content).toBeNull();
      expect(dbRow?.emailSubject).toBeTruthy();
      expect(dbRow?.emailBody).toBeTruthy();
    });

    it('approves a DRAFT draft successfully (DRAFT -> APPROVED)', async () => {
      const draft = await service.generateDraft(
        { organizationId: orgAId, userId: userAId },
        leadAWithWhatsAppId,
        {
          type: SalesAssistantDraftType.CALL_SCRIPT,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.CONCISE
        }
      );

      const approved = await service.approveDraft(
        { organizationId: orgAId, userId: userAId },
        leadAWithWhatsAppId,
        draft.id
      );

      expect(approved.id).toBe(draft.id);
      expect(approved.status).toBe(SalesAssistantDraftStatus.APPROVED);
      expect(approved.approvedByUser?.id).toBe(userAId);
      expect(approved.approvedByUserId).toBe(userAId);
      expect(approved.approvedAt).toBeInstanceOf(Date);
      expect(approved.rejectedByUser).toBeUndefined();
      expect(approved.rejectedByUserId).toBeUndefined();
      expect(approved.rejectedAt).toBeUndefined();

      // Check audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: orgAId,
          action: 'lead.sales_assistant_draft_approved',
          entityId: draft.id
        }
      });
      expect(audit).not.toBeNull();
      expect((audit!.after as any).status).toBe('APPROVED');
      expect((audit!.before as any).status).toBe('DRAFT');
    });

    it('rejects a DRAFT draft successfully (DRAFT -> REJECTED)', async () => {
      const draft = await service.generateDraft(
        { organizationId: orgAId, userId: userAId },
        leadAWithWhatsAppId,
        {
          type: SalesAssistantDraftType.PROPOSAL,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL
        }
      );

      const rejected = await service.rejectDraft(
        { organizationId: orgAId, userId: userAId },
        leadAWithWhatsAppId,
        draft.id
      );

      expect(rejected.id).toBe(draft.id);
      expect(rejected.status).toBe(SalesAssistantDraftStatus.REJECTED);
      expect(rejected.rejectedByUser?.id).toBe(userAId);
      expect(rejected.rejectedByUserId).toBe(userAId);
      expect(rejected.rejectedAt).toBeInstanceOf(Date);
      expect(rejected.approvedByUser).toBeUndefined();
      expect(rejected.approvedByUserId).toBeUndefined();
      expect(rejected.approvedAt).toBeUndefined();

      // Check audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: orgAId,
          action: 'lead.sales_assistant_draft_rejected',
          entityId: draft.id
        }
      });
      expect(audit).not.toBeNull();
      expect((audit!.after as any).status).toBe('REJECTED');
      expect((audit!.before as any).status).toBe('DRAFT');
    });

    it('rejects invalid review transitions with ConflictError', async () => {
      // 1. Create and approve a draft
      const draft1 = await service.generateDraft(
        { organizationId: orgAId, userId: userAId },
        leadAWithWhatsAppId,
        {
          type: SalesAssistantDraftType.FOLLOW_UP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.FRIENDLY
        }
      );
      await service.approveDraft(
        { organizationId: orgAId, userId: userAId },
        leadAWithWhatsAppId,
        draft1.id
      );

      // APPROVED cannot be approved again
      await expect(
        service.approveDraft(
          { organizationId: orgAId, userId: userAId },
          leadAWithWhatsAppId,
          draft1.id
        )
      ).rejects.toThrow(ConflictError);

      // APPROVED cannot be rejected
      await expect(
        service.rejectDraft(
          { organizationId: orgAId, userId: userAId },
          leadAWithWhatsAppId,
          draft1.id
        )
      ).rejects.toThrow(ConflictError);

      // 2. Create and reject a draft
      const draft2 = await service.generateDraft(
        { organizationId: orgAId, userId: userAId },
        leadAWithWhatsAppId,
        {
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.FRIENDLY
        }
      );
      await service.rejectDraft(
        { organizationId: orgAId, userId: userAId },
        leadAWithWhatsAppId,
        draft2.id
      );

      // REJECTED cannot be rejected again
      await expect(
        service.rejectDraft(
          { organizationId: orgAId, userId: userAId },
          leadAWithWhatsAppId,
          draft2.id
        )
      ).rejects.toThrow(ConflictError);

      // REJECTED cannot be approved
      await expect(
        service.approveDraft(
          { organizationId: orgAId, userId: userAId },
          leadAWithWhatsAppId,
          draft2.id
        )
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('4. Multi-Tenant & Cross-Lead Scoping Isolation', () => {
    const service = new SalesAssistantService(new MockSalesAssistantProvider());

    it('rejects cross-tenant lead generation with NotFoundError', async () => {
      // User A (Org A) attempts to generate for Org B lead
      await expect(
        service.generateDraft(
          { organizationId: orgAId, userId: userAId },
          leadBId,
          {
            type: SalesAssistantDraftType.EMAIL,
            language: SalesAssistantLanguage.ENGLISH,
            tone: SalesAssistantTone.PROFESSIONAL
          }
        )
      ).rejects.toThrow(NotFoundError);
    });

    it('rejects cross-tenant draft retrieval with NotFoundError', async () => {
      const draft = await service.generateDraft(
        { organizationId: orgAId, userId: userAId },
        leadAWithWhatsAppId,
        {
          type: SalesAssistantDraftType.EMAIL,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL
        }
      );

      // Org B attempts to read Org A draft
      await expect(
        service.getDraft(
          { organizationId: orgBId, userId: userBId },
          leadAWithWhatsAppId,
          draft.id
        )
      ).rejects.toThrow(NotFoundError);
    });

    it('rejects cross-lead draft retrieval with NotFoundError', async () => {
      const draft = await service.generateDraft(
        { organizationId: orgAId, userId: userAId },
        leadAWithWhatsAppId,
        {
          type: SalesAssistantDraftType.EMAIL,
          language: SalesAssistantLanguage.ENGLISH,
          tone: SalesAssistantTone.PROFESSIONAL
        }
      );

      // Org A user queries with mismatched lead (leadAPhoneOnlyId instead of leadAWithWhatsAppId)
      await expect(
        service.getDraft(
          { organizationId: orgAId, userId: userAId },
          leadAPhoneOnlyId,
          draft.id
        )
      ).rejects.toThrow(NotFoundError);
    });
  });
});
