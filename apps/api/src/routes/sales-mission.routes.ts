import { Router } from 'express';
import { Permissions } from '@leadmate/shared';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import {
  aiProductAnalysisRateLimiter,
  buyerDiscoveryRateLimiter,
  buyerRefreshRateLimiter,
  draftGenerationRateLimiter
} from '../middleware/rate-limiter.js';
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
  aiProductAnalysisRateLimiter,
  salesMissionController.analyzeDirect
);

// ==========================================
// SUB-PHASE D: AI SALES ENGINE ANALYTICS
// ==========================================
import { salesAnalyticsController } from '../controllers/sales-analytics.controller.js';

salesMissionRouter.get(
  '/analytics/dashboard',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  salesAnalyticsController.getDashboard
);

salesMissionRouter.get(
  '/analytics/products/:productId',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  salesAnalyticsController.getProductAnalytics
);

salesMissionRouter.get(
  '/analytics/sources',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  salesAnalyticsController.getSources
);

salesMissionRouter.get(
  '/analytics/recommendations',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  salesAnalyticsController.getRecommendations
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
  aiProductAnalysisRateLimiter,
  salesMissionController.analyze
);

// POST /api/v1/sales-missions/:id/discover -> Discover authentic buyers
salesMissionRouter.post(
  '/:id/discover',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  buyerDiscoveryRateLimiter,
  salesMissionController.discover
);

// POST /api/v1/sales-missions/:id/refresh -> Refresh authentic buyers
salesMissionRouter.post(
  '/:id/refresh',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  buyerRefreshRateLimiter,
  salesMissionController.refresh
);

// ==========================================
// SUB-PHASE C: OUTREACH GOVERNANCE & CONVERSION
// ==========================================
import { outreachGovernanceController } from '../controllers/outreach-governance.controller.js';

// Outreach Drafts
salesMissionRouter.post(
  '/:missionId/buyers/:buyerId/drafts',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  draftGenerationRateLimiter,
  outreachGovernanceController.generateDraft
);

salesMissionRouter.get(
  '/:missionId/buyers/:buyerId/drafts',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  outreachGovernanceController.listDrafts
);

salesMissionRouter.patch(
  '/:missionId/drafts/:draftId',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  outreachGovernanceController.editDraft
);

// Human Approval Gate (Approval != Dispatch)
salesMissionRouter.post(
  '/:missionId/drafts/:draftId/submit-approval',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  outreachGovernanceController.submitForApproval
);

salesMissionRouter.post(
  '/:missionId/drafts/:draftId/approve',
  requireAuth,
  requirePermission(Permissions.OUTREACH_MANAGE),
  outreachGovernanceController.approveDraft
);

salesMissionRouter.post(
  '/:missionId/drafts/:draftId/reject',
  requireAuth,
  requirePermission(Permissions.OUTREACH_MANAGE),
  outreachGovernanceController.rejectDraft
);

salesMissionRouter.post(
  '/:missionId/drafts/:draftId/ready-for-dispatch',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  outreachGovernanceController.markReadyForDispatch
);

// Inbound Replies & Classification
salesMissionRouter.post(
  '/:missionId/buyers/:buyerId/replies',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  outreachGovernanceController.processReply
);

salesMissionRouter.get(
  '/:missionId/buyers/:buyerId/interactions',
  requireAuth,
  requirePermission(Permissions.LEADS_READ),
  outreachGovernanceController.listInteractions
);

// Conversion Lifecycle
salesMissionRouter.post(
  '/:missionId/buyers/:buyerId/conversion-stage',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  outreachGovernanceController.transitionConversionStage
);

// Suppression (Do-Not-Contact)
salesMissionRouter.post(
  '/:missionId/buyers/:buyerId/suppress',
  requireAuth,
  requirePermission(Permissions.LEADS_WRITE),
  outreachGovernanceController.suppressBuyer
);
