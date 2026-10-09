/**
 * Campaign Management Routes
 *
 * Exposes:
 * - GET /api/v1/campaigns -> List campaigns with delivery metrics
 * - POST /api/v1/campaigns -> Create new campaign batch with initial AI drafts
 */

import { Router } from 'express';
import { Permissions } from '@leadmate/shared';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { campaignController } from '../controllers/campaign.controller.js';

export const campaignRouter = Router();

// GET /api/v1/campaigns -> List campaigns
campaignRouter.get(
  '/',
  requireAuth,
  requirePermission(Permissions.CAMPAIGNS_MANAGE),
  campaignController.listCampaigns
);

// POST /api/v1/campaigns -> Create campaign
campaignRouter.post(
  '/',
  requireAuth,
  requirePermission(Permissions.CAMPAIGNS_MANAGE),
  campaignController.createCampaign
);
