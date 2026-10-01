import prisma, { User } from '@leadmate/db';
import { ROLE_PERMISSIONS, Permission, Role } from '@leadmate/shared';
import { verifyPassword } from '../lib/crypto.js';
import { UnauthorizedError } from '../lib/errors.js';
import { sessionService } from './session.service.js';

export interface SanitizedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function sanitizeUser(user: User): SanitizedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    organizationId: user.organizationId,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

export interface LoginResult {
  rawToken: string;
  user: SanitizedUser;
  permissions: readonly Permission[];
}

export class AuthService {
  async login(email: string, password: string, ipAddress?: string, userAgent?: string): Promise<LoginResult> {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() }
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const isValid = await verifyPassword(user.passwordHash, password);
    if (!isValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const { rawToken } = await sessionService.createSession(user.id, ipAddress, userAgent);

    return {
      rawToken,
      user: sanitizeUser(user),
      permissions: ROLE_PERMISSIONS[user.role as Role] || []
    };
  }

  async logout(rawToken: string): Promise<void> {
    await sessionService.deleteSession(rawToken);
  }

  getAuthDetails(user: User): { user: SanitizedUser; permissions: readonly Permission[] } {
    return {
      user: sanitizeUser(user),
      permissions: ROLE_PERMISSIONS[user.role as Role] || []
    };
  }
}

export const authService = new AuthService();
