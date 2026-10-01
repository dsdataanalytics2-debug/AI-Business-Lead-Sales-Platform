import crypto from 'node:crypto';
import * as argon2 from 'argon2';

/**
 * Generate a cryptographically secure 32-byte session token (sent only to client).
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Compute SHA-256 hash of the session token for database storage and lookup.
 * Raw tokens are NEVER stored in PostgreSQL.
 */
export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Hash a password using Argon2id.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3
  });
}

/**
 * Verify a plaintext password against an Argon2id hash.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
