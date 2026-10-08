import { Router } from 'express';
import { Permissions } from '@leadmate/shared';
import { teamController } from '../controllers/team.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';

export const teamRouter = Router();

// All team routes require authentication
teamRouter.use(requireAuth);

// Read routes: require USERS_READ permission
teamRouter.get(
  '/members',
  requirePermission(Permissions.USERS_READ),
  (req, res, next) => teamController.listMembers(req, res, next)
);

teamRouter.get(
  '/members/:userId',
  requirePermission(Permissions.USERS_READ),
  (req, res, next) => teamController.getMember(req, res, next)
);

// Mutation routes: require USERS_MANAGE permission
teamRouter.post(
  '/members',
  requirePermission(Permissions.USERS_MANAGE),
  (req, res, next) => teamController.createMember(req, res, next)
);

teamRouter.patch(
  '/members/:userId',
  requirePermission(Permissions.USERS_MANAGE),
  (req, res, next) => teamController.updateMember(req, res, next)
);

teamRouter.post(
  '/members/:userId/activate',
  requirePermission(Permissions.USERS_MANAGE),
  (req, res, next) => teamController.activateMember(req, res, next)
);

teamRouter.post(
  '/members/:userId/deactivate',
  requirePermission(Permissions.USERS_MANAGE),
  (req, res, next) => teamController.deactivateMember(req, res, next)
);
