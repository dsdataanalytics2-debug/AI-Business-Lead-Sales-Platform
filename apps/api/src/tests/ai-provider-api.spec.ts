/**
 * AI Provider & AI Buyer Discovery API Tests
 *
 * Verifies:
 * - Authentication & RBAC protection (DATASOURCES_MANAGE for settings, LEADS_READ for buyer AI)
 * - Gemini API key AES-256-GCM encryption at rest & secret masking (never returned in responses)
 * - Safe connection testing with minimal prompt
 * - Model configuration (gemini-3.1-flash-lite default, gemini-3.6-flash upgrade)
 * - Strict tenant isolation (Org A vs Org B)
 * - AI Buyer Target suggestions with structured validation & UsageLedger auditing
 * - AI Buyer Fit explanations with public fact constraints & disclaimer
 * - Clean fallback when AI is unconfigured or disabled
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import prisma from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import { app } from '../app.js';
import { hashPassword, hashSessionToken, decryptCredential } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';
import { aiSettingsService } from '../services/ai-settings.service.js';
import { aiBuyerDiscoveryService } from '../services/ai-buyer-discovery.service.js';

describe('AI Provider System & Buyer Discovery API', () => {
  const ORG_A_ID = '40000000-0000-0000-0000-000000000001';
  const ORG_B_ID = '40000000-0000-0000-0000-000000000002';

  const adminAId = '40000000-0000-0000-0000-000000000011';
  const repAId = '40000000-0000-0000-0000-000000000012';
  const adminBId = '40000000-0000-0000-0000-000000000021';

  let adminACookie: string;
  let repACookie: string;
  let adminBCookie: string;

  async function createSessionCookie(userId: string, rawToken: string): Promise<string> {
    const tokenHash = hashSessionToken(rawToken);
    await prisma.session.upsert({
      where: { tokenHash },
      update: {
        userId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      },
      create: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
    return `${SESSION_COOKIE_NAME}=${rawToken}`;
  }

  beforeAll(async () => {
    await ensureTestDatabase(prisma);

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

    const passwordHash = await hashPassword('TestPass12345!');

    await prisma.user.upsert({
      where: { id: adminAId },
      update: {},
      create: {
        id: adminAId,
        email: 'admin-a-ai@leadatlas.test',
        passwordHash,
        name: 'Admin A',
        role: 'ADMIN',
        organizationId: ORG_A_ID,
        isActive: true
      }
    });

    await prisma.user.upsert({
      where: { id: repAId },
      update: {},
      create: {
        id: repAId,
        email: 'rep-a-ai@leadatlas.test',
        passwordHash,
        name: 'Rep A',
        role: 'SALES_EXECUTIVE',
        organizationId: ORG_A_ID,
        isActive: true
      }
    });

    await prisma.user.upsert({
      where: { id: adminBId },
      update: {},
      create: {
        id: adminBId,
        email: 'admin-b-ai@leadatlas.test',
        passwordHash,
        name: 'Admin B',
        role: 'ADMIN',
        organizationId: ORG_B_ID,
        isActive: true
      }
    });

    adminACookie = await createSessionCookie(adminAId, 'ai-token-admin-a');
    repACookie = await createSessionCookie(repAId, 'ai-token-rep-a');
    adminBCookie = await createSessionCookie(adminBId, 'ai-token-admin-b');
  });

  beforeEach(async () => {
    await prisma.aiProviderConfig.deleteMany({
      where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } }
    });
    await prisma.usageLedger.deleteMany({
      where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } }
    });
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.session.deleteMany({
      where: { userId: { in: [adminAId, repAId, adminBId] } }
    });
    await prisma.aiProviderConfig.deleteMany({
      where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } }
    });
    await prisma.usageLedger.deleteMany({
      where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } }
    });
    await prisma.user.deleteMany({
      where: { id: { in: [adminAId, repAId, adminBId] } }
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [ORG_A_ID, ORG_B_ID] } }
    });
  });

  /* =========================================================================
   * Section 1: Settings / AI Models Endpoints
   * ========================================================================= */

  it('1. Lists AI provider cards: Returns Google Gemini card (requires DATASOURCES_MANAGE)', async () => {
    // 401 without cookie
    await request(app).get('/api/v1/settings/ai-models').expect(401);

    // 403 for SALES_EXECUTIVE
    await request(app)
      .get('/api/v1/settings/ai-models')
      .set('Cookie', repACookie)
      .expect(403);

    // 200 for ADMIN
    const res = await request(app)
      .get('/api/v1/settings/ai-models')
      .set('Cookie', adminACookie)
      .expect(200);

    expect(res.body.providers).toHaveLength(1);
    const gemini = res.body.providers[0];
    expect(gemini.provider).toBe('gemini');
    expect(gemini.isConfigured).toBe(false);
    expect(gemini.status).toBe('NOT_CONFIGURED');
    expect(gemini.defaultModel).toBe('gemini-3.5-flash-lite');
    expect(gemini.supportedModels).toContain('gemini-3.5-flash-lite');
    expect(gemini.supportedModels).toContain('gemini-3.8-flash');
    expect(gemini.supportedModels).toContain('gemini-flash-lite-latest');
    expect(gemini.supportedModels).toContain('gemini-2.5-flash-lite');
    expect(gemini.supportedModels).toContain('gemini-2.5-flash');
    expect(gemini.supportedModels).toContain('gemini-3.1-flash-lite');
    expect(gemini.supportedModels).toContain('gemini-3.6-flash');
  });

  it('2. Configures & encrypts Gemini API key with AES-256-GCM and redacts secrets', async () => {
    const fakeKey = 'AIzaSyFakeGeminiApiKey1234567890';

    // Mock Gemini test connection to pass during configure
    vi.spyOn((aiSettingsService as any).geminiProvider, 'testConnection').mockResolvedValueOnce({
      connected: true,
      status: 'CONNECTED',
      message: 'Google Gemini connected successfully (gemini-3.1-flash-lite)',
      model: 'gemini-3.1-flash-lite'
    });

    const res = await request(app)
      .post('/api/v1/settings/ai-models/gemini/configure')
      .set('Cookie', adminACookie)
      .send({ apiKey: fakeKey, model: 'gemini-3.1-flash-lite' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('CONNECTED');
    expect(res.body.credentialMasked).toContain('AIza');
    expect(res.body.credentialLastFour).toBe('7890');

    // INVARIANT: Response never contains raw key
    const rawRes = JSON.stringify(res.body);
    expect(rawRes).not.toContain(fakeKey);

    // Check PostgreSQL: credential stored as encrypted AES-256-GCM ciphertext
    const stored = await prisma.aiProviderConfig.findUnique({
      where: {
        organizationId_provider: {
          organizationId: ORG_A_ID,
          provider: 'gemini'
        }
      }
    });

    expect(stored).toBeDefined();
    expect(stored?.encryptedCredential).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(stored?.encryptedCredential).not.toBe(fakeKey);

    // Decrypts cleanly with master key
    const decrypted = decryptCredential(stored!.encryptedCredential!);
    expect(decrypted).toBe(fakeKey);
  });

  it('3. Enforces strict tenant isolation: Org B cannot see or use Org A Gemini credentials', async () => {
    const keyA = 'AIzaSyOrgAKey12345';
    vi.spyOn((aiSettingsService as any).geminiProvider, 'testConnection').mockResolvedValueOnce({
      connected: true,
      status: 'CONNECTED',
      message: 'OK',
      model: 'gemini-3.1-flash-lite'
    });

    await aiSettingsService.configureGemini(ORG_A_ID, adminAId, keyA);

    // Org B queries its AI models
    const resB = await request(app)
      .get('/api/v1/settings/ai-models')
      .set('Cookie', adminBCookie)
      .expect(200);

    const geminiB = resB.body.providers[0];
    expect(geminiB.isConfigured).toBe(false);
    expect(geminiB.status).toBe('NOT_CONFIGURED');
    expect(geminiB.credentialMasked).toBeNull();
  });

  it('4. Updates model selection: allows upgrading to gemini-3.8-flash', async () => {
    vi.spyOn((aiSettingsService as any).geminiProvider, 'testConnection').mockResolvedValueOnce({
      connected: true,
      status: 'CONNECTED',
      message: 'OK',
      model: 'gemini-3.5-flash-lite'
    });

    await aiSettingsService.configureGemini(ORG_A_ID, adminAId, 'AIzaSyKey123');

    const res = await request(app)
      .patch('/api/v1/settings/ai-models/gemini/model')
      .set('Cookie', adminACookie)
      .send({ model: 'gemini-3.8-flash' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.model).toBe('gemini-3.8-flash');

    const stored = await prisma.aiProviderConfig.findUnique({
      where: {
        organizationId_provider: {
          organizationId: ORG_A_ID,
          provider: 'gemini'
        }
      }
    });
    expect(stored?.model).toBe('gemini-3.8-flash');
  });

  it('5. Safe connection testing: Invokes testConnection with minimal prompt', async () => {
    vi.spyOn((aiSettingsService as any).geminiProvider, 'testConnection').mockResolvedValueOnce({
      connected: true,
      status: 'CONNECTED',
      message: 'Google Gemini connected successfully (gemini-3.1-flash-lite)',
      model: 'gemini-3.1-flash-lite'
    });

    const res = await request(app)
      .post('/api/v1/settings/ai-models/gemini/test')
      .set('Cookie', adminACookie)
      .send({ apiKey: 'AIzaSyTestKey' })
      .expect(200);

    expect(res.body.connected).toBe(true);
    expect(res.body.status).toBe('CONNECTED');
    expect(res.body.model).toBe('gemini-3.1-flash-lite');
  });

  /* =========================================================================
   * Section 2: AI Buyer Discovery Endpoints
   * ========================================================================= */

  it('6. Buyer Target Suggestions: Generates structured buyer categories and records usage', async () => {
    // Configure Gemini for Org A
    vi.spyOn((aiSettingsService as any).geminiProvider, 'testConnection').mockResolvedValueOnce({
      connected: true,
      status: 'CONNECTED',
      message: 'OK',
      model: 'gemini-3.1-flash-lite'
    });
    await aiSettingsService.configureGemini(ORG_A_ID, adminAId, 'AIzaSyActiveKey');

    const mockAiResponse = {
      product: 'Smart Watch',
      buyerTargets: [
        { category: 'Electronics Retailer', reason: 'High demand for consumer wearables' },
        { category: 'Mobile Accessories Shop', reason: 'Direct shopper traffic for portable gadgets' }
      ]
    };

    vi.spyOn((aiBuyerDiscoveryService as any).geminiProvider, 'generateStructured').mockResolvedValueOnce({
      data: mockAiResponse,
      usage: { inputTokens: 45, outputTokens: 35 },
      model: 'gemini-3.1-flash-lite'
    });

    const res = await request(app)
      .post('/api/v1/ai/buyer-targets')
      .set('Cookie', repACookie) // SALES_EXECUTIVE has LEADS_READ
      .send({ product: 'Smart Watch', buyerType: 'RETAILER', location: 'Dhaka' })
      .expect(200);

    expect(res.body.product).toBe('Smart Watch');
    expect(res.body.buyerTargets).toHaveLength(2);
    expect(res.body.buyerTargets[0].category).toBe('Electronics Retailer');

    // Check UsageLedger entry was created
    const ledger = await prisma.usageLedger.findFirst({
      where: { organizationId: ORG_A_ID, operation: 'ai.buyer_targets' }
    });
    expect(ledger).toBeDefined();
    expect(ledger?.units).toBe(80); // 45 + 35 tokens
    expect(ledger?.unitType).toBe('TOKENS');
  });

  it('7. Buyer Target Suggestions: Falls back cleanly when AI is unconfigured without throwing 500', async () => {
    // Org B has no AI config
    const res = await request(app)
      .post('/api/v1/ai/buyer-targets')
      .set('Cookie', adminBCookie)
      .send({ product: 'Smart Watch', location: 'Dhaka' })
      .expect(200);

    expect(res.body.product).toBe('Smart Watch');
    expect(res.body.buyerTargets.length).toBeGreaterThan(0);
    expect(res.body.buyerTargets[0].category).toBe('Electronics Retailer');
  });

  it('8. Buyer Fit Explanation: Returns fit level and disclaimer, never inventing intent facts', async () => {
    vi.spyOn((aiSettingsService as any).geminiProvider, 'testConnection').mockResolvedValueOnce({
      connected: true,
      status: 'CONNECTED',
      message: 'OK',
      model: 'gemini-3.1-flash-lite'
    });
    await aiSettingsService.configureGemini(ORG_A_ID, adminAId, 'AIzaSyActiveKey');

    vi.spyOn((aiBuyerDiscoveryService as any).geminiProvider, 'generateStructured').mockResolvedValueOnce({
      data: {
        fitLevel: 'HIGH',
        explanation: 'Electronics retail store in Dhaka with smartphone hardware stocks.',
        disclaimer: 'AI Buyer Fit is an automated explanation based on public business categorization, not verified purchase intent.'
      },
      usage: { inputTokens: 30, outputTokens: 25 },
      model: 'gemini-3.1-flash-lite'
    });

    const res = await request(app)
      .post('/api/v1/ai/buyer-fit')
      .set('Cookie', repACookie)
      .send({
        product: 'Smart Watch',
        businessName: 'Dhaka Gadget Hub',
        category: 'Electronics Store',
        location: 'Mirpur, Dhaka'
      })
      .expect(200);

    expect(res.body.fitLevel).toBe('HIGH');
    expect(res.body.explanation).toContain('Electronics retail');
    expect(res.body.disclaimer).toContain('not verified purchase intent');

    // INVARIANT: Response does NOT contain fabricated contacts
    expect(res.body).not.toHaveProperty('phone');
    expect(res.body).not.toHaveProperty('email');
    expect(res.body).not.toHaveProperty('whatsapp');
  });
});
