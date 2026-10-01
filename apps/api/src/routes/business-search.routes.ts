/**
 * Business Search Routes
 *
 * Exposes GET /api/v1/business-search and POST /api/v1/business-search/save-lead
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
