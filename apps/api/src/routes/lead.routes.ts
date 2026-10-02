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
import { analyzeRateLimiter } from '../middleware/rate-limiter.js';
import { leadController } from '../controllers/lead.controller.js';
import { onlinePresenceController } from '../controllers/online-presence.controller.js';

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

// GET /api/v1/leads/:id -> Full lead detail
leadRouter.get(
  '/:id',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  leadController.getLead
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
