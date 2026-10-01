/**
 * Business Search Controller
 *
 * Exposes endpoints for business search preview and trusted server-side lead persistence.
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  businessSearchQuerySchema,
  saveLeadRequestSchema,
  DuplicateAction
} from '@leadmate/shared';
import { businessSearchService } from '../services/business-search.service.js';

// Extend business search query schema with optional provider parameter
const businessSearchApiQuerySchema = businessSearchQuerySchema.extend({
  provider: z.string().trim().min(1).max(100).optional()
});

export class BusinessSearchController {
  /**
   * GET /api/v1/business-search
   *
   * Preview-only business search across registered datasource providers.
   * Does NOT write to database.
   */
  async search(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = businessSearchApiQuerySchema.parse(req.query);

      const results = await businessSearchService.search(query, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({
        data: results,
        meta: {
          count: results.length,
          provider: query.provider || 'MOCK',
          q: query.q,
          location: query.location
        }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/business-search/save-lead
   *
   * Trusted server-side lead persistence from authoritative provider identity.
   * Client payload contains only { provider, externalId }.
   */
  async saveLead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = saveLeadRequestSchema.parse(req.body);

      const result = await businessSearchService.saveLead(input, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      const statusCode = result.action === DuplicateAction.CREATED ? 201 : 200;

      res.status(statusCode).json({
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
}

export const businessSearchController = new BusinessSearchController();
