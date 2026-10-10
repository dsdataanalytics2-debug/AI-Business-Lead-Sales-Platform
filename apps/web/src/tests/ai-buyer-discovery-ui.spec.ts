/**
 * AI Buyer Discovery & Gemini Integration UI / Integration Tests
 *
 * Verifies:
 * 1. AI Settings API client endpoints (/settings/ai-models)
 * 2. Model selection: default `gemini-3.1-flash-lite` and stronger `gemini-3.6-flash`
 * 3. AES-256-GCM encrypted credential handling with secret redaction
 * 4. Safe connection ping with mock AI provider (ZERO external Gemini calls)
 * 5. Buyer target category suggestions with structured outputs
 * 6. Buyer fit explanations with explicit non-fact AI labeling
 * 7. Tenant isolation (Org A vs Org B)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import prisma from '@leadmate/db';
import { app } from '../../../api/src/app.js';
import { hashPassword, hashSessionToken, encryptCredential } from '../../../api/src/lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../../../api/src/services/session.service.js';
import { apiClient } from '../lib/api-client.js';
import { ensureTestDatabase } from './helpers/test-db-guard.js';

describe('AI Buyer Discovery & Provider Integration Spec', () => {
  let server: http.Server;
  let serverPort: number;

  const ORG_A_ID = '40000000-0000-0000-0000-000000000001';
  const ORG_B_ID = '40000000-0000-0000-0000-000000000002';
  const ADMIN_A_ID = '40000000-0000-0000-0000-000000000011';
  const ADMIN_B_ID = '40000000-0000-0000-0000-000000000012';

  const rawTokenA = 'test_token_ai_admin_a_1234567890123456';
  const rawTokenB = 'test_token_ai_admin_b_1234567890123456';

  beforeAll(async () => {
    await ensureTestDatabase(prisma);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          serverPort = addr.port;
          process.env.NEXT_PUBLIC_API_URL = `http://localhost:${serverPort}/api/v1`;
        }
        resolve();
      });
    });

    // Create Org A & Org B
    await prisma.organization.upsert({
      where: { id: ORG_A_ID },
      update: {},
      create: { id: ORG_A_ID, name: 'AI Test Org A', timezone: 'Asia/Dhaka' }
    });
    await prisma.organization.upsert({
      where: { id: ORG_B_ID },
      update: {},
      create: { id: ORG_B_ID, name: 'AI Test Org B', timezone: 'Asia/Dhaka' }
    });

    const pwdHash = await hashPassword('ValidPass12345!');

    await prisma.user.upsert({
      where: { email: 'ai-admin-a@test.leadmate' },
      update: {},
      create: {
        id: ADMIN_A_ID,
        organizationId: ORG_A_ID,
        email: 'ai-admin-a@test.leadmate',
        passwordHash: pwdHash,
        name: 'AI Admin A',
        role: 'ADMIN'
      }
    });

    await prisma.user.upsert({
      where: { email: 'ai-admin-b@test.leadmate' },
      update: {},
      create: {
        id: ADMIN_B_ID,
        organizationId: ORG_B_ID,
        email: 'ai-admin-b@test.leadmate',
        passwordHash: pwdHash,
        name: 'AI Admin B',
        role: 'ADMIN'
      }
    });

    await prisma.session.upsert({
      where: { tokenHash: hashSessionToken(rawTokenA) },
      update: { userId: ADMIN_A_ID, expiresAt: new Date(Date.now() + 86400000) },
      create: {
        userId: ADMIN_A_ID,
        tokenHash: hashSessionToken(rawTokenA),
        expiresAt: new Date(Date.now() + 86400000)
      }
    });

    await prisma.session.upsert({
      where: { tokenHash: hashSessionToken(rawTokenB) },
      update: { userId: ADMIN_B_ID, expiresAt: new Date(Date.now() + 86400000) },
      create: {
        userId: ADMIN_B_ID,
        tokenHash: hashSessionToken(rawTokenB),
        expiresAt: new Date(Date.now() + 86400000)
      }
    });
  });

  afterAll(async () => {
    await prisma.session.deleteMany({
      where: { userId: { in: [ADMIN_A_ID, ADMIN_B_ID] } }
    });
    await prisma.aiProviderConfig.deleteMany({
      where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } }
    });
    await prisma.usageLedger.deleteMany({
      where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } }
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ADMIN_A_ID, ADMIN_B_ID] } }
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [ORG_A_ID, ORG_B_ID] } }
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('1. Fetches AI providers list with Google Gemini card and default model', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: any, init: any) => {
      const headers = new Headers(init?.headers);
      headers.set('Cookie', `${SESSION_COOKIE_NAME}=${rawTokenA}`);
      return originalFetch(url, { ...init, headers });
    });

    try {
      const res = await apiClient.getAiProviders();
      expect(res.providers).toBeDefined();
      expect(Array.isArray(res.providers)).toBe(true);
      const geminiCard = res.providers.find((p: any) => p.provider === 'gemini');
      expect(geminiCard).toBeDefined();
      expect(geminiCard.defaultModel).toBe('gemini-3.5-flash-lite');
      expect(geminiCard.supportedModels).toContain('gemini-3.5-flash-lite');
      expect(geminiCard.supportedModels).toContain('gemini-3.8-flash');
      expect(geminiCard.supportedModels).toContain('gemini-3.1-flash-lite');
      expect(geminiCard.supportedModels).toContain('gemini-3.6-flash');
      expect(geminiCard.supportedModels).not.toContain('gemini-3.5-flash');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('2. Configures and updates model choice without exposing raw API key', async () => {
    // Zero external Gemini call: Mock testConnection
    const { aiSettingsService } = await import('../../../api/src/services/ai-settings.service.js');
    vi.spyOn((aiSettingsService as any).geminiProvider, 'testConnection').mockResolvedValueOnce({
      connected: true,
      status: 'CONNECTED',
      message: 'OK',
      model: 'gemini-3.5-flash-lite'
    });

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: any, init: any) => {
      const headers = new Headers(init?.headers);
      headers.set('Cookie', `${SESSION_COOKIE_NAME}=${rawTokenA}`);
      return originalFetch(url, { ...init, headers });
    });

    try {
      const configRes = await apiClient.configureAiProvider('gemini', {
        apiKey: 'AIzaSyMockKeyForOrgA99999',
        model: 'gemini-3.5-flash-lite'
      });
      expect(configRes.success).toBe(true);
      const masked = configRes.config?.credentialMasked || (configRes as any).credentialMasked;
      expect(masked).toContain('••••');
      expect(masked).not.toContain('AIzaSyMockKey');

      // Update to stronger model: gemini-3.8-flash
      const modelRes = await apiClient.updateAiModel('gemini', 'gemini-3.8-flash');
      expect(modelRes.success).toBe(true);
      expect(modelRes.model).toBe('gemini-3.8-flash');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('3. Generates structured AI Buyer Target Suggestions with graceful mock fallback', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: any, init: any) => {
      const headers = new Headers(init?.headers);
      headers.set('Cookie', `${SESSION_COOKIE_NAME}=${rawTokenA}`);
      return originalFetch(url, { ...init, headers });
    });

    try {
      const res = await apiClient.suggestBuyerTargets({
        product: 'Smart Watch',
        location: 'Dhaka',
        count: 5
      });

      const targets = res.buyerTargets || res.categories || [];
      expect(targets.length).toBeGreaterThan(0);
      expect(targets[0].category || targets[0].name).toBeDefined();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('4. Explains Buyer Fit with explicit AI disclaimer and non-fact labeling', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: any, init: any) => {
      const headers = new Headers(init?.headers);
      headers.set('Cookie', `${SESSION_COOKIE_NAME}=${rawTokenA}`);
      return originalFetch(url, { ...init, headers });
    });

    try {
      const res = await apiClient.explainBuyerFit({
        product: 'Smart Watch',
        businessName: 'Gadget Express Dhaka',
        category: 'Electronics Store',
        location: 'Mirpur, Dhaka',
        signals: ['Catalog Gap', 'Promotional Activity']
      });

      expect(res.fitLevel).toBeDefined();
      expect(['HIGH', 'MEDIUM', 'LOW']).toContain(res.fitLevel);
      expect(res.explanation).toBeDefined();
      expect(typeof res.explanation).toBe('string');
      expect(res.disclaimer.toLowerCase()).toContain('not verified');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('5. Enforces tenant credential isolation (Org B cannot see Org A credentials)', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: any, init: any) => {
      const headers = new Headers(init?.headers);
      // Request as Org B
      headers.set('Cookie', `${SESSION_COOKIE_NAME}=${rawTokenB}`);
      return originalFetch(url, { ...init, headers });
    });

    try {
      const res = await apiClient.getAiProviders();
      const geminiCard = res.providers.find((p: any) => p.provider === 'gemini');
      expect(geminiCard).toBeDefined();
      // Org B has NOT configured credentials
      expect(geminiCard.isConfigured).toBe(false);
      expect(geminiCard.credentialMasked).toBeNull();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
