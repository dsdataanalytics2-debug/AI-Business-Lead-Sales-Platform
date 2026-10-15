import prisma from '@leadmate/db';
import {
  type CreateOutreachDraftInput,
  type EditOutreachDraftInput,
  type RejectOutreachDraftInput,
  type OutreachDraftDto
} from '@leadmate/shared';
import { BadRequestError, NotFoundError, ForbiddenError } from '../lib/errors.js';
import { composePersonalizedOutreach } from '@leadmate/core';
import { suppressionService } from './suppression.service.js';

export interface OutreachRequestContext {
  organizationId: string;
  userId: string;
  correlationId?: string;
}

export class OutreachDraftService {
  /**
   * Generates a new personalized outreach draft for a buyer.
   * Enforces suppression checks prior to draft generation.
   */
  async generateDraft(
    salesMissionBuyerId: string,
    input: CreateOutreachDraftInput,
    context: OutreachRequestContext
  ): Promise<OutreachDraftDto> {
    const buyer = await prisma.salesMissionBuyer.findFirst({
      where: {
        id: salesMissionBuyerId,
        organizationId: context.organizationId
      },
      include: {
        salesMission: {
          include: {
            product: true
          }
        }
      }
    });

    if (!buyer) {
      throw new NotFoundError(`SalesMissionBuyer "${salesMissionBuyerId}" not found.`);
    }

    // 1. SUPPRESSION ENFORCEMENT: Check before draft generation
    const suppressionCheck = await suppressionService.checkBuyerSuppression(
      {
        id: buyer.id,
        phone: buyer.phone,
        email: (buyer.enrichedContacts as any[])?.find((c) => c.type === 'EMAIL')?.value || null,
        website: buyer.website,
        businessName: buyer.businessName,
        city: buyer.city
      },
      context.organizationId
    );

    if (suppressionCheck.isSuppressed) {
      throw new BadRequestError(
        `Cannot generate outreach draft: recipient is suppressed in the organization Do-Not-Contact registry (${suppressionCheck.reason || 'Suppressed'}).`
      );
    }

    const product = buyer.salesMission.product;
    const missionSnapshot = (buyer.salesMission.productAnalysisSnapshot as any) || {};

    // 2. Compose personalized draft using pure domain composer
    const composed = composePersonalizedOutreach({
      product: {
        name: product ? product.name : buyer.salesMission.name,
        description: product ? product.description : null,
        category: product?.category || missionSnapshot.productCategory || null,
        price: (product as any)?.price || null,
        moq: (product as any)?.moq || null
      },
      buyer: {
        id: buyer.id,
        businessName: buyer.businessName,
        category: buyer.category,
        address: buyer.address,
        city: buyer.city,
        phone: buyer.phone,
        website: buyer.website,
        wholesaleIntent: buyer.wholesaleIntent,
        wholesaleIntentSignals: buyer.wholesaleIntentSignals as any,
        suggestedRelatedNeeds: buyer.suggestedRelatedNeeds as any,
        sourceEvidences: buyer.sourceEvidences as any,
        enrichedContacts: buyer.enrichedContacts as any,
        whatsappStatus: buyer.whatsappStatus,
        buyerScore: buyer.buyerScore,
        priority: buyer.priority
      },
      idealBuyerProfile: missionSnapshot.idealBuyerProfile || null,
      channel: input.channel,
      language: input.language
    });

    // 3. Persist new draft with status = DRAFT
    const created = await prisma.outreachDraft.create({
      data: {
        organizationId: context.organizationId,
        salesMissionBuyerId: buyer.id,
        salesMissionId: buyer.salesMissionId,
        channel: composed.channel,
        status: 'DRAFT',
        subject: composed.subject,
        body: composed.body,
        language: composed.language,
        aiContextSnapshot: composed.aiContextSnapshot,
        editHistory: []
      }
    });

    return this.serializeDraft(created);
  }

  /**
   * Human Review: Edits subject or body of a draft and appends to audit trail.
   */
  async editDraft(
    draftId: string,
    input: EditOutreachDraftInput,
    context: OutreachRequestContext
  ): Promise<OutreachDraftDto> {
    const draft = await prisma.outreachDraft.findFirst({
      where: { id: draftId, organizationId: context.organizationId }
    });

    if (!draft) {
      throw new NotFoundError(`OutreachDraft "${draftId}" not found.`);
    }

    const currentHistory = Array.isArray(draft.editHistory) ? (draft.editHistory as any[]) : [];
    const newHistoryEntry = {
      editedByUserId: context.userId,
      editedAt: new Date().toISOString(),
      previousSubject: draft.subject,
      previousBody: draft.body
    };

    const updated = await prisma.outreachDraft.update({
      where: { id: draftId },
      data: {
        subject: input.subject !== undefined ? input.subject : draft.subject,
        body: input.body,
        editHistory: [...currentHistory, newHistoryEntry],
        // If draft was rejected, editing resets it to PENDING_APPROVAL
        status: draft.status === 'REJECTED' ? 'PENDING_APPROVAL' : draft.status
      }
    });

    return this.serializeDraft(updated);
  }

