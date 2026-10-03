/**
 * Master Lead Database Controller
 *
 * Exposes endpoints for:
 * - GET /api/v1/leads (List leads with cursor pagination & filters)
 * - GET /api/v1/leads/:id (Get full lead detail with relations)
 * - PATCH /api/v1/leads/:id (Update lead attributes)
 * - POST /api/v1/leads/:id/contacts (Add manual contact)
 */

import { Request, Response, NextFunction } from 'express';
import {
  leadListQuerySchema,
  leadUpdateRequestSchema,
  manualContactRequestSchema,
  leadAssignmentRequestSchema,
  crmStageUpdateRequestSchema,
  crmNoteRequestSchema
} from '@leadmate/shared';
import { leadService } from '../services/lead.service.js';

export class LeadController {
  /**
   * PATCH /api/v1/leads/:id/assignment
   */
  async updateAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const input = leadAssignmentRequestSchema.parse(req.body);

      const result = await leadService.updateAssignment(id, input, {
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
   * GET /api/v1/leads
   */
  async listLeads(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = leadListQuerySchema.parse(req.query);

      const result = await leadService.listLeads(query, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({
        data: result.data,
        meta: {
          nextCursor: result.nextCursor,
          total: result.total,
          hasMore: result.nextCursor !== null
        }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/leads/:id
   */
  async getLead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const lead = await leadService.getLeadById(id, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({
        data: lead
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/leads/:id
   */
  async updateLead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const input = leadUpdateRequestSchema.parse(req.body);

      const updated = await leadService.updateLead(id, input, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({
        data: updated
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/leads/:id/contacts
   */
  async addContact(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const input = manualContactRequestSchema.parse(req.body);

      const contact = await leadService.addManualContact(id, input, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(201).json({
        data: contact
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/leads/:id/crm-stage
   */
  async updateCrmStage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const input = crmStageUpdateRequestSchema.parse(req.body);

      const result = await leadService.updateCrmStage(id, input, {
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
   * POST /api/v1/leads/:id/notes
   */
  async addNote(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const input = crmNoteRequestSchema.parse(req.body);

      const note = await leadService.addCrmNote(id, input, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(201).json({
        data: note
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/leads/:id/notes
   */
  async listNotes(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const notes = await leadService.listCrmNotes(id, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({
        data: notes
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/leads/:id/activities
   */
  async listActivities(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const activities = await leadService.listCrmActivities(id, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({
        data: activities
      });
    } catch (err) {
      next(err);
    }
  }
}

export const leadController = new LeadController();
