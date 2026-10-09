import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import {
  encryptCredential,
  decryptCredential,
  maskCredential,
  getCredentialLastFour,
  getEncryptionKey,
  EncryptionConfigError
} from '../lib/crypto.js';

describe('AES-256-GCM Credential Storage & Masking', () => {
  const sampleApiKey = 'AIzaSyDwE4f7Y68z91kLmNoPqRsTuVwXyZ0123';
  const validKeyB64 = crypto.randomBytes(32).toString('base64');
  let originalEnvKey: string | undefined;

  beforeEach(() => {
    originalEnvKey = process.env.DATASOURCE_CREDENTIAL_ENCRYPTION_KEY;
    process.env.DATASOURCE_CREDENTIAL_ENCRYPTION_KEY = validKeyB64;
  });

  afterEach(() => {
    process.env.DATASOURCE_CREDENTIAL_ENCRYPTION_KEY = originalEnvKey;
  });

  it('1. Successfully encrypts and decrypts credential (round-trip)', () => {
    const encrypted = encryptCredential(sampleApiKey);
    expect(encrypted).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

    const decrypted = decryptCredential(encrypted);
    expect(decrypted).toBe(sampleApiKey);
  });

  it('2. Uses random 12-byte IV (encrypting same string twice yields different outputs)', () => {
    const encrypted1 = encryptCredential(sampleApiKey);
    const encrypted2 = encryptCredential(sampleApiKey);

    expect(encrypted1).not.toBe(encrypted2);

    const iv1 = encrypted1.split(':')[1];
    const iv2 = encrypted2.split(':')[1];
    expect(iv1).not.toBe(iv2);
  });

  it('3. Rejects tampered ciphertext with authentication error (tamper detection)', () => {
    const encrypted = encryptCredential(sampleApiKey);
    const parts = encrypted.split(':');
    const cipherBuf = Buffer.from(parts[2], 'base64');
    cipherBuf[0] ^= 0xff;
    parts[2] = cipherBuf.toString('base64');
    const tampered = parts.join(':');

    expect(() => decryptCredential(tampered)).toThrow();
  });

  it('4. Rejects tampered authTag with authentication error', () => {
    const encrypted = encryptCredential(sampleApiKey);
    const parts = encrypted.split(':');
    const tagBuf = Buffer.from(parts[3], 'base64');
    tagBuf[0] ^= 0xff;
    parts[3] = tagBuf.toString('base64');
    const tampered = parts.join(':');

    expect(() => decryptCredential(tampered)).toThrow();
  });

  it('5. Fails decryption with wrong key', () => {
    const key1 = crypto.randomBytes(32).toString('base64');
    const key2 = crypto.randomBytes(32).toString('base64');

    const encrypted = encryptCredential(sampleApiKey, key1);
    expect(() => decryptCredential(encrypted, key2)).toThrow();
  });

  it('6. Masking preserves first 4 and last 4 characters, redacting middle secret', () => {
    const masked = maskCredential(sampleApiKey);
    expect(masked.startsWith('AIza')).toBe(true);
    expect(masked.endsWith('0123')).toBe(true);
    expect(masked).toContain('••••');
    expect(masked).not.toContain('DwE4f7Y68z91kLmNoPqRsTuVwXyZ');
  });

  it('7. Masking handles short credentials safely', () => {
    const shortMasked = maskCredential('short');
    expect(shortMasked).toBe('••••••••');
  });

  it('8. Extracts last four characters correctly', () => {
    expect(getCredentialLastFour(sampleApiKey)).toBe('0123');
    expect(getCredentialLastFour('abcd')).toBe('abcd');
  });

  describe('Master Key Validation & Security Hardening', () => {
    it('9. Rejects missing key when environment variable is not configured', () => {
      delete process.env.DATASOURCE_CREDENTIAL_ENCRYPTION_KEY;
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;

      expect(() => getEncryptionKey()).toThrow(EncryptionConfigError);
      expect(() => encryptCredential(sampleApiKey)).toThrow(EncryptionConfigError);
    });

    it('10. Rejects invalid base64 string', () => {
      expect(() => getEncryptionKey('!!!not-base64-characters!!!')).toThrow(EncryptionConfigError);
    });

    it('11. Rejects 31-byte key (too short)', () => {
      const key31 = crypto.randomBytes(31).toString('base64');
      expect(() => getEncryptionKey(key31)).toThrow(EncryptionConfigError);
    });

    it('12. Rejects 33-byte key (too long)', () => {
      const key33 = crypto.randomBytes(33).toString('base64');
      expect(() => getEncryptionKey(key33)).toThrow(EncryptionConfigError);
    });

    it('13. Accepts valid 32-byte key without logging or exposing plaintext', () => {
      const buf = getEncryptionKey(validKeyB64);
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.length).toBe(32);
    });
  });
});
