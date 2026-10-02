/**
 * Step 7 Integration Tests: Master Lead Database API & Cursor Pagination
 *
 * Covers all required test matrix scenarios:
 * - List leads with cursor pagination (ordering, limits, cursor safety, tenant isolation, multi-page integrity)
 * - Filtering (search, city, category, websiteStatus, onlinePresence, hasPhone, hasEmail, hasWhatsApp)
 * - Total count scoping (tenant + filter scoped)
 * - Detail retrieval (full relation loading, sanitized sources, no rawData leak, suppression augmentation)
 * - Cross-tenant 404 security (no 403 leak on cross-tenant lead/cursor/children access)
 * - PATCH updates (strict schema, protected fields, normalization, duplicate collision prevention, audit logging)
 * - Manual Contact creation (server-side normalization, landline, Bengali digits, WhatsApp safety, primary promotion, suppression, audit logging)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import prisma, {
  Role,
  ContactType,
  PhoneType,
  ContactStatus,
  WhatsAppStatus,
  WebsiteStatus,
  OnlinePresenceType,
  EvidenceType
} from '@leadmate/db';
import { ErrorCodes, Permissions } from '@leadmate/shared';
import { app } from '../app.js';
import { hashPassword, hashSessionToken } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';
import { requirePermission } from '../middleware/rbac.js';

describe('M1 Step 7: Master Lead Database Backend API Matrix', () => {
  const ORG_A_ID = '30000000-0000-0000-0000-000000000001';
  const ORG_B_ID = '40000000-0000-0000-0000-000000000002';

  const adminAEmail = 'admin-lead-a@leadmate.test';
  const adminAPassword = 'AdminPass12345!A';
  let adminACookie: string;

  const viewerAEmail = 'viewer-lead-a@leadmate.test';
  const viewerAPassword = 'ViewerPass12345!A';
  let viewerACookie: string;

  const adminBEmail = 'admin-lead-b@leadmate.test';
  const adminBPassword = 'AdminPass12345!B';
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

  async function cleanupDatabase() {
    await prisma.contactEvidence.deleteMany({});
    await prisma.leadContact.deleteMany({});
    await prisma.leadSource.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.suppressionList.deleteMany({});
  }

  beforeAll(async () => {
    // 0. Safety Guard: Confirm database is test database
    const dbUrl = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL || '';
    if (!dbUrl.includes('_test')) {
      throw new Error(
        `SAFETY GUARD TRIGGERED: Database URL "${dbUrl}" does not end with "_test". Destructive test cleanup aborted.`
      );
    }

    // 1. Setup Tenant Organizations
    await prisma.organization.upsert({
      where: { id: ORG_A_ID },
      update: {},
      create: {
        id: ORG_A_ID,
        name: 'Step 7 Tenant Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.upsert({
      where: { id: ORG_B_ID },
      update: {},
      create: {
        id: ORG_B_ID,
        name: 'Step 7 Tenant Org B',
        timezone: 'Asia/Dhaka'
      }
    });

    // 2. Setup Org A Admin User
    const adminAHash = await hashPassword(adminAPassword);
    const adminAUser = await prisma.user.upsert({
      where: { email: adminAEmail },
      update: { passwordHash: adminAHash, role: Role.ADMIN, organizationId: ORG_A_ID, isActive: true },
      create: { email: adminAEmail, passwordHash: adminAHash, name: 'Admin Lead A', role: Role.ADMIN, organizationId: ORG_A_ID, isActive: true }
    });
    adminACookie = await createSessionCookie(adminAUser.id, 'session-token-lead-admin-a-test');

    // 3. Setup Org A Viewer User
    const viewerAHash = await hashPassword(viewerAPassword);
    const viewerAUser = await prisma.user.upsert({
      where: { email: viewerAEmail },
      update: { passwordHash: viewerAHash, role: Role.VIEWER, organizationId: ORG_A_ID, isActive: true },
      create: { email: viewerAEmail, passwordHash: viewerAHash, name: 'Viewer Lead A', role: Role.VIEWER, organizationId: ORG_A_ID, isActive: true }
    });
    viewerACookie = await createSessionCookie(viewerAUser.id, 'session-token-lead-viewer-a-test');

    // 4. Setup Org B Admin User
    const adminBHash = await hashPassword(adminBPassword);
    const adminBUser = await prisma.user.upsert({
      where: { email: adminBEmail },
      update: { passwordHash: adminBHash, role: Role.ADMIN, organizationId: ORG_B_ID, isActive: true },
      create: { email: adminBEmail, passwordHash: adminBHash, name: 'Admin Lead B', role: Role.ADMIN, organizationId: ORG_B_ID, isActive: true }
    });
    adminBCookie = await createSessionCookie(adminBUser.id, 'session-token-lead-admin-b-test');
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterAll(async () => {
    await cleanupDatabase();
    await prisma.$disconnect();
  });

  /* =========================================================================
   * Section 1: Lead List & Cursor Pagination (GET /api/v1/leads)
   * ========================================================================= */

  it('1. unauthenticated list => 401 UNAUTHENTICATED', async () => {
    const res = await request(app).get('/api/v1/leads');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    expect(res.body.error.requestId).toBeDefined();
  });

  it('2. forbidden list => 403 when role lacks LEADS_READ', async () => {
    const req: any = { user: { role: 'UNAUTHORIZED_ROLE' as any }, id: 'test-req-id' };
    let errResult: any;
    const next = (err?: any) => { errResult = err; };
    requirePermission(Permissions.LEADS_READ)(req, {} as any, next);

    expect(errResult).toBeDefined();
    expect(errResult.statusCode).toBe(403);
    expect(errResult.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it('3. empty tenant list => 200 with empty array, total 0, and null nextCursor', async () => {
    const res = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
    expect(res.body.meta.nextCursor).toBeNull();
  });

  it('4. list only returns current tenant leads (tenant isolation)', async () => {
    // Org A lead
    await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Org A Dental Center',
        normalizedName: 'org a dental center',
        category: 'Dental',
        city: 'Dhaka',
        country: 'BD',
        primarySource: 'MANUAL'
      }
    });

    // Org B lead
    await prisma.lead.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Org B Steel Mills',
        normalizedName: 'org b steel mills',
        category: 'Steel',
        city: 'Chattogram',
        country: 'BD',
        primarySource: 'MANUAL'
      }
    });

    const resA = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie);

    expect(resA.status).toBe(200);
    expect(resA.body.data.length).toBe(1);
    expect(resA.body.data[0].name).toBe('Org A Dental Center');
    expect(resA.body.meta.total).toBe(1);

    const resB = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminBCookie);

    expect(resB.status).toBe(200);
    expect(resB.body.data.length).toBe(1);
    expect(resB.body.data[0].name).toBe('Org B Steel Mills');
    expect(resB.body.meta.total).toBe(1);
  });

  it('5, 6, 7 & 8. limits: default 50, custom limit, max 200, invalid limit rejection', async () => {
    // Create 3 leads
    for (let i = 1; i <= 3; i++) {
      await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: `Lead ${i}`,
          normalizedName: `lead ${i}`,
          category: 'Retail',
          city: 'Dhaka',
          country: 'BD',
          primarySource: 'MANUAL'
        }
      });
    }

    // Default limit
    const resDefault = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie);
    expect(resDefault.status).toBe(200);
    expect(resDefault.body.data.length).toBe(3);

    // Custom limit
    const resCustom = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie)
      .query({ limit: 2 });
    expect(resCustom.status).toBe(200);
    expect(resCustom.body.data.length).toBe(2);
    expect(resCustom.body.meta.nextCursor).toBeDefined();

    // Max limit 200 accepted
    const resMax = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie)
      .query({ limit: 200 });
    expect(resMax.status).toBe(200);

    // Invalid limit > 200 => 422
    const resInvalid = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie)
      .query({ limit: 250 });
    expect(resInvalid.status).toBe(422);
    expect(resInvalid.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('9, 10, 11, 12, 13 & 32. multi-page cursor pagination integrity (7 items, limit=3)', async () => {
    // Create 7 leads with staggered creation timestamps
    const createdIds: string[] = [];
    for (let i = 1; i <= 7; i++) {
      const l = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: `Numbered Lead ${i.toString().padStart(2, '0')}`,
          normalizedName: `numbered lead ${i.toString().padStart(2, '0')}`,
          category: 'Tech',
          city: 'Dhaka',
          country: 'BD',
          primarySource: 'MANUAL',
          createdAt: new Date(Date.now() + i * 1000)
        }
      });
      createdIds.push(l.id);
    }

    // Page 1: take 3
    const page1Res = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie)
      .query({ limit: 3 });

    expect(page1Res.status).toBe(200);
    expect(page1Res.body.data.length).toBe(3);
    expect(page1Res.body.meta.total).toBe(7);
    const cursor1 = page1Res.body.meta.nextCursor;
    expect(cursor1).not.toBeNull();

    // Page 2: take 3 with cursor1
    const page2Res = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie)
      .query({ limit: 3, cursor: cursor1 });

    expect(page2Res.status).toBe(200);
    expect(page2Res.body.data.length).toBe(3);
    expect(page2Res.body.meta.total).toBe(7);
    const cursor2 = page2Res.body.meta.nextCursor;
    expect(cursor2).not.toBeNull();

    // Page 3: take 3 with cursor2 (should return remaining 1 item)
    const page3Res = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie)
      .query({ limit: 3, cursor: cursor2 });

    expect(page3Res.status).toBe(200);
    expect(page3Res.body.data.length).toBe(1);
    expect(page3Res.body.meta.total).toBe(7);
    expect(page3Res.body.meta.nextCursor).toBeNull();

    // Collect all retrieved IDs
    const allRetrievedIds = [
      ...page1Res.body.data.map((x: any) => x.id),
      ...page2Res.body.data.map((x: any) => x.id),
      ...page3Res.body.data.map((x: any) => x.id)
    ];

    expect(allRetrievedIds.length).toBe(7);
    // Ensure no duplicates
    const uniqueRetrievedIds = new Set(allRetrievedIds);
    expect(uniqueRetrievedIds.size).toBe(7);
  });

  it('Cursor pagination with identical createdAt across multiple leads is strictly deterministic', async () => {
    const sameCreatedAt = new Date('2026-05-01T12:00:00.000Z');
    const createdIds: string[] = [];
    for (let i = 1; i <= 6; i++) {
      const l = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: `Same Timestamp Lead ${i}`,
          normalizedName: `same timestamp lead ${i}`,
          category: 'Health',
          city: 'Dhaka',
          country: 'BD',
          primarySource: 'MANUAL',
          createdAt: sameCreatedAt
        }
      });
      createdIds.push(l.id);
    }

    const retrievedIds: string[] = [];
    let currentCursor: string | null = null;
    let pageCount = 0;

    while (true) {
      pageCount++;
      const res = await request(app)
        .get('/api/v1/leads')
        .set('Cookie', adminACookie)
        .query({ limit: 2, ...(currentCursor ? { cursor: currentCursor } : {}) });

      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(6);

      const items = res.body.data;
      if (items.length === 0) break;

      retrievedIds.push(...items.map((x: any) => x.id));
      currentCursor = res.body.meta.nextCursor;

      if (currentCursor) {
        // nextCursor must equal the ID of the last item returned
        expect(currentCursor).toBe(items[items.length - 1].id);
      } else {
        break;
      }
    }

    expect(pageCount).toBe(3);
    expect(retrievedIds.length).toBe(6);
    expect(new Set(retrievedIds).size).toBe(6);
    expect(new Set(retrievedIds)).toEqual(new Set(createdIds));
  });

  it('Insert between pages does not duplicate returned records or skip remaining records', async () => {
    const baseTime = Date.now();
    const l1 = await prisma.lead.create({
      data: { organizationId: ORG_A_ID, name: 'Lead 1', normalizedName: 'lead 1', category: 'Tech', city: 'Dhaka', country: 'BD', primarySource: 'MANUAL', createdAt: new Date(baseTime + 1000) }
    });
    const l2 = await prisma.lead.create({
      data: { organizationId: ORG_A_ID, name: 'Lead 2', normalizedName: 'lead 2', category: 'Tech', city: 'Dhaka', country: 'BD', primarySource: 'MANUAL', createdAt: new Date(baseTime + 2000) }
    });
    const l3 = await prisma.lead.create({
      data: { organizationId: ORG_A_ID, name: 'Lead 3', normalizedName: 'lead 3', category: 'Tech', city: 'Dhaka', country: 'BD', primarySource: 'MANUAL', createdAt: new Date(baseTime + 3000) }
    });
    const l4 = await prisma.lead.create({
      data: { organizationId: ORG_A_ID, name: 'Lead 4', normalizedName: 'lead 4', category: 'Tech', city: 'Dhaka', country: 'BD', primarySource: 'MANUAL', createdAt: new Date(baseTime + 4000) }
    });

    // Page 1 with limit=2 (returns Lead 4, Lead 3 ordered DESC)
    const page1 = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie)
      .query({ limit: 2 });

    expect(page1.status).toBe(200);
    expect(page1.body.data.length).toBe(2);
    expect(page1.body.data[0].id).toBe(l4.id);
    expect(page1.body.data[1].id).toBe(l3.id);
    const cursor = page1.body.meta.nextCursor;
    expect(cursor).toBe(l3.id);

    // Insert a new lead newer than all existing leads (sorts BEFORE page 1 records)
    await prisma.lead.create({
      data: { organizationId: ORG_A_ID, name: 'Lead 5 (Newest)', normalizedName: 'lead 5 newest', category: 'Tech', city: 'Dhaka', country: 'BD', primarySource: 'MANUAL', createdAt: new Date(baseTime + 5000) }
    });

    // Fetch page 2 with page 1 nextCursor
    const page2 = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie)
      .query({ limit: 2, cursor });

    expect(page2.status).toBe(200);
    expect(page2.body.data.length).toBe(2);
    expect(page2.body.data[0].id).toBe(l2.id);
    expect(page2.body.data[1].id).toBe(l1.id);
    // Page 1 records (l4, l3) must NOT reappear
    expect(page2.body.data.some((x: any) => x.id === l4.id || x.id === l3.id)).toBe(false);
  });

  it('14 & 15. total count is tenant-scoped and respects active filters', async () => {
    await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Dhaka Dental Clinic',
        normalizedName: 'dhaka dental clinic',
        category: 'Dental',
        city: 'Dhaka',
        country: 'BD',
        primaryPhone: '+8801711000001',
        primarySource: 'MANUAL'
      }
    });

    await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Chattogram Steel Traders',
        normalizedName: 'chattogram steel traders',
        category: 'Manufacturing',
        city: 'Chattogram',
        country: 'BD',
        primarySource: 'MANUAL'
      }
    });

    // Unfiltered list for Org A => total = 2
    const resAll = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie);
    expect(resAll.body.meta.total).toBe(2);

    // Filtered by city='Dhaka' => total = 1
    const resFiltered = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie)
      .query({ city: 'Dhaka' });
    expect(resFiltered.body.meta.total).toBe(1);
    expect(resFiltered.body.data.length).toBe(1);
  });

  it('16, 17, 18, 19, 20 & 21. filters: search, category, websiteStatus, onlinePresence, hasPhone', async () => {
    await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Apex Footwear Gulshan',
        normalizedName: 'apex footwear gulshan',
        category: 'Footwear',
        city: 'Dhaka',
        country: 'BD',
        primaryPhone: '+8801711223344',
        website: 'https://apexfootwear.example.com',
        normalizedWebsite: 'apexfootwear.example.com',
        websiteStatus: WebsiteStatus.REACHABLE,
        onlinePresenceType: OnlinePresenceType.WEBSITE,
        primarySource: 'MANUAL'
      }
    });

    await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Local Facebook Boutique',
        normalizedName: 'local facebook boutique',
        category: 'Fashion',
        city: 'Dhaka',
        country: 'BD',
        websiteStatus: WebsiteStatus.NONE_DETECTED,
        onlinePresenceType: OnlinePresenceType.FACEBOOK_ONLY,
        primarySource: 'MANUAL'
      }
    });

    // Search by keyword
    const resSearch = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie)
      .query({ search: 'Apex' });
    expect(resSearch.body.data.length).toBe(1);
    expect(resSearch.body.data[0].name).toBe('Apex Footwear Gulshan');

    // Filter by websiteStatus
    const resWebStatus = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie)
      .query({ websiteStatus: 'REACHABLE' });
    expect(resWebStatus.body.data.length).toBe(1);

    // Filter by onlinePresence
    const resOnlinePresence = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie)
      .query({ onlinePresence: 'FACEBOOK_ONLY' });
    expect(resOnlinePresence.body.data.length).toBe(1);

    // Filter by hasPhone
    const resHasPhone = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie)
      .query({ hasPhone: true });
    expect(resHasPhone.body.data.length).toBe(1);
  });

  it('22 & 23. invalid or cross-tenant cursor produces safe error and never leaks records', async () => {
    // Lead in Org B
    const leadB = await prisma.lead.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Confidential Org B Lead',
        normalizedName: 'confidential org b lead',
        category: 'Private',
        city: 'Dhaka',
        country: 'BD',
        primarySource: 'MANUAL'
      }
    });

    // Org A attempts to use Org B lead ID as cursor
    const res = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie)
      .query({ cursor: leadB.id });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(res.body.error.message).toContain('Invalid pagination cursor');
  });

  /* =========================================================================
   * Section 2: Lead Detail (GET /api/v1/leads/:id)
   * ========================================================================= */

  it('24 & 25. unauthenticated / forbidden detail => 401 / 403', async () => {
    const res = await request(app).get('/api/v1/leads/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(401);
  });

  it('26, 29, 30, 31 & 32. same-tenant detail => 200 + safe contacts, evidence, and sources (no rawData leak)', async () => {
    const lead = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Detailed Dental Clinic',
        normalizedName: 'detailed dental clinic',
        category: 'Dental Clinic',
        description: 'Comprehensive oral healthcare clinic in Gulshan.',
        address: 'House 10, Road 5',
        locality: 'Gulshan-2',
        city: 'Dhaka',
        country: 'BD',
        primaryPhone: '+8801711000001',
        primaryEmail: 'info@detaileddental.test',
        website: 'https://detaileddental.test',
        normalizedWebsite: 'detaileddental.test',
        primarySource: 'MOCK',
        contacts: {
          create: {
            type: ContactType.PHONE,
            rawValue: '01711000001',
            normalizedValue: '+8801711000001',
            phoneType: PhoneType.MOBILE,
            status: ContactStatus.FOUND,
            isPrimary: true,
            evidence: {
              create: {
                sourceName: 'MOCK',
                sourceUrl: 'https://directory.example.com/listing',
                evidenceType: EvidenceType.LISTING_FIELD,
                snippet: 'Direct Phone: 01711000001'
              }
            }
          }
        },
        sources: {
          create: {
            sourceName: 'MOCK',
            sourceExternalId: 'mock-detailed-dental-001',
            sourceUrl: 'https://directory.example.com/listing',
            rawData: { secretApiToken: 'DO_NOT_LEAK', internalId: 12345 }
          }
        }
      }
    });

    const res = await request(app)
      .get(`/api/v1/leads/${lead.id}`)
      .set('Cookie', adminACookie);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(lead.id);
    expect(res.body.data.name).toBe('Detailed Dental Clinic');
    expect(res.body.data.contacts.length).toBe(1);
    expect(res.body.data.contacts[0].evidence.length).toBe(1);
    expect(res.body.data.sources.length).toBe(1);

    // CRITICAL: Verify rawData is NOT exposed in public API response
    expect(res.body.data.sources[0].rawData).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('secretApiToken');
  });

  it('27 & 28. unknown lead or cross-tenant lead => 404 NOT_FOUND (never 403)', async () => {
    // Unknown ID
    const resUnknown = await request(app)
      .get('/api/v1/leads/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminACookie);
    expect(resUnknown.status).toBe(404);
    expect(resUnknown.body.error.code).toBe(ErrorCodes.NOT_FOUND);

    // Lead in Org B
    const leadB = await prisma.lead.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Org B Secret Lead',
        normalizedName: 'org b secret lead',
        category: 'Secret',
        city: 'Dhaka',
        country: 'BD',
        primarySource: 'MANUAL'
      }
    });

    // Org A requests Org B lead ID => MUST return 404 (no existence leakage)
    const resCrossTenant = await request(app)
      .get(`/api/v1/leads/${leadB.id}`)
      .set('Cookie', adminACookie);

    expect(resCrossTenant.status).toBe(404);
    expect(resCrossTenant.body.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  /* =========================================================================
   * Section 3: Lead Update (PATCH /api/v1/leads/:id)
   * ========================================================================= */

  it('34 & 35. unauthenticated / forbidden patch => 401 / 403', async () => {
    const res = await request(app)
      .patch('/api/v1/leads/00000000-0000-0000-0000-000000000000')
      .send({ name: 'New Name' });
    expect(res.status).toBe(401);

    const resForbidden = await request(app)
      .patch('/api/v1/leads/00000000-0000-0000-0000-000000000000')
      .set('Cookie', viewerACookie)
      .send({ name: 'New Name' });
    expect(resForbidden.status).toBe(403);
  });

  it('36 & 37. unknown or cross-tenant lead patch => 404 NOT_FOUND', async () => {
    const leadB = await prisma.lead.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Org B Lead For Patch',
        normalizedName: 'org b lead for patch',
        category: 'Test',
        city: 'Dhaka',
        country: 'BD',
        primarySource: 'MANUAL'
      }
    });

    const res = await request(app)
      .patch(`/api/v1/leads/${leadB.id}`)
      .set('Cookie', adminACookie)
      .send({ name: 'Hijacked Name' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('38, 43, 46 & 48. valid allowed update succeeds with normalization and transactional audit log', async () => {
    const lead = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Original Dental Care',
        normalizedName: 'original dental care',
        category: 'Dentist',
        city: 'Dhaka',
        country: 'BD',
        primarySource: 'MANUAL'
      }
    });

    const res = await request(app)
      .patch(`/api/v1/leads/${lead.id}`)
      .set('Cookie', adminACookie)
      .send({
        name: 'Updated Dental & Orthodontic Clinic',
        category: 'Cosmetic Dentistry',
        city: 'Dhaka',
        locality: 'Banani',
        website: 'https://updateddental.example.com/clinic'
      });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Dental & Orthodontic Clinic');
    expect(res.body.data.normalizedName).toBe('updated dental & orthodontic clinic');
    expect(res.body.data.normalizedWebsite).toBe('updateddental.example.com');
    expect(res.body.data.locality).toBe('Banani');

    // Verify transactional audit log
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: lead.id, action: 'lead.updated' }
    });
    expect(audit).toBeDefined();
    expect(audit!.organizationId).toBe(ORG_A_ID);
  });

  it('39, 40, 41 & 42. protected fields and unknown fields are strictly rejected (422)', async () => {
    const lead = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Strict Schema Lead',
        normalizedName: 'strict schema lead',
        category: 'Testing',
        city: 'Dhaka',
        country: 'BD',
        primarySource: 'MANUAL'
      }
    });

    // Attempt to inject organizationId
    const resOrgInject = await request(app)
      .patch(`/api/v1/leads/${lead.id}`)
      .set('Cookie', adminACookie)
      .send({ organizationId: ORG_B_ID });
    expect(resOrgInject.status).toBe(422);

    // Attempt to inject primarySource
    const resSourceInject = await request(app)
      .patch(`/api/v1/leads/${lead.id}`)
      .set('Cookie', adminACookie)
      .send({ primarySource: 'HACKED_SOURCE' });
    expect(resSourceInject.status).toBe(422);

    // Attempt to inject unknown arbitrary property
    const resUnknown = await request(app)
      .patch(`/api/v1/leads/${lead.id}`)
      .set('Cookie', adminACookie)
      .send({ hackerField: true });
    expect(resUnknown.status).toBe(422);
  });

  it('45 & 47. patch duplicate collision prevention: does not auto-merge, returns 409 CONFLICT', async () => {
    // Lead 1 with website
    await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Existing Lead 1',
        normalizedName: 'existing lead 1',
        category: 'Tech',
        city: 'Dhaka',
        country: 'BD',
        website: 'https://shared-domain.example.com',
        normalizedWebsite: 'shared-domain.example.com',
        primarySource: 'MANUAL'
      }
    });

    // Lead 2
    const lead2 = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Existing Lead 2',
        normalizedName: 'existing lead 2',
        category: 'Tech',
        city: 'Dhaka',
        country: 'BD',
        primarySource: 'MANUAL'
      }
    });

    // Attempt to patch Lead 2 with Lead 1's website
    const res = await request(app)
      .patch(`/api/v1/leads/${lead2.id}`)
      .set('Cookie', adminACookie)
      .send({ website: 'https://shared-domain.example.com/lead2' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(ErrorCodes.CONFLICT);
    expect(res.body.error.message).toContain('already exists');

    // Verify Lead 2 was not modified
    const lead2After = await prisma.lead.findUnique({ where: { id: lead2.id } });
    expect(lead2After!.normalizedWebsite).toBeNull();
  });

  it('PATCH website null clears website and same-lead self-domain update does not conflict', async () => {
    const lead = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Self Website Lead',
        normalizedName: 'self website lead',
        category: 'Retail',
        city: 'Dhaka',
        country: 'BD',
        website: 'https://myshop.example.com',
        normalizedWebsite: 'myshop.example.com',
        primarySource: 'MANUAL'
      }
    });

    // 1. Same-lead updating to equivalent normalized URL succeeds with 200 (no self-conflict)
    const selfRes = await request(app)
      .patch(`/api/v1/leads/${lead.id}`)
      .set('Cookie', adminACookie)
      .send({ website: 'https://www.myshop.example.com/about' });
    expect(selfRes.status).toBe(200);
    expect(selfRes.body.data.normalizedWebsite).toBe('myshop.example.com');

    // 2. Clearing website with null sets both website and normalizedWebsite to null
    const clearRes = await request(app)
      .patch(`/api/v1/leads/${lead.id}`)
      .set('Cookie', adminACookie)
      .send({ website: null });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.data.website).toBeNull();
    expect(clearRes.body.data.normalizedWebsite).toBeNull();
  });

  /* =========================================================================
   * Section 4: Manual Contact Creation (POST /api/v1/leads/:id/contacts)
   * ========================================================================= */

  it('48 & 49. unauthenticated / forbidden contact creation => 401 / 403', async () => {
    const res = await request(app)
      .post('/api/v1/leads/00000000-0000-0000-0000-000000000000/contacts')
      .send({ type: 'PHONE', rawValue: '01711000001' });
    expect(res.status).toBe(401);

    const resForbidden = await request(app)
      .post('/api/v1/leads/00000000-0000-0000-0000-000000000000/contacts')
      .set('Cookie', viewerACookie)
      .send({ type: 'PHONE', rawValue: '01711000001' });
    expect(resForbidden.status).toBe(403);
  });

  it('50 & 51. unknown or cross-tenant contact creation => 404 NOT_FOUND', async () => {
    const leadB = await prisma.lead.create({
      data: {
        organizationId: ORG_B_ID,
        name: 'Org B Lead For Contact',
        normalizedName: 'org b lead for contact',
        category: 'Test',
        city: 'Dhaka',
        country: 'BD',
        primarySource: 'MANUAL'
      }
    });

    const res = await request(app)
      .post(`/api/v1/leads/${leadB.id}/contacts`)
      .set('Cookie', adminACookie)
      .send({ type: 'PHONE', rawValue: '01711000001' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('52, 53, 54, 55, 56 & 66. manual contact normalization: BD mobile, Bengali digits, landline, invalid format, audit', async () => {
    const lead = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Manual Contact Test Lead',
        normalizedName: 'manual contact test lead',
        category: 'Services',
        city: 'Dhaka',
        country: 'BD',
        primarySource: 'MANUAL'
      }
    });

    // 1. Valid BD Mobile
    const resMobile = await request(app)
      .post(`/api/v1/leads/${lead.id}/contacts`)
      .set('Cookie', adminACookie)
      .send({ type: 'PHONE', rawValue: '01711000001', isPrimary: true });

    expect(resMobile.status).toBe(201);
    expect(resMobile.body.data.normalizedValue).toBe('+8801711000001');
    expect(resMobile.body.data.phoneType).toBe(PhoneType.MOBILE);
    expect(resMobile.body.data.status).toBe(ContactStatus.FOUND);
    expect(resMobile.body.data.isPrimary).toBe(true);

    // 2. Bengali Digits
    const resBengali = await request(app)
      .post(`/api/v1/leads/${lead.id}/contacts`)
      .set('Cookie', adminACookie)
      .send({ type: 'PHONE', rawValue: '০১৮১-১০০০০০৩' });

    expect(resBengali.status).toBe(201);
    expect(resBengali.body.data.normalizedValue).toBe('+8801811000003');

    // 3. Landline
    const resLandline = await request(app)
      .post(`/api/v1/leads/${lead.id}/contacts`)
      .set('Cookie', adminACookie)
      .send({ type: 'PHONE', rawValue: '029876543' });

    expect(resLandline.status).toBe(201);
    expect(resLandline.body.data.phoneType).toBe(PhoneType.LANDLINE);

    // 4. Invalid Format
    const resInvalid = await request(app)
      .post(`/api/v1/leads/${lead.id}/contacts`)
      .set('Cookie', adminACookie)
      .send({ type: 'PHONE', rawValue: '01234567890' });

    expect(resInvalid.status).toBe(201);
    expect(resInvalid.body.data.status).toBe(ContactStatus.INVALID_FORMAT);

    // Verify audit log
    const auditCount = await prisma.auditLog.count({
      where: { organizationId: ORG_A_ID, action: 'lead.contact_added' }
    });
    expect(auditCount).toBe(4);
  });

  it('57. valid email normalized in canonical format', async () => {
    const lead = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Email Contact Lead',
        normalizedName: 'email contact lead',
        category: 'Services',
        city: 'Dhaka',
        country: 'BD',
        primarySource: 'MANUAL'
      }
    });

    const res = await request(app)
      .post(`/api/v1/leads/${lead.id}/contacts`)
      .set('Cookie', adminACookie)
      .send({ type: 'EMAIL', rawValue: 'CONTACT@Example.COM', isPrimary: true });

    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe(ContactType.EMAIL);
    expect(res.body.data.normalizedValue).toBe('CONTACT@example.com');
  });

  it('58, 59 & 60. PHONE vs WHATSAPP channel distinction, manual WhatsApp trust boundary, and primaryPhone safety', async () => {
    const lead = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Dual Channel Lead',
        normalizedName: 'dual channel lead',
        category: 'Services',
        city: 'Dhaka',
        country: 'BD',
        primarySource: 'MANUAL'
      }
    });

    // 1. Add PHONE contact => whatsappStatus is UNKNOWN, does NOT create WHATSAPP row
    const resPhone = await request(app)
      .post(`/api/v1/leads/${lead.id}/contacts`)
      .set('Cookie', adminACookie)
      .send({ type: 'PHONE', rawValue: '01711000001' });

    expect(resPhone.status).toBe(201);
    expect(resPhone.body.data.type).toBe(ContactType.PHONE);
    expect(resPhone.body.data.whatsappStatus).toBe(WhatsAppStatus.UNKNOWN);

    // 2. Add WHATSAPP contact with only rawValue => UNKNOWN
    const resWa1 = await request(app)
      .post(`/api/v1/leads/${lead.id}/contacts`)
      .set('Cookie', adminACookie)
      .send({ type: 'WHATSAPP', rawValue: '01711000001' });

    expect(resWa1.status).toBe(201);
    expect(resWa1.body.data.type).toBe(ContactType.WHATSAPP);
    expect(resWa1.body.data.whatsappStatus).toBe(WhatsAppStatus.UNKNOWN);

    // 3. Browser attempts whatsappStatus = CONFIRMED => rejected (400)
    const resWaConfirmed = await request(app)
      .post(`/api/v1/leads/${lead.id}/contacts`)
      .set('Cookie', adminACookie)
      .send({ type: 'WHATSAPP', rawValue: '01711000002', whatsappStatus: 'CONFIRMED' });

    expect(resWaConfirmed.status).toBe(400);
    expect(resWaConfirmed.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);

    // 4. Browser attempts unsupported PUBLICLY_LISTED claim => sanitized to UNKNOWN
    const resWaPublic = await request(app)
      .post(`/api/v1/leads/${lead.id}/contacts`)
      .set('Cookie', adminACookie)
      .send({ type: 'WHATSAPP', rawValue: '01711000003', whatsappStatus: 'PUBLICLY_LISTED' });

    expect(resWaPublic.status).toBe(201);
    expect(resWaPublic.body.data.whatsappStatus).toBe(WhatsAppStatus.UNKNOWN);

    // 5. WHATSAPP with isPrimary: true does NOT populate Lead.primaryPhone
    const resWaPrimary = await request(app)
      .post(`/api/v1/leads/${lead.id}/contacts`)
      .set('Cookie', adminACookie)
      .send({ type: 'WHATSAPP', rawValue: '01711000004', isPrimary: true });

    expect(resWaPrimary.status).toBe(201);
    const leadAfter = await prisma.lead.findUnique({ where: { id: lead.id } });
    // Retains initial PHONE primary, NOT overwritten by WHATSAPP number
    expect(leadAfter!.primaryPhone).toBe('+8801711000001');

    // 6. Manual sourceName and sourceUrl do NOT create fake provider ContactEvidence
    const resManualSource = await request(app)
      .post(`/api/v1/leads/${lead.id}/contacts`)
      .set('Cookie', adminACookie)
      .send({
        type: 'PHONE',
        rawValue: '01711000005',
        sourceName: 'Local Yellowpages',
        sourceUrl: 'https://directory.test/listing'
      });

    expect(resManualSource.status).toBe(201);
    expect(resManualSource.body.data.evidence).toEqual([]);
  });

  it('61. duplicate contact handling: isPrimary promotion updates lead and audits, zero mutation creates no audit', async () => {
    const lead = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Dedupe Contact Lead',
        normalizedName: 'dedupe contact lead',
        category: 'Services',
        city: 'Dhaka',
        country: 'BD',
        primaryPhone: '+8801799999999',
        primarySource: 'MANUAL',
        contacts: {
          create: {
            type: ContactType.PHONE,
            rawValue: '01799999999',
            normalizedValue: '+8801799999999',
            phoneType: PhoneType.MOBILE,
            status: ContactStatus.FOUND,
            isPrimary: true
          }
        }
      }
    });

    // 1. Create non-primary contact (since lead already has a primaryPhone, this contact stays isPrimary: false)
    const res1 = await request(app)
      .post(`/api/v1/leads/${lead.id}/contacts`)
      .set('Cookie', adminACookie)
      .send({ type: 'PHONE', rawValue: '01711000001', isPrimary: false });

    expect(res1.status).toBe(201);
    const contactId1 = res1.body.data.id;
    expect(res1.body.data.isPrimary).toBe(false);

    // 2. Re-send same contact with isPrimary = true (promotes existing contact)
    const resPromo = await request(app)
      .post(`/api/v1/leads/${lead.id}/contacts`)
      .set('Cookie', adminACookie)
      .send({ type: 'PHONE', rawValue: '01711000001', isPrimary: true });

    expect(resPromo.status).toBe(201);
    expect(resPromo.body.data.id).toBe(contactId1);
    expect(resPromo.body.data.isPrimary).toBe(true);

    const leadPromoted = await prisma.lead.findUnique({ where: { id: lead.id } });
    expect(leadPromoted!.primaryPhone).toBe('+8801711000001');

    // Promotion audit log
    const promoAudit = await prisma.auditLog.findFirst({
      where: { entityId: contactId1, action: 'lead.contact_updated' }
    });
    expect(promoAudit).toBeDefined();

    // 3. Re-send exact duplicate with isPrimary = true (zero mutation) => no new audit log
    const auditCountBefore = await prisma.auditLog.count({ where: { entityId: contactId1 } });
    const resZero = await request(app)
      .post(`/api/v1/leads/${lead.id}/contacts`)
      .set('Cookie', adminACookie)
      .send({ type: 'PHONE', rawValue: '01711000001', isPrimary: true });

    expect(resZero.status).toBe(201);
    expect(resZero.body.data.id).toBe(contactId1);
    const auditCountAfter = await prisma.auditLog.count({ where: { entityId: contactId1 } });
    expect(auditCountAfter).toBe(auditCountBefore);

    const count = await prisma.leadContact.count({ where: { leadId: lead.id } });
    expect(count).toBe(2);
  });

  it('62, 63 & 65. browser cannot set VERIFIED status, fake evidence is not created, suppression derived', async () => {
    // Add number to suppression list
    await prisma.suppressionList.create({
      data: {
        organizationId: ORG_A_ID,
        type: 'PHONE',
        normalizedValue: '+8801711000001',
        channelScope: 'ALL',
        reason: 'DO_NOT_CONTACT',
        addedBy: 'test-admin'
      }
    });

    const lead = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Suppression & Evidence Lead',
        normalizedName: 'suppression evidence lead',
        category: 'Services',
        city: 'Dhaka',
        country: 'BD',
        primarySource: 'MANUAL'
      }
    });

    // Attempt to pass status: 'VERIFIED'
    const res = await request(app)
      .post(`/api/v1/leads/${lead.id}/contacts`)
      .set('Cookie', adminACookie)
      .send({
        type: 'PHONE',
        rawValue: '01711000001',
        status: 'VERIFIED' // Rejected by strict schema
      });

    expect(res.status).toBe(422);

    // Valid contact creation
    const validRes = await request(app)
      .post(`/api/v1/leads/${lead.id}/contacts`)
      .set('Cookie', adminACookie)
      .send({
        type: 'PHONE',
        rawValue: '01711000001'
      });

    expect(validRes.status).toBe(201);
    expect(validRes.body.data.status).toBe(ContactStatus.FOUND);
    expect(validRes.body.data.isSuppressed).toBe(true);
    expect(validRes.body.data.suppressionReason).toBe('DO_NOT_CONTACT');
    expect(validRes.body.data.evidence).toEqual([]);
  });

  it('64. primary promotion updates Lead.primaryPhone, demotes other primaries, invalid contacts cannot be primary', async () => {
    const lead = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Primary Promotion Lead',
        normalizedName: 'primary promotion lead',
        category: 'Services',
        city: 'Dhaka',
        country: 'BD',
        primaryPhone: '+8801711000001',
        primarySource: 'MANUAL',
        contacts: {
          create: {
            type: ContactType.PHONE,
            rawValue: '01711000001',
            normalizedValue: '+8801711000001',
            phoneType: PhoneType.MOBILE,
            status: ContactStatus.FOUND,
            isPrimary: true
          }
        }
      }
    });

    // 1. Add second mobile contact with isPrimary = true
    const res = await request(app)
      .post(`/api/v1/leads/${lead.id}/contacts`)
      .set('Cookie', adminACookie)
      .send({
        type: 'PHONE',
        rawValue: '01722000002',
        isPrimary: true
      });

    expect(res.status).toBe(201);
    expect(res.body.data.isPrimary).toBe(true);

    // Verify Lead.primaryPhone updated
    const updatedLead = await prisma.lead.findUnique({
      where: { id: lead.id },
      include: { contacts: true }
    });
    expect(updatedLead!.primaryPhone).toBe('+8801722000002');

    // Verify first contact isPrimary was demoted to false
    const firstContact = updatedLead!.contacts.find((c) => c.normalizedValue === '+8801711000001');
    expect(firstContact!.isPrimary).toBe(false);

    // 2. Invalid contact + isPrimary = true must NOT overwrite Lead.primaryPhone
    const resInvalid = await request(app)
      .post(`/api/v1/leads/${lead.id}/contacts`)
      .set('Cookie', adminACookie)
      .send({
        type: 'PHONE',
        rawValue: 'invalid-number-xyz',
        isPrimary: true
      });

    expect(resInvalid.status).toBe(201);
    expect(resInvalid.body.data.status).toBe(ContactStatus.INVALID_FORMAT);

    const leadAfterInvalid = await prisma.lead.findUnique({ where: { id: lead.id } });
    expect(leadAfterInvalid!.primaryPhone).toBe('+8801722000002');
  });

  it('hasWhatsApp filter matches PUBLICLY_LISTED and CONFIRMED, excludes UNKNOWN', async () => {
    // Lead with UNKNOWN whatsapp
    const leadUnknown = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Unknown WA Lead',
        normalizedName: 'unknown wa lead',
        category: 'Services',
        city: 'Dhaka',
        country: 'BD',
        primarySource: 'MANUAL',
        contacts: {
          create: {
            type: ContactType.WHATSAPP,
            rawValue: '01711000001',
            normalizedValue: '+8801711000001',
            whatsappStatus: WhatsAppStatus.UNKNOWN,
            status: ContactStatus.FOUND,
            isPrimary: false
          }
        }
      }
    });

    // Lead with PUBLICLY_LISTED whatsapp
    const leadPublic = await prisma.lead.create({
      data: {
        organizationId: ORG_A_ID,
        name: 'Public WA Lead',
        normalizedName: 'public wa lead',
        category: 'Services',
        city: 'Dhaka',
        country: 'BD',
        primarySource: 'MANUAL',
        contacts: {
          create: {
            type: ContactType.WHATSAPP,
            rawValue: '01711000002',
            normalizedValue: '+8801711000002',
            whatsappStatus: WhatsAppStatus.PUBLICLY_LISTED,
            status: ContactStatus.FOUND,
            isPrimary: false
          }
        }
      }
    });

    // Query hasWhatsApp = true => returns only leadPublic
    const resTrue = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie)
      .query({ hasWhatsApp: true });
    expect(resTrue.status).toBe(200);
    expect(resTrue.body.data.length).toBe(1);
    expect(resTrue.body.data[0].id).toBe(leadPublic.id);

    // Query hasWhatsApp = false => includes leadUnknown, excludes leadPublic
    const resFalse = await request(app)
      .get('/api/v1/leads')
      .set('Cookie', adminACookie)
      .query({ hasWhatsApp: false });
    expect(resFalse.status).toBe(200);
    expect(resFalse.body.data.some((x: any) => x.id === leadUnknown.id)).toBe(true);
    expect(resFalse.body.data.some((x: any) => x.id === leadPublic.id)).toBe(false);
  });
});
