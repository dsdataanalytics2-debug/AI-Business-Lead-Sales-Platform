import prisma, { Session, User } from '@leadmate/db';
import { generateSessionToken, hashSessionToken } from '../lib/crypto.js';

export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const SESSION_COOKIE_NAME = 'leadmate_session';

export interface CreatedSession {
  rawToken: string;
  session: Session;
}

export interface ValidatedSession {
  user: User;
  session: Session;
}

export class SessionService {
  /**
   * Create a new server-side session in PostgreSQL.
   * Generates a raw token for the cookie and stores ONLY the SHA-256 tokenHash in DB.
   */
  async createSession(userId: string, ipAddress?: string, userAgent?: string): Promise<CreatedSession> {
    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    const session = await prisma.session.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        ipAddress,
        userAgent
      }
    });

    return { rawToken, session };
  }

  /**
   * Validate session token from cookie.
   * Computes SHA-256 of cookie token, queries PostgreSQL, and applies sliding expiration.
   */
  async validateSession(rawToken: string): Promise<ValidatedSession | null> {
    if (!rawToken || typeof rawToken !== 'string') {
      return null;
    }

    const tokenHash = hashSessionToken(rawToken);

    const session = await prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true }
    });

    if (!session) {
      return null;
    }

    // Check expiration
    if (session.expiresAt <= new Date()) {
      await prisma.session.deleteMany({ where: { id: session.id } }).catch(() => {});
      return null;
    }

    // Check if user is active
    if (!session.user.isActive) {
      return null;
    }

    // Sliding expiration renewal: if less than half duration remaining, extend expiresAt
    const timeRemaining = session.expiresAt.getTime() - Date.now();
    if (timeRemaining < SESSION_DURATION_MS / 2) {
      const newExpiresAt = new Date(Date.now() + SESSION_DURATION_MS);
      await prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: newExpiresAt }
      }).catch(() => {});
      session.expiresAt = newExpiresAt;
    }

    return { user: session.user, session };
  }

  /**
   * Delete session by raw cookie token (on logout).
   */
  async deleteSession(rawToken: string): Promise<void> {
    if (!rawToken) return;
    const tokenHash = hashSessionToken(rawToken);
    await prisma.session.deleteMany({
      where: { tokenHash }
    }).catch(() => {});
  }
}

export const sessionService = new SessionService();
