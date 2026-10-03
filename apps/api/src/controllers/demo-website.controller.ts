/**
 * Demo Website Controller
 *
 * Exposes endpoints for:
 * - POST /api/v1/leads/:id/demo (Request / generate demo website for lead)
 * - GET  /api/v1/leads/:id/demo (Get current demo website for lead)
 * - POST /api/v1/leads/:id/demo/regenerate (Regenerate demo website for lead)
 * - POST /api/v1/leads/:id/demo/expire (Expire demo website for lead)
 * - POST /api/v1/leads/:id/demo/remove (Remove / unpublish demo website for lead)
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createDemoWebsiteRequestSchema } from '@leadmate/shared';
import { demoWebsiteService } from '../services/demo-website.service.js';

const leadIdParamSchema = z.object({
  id: z.string().uuid('Invalid lead ID format')
});

const emptyBodySchema = z.object({}).strict();

export class DemoWebsiteController {
  /**
   * POST /api/v1/leads/:id/demo
   */
  async requestDemo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = leadIdParamSchema.parse(req.params);
      const input = createDemoWebsiteRequestSchema.parse(req.body || {});

      const result = await demoWebsiteService.requestDemoWebsite(
        {
          organizationId: req.user!.organizationId,
          userId: req.user!.id,
          correlationId: String(req.id || 'unknown')
        },
        id,
        input
      );

      res.status(200).json({
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/leads/:id/demo
   */
  async getDemo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = leadIdParamSchema.parse(req.params);

      const result = await demoWebsiteService.getDemoWebsite(
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
   * POST /api/v1/leads/:id/demo/regenerate
   */
  async regenerateDemo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = leadIdParamSchema.parse(req.params);
      const input = createDemoWebsiteRequestSchema.parse(req.body || {});

      const result = await demoWebsiteService.regenerateDemoWebsite(
        {
          organizationId: req.user!.organizationId,
          userId: req.user!.id,
          correlationId: String(req.id || 'unknown')
        },
        id,
        input
      );

      res.status(200).json({
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/leads/:id/demo/expire
   */
  async expireDemo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = leadIdParamSchema.parse(req.params);

      // Enforce strict trust boundary for empty body endpoint
      if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        emptyBodySchema.parse(req.body);
      }

      const result = await demoWebsiteService.expireDemoWebsite(
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
   * POST /api/v1/leads/:id/demo/remove
   */
  async removeDemo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = leadIdParamSchema.parse(req.params);

      // Enforce strict trust boundary for empty body endpoint
      if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
        emptyBodySchema.parse(req.body);
      }

      const result = await demoWebsiteService.removeDemoWebsite(
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
}

export const demoWebsiteController = new DemoWebsiteController();
