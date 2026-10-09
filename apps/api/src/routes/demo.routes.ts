/**
 * Demo Website Catalog Routes
 *
 * Exposes:
 * - GET /api/v1/demos (List all generated demo websites for the organization)
 */

import { Router } from 'express';
import { Permissions } from '@leadmate/shared';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { demoWebsiteController } from '../controllers/demo-website.controller.js';

export const demoRouter = Router();

// GET /api/v1/demos -> List all demo websites for the organization
demoRouter.get(
  '/',
  requireAuth,
  requirePermission(Permissions.DEMOS_GENERATE),
  demoWebsiteController.listAllDemos
);
