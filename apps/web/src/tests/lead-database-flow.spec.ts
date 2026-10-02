import './setup-test-env.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import prisma from '@leadmate/db';
import { app } from '../../../api/src/app.js';
import { hashPassword } from '../../../api/src/lib/crypto.js';
import { resetLoginRateLimiter } from '../../../api/src/middleware/rate-limiter.js';
import { apiClient, ApiClientError } from '../lib/api-client.js';
import {
  Role,
  ContactType,
  WhatsAppStatus,
  ErrorCodes
} from '@leadmate/shared';
import { ensureTestDatabase } from './helpers/test-db-guard.js';
import { buildLeadPatchPayload } from '../lib/leads/lead-patch-payload.js';
import { buildManualContactPayload } from '../lib/leads/manual-contact-payload.js';

describe('M1 Step 9: Frontend API Client Lead Database Integration Matrix', () => {
  let server: http.Server;
  let serverPort: number;
  let orgId: string;
  let otherOrgId: string;
  let adminCookie: string;
  let viewerCookie: string;

  const adminEmail = 'leads-admin@leadmate.test';
  const adminPassword = 'LeadsAdmin12345!A';
  const viewerEmail = 'leads-viewer@leadmate.test';
  const viewerPassword = 'LeadsViewer12345!V';

  async function cleanupDb() {
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

    // Start live backend API server for apiClient integration verification
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

    // Ensure organizations exist in PostgreSQL
    const org = await prisma.organization.upsert({
      where: { id: '00000000-0000-0000-0000-000000000001' },
      update: {},
      create: {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'LeadMate Primary Org',
        timezone: 'Asia/Dhaka'
      }
    });
    orgId = org.id;

    const otherOrg = await prisma.organization.upsert({
      where: { id: '00000000-0000-0000-0000-000000000002' },
      update: {},
      create: {
        id: '00000000-0000-0000-0000-000000000002',
        name: 'LeadMate Other Org',
        timezone: 'Asia/Dhaka'
      }
    });
    otherOrgId = otherOrg.id;

    // Create Admin user (has LEADS_READ and LEADS_WRITE)
    const adminHash = await hashPassword(adminPassword);
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: { passwordHash: adminHash, role: Role.ADMIN, organizationId: orgId, isActive: true },
      create: {
        email: adminEmail,
        passwordHash: adminHash,
        name: 'Leads Admin',
        role: Role.ADMIN,
        organizationId: orgId,
        isActive: true
      }
    });

    // Create Viewer user (has LEADS_READ, lacks LEADS_WRITE)
    const viewerHash = await hashPassword(viewerPassword);
    await prisma.user.upsert({
      where: { email: viewerEmail },
      update: { passwordHash: viewerHash, role: Role.VIEWER, organizationId: orgId, isActive: true },
      create: {
        email: viewerEmail,
        passwordHash: viewerHash,
        name: 'Leads Viewer',
        role: Role.VIEWER,
        organizationId: orgId,
        isActive: true
      }
    });

    // Login Admin to obtain session cookie
    const adminLoginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });
    adminCookie = adminLoginRes.headers.get('set-cookie')?.split(';')[0] || '';

    // Login Viewer to obtain session cookie
    const viewerLoginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: viewerEmail, password: viewerPassword })
    });
    viewerCookie = viewerLoginRes.headers.get('set-cookie')?.split(';')[0] || '';
  });

  beforeEach(async () => {
    resetLoginRateLimiter();
    await cleanupDb();
  });

  afterAll(async () => {
    try {
      await cleanupDb();
    } finally {
      if (server) {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }
      await prisma.$disconnect();
    }
  });

  /* =========================================================================
   * apiClient.leads.list Integration Tests
   * ========================================================================= */

  it('1. apiClient.leads.list: hasPhone=false filter correctly reaches server as boolean false and differs from unset', async () => {
    await prisma.lead.create({
      data: {
        organizationId: orgId,
        name: 'Lead With Phone',
        normalizedName: 'lead with phone',
        category: 'Dental Clinic',
        city: 'Dhaka',
        country: 'BD',
        primaryPhone: '+8801711000001',
        primarySource: 'MOCK'
      }
    });

    await prisma.lead.create({
      data: {
        organizationId: orgId,
        name: 'Lead Without Phone',
        normalizedName: 'lead without phone',
        category: 'Dental Clinic',
        city: 'Dhaka',
        country: 'BD',
        primaryPhone: null,
        primarySource: 'MOCK'
      }
    });

    // Unfiltered list returns all 2 leads
    const allRes = await apiClient.leads.list({}, { headers: { Cookie: adminCookie } });
    expect(allRes.data).toHaveLength(2);
    expect(allRes.meta.total).toBe(2);

    // Filtered by hasPhone: false returns strictly the lead without phone
    const noPhoneRes = await apiClient.leads.list(
      { hasPhone: false },
      { headers: { Cookie: adminCookie } }
    );
    expect(noPhoneRes.data).toHaveLength(1);
    expect(noPhoneRes.data[0].name).toBe('Lead Without Phone');
    expect(noPhoneRes.data[0].primaryPhone).toBeNull();
  });

  it('2. apiClient.leads.list: cursor pagination round-trip traverses pages without omissions or duplicates', async () => {
    for (let i = 1; i <= 3; i++) {
      await prisma.lead.create({
        data: {
          organizationId: orgId,
          name: `Paginated Lead ${i}`,
          normalizedName: `paginated lead ${i}`,
          category: 'Retail',
          city: 'Dhaka',
          country: 'BD',
          primarySource: 'MOCK'
        }
      });
    }

    const page1 = await apiClient.leads.list({ limit: 2 }, { headers: { Cookie: adminCookie } });
    expect(page1.data).toHaveLength(2);
    expect(page1.meta.total).toBe(3);
    expect(page1.meta.hasMore).toBe(true);
    expect(page1.meta.nextCursor).toBeTruthy();

    const page2 = await apiClient.leads.list(
      { limit: 2, cursor: page1.meta.nextCursor! },
      { headers: { Cookie: adminCookie } }
    );
    expect(page2.data).toHaveLength(1);
    expect(page2.meta.hasMore).toBe(false);
    expect(page2.meta.nextCursor).toBeNull();

    // Union of IDs is exactly 3 leads with 0 duplicates
    const allIds = [...page1.data.map((l) => l.id), ...page2.data.map((l) => l.id)];
    expect(new Set(allIds).size).toBe(3);
  });

  it('3. apiClient.leads.list: throws ApiClientError with statusCode 401 when unauthenticated', async () => {
    await expect(apiClient.leads.list({}, { headers: {} })).rejects.toThrow(ApiClientError);
    try {
      await apiClient.leads.list({}, { headers: {} });
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).statusCode).toBe(401);
      expect((err as ApiClientError).code).toBe(ErrorCodes.UNAUTHENTICATED);
    }
  });

  /* =========================================================================
   * apiClient.leads.get Integration Tests
   * ========================================================================= */

  it('4. apiClient.leads.get: throws ApiClientError with statusCode 404 and NOT_FOUND without revealing tenant on missing and cross-tenant ids', async () => {
    const unknownId = '00000000-0000-0000-0000-999999999999';

    // Unknown ID 404
    await expect(
      apiClient.leads.get(unknownId, { headers: { Cookie: adminCookie } })
    ).rejects.toThrow(ApiClientError);

    try {
      await apiClient.leads.get(unknownId, { headers: { Cookie: adminCookie } });
    } catch (err) {
      const apiErr = err as ApiClientError;
      expect(apiErr.statusCode).toBe(404);
      expect(apiErr.code).toBe(ErrorCodes.NOT_FOUND);
      expect(apiErr.message.toLowerCase()).not.toContain('org');
      expect(apiErr.message.toLowerCase()).not.toContain('tenant');
    }

    // Cross-tenant lead 404 isolation
    const otherLead = await prisma.lead.create({
      data: {
        organizationId: otherOrgId,
        name: 'Foreign Org Lead',
        normalizedName: 'foreign org lead',
        category: 'Secret',
        city: 'Sylhet',
        country: 'BD',
        primarySource: 'MOCK'
      }
    });

    try {
      await apiClient.leads.get(otherLead.id, { headers: { Cookie: adminCookie } });
    } catch (err) {
      const apiErr = err as ApiClientError;
      expect(apiErr.statusCode).toBe(404);
      expect(apiErr.code).toBe(ErrorCodes.NOT_FOUND);
      expect(apiErr.message.toLowerCase()).not.toContain('other org');
    }
  });

  /* =========================================================================
   * apiClient.leads.update Integration Tests
   * ========================================================================= */

  it('5. apiClient.leads.update: payload from buildLeadPatchPayload clearing fields persists nulls in database', async () => {
    const lead = await prisma.lead.create({
      data: {
        organizationId: orgId,
        name: 'Initial Name',
        normalizedName: 'initial name',
        category: 'Medical',
        website: 'https://initial-site.com',
        normalizedWebsite: 'initial-site.com',
        description: 'Existing description',
        address: '123 Initial Street',
        locality: 'Gulshan',
        city: 'Dhaka',
        country: 'BD',
        primarySource: 'MOCK'
      }
    });

    const leadSummary = {
      id: lead.id,
      name: lead.name,
      normalizedName: lead.normalizedName,
      category: lead.category,
      website: lead.website,
      description: lead.description,
      address: lead.address,
      locality: lead.locality,
      city: lead.city,
      country: lead.country,
      primarySource: lead.primarySource,
      primaryPhone: null,
      primaryEmail: null,
      websiteStatus: null,
      onlinePresenceType: null,
      rating: null,
      reviewCount: null,
      createdAt: lead.createdAt.toISOString(),
      updatedAt: lead.updatedAt.toISOString()
    };

    // User clears website, description, address, and locality in the edit form
    const editForm = {
      name: 'Updated Business Name',
      category: 'Healthcare Clinic',
      website: '', // Cleared
      description: '', // Cleared
      address: '', // Cleared
      locality: '', // Cleared
      city: 'Dhaka'
    };

    const patchPayload = buildLeadPatchPayload(leadSummary as any, editForm);
    expect(patchPayload).toEqual({
      name: 'Updated Business Name',
      category: 'Healthcare Clinic',
      website: null,
      description: null,
      address: null,
      locality: null
    });

    const updated = await apiClient.leads.update(lead.id, patchPayload, {
      headers: { Cookie: adminCookie }
    });
    expect(updated.name).toBe('Updated Business Name');
    expect(updated.website).toBeNull();
    expect(updated.description).toBeNull();
    expect(updated.address).toBeNull();
    expect(updated.locality).toBeNull();

    // Verify in PostgreSQL database
    const dbRecord = await prisma.lead.findUnique({ where: { id: lead.id } });
    expect(dbRecord?.name).toBe('Updated Business Name');
    expect(dbRecord?.website).toBeNull();
    expect(dbRecord?.normalizedWebsite).toBeNull();
    expect(dbRecord?.description).toBeNull();
    expect(dbRecord?.address).toBeNull();
    expect(dbRecord?.locality).toBeNull();
  });

  it('6. apiClient.leads.update: returns 409 on website domain collision and 403 for Viewer role', async () => {
    const leadA = await prisma.lead.create({
      data: {
        organizationId: orgId,
        name: 'Lead A',
        normalizedName: 'lead a',
        category: 'Clinic',
        website: 'https://taken-domain.com',
        normalizedWebsite: 'taken-domain.com',
        city: 'Dhaka',
        country: 'BD',
        primarySource: 'MOCK'
      }
    });

    const leadB = await prisma.lead.create({
      data: {
        organizationId: orgId,
        name: 'Lead B',
        normalizedName: 'lead b',
        category: 'Clinic',
        website: 'https://unique-b.com',
        normalizedWebsite: 'unique-b.com',
        city: 'Dhaka',
        country: 'BD',
        primarySource: 'MOCK'
      }
    });

    // 409 Conflict when updating leadB to leadA's domain
    try {
      await apiClient.leads.update(
        leadB.id,
        { website: 'https://taken-domain.com' },
        { headers: { Cookie: adminCookie } }
      );
      expect.unreachable('Should have thrown 409 conflict');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).statusCode).toBe(409);
      expect((err as ApiClientError).code).toBe(ErrorCodes.CONFLICT);
    }

    // 403 Forbidden when Viewer role attempts mutation
    try {
      await apiClient.leads.update(
        leadA.id,
        { name: 'Viewer Unauthorized Edit' },
        { headers: { Cookie: viewerCookie } }
      );
      expect.unreachable('Should have thrown 403 forbidden');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).statusCode).toBe(403);
      expect((err as ApiClientError).code).toBe(ErrorCodes.FORBIDDEN);
    }
  });

  /* =========================================================================
   * apiClient.leads.addContact Integration Tests
   * ========================================================================= */

  it('7. apiClient.leads.addContact: creates contact, handles WhatsApp UNKNOWN status, deduplicates re-saves, and promotes to primary', async () => {
    const lead = await prisma.lead.create({
      data: {
        organizationId: orgId,
        name: 'Contact Testing Lead',
        normalizedName: 'contact testing lead',
        category: 'Dental',
        city: 'Dhaka',
        country: 'BD',
        primarySource: 'MOCK'
      }
    });

    // 1. Create WhatsApp manual contact -> status comes back UNKNOWN
    const whatsAppPayload = buildManualContactPayload({
      type: ContactType.WHATSAPP,
      rawValue: '01711000001',
      isPrimary: false
    });

    const createdContact = await apiClient.leads.addContact(lead.id, whatsAppPayload, {
      headers: { Cookie: adminCookie }
    });

    expect(createdContact.type).toBe(ContactType.WHATSAPP);
    expect(createdContact.rawValue).toBe('01711000001');
    expect(createdContact.whatsappStatus).toBe(WhatsAppStatus.UNKNOWN);
    expect(createdContact.isPrimary).toBe(false);

    // 2. Re-adding existing contact with same primary status returns same id (no duplicate row)
    const reAddedContact = await apiClient.leads.addContact(lead.id, whatsAppPayload, {
      headers: { Cookie: adminCookie }
    });

    expect(reAddedContact.id).toBe(createdContact.id);
    const dbContactsAfterReAdd = await prisma.leadContact.findMany({ where: { leadId: lead.id } });
    expect(dbContactsAfterReAdd).toHaveLength(1);

    // 3. Promoting existing non-primary contact to primary returns same id with isPrimary=true
    const promotePayload = buildManualContactPayload({
      type: ContactType.WHATSAPP,
      rawValue: '01711000001',
      isPrimary: true
    });

    const promotedContact = await apiClient.leads.addContact(lead.id, promotePayload, {
      headers: { Cookie: adminCookie }
    });

    expect(promotedContact.id).toBe(createdContact.id);
    expect(promotedContact.isPrimary).toBe(true);

    const dbContactsAfterPromote = await prisma.leadContact.findMany({ where: { leadId: lead.id } });
    expect(dbContactsAfterPromote).toHaveLength(1);
    expect(dbContactsAfterPromote[0].isPrimary).toBe(true);
  });
});
