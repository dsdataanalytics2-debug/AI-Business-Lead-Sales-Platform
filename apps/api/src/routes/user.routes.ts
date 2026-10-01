import { Router } from 'express';
import { Permissions } from '@leadmate/shared';
import { userController } from '../controllers/user.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';

export const userRouter = Router();

userRouter.use(requireAuth);

userRouter.get('/', requirePermission(Permissions.USERS_MANAGE), (req, res, next) =>
  userController.listUsers(req, res, next)
);

userRouter.post('/', requirePermission(Permissions.USERS_MANAGE), (req, res, next) =>
  userController.createUser(req, res, next)
);

userRouter.get('/:id', requirePermission(Permissions.USERS_MANAGE), (req, res, next) =>
  userController.getUser(req, res, next)
);

userRouter.patch('/:id', requirePermission(Permissions.USERS_MANAGE), (req, res, next) =>
  userController.updateUser(req, res, next)
);
