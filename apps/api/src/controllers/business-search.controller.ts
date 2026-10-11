/**
 * Business Search Controller
 *
 * Exposes endpoints for business search preview, trusted server-side lead persistence,
 * and search session history persistence.
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  businessSearchQuerySchema,
  saveLeadRequestSchema,
  createBusinessSearchSessionSchema,
  DuplicateAction
} from '@leadmate/shared';
import { businessSearchService } from '../services/business-search.service.js';
import { businessSearchHistoryService } from '../services/business-search-history.service.js';

export class BusinessSearchController {
  /**
   * GET /api/v1/business-search
   *
   * Preview-only business search across registered datasource providers.
   * Does NOT write to database.
   */
  async search(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = businessSearchQuerySchema.parse(req.query);

      const results = await businessSearchService.search(query, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      const buyerTargetsUsed = results
        .map((r) => r.matchedBuyerCategory)
        .filter((c, i, a): c is string => Boolean(c) && a.indexOf(c) === i);

      res.status(200).json({
        data: results,
        meta: {
          count: results.length,
          provider: query.provider || (process.env.NODE_ENV === 'test' ? 'MOCK' : 'AUTO'),
          q: query.q,
          location: query.location,
          buyerTargetsUsed
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

  /**
   * GET /api/v1/business-search/history
   *
   * Returns recent searches list (max 20 per user, newest first).
   */
  async getHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 20;
      const history = await businessSearchHistoryService.listHistory(
        {
          organizationId: req.user!.organizationId,
          userId: req.user!.id
        },
        limit
      );

      res.status(200).json({
        data: history
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/business-search/history/latest
   *
   * Returns the most recent search session with its saved results snapshot.
   */
  async getLatestSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const latest = await businessSearchHistoryService.getLatestSession({
        organizationId: req.user!.organizationId,
        userId: req.user!.id
      });

      res.status(200).json({
        data: latest
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/business-search/history/:id
   *
   * Returns a specific search session and its saved results snapshot.
   */
  async getSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = await businessSearchHistoryService.getSession(
        {
          organizationId: req.user!.organizationId,
          userId: req.user!.id
        },
        req.params.id
      );

      res.status(200).json({
        data: session
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/business-search/history
   *
   * Saves or updates a search session with its result snapshot.
   */
  async saveSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createBusinessSearchSessionSchema.parse(req.body);

      const session = await businessSearchHistoryService.saveSession(
        {
          organizationId: req.user!.organizationId,
          userId: req.user!.id
        },
        input
      );

      res.status(201).json({
        data: session
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/business-search/history/:id
   *
   * Deletes a single search session.
   */
  async deleteSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await businessSearchHistoryService.deleteSession(
        {
          organizationId: req.user!.organizationId,
          userId: req.user!.id
        },
        req.params.id
      );

      res.status(200).json({
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/business-search/history
   *
   * Clears all search history for current user.
   */
  async clearHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await businessSearchHistoryService.clearHistory({
        organizationId: req.user!.organizationId,
        userId: req.user!.id
      });

      res.status(200).json({
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
}

export const businessSearchController = new BusinessSearchController();
