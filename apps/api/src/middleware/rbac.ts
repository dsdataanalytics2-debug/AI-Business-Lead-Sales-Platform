import { Request, Response, NextFunction } from 'express';
import { Permission, Role, hasPermission } from '@leadmate/shared';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';

/**
 * Middleware to enforce granular RBAC permissions.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    const userRole = req.user.role as Role;
    if (!hasPermission(userRole, permission)) {
      return next(new ForbiddenError(`Permission '${permission}' is required for this action`));
    }

    next();
  };
}

/**
 * Middleware to enforce specific user roles.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    const userRole = req.user.role as Role;
    if (!roles.includes(userRole)) {
      return next(new ForbiddenError(`Role must be one of: ${roles.join(', ')}`));
    }

    next();
  };
}
