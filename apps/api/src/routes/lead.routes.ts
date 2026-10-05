/**
 * Master Lead Database Routes
 *
 * Exposes:
 * - GET /api/v1/leads
 * - GET /api/v1/leads/:id
 * - PATCH /api/v1/leads/:id
 * - POST /api/v1/leads/:id/contacts
 * - GET /api/v1/leads/:id/analysis
 * - POST /api/v1/leads/:id/analyze
 */

import { Router } from 'express';
import { Permissions } from '@leadmate/shared';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { analyzeRateLimiter, salesAssistantRateLimiter } from '../middleware/rate-limiter.js';
import { leadController } from '../controllers/lead.controller.js';
import { onlinePresenceController } from '../controllers/online-presence.controller.js';
import { followUpController } from '../controllers/follow-up.controller.js';
import { demoWebsiteController } from '../controllers/demo-website.controller.js';
import { salesAssistantController } from '../controllers/sales-assistant.controller.js';
import { outreachController } from '../controllers/outreach.controller.js';

export const leadRouter = Router();

// GET /api/v1/leads -> List leads with cursor pagination & filters
leadRouter.get(
  '/',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  leadController.listLeads
);

// GET /api/v1/leads/:id/analysis -> Get lead online presence analysis
leadRouter.get(
  '/:id/analysis',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  onlinePresenceController.getAnalysis
);

// POST /api/v1/leads/:id/analyze -> Trigger lead online presence analysis
leadRouter.post(
  '/:id/analyze',
  requireAuth,
  analyzeRateLimiter,
  requirePermission(Permissions.LEADS_WRITE),
  onlinePresenceController.analyzeLead
);

// GET /api/v1/leads/assignees -> List active users for lead assignment
leadRouter.get(
  '/assignees',
  requireAuth,
  requirePermission(Permissions.LEADS_ASSIGN),
  leadController.listAssignees
);

// GET /api/v1/leads/:id -> Full lead detail
leadRouter.get(
  '/:id',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  leadController.getLead
);

// POST /api/v1/leads/:id/demo -> Request / generate demo website
leadRouter.post(
  '/:id/demo',
  requireAuth,
  requirePermission(Permissions.DEMOS_GENERATE),
  demoWebsiteController.requestDemo
);

// GET /api/v1/leads/:id/demo -> Get current demo website summary
leadRouter.get(
  '/:id/demo',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  demoWebsiteController.getDemo
);

// POST /api/v1/leads/:id/demo/regenerate -> Regenerate demo website
leadRouter.post(
  '/:id/demo/regenerate',
  requireAuth,
  requirePermission(Permissions.DEMOS_GENERATE),
  demoWebsiteController.regenerateDemo
);

// POST /api/v1/leads/:id/demo/expire -> Expire demo website
leadRouter.post(
  '/:id/demo/expire',
  requireAuth,
  requirePermission(Permissions.DEMOS_MANAGE),
  demoWebsiteController.expireDemo
);

// POST /api/v1/leads/:id/demo/remove -> Remove / unpublish demo website
leadRouter.post(
  '/:id/demo/remove',
  requireAuth,
  requirePermission(Permissions.DEMOS_MANAGE),
  demoWebsiteController.removeDemo
);

// PATCH /api/v1/leads/:id/assignment -> Assign/reassign/unassign lead
leadRouter.patch(
  '/:id/assignment',
  requireAuth,
  requirePermission(Permissions.LEADS_ASSIGN),
  leadController.updateAssignment
);

// PATCH /api/v1/leads/:id/crm-stage -> Update lead CRM pipeline stage
leadRouter.patch(
  '/:id/crm-stage',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  leadController.updateCrmStage
);

// GET /api/v1/leads/:id/notes -> List CRM notes for lead
leadRouter.get(
  '/:id/notes',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  leadController.listNotes
);

