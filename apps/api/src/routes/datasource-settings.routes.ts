/**
 * Datasource Settings Routes
 *
 * Exposes:
 * - GET /api/v1/settings/data-sources -> List provider cards
 * - POST /api/v1/settings/data-sources/google-places/configure -> Encrypt and save key
 * - POST /api/v1/settings/data-sources/google-places/test -> Test Google Places connection
 * - POST /api/v1/settings/data-sources/:provider/test -> Test provider connection
 * - POST /api/v1/settings/data-sources/:provider/set-active -> Set active provider
 * - POST /api/v1/settings/data-sources/:provider/toggle -> Enable or disable provider
 */

import { Router } from 'express';
import { Permissions, Role } from '@leadmate/shared';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, requireRole } from '../middleware/rbac.js';
import { datasourceSettingsController } from '../controllers/datasource-settings.controller.js';

export const datasourceSettingsRouter = Router();

// GET /api/v1/settings/data-sources -> List cards with masked credentials
datasourceSettingsRouter.get(
  '/',
  requireAuth,
  requireRole(Role.SUPER_ADMIN, Role.ADMIN, Role.SALES_MANAGER),
  datasourceSettingsController.listDataSources
);

// POST /api/v1/settings/data-sources/google-places/configure -> Encrypt and save key
datasourceSettingsRouter.post(
  '/google-places/configure',
  requireAuth,
  requirePermission(Permissions.USERS_MANAGE),
  datasourceSettingsController.configureGooglePlaces
);

// POST /api/v1/settings/data-sources/google-places/test -> Test Google Places connection
datasourceSettingsRouter.post(
  '/google-places/test',
  requireAuth,
  requirePermission(Permissions.USERS_MANAGE),
  datasourceSettingsController.testGooglePlaces
);

// POST /api/v1/settings/data-sources/:provider/test -> Test connection for any provider
datasourceSettingsRouter.post(
  '/:provider/test',
  requireAuth,
  requirePermission(Permissions.USERS_MANAGE),
  datasourceSettingsController.testProvider
);

// POST /api/v1/settings/data-sources/:provider/set-active -> Set active provider
datasourceSettingsRouter.post(
  '/:provider/set-active',
  requireAuth,
  requirePermission(Permissions.USERS_MANAGE),
  datasourceSettingsController.setActiveProvider
);

// POST /api/v1/settings/data-sources/:provider/toggle -> Enable or disable provider
datasourceSettingsRouter.post(
  '/:provider/toggle',
  requireAuth,
  requirePermission(Permissions.USERS_MANAGE),
  datasourceSettingsController.toggleProviderEnabled
);
