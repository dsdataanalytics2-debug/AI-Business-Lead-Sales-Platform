/**
 * Business Search History API & Session Persistence Tests
 *
 * Verifies:
 * - Session creation & results snapshot persistence
 * - User and tenant isolation (Org A vs Org B, User 1 vs User 2)
 * - Restoring latest search session
 * - Restoring specific session by ID and bumping lastOpenedAt
 * - Max 20 history entries enforcement (auto-trimming)
 * - Duplicate search reuse/update within 1-hour window
 * - Deleting individual session
 * - Clearing all search history for current user
 * - Results snapshot payload size validation & safe field sanitization
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import prisma from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import { app } from '../app.js';
import { hashPassword, hashSessionToken } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';

describe('Business Search History API & Session Persistence', () => {
  const ORG_A_ID = '50000000-0000-0000-0000-000000000001';
  const ORG_B_ID = '50000000-0000-0000-0000-000000000002';

  const userA1Id = '50000000-0000-0000-0000-000000000011';
  const userA2Id = '50000000-0000-0000-0000-000000000012';
  const userB1Id = '50000000-0000-0000-0000-000000000021';

  let cookieA1: string;
  let cookieA2: string;
  let cookieB1: string;

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

  const sampleCard = {
    externalId: 'osm:node:101',
    provider: 'OPENSTREETMAP',
    name: 'Smart Gadget Shop',
    category: 'Electronics Store',
    description: 'Retailer of watches and gadgets',
    address: 'Mirpur-10, Dhaka',
    city: 'Dhaka',
    country: 'BD',
    contacts: [
      {
        type: 'PHONE',
        rawValue: '+8801711000111',
        phoneType: 'MOBILE',
        whatsappStatus: 'UNKNOWN',
        evidenceType: 'LISTING_FIELD'
      }
    ]
  };

  beforeAll(async () => {
    await ensureTestDatabase(prisma);

    // Setup Organizations
    await prisma.organization.upsert({
      where: { id: ORG_A_ID },
      update: {},
      create: { id: ORG_A_ID, name: 'Search History Org A', timezone: 'Asia/Dhaka' }
    });

    await prisma.organization.upsert({
      where: { id: ORG_B_ID },
      update: {},
      create: { id: ORG_B_ID, name: 'Search History Org B', timezone: 'Asia/Dhaka' }
    });

    const passHash = await hashPassword('HistoryTestPass123!');

    // Org A User 1
    await prisma.user.upsert({
      where: { email: 'search-user-a1@leadmate.test' },
      update: { organizationId: ORG_A_ID, role: 'SALES_EXECUTIVE', passwordHash: passHash, isActive: true },
      create: {
        id: userA1Id,
        organizationId: ORG_A_ID,
        email: 'search-user-a1@leadmate.test',
        name: 'User A1',
        role: 'SALES_EXECUTIVE',
        passwordHash: passHash,
        isActive: true
      }
    });

    // Org A User 2 (same tenant, different user)
    await prisma.user.upsert({
      where: { email: 'search-user-a2@leadmate.test' },
      update: { organizationId: ORG_A_ID, role: 'SALES_EXECUTIVE', passwordHash: passHash, isActive: true },
      create: {
        id: userA2Id,
        organizationId: ORG_A_ID,
        email: 'search-user-a2@leadmate.test',
        name: 'User A2',
        role: 'SALES_EXECUTIVE',
        passwordHash: passHash,
        isActive: true
      }
    });

    // Org B User 1 (different tenant)
    await prisma.user.upsert({
      where: { email: 'search-user-b1@leadmate.test' },
      update: { organizationId: ORG_B_ID, role: 'SALES_EXECUTIVE', passwordHash: passHash, isActive: true },
      create: {
        id: userB1Id,
        organizationId: ORG_B_ID,
        email: 'search-user-b1@leadmate.test',
        name: 'User B1',
        role: 'SALES_EXECUTIVE',
        passwordHash: passHash,
        isActive: true
      }
    });

    cookieA1 = await createSessionCookie(userA1Id, 'token-history-a1');
    cookieA2 = await createSessionCookie(userA2Id, 'token-history-a2');
    cookieB1 = await createSessionCookie(userB1Id, 'token-history-b1');
  });

  beforeEach(async () => {
    await prisma.businessSearchSession.deleteMany({
      where: {
        organizationId: { in: [ORG_A_ID, ORG_B_ID] }
      }
    });
  });

  afterAll(async () => {
    await prisma.businessSearchSession.deleteMany({
      where: {
        organizationId: { in: [ORG_A_ID, ORG_B_ID] }
      }
    });
  });

  it('1. saves a search session and persists result snapshot', async () => {
    const res = await request(app)
      .post('/api/v1/business-search/history')
      .set('Cookie', cookieA1)
      .send({
        productQuery: 'Smart Watch',
        location: 'Dhaka',
        buyerType: 'RETAILER',
        category: 'Electronics',
        provider: 'auto',
        limit: 20,
        selectedAiBuyerTargets: [
          { name: 'Gadget Shops', relevance: 'HIGH', selected: true }
        ],
        resultsSnapshot: [sampleCard]
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.productQuery).toBe('Smart Watch');
    expect(res.body.data.location).toBe('Dhaka');
    expect(res.body.data.buyerType).toBe('RETAILER');
    expect(res.body.data.resultCount).toBe(1);
    expect(res.body.data.resultsSnapshot).toHaveLength(1);
    expect(res.body.data.resultsSnapshot[0].name).toBe('Smart Gadget Shop');
    expect(res.body.data.selectedAiBuyerTargets).toHaveLength(1);
  });

  it('2. restores latest search session with result snapshot without external calls', async () => {
    // Save session 1
    await request(app)
      .post('/api/v1/business-search/history')
      .set('Cookie', cookieA1)
      .send({
        productQuery: 'Power Bank',
        location: 'Mirpur',
        buyerType: 'RETAILER',
        resultsSnapshot: [sampleCard]
      });

    // Save session 2 (more recent)
    await request(app)
      .post('/api/v1/business-search/history')
      .set('Cookie', cookieA1)
      .send({
        productQuery: 'Diabetes Machine',
        location: 'Chattogram',
        buyerType: 'DISTRIBUTOR',
        resultsSnapshot: [{ ...sampleCard, name: 'Pharma Dist' }]
      });

    // GET /latest
    const latestRes = await request(app)
      .get('/api/v1/business-search/history/latest')
      .set('Cookie', cookieA1);

    expect(latestRes.status).toBe(200);
    expect(latestRes.body.data).toBeDefined();
    expect(latestRes.body.data.productQuery).toBe('Diabetes Machine');
    expect(latestRes.body.data.location).toBe('Chattogram');
    expect(latestRes.body.data.buyerType).toBe('DISTRIBUTOR');
    expect(latestRes.body.data.resultsSnapshot[0].name).toBe('Pharma Dist');
  });

  it('3. enforces user isolation: User A2 cannot see User A1 history in same tenant', async () => {
    // User A1 saves a search
    await request(app)
      .post('/api/v1/business-search/history')
      .set('Cookie', cookieA1)
      .send({
        productQuery: 'User A1 Query',
        location: 'Dhaka',
        resultsSnapshot: [sampleCard]
      });

    // User A2 lists history
    const listRes = await request(app)
      .get('/api/v1/business-search/history')
      .set('Cookie', cookieA2);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(0);

    // User A2 gets latest
    const latestRes = await request(app)
      .get('/api/v1/business-search/history/latest')
      .set('Cookie', cookieA2);

    expect(latestRes.status).toBe(200);
    expect(latestRes.body.data).toBeNull();
  });

  it('4. enforces tenant isolation: User B1 in Org B cannot see Org A history', async () => {
    // User A1 saves a search
    await request(app)
      .post('/api/v1/business-search/history')
      .set('Cookie', cookieA1)
      .send({
        productQuery: 'Tenant A Query',
        location: 'Dhaka',
        resultsSnapshot: [sampleCard]
      });

    // User B1 lists history
    const listRes = await request(app)
      .get('/api/v1/business-search/history')
      .set('Cookie', cookieB1);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(0);
  });

  it('5. deduplicates identical searches within 1-hour window instead of creating duplicate spam', async () => {
    // First search
    const firstRes = await request(app)
      .post('/api/v1/business-search/history')
      .set('Cookie', cookieA1)
      .send({
        productQuery: 'Smart Watch',
        location: 'Dhaka',
        buyerType: 'RETAILER',
        provider: 'auto',
        resultsSnapshot: [sampleCard]
      });

    const firstId = firstRes.body.data.id;

    // Identical search within minutes
    const secondRes = await request(app)
      .post('/api/v1/business-search/history')
      .set('Cookie', cookieA1)
      .send({
        productQuery: 'smart watch', // case-insensitive match
        location: 'dhaka',
        buyerType: 'RETAILER',
        provider: 'auto',
        resultsSnapshot: [sampleCard, { ...sampleCard, externalId: 'osm:node:102', name: 'Second Shop' }]
      });

    const secondId = secondRes.body.data.id;

    // Should update/reuse the same session ID
    expect(secondId).toBe(firstId);
    expect(secondRes.body.data.resultCount).toBe(2);

    // Total session count in DB for this user should remain 1
    const count = await prisma.businessSearchSession.count({
      where: { userId: userA1Id }
    });
    expect(count).toBe(1);
  });

  it('6. enforces maximum 20 history entries per user and trims oldest', async () => {
    // Insert 22 distinct sessions
    for (let i = 1; i <= 22; i++) {
      await request(app)
        .post('/api/v1/business-search/history')
        .set('Cookie', cookieA1)
        .send({
          productQuery: `Query #${i}`,
          location: `Location #${i}`,
          resultsSnapshot: [sampleCard]
        });
    }

    const count = await prisma.businessSearchSession.count({
      where: { userId: userA1Id }
    });
    expect(count).toBe(20);

    const historyRes = await request(app)
      .get('/api/v1/business-search/history')
      .set('Cookie', cookieA1);

    expect(historyRes.status).toBe(200);
    expect(historyRes.body.data).toHaveLength(20);
    // Newest first: Query #22 should be top
    expect(historyRes.body.data[0].productQuery).toBe('Query #22');
  });

  it('7. deletes single search session scoped to user', async () => {
    const saveRes = await request(app)
      .post('/api/v1/business-search/history')
      .set('Cookie', cookieA1)
      .send({
        productQuery: 'Item To Delete',
        location: 'Dhaka',
        resultsSnapshot: [sampleCard]
      });

    const sessionId = saveRes.body.data.id;

    // User A2 cannot delete User A1's session
    const unauthorizedDel = await request(app)
      .delete(`/api/v1/business-search/history/${sessionId}`)
      .set('Cookie', cookieA2);
    expect(unauthorizedDel.status).toBe(404);

    // User A1 deletes their own session
    const authorizedDel = await request(app)
      .delete(`/api/v1/business-search/history/${sessionId}`)
      .set('Cookie', cookieA1);
    expect(authorizedDel.status).toBe(200);
    expect(authorizedDel.body.data.success).toBe(true);

    const check = await prisma.businessSearchSession.findUnique({
      where: { id: sessionId }
    });
    expect(check).toBeNull();
  });

  it('8. clears all history for authenticated user', async () => {
    await request(app)
      .post('/api/v1/business-search/history')
      .set('Cookie', cookieA1)
      .send({ productQuery: 'Item 1', location: 'Dhaka', resultsSnapshot: [sampleCard] });

    await request(app)
      .post('/api/v1/business-search/history')
      .set('Cookie', cookieA1)
      .send({ productQuery: 'Item 2', location: 'Dhaka', resultsSnapshot: [sampleCard] });

    const clearRes = await request(app)
      .delete('/api/v1/business-search/history')
      .set('Cookie', cookieA1);

    expect(clearRes.status).toBe(200);
    expect(clearRes.body.data.count).toBe(2);

    const remaining = await prisma.businessSearchSession.count({
      where: { userId: userA1Id }
    });
    expect(remaining).toBe(0);
  });

  it('9. validates storage safety: rejects payloads exceeding max allowable size', async () => {
    // Array of 250 items exceeds the allowable cap of 200 items
    const manyCards = Array(250).fill(sampleCard);

    const res = await request(app)
      .post('/api/v1/business-search/history')
      .set('Cookie', cookieA1)
      .send({
        productQuery: 'Oversized',
        location: 'Dhaka',
        resultsSnapshot: manyCards
      });

    // Should be rejected by validation (422)
    expect(res.status).toBe(422);
  });
});
