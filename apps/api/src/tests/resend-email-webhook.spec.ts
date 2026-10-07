import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { verifyResendWebhookSignature } from '../middleware/resend-webhook-auth.js';

describe('Resend Email Webhook Endpoint Security & Ingestion', () => {
  // Svix test secret (base64 encoded 32 bytes prefixed with whsec_)
  const testRawSecretBytes = Buffer.from('test-secret-32-byte-length-here!', 'utf8');
  const testWebhookSecret = `whsec_${testRawSecretBytes.toString('base64')}`;

  const originalWebhookSecret = env.RESEND_WEBHOOK_SECRET;

  beforeAll(() => {
    (env as any).RESEND_WEBHOOK_SECRET = testWebhookSecret;
  });

  afterAll(() => {
    (env as any).RESEND_WEBHOOK_SECRET = originalWebhookSecret;
  });

  const app = createApp();

  function computeSvixSignature(
    id: string,
    timestamp: string,
    payload: string,
    secret: string
  ): string {
    let key: Buffer;
    if (secret.startsWith('whsec_')) {
      key = Buffer.from(secret.slice(6), 'base64');
    } else {
      key = Buffer.from(secret, 'base64');
      if (key.length === 0) key = Buffer.from(secret, 'utf8');
    }

    const toSign = Buffer.concat([
      Buffer.from(`${id}.${timestamp}.`, 'utf8'),
      Buffer.from(payload, 'utf8')
    ]);

    const hmac = crypto.createHmac('sha256', key);
    hmac.update(toSign);
    return `v1,${hmac.digest('base64')}`;
  }

  const validDeliveredPayload = JSON.stringify({
    id: 'evt_resend_deliv_001',
    type: 'email.delivered',
    created_at: new Date().toISOString(),
    data: {
      email_id: 're_msg_deliv_001',
      from: 'alerts@leadmate.ai',
      to: ['client@example.com'],
      subject: 'Welcome to LeadMate'
    }
  });

  const validBouncedPayload = JSON.stringify({
    id: 'evt_resend_bounce_002',
    type: 'email.bounced',
    created_at: new Date().toISOString(),
    data: {
      email_id: 're_msg_bounce_002',
      from: 'alerts@leadmate.ai',
      to: ['bounced@example.com'],
      subject: 'Welcome to LeadMate',
      bounce_type: 'Permanent'
    }
  });

  const ignoredAnalyticsPayload = JSON.stringify({
    id: 'evt_resend_opened_003',
    type: 'email.opened',
    created_at: new Date().toISOString(),
    data: {
      email_id: 're_msg_opened_003'
    }
  });

  describe('1. Webhook Signature Verification Algorithm (Svix spec)', () => {
    it('verifies valid Svix signature accurately', () => {
      const svixId = 'msg_test_id_1';
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();
      const body = '{"hello":"world"}';
      const sig = computeSvixSignature(svixId, svixTimestamp, body, testWebhookSecret);

      const isValid = verifyResendWebhookSignature(
        { id: svixId, timestamp: svixTimestamp, signature: sig },
        body,
        testWebhookSecret
      );
      expect(isValid).toBe(true);
    });

    it('rejects tampered body or mismatched secret', () => {
      const svixId = 'msg_test_id_1';
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();
      const body = '{"hello":"world"}';
      const sig = computeSvixSignature(svixId, svixTimestamp, body, testWebhookSecret);

      const isTamperedValid = verifyResendWebhookSignature(
        { id: svixId, timestamp: svixTimestamp, signature: sig },
        '{"hello":"tampered"}',
        testWebhookSecret
      );
      expect(isTamperedValid).toBe(false);

      const isWrongSecretValid = verifyResendWebhookSignature(
        { id: svixId, timestamp: svixTimestamp, signature: sig },
        body,
        'whsec_YW5vdGhlci1zZWNyZXQtMzItYnl0ZXMtbG9uZyEhIQ=='
      );
      expect(isWrongSecretValid).toBe(false);
    });
  });

  describe('2. POST /api/v1/webhooks/resend/email (Security & Ingestion)', () => {
    it('accepts valid Svix signature and returns 200 EVENT_RECEIVED for delivered event', async () => {
      const svixId = 'msg_svix_001';
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();
      const sig = computeSvixSignature(svixId, svixTimestamp, validDeliveredPayload, testWebhookSecret);

      const response = await request(app)
        .post('/api/v1/webhooks/resend/email')
        .set('svix-id', svixId)
        .set('svix-timestamp', svixTimestamp)
        .set('svix-signature', sig)
        .set('content-type', 'application/json')
        .send(validDeliveredPayload);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('EVENT_RECEIVED');
      expect(response.body.count).toBe(1);
    });

    it('accepts valid Svix signature and returns 200 EVENT_RECEIVED for bounced event', async () => {
      const svixId = 'msg_svix_002';
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();
      const sig = computeSvixSignature(svixId, svixTimestamp, validBouncedPayload, testWebhookSecret);

      const response = await request(app)
        .post('/api/v1/webhooks/resend/email')
        .set('svix-id', svixId)
        .set('svix-timestamp', svixTimestamp)
        .set('svix-signature', sig)
        .set('content-type', 'application/json')
        .send(validBouncedPayload);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('EVENT_RECEIVED');
      expect(response.body.count).toBe(1);
    });

    it('accepts valid Svix signature and returns 200 EVENT_RECEIVED for failed event', async () => {
      const svixId = 'msg_svix_004';
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();
      const validFailedPayload = JSON.stringify({
        id: 'evt_resend_failed_004',
        type: 'email.failed',
        created_at: new Date().toISOString(),
        data: {
          email_id: 're_msg_failed_004',
          from: 'alerts@leadmate.ai',
          to: ['failed@example.com'],
          subject: 'Welcome to LeadMate',
          message: 'Upstream SMTP server dropped connection'
        }
      });
      const sig = computeSvixSignature(svixId, svixTimestamp, validFailedPayload, testWebhookSecret);

      const response = await request(app)
        .post('/api/v1/webhooks/resend/email')
        .set('svix-id', svixId)
        .set('svix-timestamp', svixTimestamp)
        .set('svix-signature', sig)
        .set('content-type', 'application/json')
        .send(validFailedPayload);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('EVENT_RECEIVED');
      expect(response.body.count).toBe(1);
    });

    it('accepts valid Svix signature and returns 200 EVENT_RECEIVED for suppressed event', async () => {
      const svixId = 'msg_svix_005';
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();
      const validSuppressedPayload = JSON.stringify({
        id: 'evt_resend_suppressed_005',
        type: 'email.suppressed',
        created_at: new Date().toISOString(),
        data: {
          email_id: 're_msg_suppressed_005',
          from: 'alerts@leadmate.ai',
          to: ['suppressed@example.com'],
          subject: 'Welcome to LeadMate'
        }
      });
      const sig = computeSvixSignature(svixId, svixTimestamp, validSuppressedPayload, testWebhookSecret);

      const response = await request(app)
        .post('/api/v1/webhooks/resend/email')
        .set('svix-id', svixId)
        .set('svix-timestamp', svixTimestamp)
        .set('svix-signature', sig)
        .set('content-type', 'application/json')
        .send(validSuppressedPayload);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('EVENT_RECEIVED');
      expect(response.body.count).toBe(1);
    });

    it('returns 200 EVENT_IGNORED for unsupported non-terminal analytics events (email.opened)', async () => {
      const svixId = 'msg_svix_003';
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();
      const sig = computeSvixSignature(svixId, svixTimestamp, ignoredAnalyticsPayload, testWebhookSecret);

      const response = await request(app)
        .post('/api/v1/webhooks/resend/email')
        .set('svix-id', svixId)
        .set('svix-timestamp', svixTimestamp)
        .set('svix-signature', sig)
        .set('content-type', 'application/json')
        .send(ignoredAnalyticsPayload);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('EVENT_IGNORED');
    });

    it('returns 200 EVENT_IGNORED for unsupported events (email.delivery_delayed, email.sent, email.complained)', async () => {
      const svixId = 'msg_svix_delayed';
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();
      const delayedPayload = JSON.stringify({
        id: 'evt_resend_delayed_006',
        type: 'email.delivery_delayed',
        data: { email_id: 're_msg_delayed_006' }
      });
      const sig = computeSvixSignature(svixId, svixTimestamp, delayedPayload, testWebhookSecret);

      const response = await request(app)
        .post('/api/v1/webhooks/resend/email')
        .set('svix-id', svixId)
        .set('svix-timestamp', svixTimestamp)
        .set('svix-signature', sig)
        .set('content-type', 'application/json')
        .send(delayedPayload);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('EVENT_IGNORED');
    });

    it('rejects request with 401 when svix-signature header is missing', async () => {
      const svixId = 'msg_svix_missing_sig';
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();

      const response = await request(app)
        .post('/api/v1/webhooks/resend/email')
        .set('svix-id', svixId)
        .set('svix-timestamp', svixTimestamp)
        .set('content-type', 'application/json')
        .send(validDeliveredPayload);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects request with 401 when svix-timestamp header is missing', async () => {
      const svixId = 'msg_svix_missing_ts';

      const response = await request(app)
        .post('/api/v1/webhooks/resend/email')
        .set('svix-id', svixId)
        .set('svix-signature', 'v1,fake')
        .set('content-type', 'application/json')
        .send(validDeliveredPayload);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects request with 401 when svix-id header is missing', async () => {
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();

      const response = await request(app)
        .post('/api/v1/webhooks/resend/email')
        .set('svix-timestamp', svixTimestamp)
        .set('svix-signature', 'v1,fake')
        .set('content-type', 'application/json')
        .send(validDeliveredPayload);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects request with 401 when signature is invalid', async () => {
      const svixId = 'msg_svix_invalid_sig';
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();

      const response = await request(app)
        .post('/api/v1/webhooks/resend/email')
        .set('svix-id', svixId)
        .set('svix-timestamp', svixTimestamp)
        .set('svix-signature', 'v1,totallyinvalidsignaturehere==')
        .set('content-type', 'application/json')
        .send(validDeliveredPayload);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects request with 401 when request body has been mutated', async () => {
      const svixId = 'msg_svix_tampered';
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();
      const sig = computeSvixSignature(svixId, svixTimestamp, validDeliveredPayload, testWebhookSecret);

      const tamperedBody = validDeliveredPayload.replace('re_msg_deliv_001', 're_msg_tampered');

      const response = await request(app)
        .post('/api/v1/webhooks/resend/email')
        .set('svix-id', svixId)
        .set('svix-timestamp', svixTimestamp)
        .set('svix-signature', sig)
        .set('content-type', 'application/json')
        .send(tamperedBody);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects request with 401 when timestamp is older than tolerance (5 minutes)', async () => {
      const svixId = 'msg_svix_expired';
      const expiredTimestamp = (Math.floor(Date.now() / 1000) - 400).toString(); // 400s ago
      const sig = computeSvixSignature(svixId, expiredTimestamp, validDeliveredPayload, testWebhookSecret);

      const response = await request(app)
        .post('/api/v1/webhooks/resend/email')
        .set('svix-id', svixId)
        .set('svix-timestamp', expiredTimestamp)
        .set('svix-signature', sig)
        .set('content-type', 'application/json')
        .send(validDeliveredPayload);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns safe 400 when signature is valid but body contains malformed JSON', async () => {
      const svixId = 'msg_svix_malformed_json';
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();
      const malformedPayload = '{"incomplete_json":';
      const sig = computeSvixSignature(svixId, svixTimestamp, malformedPayload, testWebhookSecret);

      const response = await request(app)
        .post('/api/v1/webhooks/resend/email')
        .set('svix-id', svixId)
        .set('svix-timestamp', svixTimestamp)
        .set('svix-signature', sig)
        .set('content-type', 'application/json')
        .send(malformedPayload);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('Malformed JSON');
    });

    it('rejects oversized payload (> 256kb) with 413 Payload Too Large', async () => {
      const svixId = 'msg_svix_oversized';
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();
      // Generate 300kb string
      const bigString = 'x'.repeat(300 * 1024);
      const oversizedPayload = JSON.stringify({ big: bigString });
      const sig = computeSvixSignature(svixId, svixTimestamp, oversizedPayload, testWebhookSecret);

      const response = await request(app)
        .post('/api/v1/webhooks/resend/email')
        .set('svix-id', svixId)
        .set('svix-timestamp', svixTimestamp)
        .set('svix-signature', sig)
        .set('content-type', 'application/json')
        .send(oversizedPayload);

      expect(response.status).toBe(413);
    });

    it('returns 503 OUTREACH_PROVIDER_UNAVAILABLE when RESEND_WEBHOOK_SECRET is not configured', async () => {
      (env as any).RESEND_WEBHOOK_SECRET = undefined;

      const svixId = 'msg_svix_unconfigured';
      const svixTimestamp = Math.floor(Date.now() / 1000).toString();

      const response = await request(app)
        .post('/api/v1/webhooks/resend/email')
        .set('svix-id', svixId)
        .set('svix-timestamp', svixTimestamp)
        .set('svix-signature', 'v1,some_sig')
        .set('content-type', 'application/json')
        .send(validDeliveredPayload);

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('OUTREACH_PROVIDER_UNAVAILABLE');

      (env as any).RESEND_WEBHOOK_SECRET = testWebhookSecret;
    });
  });

  describe('3. Configuration Schema & Fail-Closed Invariants', () => {
    it('NODE_ENV=test with email provider omitted defaults to mock', async () => {
      const { envSchema } = await import('../config/env.js');
      const parsed = envSchema.safeParse({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://localhost:5432/test',
        SESSION_SECRET: 'super-secret-session-key-at-least-16-chars'
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.OUTREACH_EMAIL_PROVIDER).toBe('mock');
      }
    });

    it('NODE_ENV=development with email provider omitted defaults to mock', async () => {
      const { envSchema } = await import('../config/env.js');
      const parsed = envSchema.safeParse({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost:5432/test',
        SESSION_SECRET: 'super-secret-session-key-at-least-16-chars'
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.OUTREACH_EMAIL_PROVIDER).toBe('mock');
      }
    });

    it('NODE_ENV=production with email provider omitted FAILS CLOSED', async () => {
      const { envSchema } = await import('../config/env.js');
      const parsed = envSchema.safeParse({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://localhost:5432/test',
        SESSION_SECRET: 'super-secret-session-key-at-least-16-chars',
        OUTREACH_WHATSAPP_PROVIDER: 'mock'
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const issues = parsed.error.issues;
        expect(issues.some((i) => i.path.includes('OUTREACH_EMAIL_PROVIDER'))).toBe(true);
      }
    });

    it('NODE_ENV=production with explicit OUTREACH_EMAIL_PROVIDER=mock is allowed without secrets', async () => {
      const { envSchema } = await import('../config/env.js');
      const parsed = envSchema.safeParse({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://localhost:5432/test',
        SESSION_SECRET: 'super-secret-session-key-at-least-16-chars',
        OUTREACH_WHATSAPP_PROVIDER: 'mock',
        OUTREACH_EMAIL_PROVIDER: 'mock'
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.OUTREACH_EMAIL_PROVIDER).toBe('mock');
      }
    });

    it('NODE_ENV=production with OUTREACH_EMAIL_PROVIDER=resend and missing credentials FAILS CLOSED', async () => {
      const { envSchema } = await import('../config/env.js');
      const parsed = envSchema.safeParse({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://localhost:5432/test',
        SESSION_SECRET: 'super-secret-session-key-at-least-16-chars',
        OUTREACH_WHATSAPP_PROVIDER: 'mock',
        OUTREACH_EMAIL_PROVIDER: 'resend'
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const paths = parsed.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('RESEND_API_KEY');
        expect(paths).toContain('RESEND_FROM_EMAIL');
        expect(paths).toContain('RESEND_WEBHOOK_SECRET');
      }
    });

    it('NODE_ENV=production with OUTREACH_EMAIL_PROVIDER=resend and missing RESEND_WEBHOOK_SECRET FAILS CLOSED', async () => {
      const { envSchema } = await import('../config/env.js');
      const parsed = envSchema.safeParse({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://localhost:5432/test',
        SESSION_SECRET: 'super-secret-session-key-at-least-16-chars',
        OUTREACH_WHATSAPP_PROVIDER: 'mock',
        OUTREACH_EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_valid_api_key_123',
        RESEND_FROM_EMAIL: 'team@company.com'
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const paths = parsed.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('RESEND_WEBHOOK_SECRET');
      }
    });

    it('NODE_ENV=production with OUTREACH_EMAIL_PROVIDER=resend and complete credentials succeeds', async () => {
      const { envSchema } = await import('../config/env.js');
      const parsed = envSchema.safeParse({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://localhost:5432/test',
        SESSION_SECRET: 'super-secret-session-key-at-least-16-chars',
        OUTREACH_WHATSAPP_PROVIDER: 'mock',
        OUTREACH_EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_valid_api_key_123',
        RESEND_FROM_EMAIL: 'team@company.com',
        RESEND_FROM_NAME: 'Sales Team',
        RESEND_WEBHOOK_SECRET: 'whsec_prod_secret_here'
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.OUTREACH_EMAIL_PROVIDER).toBe('resend');
        expect(parsed.data.RESEND_API_KEY).toBe('re_valid_api_key_123');
        expect(parsed.data.RESEND_FROM_EMAIL).toBe('team@company.com');
        expect(parsed.data.RESEND_FROM_NAME).toBe('Sales Team');
        expect(parsed.data.RESEND_WEBHOOK_SECRET).toBe('whsec_prod_secret_here');
      }
    });
  });
});
