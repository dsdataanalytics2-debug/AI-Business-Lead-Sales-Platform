/**
 * Location Routes
 *
 * Exposes GET /api/v1/locations/suggest protected by session auth and LEADS_READ permission.
 */

import { Router } from 'express';
import { Permissions } from '@leadmate/shared';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { locationController } from '../controllers/location.controller.js';

export const locationRouter = Router();

// GET /api/v1/locations/suggest -> Real-time geographic location suggestions
locationRouter.get(
  '/suggest',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  locationController.suggest
);
