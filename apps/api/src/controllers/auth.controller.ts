import { Request, Response, NextFunction } from 'express';
import { loginSchema } from '@leadmate/shared';
import { authService } from '../services/auth.service.js';
import { SESSION_COOKIE_NAME, SESSION_DURATION_MS } from '../services/session.service.js';

export class AuthController {
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = loginSchema.parse(req.body);
      const userAgent = req.headers['user-agent'];
      const ip = req.ip || req.socket.remoteAddress;

      const { rawToken, user, permissions } = await authService.login(
        input.email,
        input.password,
        ip,
        userAgent
      );

      res.cookie(SESSION_COOKIE_NAME, rawToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: SESSION_DURATION_MS
      });

      res.status(200).json({
        data: {
          user,
          permissions
        }
      });
    } catch (err) {
      next(err);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawToken = req.cookies?.[SESSION_COOKIE_NAME];
      if (rawToken) {
        await authService.logout(rawToken);
      }

      res.clearCookie(SESSION_COOKIE_NAME, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/'
      });

      res.status(200).json({
        data: {
          success: true
        }
      });
    } catch (err) {
      next(err);
    }
  }

  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const authDetails = authService.getAuthDetails(req.user!);
      res.status(200).json({
        data: authDetails
      });
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
