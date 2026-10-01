import { z } from 'zod';
import { Role } from '../enums.js';

export const userCreateSchema = z.object({
  email: z.string().trim().email('Invalid email address').toLowerCase(),
  password: z.string().min(10, 'Password must be at least 10 characters'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  role: z.nativeEnum(Role),
  organizationId: z.string().uuid('Invalid organization ID'),
  isActive: z.boolean().default(true)
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').optional(),
  role: z.nativeEnum(Role).optional(),
  isActive: z.boolean().optional()
});

export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: z.nativeEnum(Role),
  organizationId: z.string().uuid(),
  isActive: z.boolean(),
  createdAt: z.date().or(z.string()),
  updatedAt: z.date().or(z.string())
});

export type UserResponse = z.infer<typeof userResponseSchema>;
