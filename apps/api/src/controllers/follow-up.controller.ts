/**
 * Follow-Up Tasks Controller
 *
 * Exposes endpoints for:
 * - POST /api/v1/leads/:id/follow-ups (Create a follow-up task)
 * - GET  /api/v1/leads/:id/follow-ups (List follow-up tasks for lead)
 * - PATCH /api/v1/leads/:id/follow-ups/:followUpId (Update follow-up task)
 * - POST /api/v1/leads/:id/follow-ups/:followUpId/complete (Complete follow-up task)
 * - POST /api/v1/leads/:id/follow-ups/:followUpId/cancel (Cancel follow-up task)
 */

import { Request, Response, NextFunction } from 'express';
import {
  createFollowUpRequestSchema,
  updateFollowUpRequestSchema
} from '@leadmate/shared';
import { followUpService } from '../services/follow-up.service.js';

export class FollowUpController {
  /**
   * POST /api/v1/leads/:id/follow-ups
   */
  async createFollowUp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const input = createFollowUpRequestSchema.parse(req.body);

      const result = await followUpService.createFollowUp(id, input, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(201).json({
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/leads/:id/follow-ups
   */
  async listFollowUps(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const result = await followUpService.listFollowUps(id, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/leads/:id/follow-ups/:followUpId
   */
  async updateFollowUp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id, followUpId } = req.params;
      const input = updateFollowUpRequestSchema.parse(req.body);

      const result = await followUpService.updateFollowUp(id, followUpId, input, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/leads/:id/follow-ups/:followUpId/complete
   */
  async completeFollowUp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id, followUpId } = req.params;

      const result = await followUpService.completeFollowUp(id, followUpId, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/leads/:id/follow-ups/:followUpId/cancel
   */
  async cancelFollowUp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id, followUpId } = req.params;

      const result = await followUpService.cancelFollowUp(id, followUpId, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
}

export const followUpController = new FollowUpController();
