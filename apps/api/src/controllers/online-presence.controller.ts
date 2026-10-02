/**
 * Online Presence Analysis Controller
 *
 * Exposes endpoints for:
 * - POST /api/v1/leads/:id/analyze (Trigger online presence analysis)
 * - GET /api/v1/leads/:id/analysis (Get current online presence analysis)
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { onlinePresenceService } from '../services/online-presence.service.js';

const leadIdParamSchema = z.object({
  id: z.string().uuid('Invalid lead ID format')
});

const emptyBodySchema = z.object({}).strict();

export class OnlinePresenceController {
  /**
   * POST /api/v1/leads/:id/analyze
   */
  async analyzeLead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = leadIdParamSchema.parse(req.params);

      // Enforce strict trust boundary: Client cannot provide any authoritative payload fields
      if (req.body !== undefined && req.body !== null && typeof req.body === 'object') {
        emptyBodySchema.parse(req.body);
      }

      const result = await onlinePresenceService.analyzeLead(id, {
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
   * GET /api/v1/leads/:id/analysis
   */
  async getAnalysis(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = leadIdParamSchema.parse(req.params);

      const result = await onlinePresenceService.getLeadAnalysis(id, {
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

export const onlinePresenceController = new OnlinePresenceController();
