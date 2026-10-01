import { Request, Response, NextFunction } from 'express';
import { User, Session } from '@leadmate/db';
import { UnauthorizedError } from '../lib/errors.js';
import { sessionService, SESSION_COOKIE_NAME } from '../services/session.service.js';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      session?: Session;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawToken = req.cookies?.[SESSION_COOKIE_NAME];

    if (!rawToken || typeof rawToken !== 'string') {
      throw new UnauthorizedError('Authentication required');
    }

    const validated = await sessionService.validateSession(rawToken);

    if (!validated) {
      // Clear invalid cookie
      res.clearCookie(SESSION_COOKIE_NAME, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/'
      });
      throw new UnauthorizedError('Session is invalid or has expired');
    }

    req.user = validated.user;
    req.session = validated.session;

    next();
  } catch (err) {
    next(err);
  }
}
