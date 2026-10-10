/**
 * AI Routes
 *
 * Exposes endpoints for buyer target category suggestions and fit explanation under /api/v1/ai.
 */

import { Router } from 'express';
import { Permissions } from '@leadmate/shared';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { aiBuyerDiscoveryController } from '../controllers/ai-buyer-discovery.controller.js';

export const aiRouter = Router();

// POST /api/v1/ai/buyer-targets OR /api/v1/ai/buyer-discovery/suggest-targets
aiRouter.post(
  '/buyer-targets',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  aiBuyerDiscoveryController.suggestBuyerTargets
);

aiRouter.post(
  '/buyer-discovery/suggest-targets',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  aiBuyerDiscoveryController.suggestBuyerTargets
);

// POST /api/v1/ai/buyer-fit OR /api/v1/ai/buyer-discovery/explain-fit
aiRouter.post(
  '/buyer-fit',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  aiBuyerDiscoveryController.explainBuyerFit
);

aiRouter.post(
  '/buyer-discovery/explain-fit',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  aiBuyerDiscoveryController.explainBuyerFit
);
