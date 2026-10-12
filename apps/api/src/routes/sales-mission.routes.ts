import { Router } from 'express';
import { Permissions } from '@leadmate/shared';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { salesMissionController } from '../controllers/sales-mission.controller.js';

export const salesMissionRouter = Router();

// GET /api/v1/sales-missions -> List missions
salesMissionRouter.get(
  '/',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  salesMissionController.list
);

// POST /api/v1/sales-missions -> Create new mission
salesMissionRouter.post(
  '/',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  salesMissionController.create
);

// POST /api/v1/sales-missions/analyze-product -> Direct product analysis for wizard review
salesMissionRouter.post(
  '/analyze-product',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  salesMissionController.analyzeDirect
);

// GET /api/v1/sales-missions/:id -> Get mission details
salesMissionRouter.get(
  '/:id',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  salesMissionController.getById
);

// POST /api/v1/sales-missions/:id/analyze -> Analyze mission product
salesMissionRouter.post(
  '/:id/analyze',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  salesMissionController.analyze
);

// POST /api/v1/sales-missions/:id/discover -> Discover authentic buyers
salesMissionRouter.post(
  '/:id/discover',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  salesMissionController.discover
);

// POST /api/v1/sales-missions/:id/refresh -> Refresh authentic buyers
salesMissionRouter.post(
  '/:id/refresh',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  salesMissionController.refresh
);
