import { Router } from 'express';
import { Permissions } from '@leadmate/shared';
import { dashboardController } from '../controllers/dashboard.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';

export const dashboardRouter = Router();

// All dashboard routes require authentication and REPORTS_READ permission
dashboardRouter.use(requireAuth);
dashboardRouter.use(requirePermission(Permissions.REPORTS_READ));

dashboardRouter.get('/summary', (req, res, next) =>
  dashboardController.getSummary(req, res, next)
);

dashboardRouter.get('/funnel', (req, res, next) =>
  dashboardController.getFunnel(req, res, next)
);

dashboardRouter.get('/team-performance', (req, res, next) =>
  dashboardController.getTeamPerformance(req, res, next)
);

dashboardRouter.get('/outreach', (req, res, next) =>
  dashboardController.getOutreach(req, res, next)
);

dashboardRouter.get('/sources', (req, res, next) =>
  dashboardController.getSources(req, res, next)
);
