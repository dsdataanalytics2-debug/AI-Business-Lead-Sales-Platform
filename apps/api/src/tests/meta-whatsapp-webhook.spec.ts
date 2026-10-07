import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { createApp } from '../app.js';
import { env } from '../config/env.js';
import {
  verifyMetaSignatureHeader
} from '../middleware/meta-webhook-auth.js';

describe('Meta WhatsApp Webhook Endpoint Security & Ingestion', () => {
  const testVerifyToken = 'test-meta-verify-token-secret-123';
  const testAppSecret = 'test-meta-app-secret-456';

  // Override env values for testing
  const originalVerifyToken = env.META_WHATSAPP_VERIFY_TOKEN;
  const originalAppSecret = env.META_WHATSAPP_APP_SECRET;

  beforeAll(() => {
    (env as any).META_WHATSAPP_VERIFY_TOKEN = testVerifyToken;
    (env as any).META_WHATSAPP_APP_SECRET = testAppSecret;
  });

  afterAll(() => {
    (env as any).META_WHATSAPP_VERIFY_TOKEN = originalVerifyToken;
    (env as any).META_WHATSAPP_APP_SECRET = originalAppSecret;
  });

  const app = createApp();

  describe('1. GET /api/v1/webhooks/meta/whatsapp (Hub Challenge Handshake)', () => {
    it('returns exact challenge string with HTTP 200 when verify_token matches', async () => {
      const challengeStr = '1158201444';
      const response = await request(app)
        .get('/api/v1/webhooks/meta/whatsapp')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': testVerifyToken,
          'hub.challenge': challengeStr
        });

      expect(response.status).toBe(200);
      expect(response.text).toBe(challengeStr);
    });

    it('rejects handshake with HTTP 403 when verify_token does not match', async () => {
      const response = await request(app)
        .get('/api/v1/webhooks/meta/whatsapp')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong-token',
          'hub.challenge': '12345'
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects handshake with HTTP 403 when hub.mode is not subscribe', async () => {
      const response = await request(app)
        .get('/api/v1/webhooks/meta/whatsapp')
        .query({
          'hub.mode': 'unsubscribe',
          'hub.verify_token': testVerifyToken,
          'hub.challenge': '12345'
        });

      expect(response.status).toBe(403);
    });

    it('rejects handshake when verify_token is missing from query', async () => {
      const response = await request(app)
        .get('/api/v1/webhooks/meta/whatsapp')
        .query({
          'hub.mode': 'subscribe',
          'hub.challenge': '12345'
        });

      expect(response.status).toBe(403);
    });
  });

  describe('2. POST /api/v1/webhooks/meta/whatsapp (Signature Verification & Security)', () => {
    function computeSignature(payload: string, secret: string): string {
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(Buffer.from(payload, 'utf8'));
      return `sha256=${hmac.digest('hex')}`;
    }

    const validPayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123',
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [
                  {
                    id: 'wamid.TEST_SIGNATURE_001',
                    status: 'delivered',
                    timestamp: '1728280000'
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    it('accepts valid X-Hub-Signature-256 and returns 200 EVENT_RECEIVED', async () => {
      const sig = computeSignature(validPayload, testAppSecret);

      const response = await request(app)
        .post('/api/v1/webhooks/meta/whatsapp')
        .set('x-hub-signature-256', sig)
        .set('content-type', 'application/json')
        .send(validPayload);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('EVENT_RECEIVED');
    });

    it('rejects request with HTTP 401 when signature header is missing', async () => {
      const response = await request(app)
        .post('/api/v1/webhooks/meta/whatsapp')
        .set('content-type', 'application/json')
        .send(validPayload);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects request with HTTP 401 when signature header is computed with wrong secret', async () => {
      const invalidSig = computeSignature(validPayload, 'wrong-app-secret');

      const response = await request(app)
        .post('/api/v1/webhooks/meta/whatsapp')
        .set('x-hub-signature-256', invalidSig)
        .set('content-type', 'application/json')
        .send(validPayload);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects request with HTTP 401 when body has been tampered after signing', async () => {
      const sig = computeSignature(validPayload, testAppSecret);
      const tamperedPayload = validPayload.replace('wamid.TEST_SIGNATURE_001', 'wamid.TAMPERED_001');

      const response = await request(app)
        .post('/api/v1/webhooks/meta/whatsapp')
        .set('x-hub-signature-256', sig)
        .set('content-type', 'application/json')
        .send(tamperedPayload);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects request with HTTP 401 when signature is invalid even if JSON is malformed (signature precedes parse)', async () => {
      const malformedPayload = '{"incomplete": true,';
      const invalidSig = computeSignature(malformedPayload, 'wrong-app-secret');

      const response = await request(app)
        .post('/api/v1/webhooks/meta/whatsapp')
        .set('x-hub-signature-256', invalidSig)
        .set('content-type', 'application/json')
        .send(malformedPayload);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns safe HTTP 400 when signature is valid but JSON is malformed (no domain processing)', async () => {
      const malformedPayload = '{"broken": [1, 2, 3';
      const validSig = computeSignature(malformedPayload, testAppSecret);

      const response = await request(app)
        .post('/api/v1/webhooks/meta/whatsapp')
        .set('x-hub-signature-256', validSig)
        .set('content-type', 'application/json')
        .send(malformedPayload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('Malformed JSON payload');
    });

    it('rejects request with HTTP 413 when body exceeds configured size limit (256kb)', async () => {
      const oversizedData = 'x'.repeat(300 * 1024); // 300KB
      const oversizedPayload = JSON.stringify({ padding: oversizedData });
      const validSig = computeSignature(oversizedPayload, testAppSecret);

      const response = await request(app)
        .post('/api/v1/webhooks/meta/whatsapp')
        .set('x-hub-signature-256', validSig)
        .set('content-type', 'application/json')
        .send(oversizedPayload);

      expect(response.status).toBe(413);
      expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('confirms normal application JSON endpoints continue parsing JSON normally without rawBody', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .set('content-type', 'application/json')
        .send({ email: 'test@example.com', password: 'password123' });

      // Expect normal auth controller response (401 invalid credentials), proving JSON was parsed
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('verifyMetaSignatureHeader helper uses constant-time comparison correctly', () => {
      const body = '{"test":true}';
      const sig = computeSignature(body, testAppSecret);

      expect(verifyMetaSignatureHeader(sig, body, testAppSecret)).toBe(true);
      expect(verifyMetaSignatureHeader(sig, body, 'wrong-secret')).toBe(false);
      expect(verifyMetaSignatureHeader('invalid-format', body, testAppSecret)).toBe(false);
      expect(verifyMetaSignatureHeader(sig, 'tampered-body', testAppSecret)).toBe(false);
      expect(verifyMetaSignatureHeader(undefined, body, testAppSecret)).toBe(false);
    });
  });

  describe('3. Production Environment Fail-Closed Configuration Matrix', () => {
    it('NODE_ENV=test with provider omitted defaults to mock', async () => {
      const { envSchema } = await import('../config/env.js');
      const parsed = envSchema.safeParse({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://localhost:5432/test',
        SESSION_SECRET: 'super-secret-session-key-at-least-16-chars'
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.OUTREACH_WHATSAPP_PROVIDER).toBe('mock');
      }
    });

    it('NODE_ENV=development with provider omitted defaults to mock', async () => {
      const { envSchema } = await import('../config/env.js');
      const parsed = envSchema.safeParse({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/test',
        SESSION_SECRET: 'super-secret-session-key-at-least-16-chars'
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.OUTREACH_WHATSAPP_PROVIDER).toBe('mock');
      }
    });

    it('NODE_ENV=production with provider omitted FAILS CLOSED', async () => {
      const { envSchema } = await import('../config/env.js');
      const parsed = envSchema.safeParse({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://localhost:5432/test',
        SESSION_SECRET: 'super-secret-session-key-at-least-16-chars'
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const issues = parsed.error.issues;
        expect(issues.some((i) => i.path.includes('OUTREACH_WHATSAPP_PROVIDER'))).toBe(true);
      }
    });

    it('NODE_ENV=production with explicit OUTREACH_WHATSAPP_PROVIDER=mock is allowed', async () => {
      const { envSchema } = await import('../config/env.js');
      const parsed = envSchema.safeParse({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://localhost:5432/test',
        SESSION_SECRET: 'super-secret-session-key-at-least-16-chars',
        OUTREACH_WHATSAPP_PROVIDER: 'mock'
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.OUTREACH_WHATSAPP_PROVIDER).toBe('mock');
      }
    });

    it('NODE_ENV=production with OUTREACH_WHATSAPP_PROVIDER=meta and missing credentials FAILS CLOSED', async () => {
      const { envSchema } = await import('../config/env.js');
      const parsed = envSchema.safeParse({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://localhost:5432/test',
        SESSION_SECRET: 'super-secret-session-key-at-least-16-chars',
        OUTREACH_WHATSAPP_PROVIDER: 'meta'
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const paths = parsed.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('META_WHATSAPP_ACCESS_TOKEN');
        expect(paths).toContain('META_WHATSAPP_PHONE_NUMBER_ID');
        expect(paths).toContain('META_WHATSAPP_APP_SECRET');
        expect(paths).toContain('META_WHATSAPP_VERIFY_TOKEN');
      }
    });

    it('NODE_ENV=production with OUTREACH_WHATSAPP_PROVIDER=meta and complete credentials succeeds', async () => {
      const { envSchema } = await import('../config/env.js');
      const parsed = envSchema.safeParse({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://localhost:5432/test',
        SESSION_SECRET: 'super-secret-session-key-at-least-16-chars',
        OUTREACH_WHATSAPP_PROVIDER: 'meta',
        META_WHATSAPP_ACCESS_TOKEN: 'valid-meta-token',
        META_WHATSAPP_PHONE_NUMBER_ID: '1234567890',
        META_WHATSAPP_APP_SECRET: 'valid-meta-app-secret',
        META_WHATSAPP_VERIFY_TOKEN: 'valid-meta-verify-token'
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.OUTREACH_WHATSAPP_PROVIDER).toBe('meta');
      }
    });
  });
});
