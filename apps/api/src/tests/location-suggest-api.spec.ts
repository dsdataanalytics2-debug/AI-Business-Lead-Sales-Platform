/**
 * Location Suggestion API Integration Tests
 *
 * Tests GET /api/v1/locations/suggest:
 * - Authentication & RBAC protection
 * - Input validation & minimum length guard (no external call when < 2 chars)
 * - Google Places Autocomplete (New) integration with Bangladesh restriction
 * - Masked / secret credential protection (API key never exposed to client)
 * - Maximum suggestions limit capping
 * - Curated Bangladesh fallback when Google is unconfigured or unavailable
 * - Tenant isolation (Org A vs Org B)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import prisma from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import { app } from '../app.js';
import { hashPassword, hashSessionToken, encryptCredential } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';
import { locationService } from '../services/location.service.js';

describe('GET /api/v1/locations/suggest API Tests', () => {
  const ORG_A_ID = '30000000-0000-0000-0000-000000000001';
  const ORG_B_ID = '30000000-0000-0000-0000-000000000002';

  const userAId = '30000000-0000-0000-0000-000000000011';
  const userBId = '30000000-0000-0000-0000-000000000012';

  let userACookie: string;
  let userBCookie: string;

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

    // Setup Organizations
    await prisma.organization.upsert({
      where: { id: ORG_A_ID },
      update: {},
      create: { id: ORG_A_ID, name: 'Location Test Org A', timezone: 'Asia/Dhaka' }
    });

    await prisma.organization.upsert({
      where: { id: ORG_B_ID },
      update: {},
      create: { id: ORG_B_ID, name: 'Location Test Org B', timezone: 'Asia/Dhaka' }
    });

    // Setup Users
    const passwordHash = await hashPassword('TestPass12345!');
    await prisma.user.upsert({
      where: { id: userAId },
      update: {},
      create: {
        id: userAId,
        email: 'user-a-loc@leadatlas.test',
        passwordHash,
        name: 'User A',
        role: 'ADMIN',
        organizationId: ORG_A_ID,
        isActive: true
      }
    });

    await prisma.user.upsert({
      where: { id: userBId },
      update: {},
      create: {
        id: userBId,
        email: 'user-b-loc@leadatlas.test',
        passwordHash,
        name: 'User B',
        role: 'ADMIN',
        organizationId: ORG_B_ID,
        isActive: true
      }
    });

    userACookie = await createSessionCookie(userAId, 'loc-session-token-user-a');
    userBCookie = await createSessionCookie(userBId, 'loc-session-token-user-b');
  });

  beforeEach(async () => {
    // Clear test datasource configs
    await prisma.dataSourceConfig.deleteMany({
      where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } }
    });
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.session.deleteMany({
      where: { userId: { in: [userAId, userBId] } }
    });
    await prisma.dataSourceConfig.deleteMany({
      where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } }
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userAId, userBId] } }
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [ORG_A_ID, ORG_B_ID] } }
    });
  });

  it('1. Rejects unauthenticated request with 401', async () => {
    const res = await request(app)
      .get('/api/v1/locations/suggest?q=Dhaka')
      .expect(401);

    expect(res.body.error).toBeDefined();
  });

  it('2. Returns empty suggestions immediately when query is under minimum length', async () => {
    const customFetchSpy = vi.fn();
    (locationService as any).customFetch = customFetchSpy;

    const res = await request(app)
      .get('/api/v1/locations/suggest?q=D')
      .set('Cookie', userACookie)
      .expect(200);

    expect(res.body.data).toEqual([]);
    expect(customFetchSpy).not.toHaveBeenCalled();
  });

  it('3. Uses Google Places Autocomplete when API key is configured and returns sanitized suggestions', async () => {
    const fakeKey = 'AIzaSyFakeKeyForAutocompleteTest12345';
    const encrypted = encryptCredential(fakeKey);

    await prisma.dataSourceConfig.create({
      data: {
        organizationId: ORG_A_ID,
        provider: 'google-places',
        name: 'org-a:google-places',
        isEnabled: true,
        encryptedCredential: encrypted,
        credentialMasked: 'AIza•••••••••••••••••••••••••••••12345',
        credentialLastFour: '2345'
      }
    });

    const mockGoogleResponse = {
      suggestions: [
        {
          placePrediction: {
            placeId: 'ChIJgWsCh7C4VTcRwgRZ3btjpY8',
            text: { text: 'Dhaka, Bangladesh' },
            structuredFormat: {
              mainText: { text: 'Dhaka' },
              secondaryText: { text: 'Bangladesh' }
            }
          }
        },
        {
          placePrediction: {
            placeId: 'ChIJa_25u0-5VTcRj_H1Xf9vV4M',
            text: { text: 'Dhanmondi, Dhaka, Bangladesh' },
            structuredFormat: {
              mainText: { text: 'Dhanmondi' },
              secondaryText: { text: 'Dhaka, Bangladesh' }
            }
          }
        }
      ]
    };

    let capturedHeaders: Record<string, string> | undefined;
    let capturedBody: any;

    const customFetchSpy = vi.fn().mockImplementation(async (_url, options) => {
      capturedHeaders = options.headers;
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => mockGoogleResponse
      };
    });

    (locationService as any).customFetch = customFetchSpy;

    const res = await request(app)
      .get('/api/v1/locations/suggest?q=Dha&limit=5')
      .set('Cookie', userACookie)
      .expect(200);

    // Verify Google call parameters
    expect(customFetchSpy).toHaveBeenCalled();
    expect(capturedHeaders?.['X-Goog-Api-Key']).toBe(fakeKey);
    expect(capturedBody).toEqual({
      input: 'Dha',
      includedRegionCodes: ['bd']
    });

    // Verify returned payload
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toEqual({
      id: 'ChIJgWsCh7C4VTcRwgRZ3btjpY8',
      label: 'Dhaka, Bangladesh',
      primaryText: 'Dhaka',
      secondaryText: 'Bangladesh'
    });
    expect(res.body.data[1]).toEqual({
      id: 'ChIJa_25u0-5VTcRj_H1Xf9vV4M',
      label: 'Dhanmondi, Dhaka, Bangladesh',
      primaryText: 'Dhanmondi',
      secondaryText: 'Dhaka, Bangladesh'
    });

    // INVARIANT: Secret key is NEVER returned in response
    const rawResponse = JSON.stringify(res.body);
    expect(rawResponse).not.toContain(fakeKey);
  });

  it('4. Respects maximum suggestion limit parameter', async () => {
    const fakeKey = 'AIzaSyFakeKeyForAutocompleteTest12345';
    const encrypted = encryptCredential(fakeKey);

    await prisma.dataSourceConfig.create({
      data: {
        organizationId: ORG_A_ID,
        provider: 'google-places',
        name: 'org-a:google-places',
        isEnabled: true,
        encryptedCredential: encrypted,
        credentialMasked: 'AIza•••••••••••••••••••••••••••••12345',
        credentialLastFour: '2345'
      }
    });

    const mockGoogleResponse = {
      suggestions: [
        { placePrediction: { placeId: '1', text: { text: 'Dhaka 1' }, structuredFormat: { mainText: { text: 'Dhaka 1' } } } },
        { placePrediction: { placeId: '2', text: { text: 'Dhaka 2' }, structuredFormat: { mainText: { text: 'Dhaka 2' } } } },
        { placePrediction: { placeId: '3', text: { text: 'Dhaka 3' }, structuredFormat: { mainText: { text: 'Dhaka 3' } } } }
      ]
    };

    (locationService as any).customFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockGoogleResponse
    });

    const res = await request(app)
      .get('/api/v1/locations/suggest?q=Dha&limit=2')
      .set('Cookie', userACookie)
      .expect(200);

    expect(res.body.data).toHaveLength(2);
  });

  it('5. Falls back to curated Bangladesh locations when Google Places is unconfigured', async () => {
    const customFetchSpy = vi.fn();
    (locationService as any).customFetch = customFetchSpy;

    // Org B has no Google Places config
    const res = await request(app)
      .get('/api/v1/locations/suggest?q=Mirpur')
      .set('Cookie', userBCookie)
      .expect(200);

    expect(customFetchSpy).not.toHaveBeenCalled();
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].primaryText).toBe('Mirpur');
    expect(res.body.data[0].label).toContain('Mirpur');
  });

  it('6. Falls back gracefully to Bangladesh locations when Google API request fails', async () => {
    const fakeKey = 'AIzaSyFakeKeyForAutocompleteTest12345';
    const encrypted = encryptCredential(fakeKey);

    await prisma.dataSourceConfig.create({
      data: {
        organizationId: ORG_A_ID,
        provider: 'google-places',
        name: 'org-a:google-places',
        isEnabled: true,
        encryptedCredential: encrypted,
        credentialMasked: 'AIza•••••••••••••••••••••••••••••12345',
        credentialLastFour: '2345'
      }
    });

    // Google API throws network error
    (locationService as any).customFetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const res = await request(app)
      .get('/api/v1/locations/suggest?q=Chattogram')
      .set('Cookie', userACookie)
      .expect(200);

    // Fallback succeeds without throwing 500 to user
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].primaryText).toBe('Chattogram');
  });

  it('7. Enforces strict tenant credential isolation between Org A and Org B', async () => {
    const keyA = 'AIzaSyOrgAKey12345';
    await prisma.dataSourceConfig.create({
      data: {
        organizationId: ORG_A_ID,
        provider: 'google-places',
        name: 'org-a:google-places',
        isEnabled: true,
        encryptedCredential: encryptCredential(keyA),
        credentialMasked: 'AIza•••••••••••••••••••••••••••••12345',
        credentialLastFour: '2345'
      }
    });

    const customFetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ suggestions: [] })
    });
    (locationService as any).customFetch = customFetchSpy;

    // Org B calls suggest: customFetch must NOT be called with Org A's key!
    await request(app)
      .get('/api/v1/locations/suggest?q=Dhaka')
      .set('Cookie', userBCookie)
      .expect(200);

    expect(customFetchSpy).not.toHaveBeenCalled();
  });
});
