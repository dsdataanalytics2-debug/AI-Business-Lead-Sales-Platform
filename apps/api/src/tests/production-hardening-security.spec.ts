import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import prisma, { Role } from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import { createApp } from '../app.js';
import { hashPassword } from '../lib/crypto.js';
import { resetAllRateLimiters } from '../middleware/rate-limiter.js';
import { env } from '../config/env.js';

describe('Production Hardening: Security Headers, CSRF/Origin Guard, and Rate Limiting', () => {
  const app = createApp();
  let org: any;
  let user: any;
  let sessionCookie: string;

  beforeAll(async () => {
    await ensureTestDatabase(prisma);

    org = await prisma.organization.create({
      data: { name: `Security Test Org ${Date.now()}` }
    });

    const passHash = await hashPassword('AdminPass123!');
    user = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `sec-user-${Date.now()}@test.local`,
        passwordHash: passHash,
        name: 'Sec Admin',
        role: Role.ADMIN
      }
    });

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'AdminPass123!' });

    sessionCookie = loginRes.headers['set-cookie'][0];
  });

  beforeEach(() => {
    resetAllRateLimiters();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('1. Helmet Security Headers', () => {
    it('sets standard security response headers on HTTP endpoints', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });
  });

  describe('2. Origin / Referer Validation (CSRF Protection)', () => {
    it('allows mutating requests with trusted APP_BASE_URL origin', async () => {
      const res = await request(app)
        .post('/api/v1/locations/suggest')
        .set('Cookie', sessionCookie)
        .set('Origin', env.APP_BASE_URL)
        .send();

      // Should not be 403 Forbidden
      expect(res.status).not.toBe(403);
    });

    it('blocks mutating requests with untrusted Origin header with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/locations/suggest')
        .set('Cookie', sessionCookie)
        .set('Origin', 'https://evil-attacker.com')
        .send();

      expect(res.status).toBe(403);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.message).toContain('untrusted origin');
    });

    it('allows mutating requests with trusted Referer when Origin header is absent', async () => {
      const res = await request(app)
        .post('/api/v1/locations/suggest')
        .set('Cookie', sessionCookie)
        .set('Referer', `${env.APP_BASE_URL}/sales-missions/new`)
        .send();

      expect(res.status).not.toBe(403);
    });

    it('blocks mutating requests with untrusted Referer header with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/locations/suggest')
        .set('Cookie', sessionCookie)
        .set('Referer', 'https://phishing-site.com/steal')
        .send();

      expect(res.status).toBe(403);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.message).toContain('untrusted referer');
    });

    it('does NOT block server-to-server webhook routes with origin checks', async () => {
      // POST to meta webhook with cross-origin or no origin should pass to webhook handler, not 403 origin guard
      const res = await request(app)
        .post('/api/v1/webhooks/meta/whatsapp')
        .set('Origin', 'https://graph.facebook.com')
        .send({ object: 'whatsapp_business_account', entry: [] });

      // Handled by webhook HMAC verification (401 or 400), NEVER 403 origin guard
      expect(res.status).not.toBe(403);
    });
  });

  describe('3. Rate Limiting on Wholesale Sales Engine Routes', () => {
    it('throttles location search when exceeding rate limit and returns 429 with Retry-After', async () => {
      // Limit is 60 req/min for location search
      let lastRes: any;
      for (let i = 0; i < 62; i++) {
        lastRes = await request(app)
          .get('/api/v1/locations/search?q=Dhaka')
          .set('Cookie', sessionCookie);
      }

      expect(lastRes.status).toBe(429);
      expect(lastRes.headers['retry-after']).toBeDefined();
      expect(lastRes.body.error.code).toBe('RATE_LIMITED');
      expect(lastRes.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('throttles AI product analysis when exceeding rate limit', async () => {
      // Limit is 20 req/min for AI product analysis
      let lastRes: any;
      for (let i = 0; i < 22; i++) {
        lastRes = await request(app)
          .post('/api/v1/sales-missions/analyze-product')
          .set('Cookie', sessionCookie)
          .send({
            name: 'Sample Wholesale Product',
            description: 'Organic green tea bulk packs'
          });
      }

      expect(lastRes.status).toBe(429);
      expect(lastRes.headers['retry-after']).toBeDefined();
      expect(lastRes.body.error.code).toBe('RATE_LIMITED');
    });
  });
});