  /**
   * Human Review: Submits draft for approval.
   */
  async submitForApproval(
    draftId: string,
    context: OutreachRequestContext
  ): Promise<OutreachDraftDto> {
    const draft = await prisma.outreachDraft.findFirst({
      where: { id: draftId, organizationId: context.organizationId }
    });

    if (!draft) {
      throw new NotFoundError(`OutreachDraft "${draftId}" not found.`);
    }

    const updated = await prisma.outreachDraft.update({
      where: { id: draftId },
      data: { status: 'PENDING_APPROVAL' }
    });

    return this.serializeDraft(updated);
  }

  /**
   * Human Review: Approves draft.
   * INVARIANT: Approval != Dispatch. Causes ZERO external network calls or sends.
   */
  async approveDraft(
    draftId: string,
    context: OutreachRequestContext
  ): Promise<OutreachDraftDto> {
    const draft = await prisma.outreachDraft.findFirst({
      where: { id: draftId, organizationId: context.organizationId },
      include: { salesMissionBuyer: true }
    });

    if (!draft) {
      throw new NotFoundError(`OutreachDraft "${draftId}" not found.`);
    }

    // SUPPRESSION ENFORCEMENT: Check suppression again before approving
    const suppressionCheck = await suppressionService.checkBuyerSuppression(
      {
        id: draft.salesMissionBuyer.id,
        phone: draft.salesMissionBuyer.phone,
        website: draft.salesMissionBuyer.website,
        businessName: draft.salesMissionBuyer.businessName,
        city: draft.salesMissionBuyer.city
      },
      context.organizationId
    );

    if (suppressionCheck.isSuppressed) {
      throw new BadRequestError(
        `Cannot approve outreach draft: recipient is suppressed in the organization Do-Not-Contact registry (${suppressionCheck.reason || 'Suppressed'}).`
      );
    }

    const updated = await prisma.outreachDraft.update({
      where: { id: draftId },
      data: {
        status: 'APPROVED',
        approvedByUserId: context.userId,
        approvedAt: new Date()
      }
    });

    return this.serializeDraft(updated);
  }

  /**
   * Human Review: Rejects draft with mandatory rejection reason.
   */
  async rejectDraft(
    draftId: string,
    input: RejectOutreachDraftInput,
    context: OutreachRequestContext
  ): Promise<OutreachDraftDto> {
    const draft = await prisma.outreachDraft.findFirst({
      where: { id: draftId, organizationId: context.organizationId }
    });

    if (!draft) {
      throw new NotFoundError(`OutreachDraft "${draftId}" not found.`);
    }

    const updated = await prisma.outreachDraft.update({
      where: { id: draftId },
      data: {
        status: 'REJECTED',
        rejectedByUserId: context.userId,
        rejectedAt: new Date(),
        rejectionReason: input.rejectionReason
      }
    });

    return this.serializeDraft(updated);
  }

  /**
   * Marks draft as READY_FOR_DISPATCH (Explicit separate state before delivery).
   */
  async markReadyForDispatch(
    draftId: string,
    context: OutreachRequestContext
  ): Promise<OutreachDraftDto> {
    const draft = await prisma.outreachDraft.findFirst({
      where: { id: draftId, organizationId: context.organizationId },
      include: { salesMissionBuyer: true }
    });

    if (!draft) {
      throw new NotFoundError(`OutreachDraft "${draftId}" not found.`);
    }

    if (draft.status !== 'APPROVED') {
      throw new BadRequestError('Only APPROVED drafts can be marked as READY_FOR_DISPATCH.');
    }

    // SUPPRESSION ENFORCEMENT: Check before queueing/dispatching
    const suppressionCheck = await suppressionService.checkBuyerSuppression(
      {
        id: draft.salesMissionBuyer.id,
        phone: draft.salesMissionBuyer.phone,
        website: draft.salesMissionBuyer.website,
        businessName: draft.salesMissionBuyer.businessName,
        city: draft.salesMissionBuyer.city
      },
      context.organizationId
    );

    if (suppressionCheck.isSuppressed) {
      throw new BadRequestError(
        `Cannot mark ready for dispatch: recipient is suppressed in the organization Do-Not-Contact registry.`
      );
    }

    const updated = await prisma.outreachDraft.update({
      where: { id: draftId },
      data: { status: 'READY_FOR_DISPATCH' }
    });

    return this.serializeDraft(updated);
  }

  /**
   * Lists drafts for a buyer.
   */
  async listDraftsForBuyer(
    salesMissionBuyerId: string,
    organizationId: string
  ): Promise<OutreachDraftDto[]> {
    const drafts = await prisma.outreachDraft.findMany({
      where: { salesMissionBuyerId, organizationId },
      orderBy: { createdAt: 'desc' }
    });

    return drafts.map((d) => this.serializeDraft(d));
  }

  private serializeDraft(d: any): OutreachDraftDto {
    return {
      id: d.id,
      organizationId: d.organizationId,
      salesMissionBuyerId: d.salesMissionBuyerId,
      salesMissionId: d.salesMissionId,
      channel: d.channel,
      status: d.status,
      subject: d.subject || null,
      body: d.body,
      language: d.language || 'EN',
      aiContextSnapshot: d.aiContextSnapshot || null,
      editHistory: Array.isArray(d.editHistory) ? d.editHistory : [],
      approvedByUserId: d.approvedByUserId || null,
      approvedAt: d.approvedAt || null,
      rejectedByUserId: d.rejectedByUserId || null,
      rejectedAt: d.rejectedAt || null,
      rejectionReason: d.rejectionReason || null,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt
    };
  }
}

export const outreachDraftService = new OutreachDraftService();
