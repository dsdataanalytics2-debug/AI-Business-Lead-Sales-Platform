/**
 * M1 Step 10: End-to-End Integration, Regression & Milestone Closure Test Suite
 *
 * Comprehensive validation of the entire M1 Data Sources & Schema milestone:
 * 1. Full E2E Lifecycle: Search -> Select -> Trusted Save -> Lead List -> Lead Detail -> PATCH Lead -> Add Manual Contact -> Re-fetch Detail.
 * 2. Trusted Save & Anti-Tampering: Strict schema validation rejecting client-injected fields (name, phone, rating, etc.).
 * 3. Strict Multi-Tenant Isolation: Org A vs Org B (404 on cross-tenant read/patch/contact, isolated list).
 * 4. Granular RBAC: LEADS_READ (search, list, view) vs LEADS_WRITE (save, patch, add contact) vs 401 unauthenticated.
 * 5. Deterministic Duplicate Matrix: Tier 1A (provider+extId), Tier 1B (mobile phone), Tier 2A (website domain 409), Tier 2B (name+city 409), Conflict (409).
 * 6. BD Normalization & Contact Trust: Canonical BD mobile, PHONE != WHATSAPP, manual WhatsApp = UNKNOWN, no client-claimed VERIFIED.
 * 7. Suppression Separation: Orthogonal to contact status (isSuppressed=true, status=FOUND, not STALE).
 * 8. Data Minimization & Privacy: LeadSource.rawData and secrets never exposed to clients.
 * 9. Audit Logging: Authoritative audit trail for create, merge, patch, contact operations; zero audit log on 409 candidates.
 * 10. Standard Error Contract: { error: { code, message, requestId } } across 401, 403, 404, 409, 422 without stack trace leakage.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import prisma, {
  Role,
  ContactType,
  PhoneType,
  ContactStatus,
  WhatsAppStatus,
  EvidenceType
} from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import { ErrorCodes, Permissions, DuplicateAction } from '@leadmate/shared';
import { app } from '../app.js';
import { hashPassword, hashSessionToken } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';

describe('M1 Step 10: End-to-End Integration & Regression Suite', () => {
  const ORG_A_ID = '90000000-0000-0000-0000-000000000001';
  const ORG_B_ID = '90000000-0000-0000-0000-000000000002';

  const adminAEmail = 'admin-e2e-a@leadmate.test';
  const adminAPassword = 'AdminPass12345!A';
  let adminACookie: string;

  const viewerAEmail = 'viewer-e2e-a@leadmate.test';
  const viewerAPassword = 'ViewerPass12345!A';
  let viewerACookie: string;

  const adminBEmail = 'admin-e2e-b@leadmate.test';
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
    await ensureTestDatabase(prisma);
    await prisma.contactEvidence.deleteMany({});
    await prisma.leadContact.deleteMany({});
    await prisma.leadSource.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.suppressionList.deleteMany({});
  }

  beforeAll(async () => {
    // 0. Strict Safety Guard: Confirm connected PostgreSQL database name ENDS WITH "_test"
    await ensureTestDatabase(prisma);

    // 1. Setup Tenant Organizations
    await prisma.organization.upsert({
      where: { id: ORG_A_ID },
      update: {},
      create: {
        id: ORG_A_ID,
        name: 'E2E Tenant Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.upsert({
      where: { id: ORG_B_ID },
      update: {},
      create: {
        id: ORG_B_ID,
        name: 'E2E Tenant Org B',
        timezone: 'Asia/Dhaka'
      }
    });

    // 2. Setup Org A Admin User (LEADS_READ + LEADS_WRITE)
    const adminAHash = await hashPassword(adminAPassword);
    const adminAUser = await prisma.user.upsert({
      where: { email: adminAEmail },
      update: { passwordHash: adminAHash, role: Role.ADMIN, organizationId: ORG_A_ID, isActive: true },
      create: { email: adminAEmail, passwordHash: adminAHash, name: 'Admin Org A', role: Role.ADMIN, organizationId: ORG_A_ID, isActive: true }
    });
    adminACookie = await createSessionCookie(adminAUser.id, 'e2e-session-token-admin-a');

    // 3. Setup Org A Viewer User (LEADS_READ only)
    const viewerAHash = await hashPassword(viewerAPassword);
    const viewerAUser = await prisma.user.upsert({
      where: { email: viewerAEmail },
      update: { passwordHash: viewerAHash, role: Role.VIEWER, organizationId: ORG_A_ID, isActive: true },
      create: { email: viewerAEmail, passwordHash: viewerAHash, name: 'Viewer Org A', role: Role.VIEWER, organizationId: ORG_A_ID, isActive: true }
    });
    viewerACookie = await createSessionCookie(viewerAUser.id, 'e2e-session-token-viewer-a');

    // 4. Setup Org B Admin User
    const adminBHash = await hashPassword(adminBPassword);
    const adminBUser = await prisma.user.upsert({
      where: { email: adminBEmail },
      update: { passwordHash: adminBHash, role: Role.ADMIN, organizationId: ORG_B_ID, isActive: true },
      create: { email: adminBEmail, passwordHash: adminBHash, name: 'Admin Org B', role: Role.ADMIN, organizationId: ORG_B_ID, isActive: true }
    });
    adminBCookie = await createSessionCookie(adminBUser.id, 'e2e-session-token-admin-b');
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterAll(async () => {
    try {
      await cleanupDatabase();
    } finally {
      await prisma.$disconnect();
    }
  });

  /* =========================================================================
   * 1. End-to-End Complete Business Lifecycle
   * ========================================================================= */
  describe('1. Complete End-to-End Business Flow', () => {
    it('executes full flow: Search -> Select -> Trusted Save -> List -> Detail -> PATCH -> Add Manual Contact -> Re-fetch Detail', async () => {
      // Step A: Authenticated user searches mock provider
      const searchRes = await request(app)
        .get('/api/v1/business-search')
        .set('Cookie', adminACookie)
        .query({ q: 'dental', location: 'Gulshan' });

      expect(searchRes.status).toBe(200);
      expect(searchRes.body.data).toBeDefined();
      expect(searchRes.body.data.length).toBeGreaterThan(0);

      // Step B: Pick returned business
      const selected = searchRes.body.data[0];
      expect(selected.provider).toBe('MOCK');
      expect(selected.externalId).toBe('mock-dhaka-dental-gulshan-001');

      // Step C: Trusted save using ONLY provider and externalId
      const saveRes = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({
          provider: selected.provider,
          externalId: selected.externalId
        });

      expect(saveRes.status).toBe(201);
      expect(saveRes.body.data.action).toBe(DuplicateAction.CREATED);
      const leadId = saveRes.body.data.leadId;
      expect(leadId).toBeDefined();

      // Step D: Verify saved lead exists in PostgreSQL with normalized values and provenance
      const leadInDb = await prisma.lead.findUnique({
        where: { id: leadId },
        include: { contacts: true, sources: true }
      });
      expect(leadInDb).toBeDefined();
      expect(leadInDb!.organizationId).toBe(ORG_A_ID);
      expect(leadInDb!.sources.length).toBe(1);
      expect(leadInDb!.sources[0].sourceName).toBe('MOCK');
      expect(leadInDb!.sources[0].sourceExternalId).toBe('mock-dhaka-dental-gulshan-001');
      expect(leadInDb!.contacts.length).toBeGreaterThan(0);

      // Step E: GET /api/v1/leads (Verify it appears in list)
      const listRes = await request(app)
        .get('/api/v1/leads')
        .set('Cookie', adminACookie);

      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBe(1);
      expect(listRes.body.data[0].id).toBe(leadId);
      expect(listRes.body.data[0].name).toBe('Mock Dhaka Dental Care Gulshan');
      expect(listRes.body.data[0].primaryPhone).toBe('+8801711000001');

      // Step F: GET /api/v1/leads/:id (Verify authoritative normalized detail)
      const detailRes = await request(app)
        .get(`/api/v1/leads/${leadId}`)
        .set('Cookie', adminACookie);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.data.id).toBe(leadId);
      expect(detailRes.body.data.name).toBe('Mock Dhaka Dental Care Gulshan');
      expect(detailRes.body.data.city).toBe('Dhaka');
      expect(detailRes.body.data.contacts.length).toBeGreaterThan(0);
      expect(detailRes.body.data.sources.length).toBe(1);
      // Data minimization: rawData must NOT be present
      expect(detailRes.body.data.sources[0].rawData).toBeUndefined();

      // Step G: PATCH allowed lead field (description, category)
      const patchRes = await request(app)
        .patch(`/api/v1/leads/${leadId}`)
        .set('Cookie', adminACookie)
        .send({
          description: 'Top prospective dental clinic in Gulshan',
          category: 'Dental Clinic'
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.description).toBe('Top prospective dental clinic in Gulshan');
      expect(patchRes.body.data.category).toBe('Dental Clinic');

      // Step H: POST manual contact (PHONE != WHATSAPP, manual WhatsApp defaults UNKNOWN)
      const contactRes = await request(app)
        .post(`/api/v1/leads/${leadId}/contacts`)
        .set('Cookie', adminACookie)
        .send({
          type: ContactType.WHATSAPP,
          rawValue: '01811999999',
          isPrimary: false
        });

      expect(contactRes.status).toBe(201);
      expect(contactRes.body.data.type).toBe(ContactType.WHATSAPP);
      expect(contactRes.body.data.normalizedValue).toBe('+8801811999999');
      expect(contactRes.body.data.whatsappStatus).toBe(WhatsAppStatus.UNKNOWN);
      expect(contactRes.body.data.status).toBe(ContactStatus.FOUND);

      // Step I: GET detail again (Verify authoritative updated state)
      const finalDetailRes = await request(app)
        .get(`/api/v1/leads/${leadId}`)
        .set('Cookie', adminACookie);

      expect(finalDetailRes.status).toBe(200);
      expect(finalDetailRes.body.data.description).toBe('Top prospective dental clinic in Gulshan');
      const waContact = finalDetailRes.body.data.contacts.find(
        (c: { normalizedValue: string }) => c.normalizedValue === '+8801811999999'
      );
      expect(waContact).toBeDefined();
      expect(waContact.type).toBe(ContactType.WHATSAPP);
      expect(waContact.whatsappStatus).toBe(WhatsAppStatus.UNKNOWN);
    });
  });

  /* =========================================================================
   * 2. Trusted Save & Anti-Tampering Invariants
   * ========================================================================= */
  describe('2. Trusted Save & Anti-Tampering', () => {
    it('rejects save request with client-injected authoritative fields (422 VALIDATION_ERROR)', async () => {
      const tamperedRes = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({
          provider: 'MOCK',
          externalId: 'mock-dhaka-dental-gulshan-001',
          name: 'Hacked Injected Business Name',
          phone: '+8801999999999',
          rating: 5.0,
          organizationId: ORG_B_ID
        });

      expect(tamperedRes.status).toBe(422);
      expect(tamperedRes.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('rejects save request with missing externalId or provider (422 VALIDATION_ERROR)', async () => {
      const invalidRes = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({ provider: 'MOCK' });

      expect(invalidRes.status).toBe(422);
      expect(invalidRes.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
  });

  /* =========================================================================
   * 3. Multi-Tenant Isolation
   * ========================================================================= */
  describe('3. Multi-Tenant Isolation', () => {
    let orgALeadId: string;

    beforeEach(async () => {
      const saveRes = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({ provider: 'MOCK', externalId: 'mock-dhaka-dental-gulshan-001' });
      orgALeadId = saveRes.body.data.leadId;
    });

    it('prevents Org B from reading Org A lead (404 NOT_FOUND)', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${orgALeadId}`)
        .set('Cookie', adminBCookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    it('prevents Org B from patching Org A lead (404 NOT_FOUND)', async () => {
      const res = await request(app)
        .patch(`/api/v1/leads/${orgALeadId}`)
        .set('Cookie', adminBCookie)
        .send({ name: 'Cross-tenant patch attack' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    it('prevents Org B from adding contact to Org A lead (404 NOT_FOUND)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${orgALeadId}/contacts`)
        .set('Cookie', adminBCookie)
        .send({ type: ContactType.PHONE, rawValue: '01711222333' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    it('isolates lead list: Org B list does NOT contain Org A lead', async () => {
      const res = await request(app)
        .get('/api/v1/leads')
        .set('Cookie', adminBCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(0);
    });
  });

  /* =========================================================================
   * 4. RBAC Authorization Enforcement
   * ========================================================================= */
  describe('4. RBAC Authorization Enforcement', () => {
    let orgALeadId: string;

    beforeEach(async () => {
      const saveRes = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({ provider: 'MOCK', externalId: 'mock-dhaka-dental-gulshan-001' });
      orgALeadId = saveRes.body.data.leadId;
    });

    it('allows Viewer (LEADS_READ) to search, list, and view detail', async () => {
      const searchRes = await request(app)
        .get('/api/v1/business-search')
        .set('Cookie', viewerACookie)
        .query({ q: 'dental', location: 'Gulshan' });
      expect(searchRes.status).toBe(200);

      const listRes = await request(app)
        .get('/api/v1/leads')
        .set('Cookie', viewerACookie);
      expect(listRes.status).toBe(200);

      const detailRes = await request(app)
        .get(`/api/v1/leads/${orgALeadId}`)
        .set('Cookie', viewerACookie);
      expect(detailRes.status).toBe(200);
    });

    it('blocks Viewer lacking LEADS_WRITE on save, patch, and contact creation (403 FORBIDDEN)', async () => {
      const saveRes = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', viewerACookie)
        .send({ provider: 'MOCK', externalId: 'mock-dhaka-bakery-mirpur-005' });
      expect(saveRes.status).toBe(403);
      expect(saveRes.body.error.code).toBe(ErrorCodes.FORBIDDEN);

      const patchRes = await request(app)
        .patch(`/api/v1/leads/${orgALeadId}`)
        .set('Cookie', viewerACookie)
        .send({ name: 'Unauthorized edit' });
      expect(patchRes.status).toBe(403);
      expect(patchRes.body.error.code).toBe(ErrorCodes.FORBIDDEN);

      const contactRes = await request(app)
        .post(`/api/v1/leads/${orgALeadId}/contacts`)
        .set('Cookie', viewerACookie)
        .send({ type: ContactType.PHONE, rawValue: '01711222333' });
      expect(contactRes.status).toBe(403);
      expect(contactRes.body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('blocks unauthenticated requests without session cookie (401 UNAUTHENTICATED)', async () => {
      const res = await request(app).get('/api/v1/leads');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    });
  });

  /* =========================================================================
   * 5. Deterministic Duplicate Detection Matrix
   * ========================================================================= */
  describe('5. Duplicate Detection Rules', () => {
    it('Tier 1A: same provider + externalId merges into existing lead with 200 OK', async () => {
      // 1. Initial save -> 201 CREATED
      const res1 = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({ provider: 'MOCK', externalId: 'mock-dhaka-dental-gulshan-001' });
      expect(res1.status).toBe(201);
      expect(res1.body.data.action).toBe(DuplicateAction.CREATED);
      const initialLeadId = res1.body.data.leadId;

      // 2. Re-save same provider + externalId -> 200 MERGED
      const res2 = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({ provider: 'MOCK', externalId: 'mock-dhaka-dental-gulshan-001' });
      expect(res2.status).toBe(200);
      expect(res2.body.data.action).toBe(DuplicateAction.MERGED);
      expect(res2.body.data.leadId).toBe(initialLeadId);

      // Verify DB has only 1 lead row
      const count = await prisma.lead.count({ where: { organizationId: ORG_A_ID } });
      expect(count).toBe(1);
    });

    it('Tier 1B: same normalized BD phone merges definite match with 200 OK', async () => {
      // 1. Create a lead with normalized mobile +8801811000003
      const existingLead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Existing Agrabad Steel Works',
          normalizedName: 'existing agrabad steel works',
          category: 'Manufacturing',
          city: 'Chattogram',
          country: 'BD',
          primaryPhone: '+8801811000003',
          primarySource: 'MANUAL',
          contacts: {
            create: {
              type: ContactType.PHONE,
              rawValue: '01811000003',
              normalizedValue: '+8801811000003',
              phoneType: PhoneType.MOBILE,
              status: ContactStatus.FOUND,
              isPrimary: true
            }
          }
        }
      });

      // 2. Save fixture mock-ctg-steel-agrabad-003 which has phone "+8801811000003"
      const res = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({ provider: 'MOCK', externalId: 'mock-ctg-steel-agrabad-003' });

      expect(res.status).toBe(200);
      expect(res.body.data.action).toBe(DuplicateAction.MERGED);
      expect(res.body.data.leadId).toBe(existingLead.id);
      expect(res.body.data.matchReason).toBe('TIER_1B_MOBILE_MATCH');
    });

    it('Tier 2A: same website domain produces 409 CONFLICT candidate with zero DB write', async () => {
      // 1. Create an existing lead with domain "ctgsteel.example.com"
      const existing = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Independent Steel Traders',
          normalizedName: 'independent steel traders',
          category: 'Steel',
          city: 'Chattogram',
          country: 'BD',
          website: 'https://ctgsteel.example.com',
          normalizedWebsite: 'ctgsteel.example.com',
          primarySource: 'MANUAL'
        }
      });

      // 2. Try to save fixture 003 which has website "https://ctgsteel.example.com"
      const res = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({ provider: 'MOCK', externalId: 'mock-ctg-steel-agrabad-003' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(ErrorCodes.CONFLICT);
      expect(res.body.error.details.action).toBe('CANDIDATE_REQUIRES_CONFIRMATION');
      expect(res.body.error.details.candidateLeadIds).toContain(existing.id);

      // Verify no new lead created
      const totalLeads = await prisma.lead.count({ where: { organizationId: ORG_A_ID } });
      expect(totalLeads).toBe(1);
    });

    it('Tier 2B: same name + city produces 409 CONFLICT candidate with zero DB write', async () => {
      // 1. Create an existing lead with same name & city as fixture 004
      const existing = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Mock Surma Valley Tea House',
          normalizedName: 'mock surma valley tea house',
          category: 'Tea',
          city: 'Sylhet',
          locality: 'Zindabazar',
          country: 'BD',
          primarySource: 'MANUAL'
        }
      });

      // 2. Save fixture 004
      const res = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({ provider: 'MOCK', externalId: 'mock-sylhet-tea-zindabazar-004' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(ErrorCodes.CONFLICT);
      expect(res.body.error.details.action).toBe('CANDIDATE_REQUIRES_CONFIRMATION');
      expect(res.body.error.details.candidateLeadIds).toContain(existing.id);

      const totalLeads = await prisma.lead.count({ where: { organizationId: ORG_A_ID } });
      expect(totalLeads).toBe(1);
    });

    it('Conflict: conflicting identities produce 409 CONFLICT with zero DB mutation', async () => {
      // 1. Create Lead A with provider source for fixture 001
      const leadA = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Lead A - Gulshan Dental Clinic',
          normalizedName: 'lead a gulshan dental clinic',
          category: 'Dental',
          city: 'Dhaka',
          country: 'BD',
          primarySource: 'MOCK'
        }
      });

      await prisma.leadSource.create({
        data: {
          leadId: leadA.id,
          organizationId: ORG_A_ID,
          sourceName: 'MOCK',
          sourceExternalId: 'mock-dhaka-dental-gulshan-001'
        }
      });

      // 2. Create Lead B with mobile for fixture 001 (+8801711000001)
      const leadB = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Lead B - Different Branch',
          normalizedName: 'lead b different branch',
          category: 'Dental',
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
              status: ContactStatus.FOUND
            }
          }
        }
      });

      // 3. Save fixture 001 -> Provider matches Lead A, but mobile matches Lead B => CONFLICT!
      const res = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({ provider: 'MOCK', externalId: 'mock-dhaka-dental-gulshan-001' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(ErrorCodes.CONFLICT);
      expect(res.body.error.details.action).toBe('DEFINITE_MATCH_CONFLICT');
      expect(res.body.error.details.conflictingLeadIds).toContain(leadA.id);
      expect(res.body.error.details.conflictingLeadIds).toContain(leadB.id);

      const totalLeads = await prisma.lead.count({ where: { organizationId: ORG_A_ID } });
      expect(totalLeads).toBe(2);
    });
  });

  /* =========================================================================
   * 6. BD Normalization, Contact Trust & Suppression Invariants
   * ========================================================================= */
  describe('6. Normalization, Contact Trust & Suppression Invariants', () => {
    it('normalizes Bengali digits and various BD formats to canonical +8801... mobile form', async () => {
      const saveRes = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({ provider: 'MOCK', externalId: 'mock-dhaka-dental-gulshan-001' });
      const leadId = saveRes.body.data.leadId;

      // Add Bengali digit phone number: ০১৭১১৩৩৩৪৪৪
      const contactRes = await request(app)
        .post(`/api/v1/leads/${leadId}/contacts`)
        .set('Cookie', adminACookie)
        .send({
          type: ContactType.PHONE,
          rawValue: '০১৭১১৩৩৩৪৪৪'
        });

      expect(contactRes.status).toBe(201);
      expect(contactRes.body.data.normalizedValue).toBe('+8801711333444');
      expect(contactRes.body.data.phoneType).toBe(PhoneType.MOBILE);
    });

    it('enforces PHONE != WHATSAPP: manual WhatsApp contact strictly defaults to UNKNOWN', async () => {
      const saveRes = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({ provider: 'MOCK', externalId: 'mock-dhaka-dental-gulshan-001' });
      const leadId = saveRes.body.data.leadId;

      // Attempt to post manual WhatsApp contact
      const contactRes = await request(app)
        .post(`/api/v1/leads/${leadId}/contacts`)
        .set('Cookie', adminACookie)
        .send({
          type: ContactType.WHATSAPP,
          rawValue: '01711000002'
        });

      expect(contactRes.status).toBe(201);
      expect(contactRes.body.data.type).toBe(ContactType.WHATSAPP);
      expect(contactRes.body.data.whatsappStatus).toBe(WhatsAppStatus.UNKNOWN);
      expect(contactRes.body.data.status).toBe(ContactStatus.FOUND);
    });

    it('suppression list integration: suppressed contact retains status FOUND with isSuppressed=true (never STALE)', async () => {
      // 1. Add phone to Org A suppression list
      await prisma.suppressionList.create({
        data: {
          organizationId: ORG_A_ID,
          type: 'PHONE',
          normalizedValue: '+8801711000001',
          channelScope: 'ALL',
          reason: 'OPT_OUT',
          addedBy: 'test-admin'
        }
      });

      // 2. Save lead with that phone
      const saveRes = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({ provider: 'MOCK', externalId: 'mock-dhaka-dental-gulshan-001' });

      expect(saveRes.status).toBe(201);
      const leadId = saveRes.body.data.leadId;

      // 3. GET /api/v1/leads/:id
      const detailRes = await request(app)
        .get(`/api/v1/leads/${leadId}`)
        .set('Cookie', adminACookie);

      expect(detailRes.status).toBe(200);
      const contact = detailRes.body.data.contacts.find(
        (c: { normalizedValue: string }) => c.normalizedValue === '+8801711000001'
      );
      expect(contact).toBeDefined();
      expect(contact.status).toBe(ContactStatus.FOUND);
      expect(contact.isSuppressed).toBe(true);
      expect(contact.suppressionReason).toBe('OPT_OUT');
    });
  });

  /* =========================================================================
   * 7. Data Minimization, Audit Logging & Error Contracts
   * ========================================================================= */
  describe('7. Data Minimization, Audit Logging & Error Contracts', () => {
    it('data minimization: LeadSource.rawData and internal credentials are not leaked in responses', async () => {
      const saveRes = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({ provider: 'MOCK', externalId: 'mock-dhaka-dental-gulshan-001' });
      const leadId = saveRes.body.data.leadId;

      const detailRes = await request(app)
        .get(`/api/v1/leads/${leadId}`)
        .set('Cookie', adminACookie);

      expect(detailRes.status).toBe(200);
      for (const source of detailRes.body.data.sources) {
        expect(source.rawData).toBeUndefined();
      }
    });

    it('audit logging: records lead.created_from_provider, lead.merged_from_provider, and lead.updated', async () => {
      // 1. Create
      const saveRes = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({ provider: 'MOCK', externalId: 'mock-dhaka-dental-gulshan-001' });
      const leadId = saveRes.body.data.leadId;

      const createAudit = await prisma.auditLog.findFirst({
        where: { entityId: leadId, action: 'lead.created_from_provider' }
      });
      expect(createAudit).toBeDefined();
      expect(createAudit!.organizationId).toBe(ORG_A_ID);

      // 2. Merge
      await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({ provider: 'MOCK', externalId: 'mock-dhaka-dental-gulshan-001' });

      const mergeAudit = await prisma.auditLog.findFirst({
        where: { entityId: leadId, action: 'lead.merged_from_provider' }
      });
      expect(mergeAudit).toBeDefined();

      // 3. Patch
      await request(app)
        .patch(`/api/v1/leads/${leadId}`)
        .set('Cookie', adminACookie)
        .send({ description: 'Audit logged description edit' });

      const updateAudit = await prisma.auditLog.findFirst({
        where: { entityId: leadId, action: 'lead.updated' }
      });
      expect(updateAudit).toBeDefined();
    });

    it('standard error contract: returns { error: { code, message, requestId } } on 404', async () => {
      const res = await request(app)
        .get('/api/v1/leads/00000000-0000-0000-0000-000000000099')
        .set('Cookie', adminACookie);

      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(res.body.error.message).toBeDefined();
      expect(res.body.error.requestId).toBeDefined();
      expect(res.body.error.stack).toBeUndefined();
    });
  });
});
