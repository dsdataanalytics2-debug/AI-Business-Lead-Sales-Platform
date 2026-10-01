import { Request, Response, NextFunction } from 'express';
import prisma, { Role } from '@leadmate/db';
import { userCreateSchema, userUpdateSchema, cursorPaginationSchema } from '@leadmate/shared';
import { hashPassword } from '../lib/crypto.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { sanitizeUser } from '../services/auth.service.js';

export class UserController {
  async listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { limit, cursor } = cursorPaginationSchema.parse(req.query);

      const users = await prisma.user.findMany({
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        where: {
          organizationId: req.user!.organizationId
        },
        orderBy: { createdAt: 'desc' }
      });

      const hasNextPage = users.length > limit;
      const data = hasNextPage ? users.slice(0, limit) : users;
      const nextCursor = hasNextPage ? data[data.length - 1].id : null;

      res.status(200).json({
        data: data.map(sanitizeUser),
        meta: {
          nextCursor,
          hasMore: hasNextPage
        }
      });
    } catch (err) {
      next(err);
    }
  }

  async getUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const user = await prisma.user.findFirst({
        where: {
          id,
          organizationId: req.user!.organizationId
        }
      });

      if (!user) {
        throw new NotFoundError(`User with ID '${id}' not found`);
      }

      res.status(200).json({
        data: sanitizeUser(user)
      });
    } catch (err) {
      next(err);
    }
  }

  async createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = userCreateSchema.parse(req.body);

      const existing = await prisma.user.findUnique({
        where: { email: input.email }
      });

      if (existing) {
        throw new ConflictError(`User with email '${input.email}' already exists`);
      }

      const passwordHash = await hashPassword(input.password);

      const created = await prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          name: input.name,
          role: input.role as Role,
          organizationId: req.user!.organizationId,
          isActive: input.isActive
        }
      });

      res.status(201).json({
        data: sanitizeUser(created)
      });
    } catch (err) {
      next(err);
    }
  }

  async updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const input = userUpdateSchema.parse(req.body);

      const user = await prisma.user.findFirst({
        where: {
          id,
          organizationId: req.user!.organizationId
        }
      });

      if (!user) {
        throw new NotFoundError(`User with ID '${id}' not found`);
      }

      const updated = await prisma.user.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.role ? { role: input.role as Role } : {}),
          ...(typeof input.isActive === 'boolean' ? { isActive: input.isActive } : {})
        }
      });

      res.status(200).json({
        data: sanitizeUser(updated)
      });
    } catch (err) {
      next(err);
    }
  }
}

export const userController = new UserController();
