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

/**
 * Error thrown when DATASOURCE_CREDENTIAL_ENCRYPTION_KEY is missing or invalid.
 */
export class EncryptionConfigError extends Error {
  constructor(message = 'DATASOURCE_CREDENTIAL_ENCRYPTION_KEY must be a valid base64-encoded 32-byte key') {
    super(message);
    this.name = 'EncryptionConfigError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Validates and extracts the 32-byte master encryption key from environment variable
 * DATASOURCE_CREDENTIAL_ENCRYPTION_KEY (or CREDENTIAL_ENCRYPTION_KEY).
 *
 * FAILS CLOSED:
 * - Throws EncryptionConfigError if key is missing, invalid base64, or not exactly 32 bytes.
 * - ZERO predictable fallbacks, ZERO automatic key generation, ZERO hardcoded development keys.
 * - NEVER logs or exposes the master key.
 */
export function getEncryptionKey(overrideKey?: string): Buffer {
  const rawSecret =
    overrideKey ??
    process.env.DATASOURCE_CREDENTIAL_ENCRYPTION_KEY ??
    process.env.CREDENTIAL_ENCRYPTION_KEY;

  if (!rawSecret || typeof rawSecret !== 'string' || rawSecret.trim().length === 0) {
    throw new EncryptionConfigError(
      'DATASOURCE_CREDENTIAL_ENCRYPTION_KEY environment variable is not configured'
    );
  }

  const trimmed = rawSecret.trim();

  // Validate strict base64 character set
  const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
  if (!base64Regex.test(trimmed)) {
    throw new EncryptionConfigError(
      'DATASOURCE_CREDENTIAL_ENCRYPTION_KEY must be a valid base64-encoded string'
    );
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(trimmed, 'base64');
  } catch {
    throw new EncryptionConfigError(
      'Failed to decode DATASOURCE_CREDENTIAL_ENCRYPTION_KEY as base64'
    );
  }

  if (buf.length !== 32) {
    throw new EncryptionConfigError(
      `DATASOURCE_CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes (received ${buf.length} bytes)`
    );
  }

  // Verify canonical encoding to detect corrupt or truncated base64 payloads
  const reEncoded = buf.toString('base64');
  if (reEncoded !== trimmed && reEncoded.replace(/=/g, '') !== trimmed.replace(/=/g, '')) {
    throw new EncryptionConfigError(
      'DATASOURCE_CREDENTIAL_ENCRYPTION_KEY contains invalid base64 characters'
    );
  }

  return buf;
}

/**
 * Encrypt a credential using authenticated AES-256-GCM.
 * Output payload format: v1:<iv_b64>:<ciphertext_b64>:<authTag_b64>
 *
 * Invariants:
 * - 12-byte random IV for every encryption call
 * - 32-byte AES key
 * - 16-byte GCM authentication tag
 * - Never returns plaintext
 */
export function encryptCredential(plaintext: string, overrideKey?: string): string {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('Credential must be a non-empty string');
  }

  const key = getEncryptionKey(overrideKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString('base64')}:${ciphertext.toString('base64')}:${authTag.toString('base64')}`;
}

/**
 * Decrypt an AES-256-GCM encrypted credential payload.
 * Validates authentication tag before returning plaintext. Throws on tampering.
 */
export function decryptCredential(encryptedBlob: string, overrideKey?: string): string {
  if (!encryptedBlob || typeof encryptedBlob !== 'string') {
    throw new Error('Invalid encrypted credential payload');
  }

  const parts = encryptedBlob.split(':');
  let ivB64: string;
  let ciphertextB64: string;
  let authTagB64: string;

  if (parts.length === 4 && parts[0] === 'v1') {
    // Canonical format: v1:<iv>:<ciphertext>:<authTag>
    [, ivB64, ciphertextB64, authTagB64] = parts;
  } else if (parts.length === 3) {
    // Legacy prototype format: <iv>:<authTag>:<ciphertext>
    [ivB64, authTagB64, ciphertextB64] = parts;
  } else {
    throw new Error('Malformed encrypted credential format');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');

  if (iv.length !== 12 || authTag.length !== 16) {
    throw new Error('Invalid IV or auth tag length for AES-256-GCM');
  }

  const key = getEncryptionKey(overrideKey);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  return plaintext.toString('utf8');
}

/**
 * Masks an API credential for safe display on dashboards.
 * E.g., 'AIzaSyA1234567890abcdef9x2A' -> 'AIza••••••••••••••9x2A'
 * Never exposes middle characters.
 */
export function maskCredential(apiKey: string): string {
  if (!apiKey || typeof apiKey !== 'string') return '';
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) {
    return '••••••••';
  }
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  const dotCount = Math.min(Math.max(trimmed.length - 8, 8), 14);
  return `${prefix}${'•'.repeat(dotCount)}${suffix}`;
}

/**
 * Returns the last 4 characters of a credential for quick identification.
 */
export function getCredentialLastFour(apiKey: string): string {
  if (!apiKey || typeof apiKey !== 'string') return '';
  const trimmed = apiKey.trim();
  return trimmed.slice(-4);
}