// POST /api/v1/leads/:id/notes -> Add CRM note to lead
leadRouter.post(
  '/:id/notes',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  leadController.addNote
);

// GET /api/v1/leads/:id/activities -> Get CRM activity timeline for lead
leadRouter.get(
  '/:id/activities',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  leadController.listActivities
);

// PATCH /api/v1/leads/:id -> Update lead scalar attributes
leadRouter.patch(
  '/:id',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  leadController.updateLead
);

// POST /api/v1/leads/:id/contacts -> Add manual direct contact
leadRouter.post(
  '/:id/contacts',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  leadController.addContact
);

// POST /api/v1/leads/:id/follow-ups -> Create follow-up task
leadRouter.post(
  '/:id/follow-ups',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  followUpController.createFollowUp
);

// GET /api/v1/leads/:id/follow-ups -> List follow-up tasks for lead
leadRouter.get(
  '/:id/follow-ups',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  followUpController.listFollowUps
);

// PATCH /api/v1/leads/:id/follow-ups/:followUpId -> Update follow-up task
leadRouter.patch(
  '/:id/follow-ups/:followUpId',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  followUpController.updateFollowUp
);

// POST /api/v1/leads/:id/follow-ups/:followUpId/complete -> Mark follow-up as completed
leadRouter.post(
  '/:id/follow-ups/:followUpId/complete',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  followUpController.completeFollowUp
);

// POST /api/v1/leads/:id/follow-ups/:followUpId/cancel -> Mark follow-up as cancelled
leadRouter.post(
  '/:id/follow-ups/:followUpId/cancel',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  followUpController.cancelFollowUp
);

// POST /api/v1/leads/:id/sales-assistant/drafts -> Generate sales assistant draft
leadRouter.post(
  '/:id/sales-assistant/drafts',
  requireAuth,
  salesAssistantRateLimiter,
  requirePermission(Permissions.SALES_ASSISTANT_GENERATE),
  salesAssistantController.generateDraft
);

// GET /api/v1/leads/:id/sales-assistant/drafts -> List sales assistant drafts for lead
leadRouter.get(
  '/:id/sales-assistant/drafts',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  salesAssistantController.listDrafts
);

// GET /api/v1/leads/:id/sales-assistant/drafts/:draftId -> Get sales assistant draft detail
leadRouter.get(
  '/:id/sales-assistant/drafts/:draftId',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  salesAssistantController.getDraft
);

// POST /api/v1/leads/:id/sales-assistant/drafts/:draftId/approve -> Approve sales assistant draft
leadRouter.post(
  '/:id/sales-assistant/drafts/:draftId/approve',
  requireAuth,
  requirePermission(Permissions.SALES_ASSISTANT_REVIEW),
  salesAssistantController.approveDraft
);

// POST /api/v1/leads/:id/sales-assistant/drafts/:draftId/reject -> Reject sales assistant draft
leadRouter.post(
  '/:id/sales-assistant/drafts/:draftId/reject',
  requireAuth,
  requirePermission(Permissions.SALES_ASSISTANT_REVIEW),
  salesAssistantController.rejectDraft
);

// POST /api/v1/leads/:id/outreach/deliveries -> Dispatch approved sales draft delivery
leadRouter.post(
  '/:id/outreach/deliveries',
  requireAuth,
  requirePermission(Permissions.OUTREACH_SEND),
  outreachController.requestDelivery
);

// GET /api/v1/leads/:id/outreach/deliveries -> List outreach deliveries for lead
leadRouter.get(
  '/:id/outreach/deliveries',
  requireAuth,
  requirePermission(Permissions.OUTREACH_READ),
  outreachController.listDeliveries
);

// GET /api/v1/leads/:id/outreach/deliveries/:deliveryId -> Get single outreach delivery detail
leadRouter.get(
  '/:id/outreach/deliveries/:deliveryId',
  requireAuth,
  requirePermission(Permissions.OUTREACH_READ),
  outreachController.getDelivery
);
