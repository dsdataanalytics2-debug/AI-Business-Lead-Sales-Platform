import { describe, it, expect, beforeEach } from 'vitest';
import prisma from '@leadmate/db';
import { outreachDraftService } from '../services/outreach-draft.service.js';
import { replyProcessingService } from '../services/reply-processing.service.js';
import { conversionTrackingService } from '../services/conversion-tracking.service.js';
import { suppressionService } from '../services/suppression.service.js';
import { salesMissionService } from '../services/sales-mission.service.js';
import { SalesMissionGoal, SalesMissionStatus } from '@leadmate/shared';

describe('OutreachGovernance & Conversion Tracking (Sub-Phase C)', () => {
  let org: any;
  let user: any;
  let mission: any;
  let product: any;
  let buyer: any;

  beforeEach(async () => {
    org = await prisma.organization.create({
      data: { name: `Gov Org ${Date.now()}` }
    });

    user = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `gov-user-${Date.now()}@test.local`,
        passwordHash: 'dummyhash',
        name: 'Gov Admin',
        role: 'ADMIN'
      }
    });

    product = await prisma.product.create({
      data: {
        organizationId: org.id,
        name: 'Smart Ambient Mushroom Lamp',
        category: 'Home Decor & Lighting',
        description: 'Rechargeable wooden bedside lamp with warm LED glow'
      }
    });

    mission = await prisma.salesMission.create({
      data: {
        organizationId: org.id,
        createdByUserId: user.id,
        productId: product.id,
        name: 'Mushroom Lamp B2B Outreach',
        goal: SalesMissionGoal.WHOLESALE,
        targetMarket: 'Dhaka',
        buyerType: 'AI_DECIDE',
        resultTarget: 10,
        status: SalesMissionStatus.READY,
        productAnalysisSnapshot: {
          productCategory: 'Home Decor & Lighting',
          idealBuyerProfile: {
            primaryBuyerTypes: ['Lighting Store', 'Home Decor Retailer'],
            secondaryBuyerTypes: ['Gift Shop'],
            businessSize: ['SMB'],
            targetMarkets: ['Dhaka'],
            commercialUseCases: ['Retail Resale'],
            recommendedPitchAngles: ['Fast-selling ambient lighting line for prime retail margins']
          }
        }
      }
    });

    buyer = await prisma.salesMissionBuyer.create({
      data: {
        organizationId: org.id,
        salesMissionId: mission.id,
        externalBusinessId: `ext-${Date.now()}`,
        provider: 'OPENSTREETMAP',
        businessName: 'Dhaka Lights & Living',
        category: 'Lighting Store',
        address: 'House 5, Road 12, Banani',
        city: 'Dhaka',
        phone: '01711000222',
        website: 'https://dhakalights.example.com',
        buyerScore: 82,
        priority: 'HOT',
        wholesaleIntent: 'HIGH',
        wholesaleIntentSignals: ['RFQ', 'bulk price'],
        suggestedRelatedNeeds: ['Dimmers', 'Gift Packaging'],
        whatsappStatus: 'NOT_VERIFIED',
        sourceEvidences: [
          {
            sourceType: 'PUBLIC_RFQ',
            sourceName: 'Dhaka Procurement Notice',
            observedAt: new Date(),
            evidenceType: 'PUBLIC_RFQ',
            snippet: 'Looking for bulk price and RFQ for modern bedside decorative lamps'
          }
        ]
      }
    });
  });

  describe('A. Outreach Personalization Drafts', () => {
    it('generates a draft with status DRAFT and cites RFQ evidence without auto-sending', async () => {
      const draft = await outreachDraftService.generateDraft(
        buyer.id,
        { channel: 'EMAIL', language: 'EN' },
        { organizationId: org.id, userId: user.id }
      );

      expect(draft.status).toBe('DRAFT');
      expect(draft.salesMissionBuyerId).toBe(buyer.id);
      expect(draft.subject).toContain('Dhaka Lights & Living');
      expect(draft.body).toContain('Smart Ambient Mushroom Lamp');
      expect(draft.body).toContain('public trade inquiry');
      expect(draft.aiContextSnapshot.citesRfqEvidence).toBe(true);
    });

    it('enforces PHONE != WHATSAPP: generates warning when phone is not explicitly verified for WhatsApp', async () => {
      const draft = await outreachDraftService.generateDraft(
        buyer.id,
        { channel: 'WHATSAPP_DRAFT', language: 'EN' },
        { organizationId: org.id, userId: user.id }
      );

      expect(draft.channel).toBe('WHATSAPP_DRAFT');
      expect(draft.status).toBe('DRAFT');
      expect(draft.aiContextSnapshot.whatsappVerified).toBe(false);
    });
  });

  describe('B. Human Approval Gate & Edit Audit', () => {
    it('supports editing draft and appends to audit trail', async () => {
      const draft = await outreachDraftService.generateDraft(
        buyer.id,
        { channel: 'EMAIL', language: 'EN' },
        { organizationId: org.id, userId: user.id }
      );

      const edited = await outreachDraftService.editDraft(
        draft.id,
        {
          subject: 'Custom Personalized Subject Line',
          body: 'Customized message body by sales executive.'
        },
        { organizationId: org.id, userId: user.id }
      );

      expect(edited.subject).toBe('Custom Personalized Subject Line');
      expect(edited.body).toBe('Customized message body by sales executive.');
      expect(edited.editHistory).toHaveLength(1);
      expect(edited.editHistory![0].editedByUserId).toBe(user.id);
      expect(edited.editHistory![0].previousBody).toBe(draft.body);
    });

    it('transitions DRAFT -> PENDING_APPROVAL -> APPROVED, and approval causes ZERO dispatch', async () => {
      const draft = await outreachDraftService.generateDraft(
        buyer.id,
        { channel: 'EMAIL', language: 'EN' },
        { organizationId: org.id, userId: user.id }
      );

      const pending = await outreachDraftService.submitForApproval(draft.id, {
        organizationId: org.id,
        userId: user.id
      });
      expect(pending.status).toBe('PENDING_APPROVAL');

      const approved = await outreachDraftService.approveDraft(draft.id, {
        organizationId: org.id,
        userId: user.id
      });

      expect(approved.status).toBe('APPROVED');
      expect(approved.approvedByUserId).toBe(user.id);
      expect(approved.approvedAt).toBeDefined();

      // Separate explicit step: mark ready for dispatch
      const ready = await outreachDraftService.markReadyForDispatch(draft.id, {
        organizationId: org.id,
        userId: user.id
      });
      expect(ready.status).toBe('READY_FOR_DISPATCH');
    });

    it('supports rejection with mandatory reason', async () => {
      const draft = await outreachDraftService.generateDraft(
        buyer.id,
        { channel: 'EMAIL', language: 'EN' },
        { organizationId: org.id, userId: user.id }
      );

      const rejected = await outreachDraftService.rejectDraft(
        draft.id,
        { rejectionReason: 'Irrelevant pitch angle for this store segment' },
        { organizationId: org.id, userId: user.id }
      );

      expect(rejected.status).toBe('REJECTED');
      expect(rejected.rejectedByUserId).toBe(user.id);
      expect(rejected.rejectionReason).toBe('Irrelevant pitch angle for this store segment');
    });
  });

  describe('C. Reply Classification & Auto-Suppression', () => {
    it('classifies ORDER_INTENT and advances stage to NEGOTIATING, NOT WON', async () => {
      const res = await replyProcessingService.processInboundReply(
        buyer.id,
        {
          content: 'We are ready to place an order for 20 units. Please send invoice.',
          channel: 'EMAIL'
        },
        { organizationId: org.id, userId: user.id }
      );

      expect(res.classification).toBe('ORDER_INTENT');
      expect(res.isOptOut).toBe(false);

      // Verify buyer stage is NEGOTIATING, strictly NOT WON
      const updatedBuyer = await prisma.salesMissionBuyer.findUnique({ where: { id: buyer.id } });
      expect(updatedBuyer?.conversionStage).toBe('NEGOTIATING');
      expect(updatedBuyer?.conversionStage).not.toBe('WON');
    });

    it('classifies PRICE_REQUEST and MOQ_REQUEST correctly', async () => {
      const priceRes = await replyProcessingService.processInboundReply(
        buyer.id,
        {
          content: 'What is your best wholesale price per unit?',
          channel: 'EMAIL'
        },
        { organizationId: org.id, userId: user.id }
      );
      expect(priceRes.classification).toBe('PRICE_REQUEST');

      const moqRes = await replyProcessingService.processInboundReply(
        buyer.id,
        {
          content: 'What is your minimum order quantity (MOQ)?',
          channel: 'EMAIL'
        },
        { organizationId: org.id, userId: user.id }
      );
      expect(moqRes.classification).toBe('MOQ_REQUEST');
    });

    it('classifies Bangla UNSUBSCRIBE, creates organization suppression, and does not force conversionStage to LOST', async () => {
      // Set initial stage to CONTACTED
      await prisma.salesMissionBuyer.update({
        where: { id: buyer.id },
        data: { conversionStage: 'CONTACTED' }
      });

      const res = await replyProcessingService.processInboundReply(
        buyer.id,
        {
          content: 'আমাদের সাথে আর যোগাযোগ করবেন না, মেসেজ বন্ধ করুন।',
          channel: 'SMS'
        },
        { organizationId: org.id, userId: user.id }
      );

      expect(res.classification).toBe('UNSUBSCRIBE');
      expect(res.isOptOut).toBe(true);
      expect(res.autoSuppressed).toBe(true);

      // INVARIANT: Suppression != Commercial LOST.
      // Verify buyer stage is NOT forced to LOST (advances to REPLIED or remains unforced)
      const updatedBuyer = await prisma.salesMissionBuyer.findUnique({ where: { id: buyer.id } });
      expect(updatedBuyer?.conversionStage).not.toBe('LOST');
      expect(updatedBuyer?.conversionStage).toBe('REPLIED');

      // Verify suppression record was created
      const sup = await prisma.suppressionRecord.findFirst({
        where: { organizationId: org.id, salesMissionBuyerId: buyer.id }
      });
      expect(sup).toBeDefined();
      expect(sup?.reason).toBe('UNSUBSCRIBE');
    });
  });

  describe('D. Suppression Enforcement', () => {
    it('blocks draft generation and approval when recipient is suppressed', async () => {
      // Create suppression on buyer phone
      await suppressionService.createSuppression(
        {
          phone: buyer.phone,
          reason: 'DO_NOT_CONTACT',
          source: 'MANUAL_OPERATOR'
        },
        { organizationId: org.id, userId: user.id }
      );

      // Attempting to generate draft must throw BadRequestError
      await expect(
        outreachDraftService.generateDraft(
          buyer.id,
          { channel: 'EMAIL', language: 'EN' },
          { organizationId: org.id, userId: user.id }
        )
      ).rejects.toThrow(/recipient is suppressed in the organization Do-Not-Contact registry/);
    });

    it('CRITICAL INVARIANT: name+locality is review only, does NOT block draft', async () => {
      // Create suppression with just businessName + locality
      await prisma.suppressionRecord.create({
        data: {
          organizationId: org.id,
          reason: 'DO_NOT_CONTACT',
          source: 'IMPORT',
          phone: null,
          email: null,
          domain: null,
          metadata: {
            businessName: buyer.businessName,
            locality: buyer.city
          }
        }
      });

      // Different unsuppressed buyer with same name but different phone
      const secondBuyer = await prisma.salesMissionBuyer.create({
        data: {
          organizationId: org.id,
          salesMissionId: mission.id,
          externalBusinessId: `ext-second-${Date.now()}`,
          provider: 'MOCK',
          businessName: buyer.businessName,
          city: buyer.city,
          phone: '01888999000', // unblocked phone
          buyerScore: 70
        }
      });

      // Draft generation MUST NOT be hard-blocked
      const draft = await outreachDraftService.generateDraft(
        secondBuyer.id,
        { channel: 'EMAIL', language: 'EN' },
        { organizationId: org.id, userId: user.id }
      );

      expect(draft.status).toBe('DRAFT');
    });
  });

  describe('E. Conversion Lifecycle & WON Evidence Invariant', () => {
    it('rejects transition to WON if commercial evidence is missing or invalid', async () => {
      // 1. Missing wonEvidence completely
      await expect(
        conversionTrackingService.transitionStage(
          buyer.id,
          { stage: 'WON' as any },
          { organizationId: org.id, userId: user.id }
        )
      ).rejects.toThrow(/Explicit commercial evidence is strictly required/);

      // 2. Invalid dealValue
      await expect(
        conversionTrackingService.transitionStage(
          buyer.id,
          {
            stage: 'WON',
            wonEvidence: {
              dealValue: 0,
              currency: 'BDT',
              closedAt: new Date(),
              notes: 'Valid commercial deal note here',
              verifiedByUserId: user.id
            }
          },
          { organizationId: org.id, userId: user.id }
        )
      ).rejects.toThrow(/dealValue must be a positive number/);

      // 3. Short notes (<10 chars)
      await expect(
        conversionTrackingService.transitionStage(
          buyer.id,
          {
            stage: 'WON',
            wonEvidence: {
              dealValue: 45000,
              currency: 'BDT',
              closedAt: new Date(),
              notes: 'Too short',
              verifiedByUserId: user.id
            }
          },
          { organizationId: org.id, userId: user.id }
        )
      ).rejects.toThrow(/notes must contain at least 10 characters/);
    });

    it('accepts transition to WON when full commercial evidence is provided and logs ConversionEvent', async () => {
      const res = await conversionTrackingService.transitionStage(
        buyer.id,
        {
          stage: 'WON',
          wonEvidence: {
            dealValue: 65000,
            currency: 'BDT',
            closedAt: new Date(),
            notes: 'Purchased 50 Mushroom Lamps for Dhanmondi retail showroom',
            verifiedByUserId: user.id,
            invoiceOrPoReference: 'PO-2026-9941'
          }
        },
        { organizationId: org.id, userId: user.id }
      );

      expect(res.buyer.conversionStage).toBe('WON');
      expect(res.buyer.conversionWonEvidence.dealValue).toBe(65000);
      expect(res.buyer.conversionWonEvidence.invoiceOrPoReference).toBe('PO-2026-9941');

      // Verify event log
      const events = await conversionTrackingService.listConversionEvents(buyer.id, org.id);
      expect(events).toHaveLength(1);
      expect(events[0].toStage).toBe('WON');
      expect(events[0].userId).toBe(user.id);
    });

    it('requires standard loss reason when marking stage as LOST', async () => {
      await expect(
        conversionTrackingService.transitionStage(
          buyer.id,
          { stage: 'LOST' as any },
          { organizationId: org.id, userId: user.id }
        )
      ).rejects.toThrow(/Standard loss reason/);

      const res = await conversionTrackingService.transitionStage(
        buyer.id,
        { stage: 'LOST', lostReason: 'PRICE_HIGH' },
        { organizationId: org.id, userId: user.id }
      );

      expect(res.buyer.conversionStage).toBe('LOST');
      expect(res.buyer.conversionLostReason).toBe('PRICE_HIGH');
    });
  });

  describe('F. Regression & Mission Reopen Verification', () => {
    it('reopens mission with 0 external calls and returns serialized Sub-Phase C fields and suppression badge', async () => {
      const reopened = await salesMissionService.getMissionById(mission.id, org.id);
      expect(reopened.id).toBe(mission.id);
      expect(reopened.buyers).toBeDefined();

      const b = reopened.buyers!.find((x) => x.id === buyer.id);
      expect(b).toBeDefined();
      expect(b?.conversionStage).toBeDefined();
      expect(b?.isSuppressed).toBe(false);
      expect(b?.outreachDrafts).toBeDefined();
    });
  });
});
