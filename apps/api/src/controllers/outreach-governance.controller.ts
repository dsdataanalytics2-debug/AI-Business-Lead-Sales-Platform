import { Request, Response, NextFunction } from 'express';
import {
  createOutreachDraftInputSchema,
  editOutreachDraftInputSchema,
  rejectOutreachDraftInputSchema,
  processInboundReplyInputSchema,
  transitionStageInputSchema,
  createSuppressionInputSchema
} from '@leadmate/shared';
import { outreachDraftService } from '../services/outreach-draft.service.js';
import { replyProcessingService } from '../services/reply-processing.service.js';
import { conversionTrackingService } from '../services/conversion-tracking.service.js';
import { suppressionService } from '../services/suppression.service.js';

export class OutreachGovernanceController {
  // Generate Draft
  async generateDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { buyerId } = req.params;
      const input = createOutreachDraftInputSchema.parse(req.body);
      const draft = await outreachDraftService.generateDraft(buyerId, input, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(201).json({ data: draft });
    } catch (err) {
      next(err);
    }
  }

  // List Drafts for Buyer
  async listDrafts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { buyerId } = req.params;
      const drafts = await outreachDraftService.listDraftsForBuyer(
        buyerId,
        req.user!.organizationId
      );

      res.status(200).json({ data: drafts });
    } catch (err) {
      next(err);
    }
  }

  // Edit Draft
  async editDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { draftId } = req.params;
      const input = editOutreachDraftInputSchema.parse(req.body);
      const updated = await outreachDraftService.editDraft(draftId, input, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  }

  // Submit for Approval
  async submitForApproval(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { draftId } = req.params;
      const updated = await outreachDraftService.submitForApproval(draftId, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  }

  // Approve Draft
  async approveDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { draftId } = req.params;
      const updated = await outreachDraftService.approveDraft(draftId, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  }

  // Reject Draft
  async rejectDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { draftId } = req.params;
      const input = rejectOutreachDraftInputSchema.parse(req.body);
      const updated = await outreachDraftService.rejectDraft(draftId, input, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  }

  // Mark Ready for Dispatch (Approval != Dispatch)
  async markReadyForDispatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { draftId } = req.params;
      const updated = await outreachDraftService.markReadyForDispatch(draftId, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  }

  // Ingest / Process Inbound Reply
  async processReply(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { buyerId } = req.params;
      const input = processInboundReplyInputSchema.parse(req.body);
      const result = await replyProcessingService.processInboundReply(buyerId, input, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  }

  // List Buyer Interactions
  async listInteractions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { buyerId } = req.params;
      const list = await replyProcessingService.listInteractionsForBuyer(
        buyerId,
        req.user!.organizationId
      );

      res.status(200).json({ data: list });
    } catch (err) {
      next(err);
    }
  }

  // Transition Conversion Stage (WON requires evidence, LOST requires reason)
  async transitionConversionStage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { buyerId } = req.params;
      const input = transitionStageInputSchema.parse(req.body);
      const result = await conversionTrackingService.transitionStage(buyerId, input, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  }

  // Suppress Buyer (Manual operator action)
  async suppressBuyer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { buyerId } = req.params;
      const input = createSuppressionInputSchema.parse({
        ...req.body,
        salesMissionBuyerId: buyerId
      });

      const suppression = await suppressionService.createSuppression(input, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(201).json({ data: suppression });
    } catch (err) {
      next(err);
    }
  }
}

export const outreachGovernanceController = new OutreachGovernanceController();
