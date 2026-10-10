/**
 * AI Settings Routes
 *
 * Exposes endpoints for managing AI models, keys, and statuses under /api/v1/settings/ai-models.
 */

import { Router } from 'express';
import { Permissions } from '@leadmate/shared';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { aiSettingsController } from '../controllers/ai-settings.controller.js';

export const aiSettingsRouter = Router();

// GET /api/v1/settings/ai-models -> List AI model cards for tenant
aiSettingsRouter.get(
  '/',
  requireAuth,
  requirePermission(Permissions.DATASOURCES_MANAGE),
  aiSettingsController.list
);

// PUT /api/v1/settings/ai-models/:provider OR POST /gemini/configure
aiSettingsRouter.put(
  '/:provider',
  requireAuth,
  requirePermission(Permissions.DATASOURCES_MANAGE),
  aiSettingsController.configureGemini
);

aiSettingsRouter.post(
  '/:provider/configure',
  requireAuth,
  requirePermission(Permissions.DATASOURCES_MANAGE),
  aiSettingsController.configureGemini
);

// POST /api/v1/settings/ai-models/:provider/test OR /gemini/test
aiSettingsRouter.post(
  '/:provider/test',
  requireAuth,
  requirePermission(Permissions.DATASOURCES_MANAGE),
  aiSettingsController.testGemini
);

// POST /api/v1/settings/ai-models/:provider/toggle -> Enable or disable AI provider
aiSettingsRouter.post(
  '/:provider/toggle',
  requireAuth,
  requirePermission(Permissions.DATASOURCES_MANAGE),
  aiSettingsController.toggleProvider
);

// PATCH /api/v1/settings/ai-models/:provider/model OR POST .../model -> Update active model
aiSettingsRouter.patch(
  '/:provider/model',
  requireAuth,
  requirePermission(Permissions.DATASOURCES_MANAGE),
  aiSettingsController.setModel
);

aiSettingsRouter.post(
  '/:provider/model',
  requireAuth,
  requirePermission(Permissions.DATASOURCES_MANAGE),
  aiSettingsController.setModel
);
