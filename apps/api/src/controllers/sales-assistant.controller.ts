/**
 * AI Sales Assistant Controller
 *
 * Exposes endpoints for:
 * - POST /api/v1/leads/:id/sales-assistant/drafts (Generate new AI draft)
 * - GET  /api/v1/leads/:id/sales-assistant/drafts (List draft history for lead)
 * - GET  /api/v1/leads/:id/sales-assistant/drafts/:draftId (Get single draft detail)
 * - POST /api/v1/leads/:id/sales-assistant/drafts/:draftId/approve (Approve draft)
 * - POST /api/v1/leads/:id/sales-assistant/drafts/:draftId/reject (Reject draft)
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { generateSalesAssistantDraftRequestSchema } from '@leadmate/shared';
import { salesAssistantService } from '../services/sales-assistant.service.js';

const leadIdParamSchema = z.object({
  id: z.string().uuid('Invalid lead ID format')
});

const draftParamsSchema = z.object({
  id: z.string().uuid('Invalid lead ID format'),
  draftId: z.string().uuid('Invalid draft ID format')
});

export class SalesAssistantController {
  /**
   * POST /api/v1/leads/:id/sales-assistant/drafts
   */
  async generateDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = leadIdParamSchema.parse(req.params);
      const input = generateSalesAssistantDraftRequestSchema.parse(req.body);

      const result = await salesAssistantService.generateDraft(
        {
          organizationId: req.user!.organizationId,
          userId: req.user!.id,
          correlationId: String(req.id || 'unknown')
        },
        id,
        input
      );

      res.status(201).json({
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/leads/:id/sales-assistant/drafts
   */
  async listDrafts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = leadIdParamSchema.parse(req.params);

      const result = await salesAssistantService.listDrafts(
        {
          organizationId: req.user!.organizationId,
          userId: req.user!.id,
          correlationId: String(req.id || 'unknown')
        },
        id
      );

      res.status(200).json({
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/leads/:id/sales-assistant/drafts/:draftId
   */
  async getDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id, draftId } = draftParamsSchema.parse(req.params);

      const result = await salesAssistantService.getDraft(
        {
          organizationId: req.user!.organizationId,
          userId: req.user!.id,
          correlationId: String(req.id || 'unknown')
        },
        id,
        draftId
      );

      res.status(200).json({
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/leads/:id/sales-assistant/drafts/:draftId/approve
   */
  async approveDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id, draftId } = draftParamsSchema.parse(req.params);

      const result = await salesAssistantService.approveDraft(
        {
          organizationId: req.user!.organizationId,
          userId: req.user!.id,
          correlationId: String(req.id || 'unknown')
        },
        id,
        draftId
      );

      res.status(200).json({
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/leads/:id/sales-assistant/drafts/:draftId/reject
   */
  async rejectDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id, draftId } = draftParamsSchema.parse(req.params);

      const result = await salesAssistantService.rejectDraft(
        {
          organizationId: req.user!.organizationId,
          userId: req.user!.id,
          correlationId: String(req.id || 'unknown')
        },
        id,
        draftId
      );

      res.status(200).json({
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
}

export const salesAssistantController = new SalesAssistantController();
