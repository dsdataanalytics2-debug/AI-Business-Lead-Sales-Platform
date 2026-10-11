/**
 * Business Search Routes
 *
 * Exposes GET /api/v1/business-search, POST /api/v1/business-search/save-lead,
 * and /api/v1/business-search/history endpoints
 * protected by session authentication and granular RBAC permissions.
 */

import { Router } from 'express';
import { Permissions } from '@leadmate/shared';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { businessSearchController } from '../controllers/business-search.controller.js';

export const businessSearchRouter = Router();

// GET /api/v1/business-search -> Read-only business search preview
businessSearchRouter.get(
  '/',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  businessSearchController.search
);

// POST /api/v1/business-search/save-lead -> Trusted server-side lead persistence
businessSearchRouter.post(
  '/save-lead',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  businessSearchController.saveLead
);

// GET /api/v1/business-search/history -> List recent search sessions
businessSearchRouter.get(
  '/history',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  businessSearchController.getHistory
);

// GET /api/v1/business-search/history/latest -> Get latest search session
businessSearchRouter.get(
  '/history/latest',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  businessSearchController.getLatestSession
);

// GET /api/v1/business-search/history/:id -> Get specific search session
businessSearchRouter.get(
  '/history/:id',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  businessSearchController.getSession
);

// POST /api/v1/business-search/history -> Save / deduplicate search session
businessSearchRouter.post(
  '/history',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  businessSearchController.saveSession
);

// DELETE /api/v1/business-search/history -> Clear all user search history
businessSearchRouter.delete(
  '/history',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  businessSearchController.clearHistory
);

// DELETE /api/v1/business-search/history/:id -> Delete single search session
businessSearchRouter.delete(
  '/history/:id',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  businessSearchController.deleteSession
);
