/**
 * AI Buyer Discovery Controller
 *
 * Exposes endpoints for buyer target suggestions and buyer fit explanations.
 */

import { Request, Response, NextFunction } from 'express';
import {
  suggestBuyerTargetsRequestSchema,
  explainBuyerFitRequestSchema
} from '@leadmate/shared';
import { aiBuyerDiscoveryService } from '../services/ai-buyer-discovery.service.js';

export class AiBuyerDiscoveryController {
  async suggestBuyerTargets(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = suggestBuyerTargetsRequestSchema.parse(req.body);
      const result = await aiBuyerDiscoveryService.suggestBuyerTargets(input, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async explainBuyerFit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = explainBuyerFitRequestSchema.parse(req.body);
      const result = await aiBuyerDiscoveryService.explainBuyerFit(input, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const aiBuyerDiscoveryController = new AiBuyerDiscoveryController();
