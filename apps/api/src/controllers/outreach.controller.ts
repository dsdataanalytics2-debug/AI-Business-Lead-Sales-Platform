/**
 * Automated Outreach & Delivery Controller
 *
 * Exposes endpoints for:
 * - POST /api/v1/leads/:id/outreach (Dispatch approved sales draft delivery)
 * - GET  /api/v1/leads/:id/outreach (List delivery history for lead)
 * - GET  /api/v1/leads/:id/outreach/:deliveryId (Get single delivery detail)
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  sendOutreachDeliveryRequestSchema,
  listOutreachDeliveriesQuerySchema,
  outreachIdempotencyKeySchema,
  Role
} from '@leadmate/shared';
import { outreachService } from '../services/outreach.service.js';

const leadIdParamSchema = z.object({
  id: z.string().uuid('Invalid lead ID format')
});

const deliveryParamsSchema = z.object({
  id: z.string().uuid('Invalid lead ID format'),
  deliveryId: z.string().uuid('Invalid delivery ID format')
});

export class OutreachController {
  /**
   * POST /api/v1/leads/:id/outreach
   *
   * Dispatches an approved sales assistant draft.
   * Requires mandatory `Idempotency-Key` HTTP header.
   */
  async requestDelivery(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = leadIdParamSchema.parse(req.params);

      // Extract and validate Idempotency-Key header
      const rawKey = req.header('idempotency-key');
      const idempotencyKey = outreachIdempotencyKeySchema.parse(rawKey);

      // Validate strict request body
      const input = sendOutreachDeliveryRequestSchema.parse(req.body);

      const result = await outreachService.requestDelivery(
        {
          organizationId: req.user!.organizationId,
          userId: req.user!.id,
          role: req.user!.role as Role,
          correlationId: String(req.id || 'unknown')
        },
        id,
        input,
        idempotencyKey
      );

      res.status(201).json({
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/leads/:id/outreach
   *
   * Lists outreach delivery history for a lead.
   */
  async listDeliveries(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = leadIdParamSchema.parse(req.params);
      const query = listOutreachDeliveriesQuerySchema.parse(req.query);

      const result = await outreachService.listDeliveries(
        {
          organizationId: req.user!.organizationId,
          userId: req.user!.id,
          role: req.user!.role as Role,
          correlationId: String(req.id || 'unknown')
        },
        id,
        query
      );

      res.status(200).json({
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/leads/:id/outreach/:deliveryId
   *
   * Retrieves single outreach delivery status.
   */
  async getDelivery(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id, deliveryId } = deliveryParamsSchema.parse(req.params);

      const result = await outreachService.getDelivery(
        {
          organizationId: req.user!.organizationId,
          userId: req.user!.id,
          role: req.user!.role as Role,
          correlationId: String(req.id || 'unknown')
        },
        id,
        deliveryId
      );

      res.status(200).json({
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/leads/:id/outreach/deliveries/:deliveryId/cancel
   *
   * Cancels a pending outreach delivery.
   */
  async cancelDelivery(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id, deliveryId } = deliveryParamsSchema.parse(req.params);

      const result = await outreachService.cancelDelivery(
        {
          organizationId: req.user!.organizationId,
          userId: req.user!.id,
          role: req.user!.role as Role,
          correlationId: String(req.id || 'unknown')
        },
        id,
        deliveryId
      );

      res.status(200).json({
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
}

export const outreachController = new OutreachController();
