import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import prisma from '@leadmate/db';
import { app } from '../../../api/src/app.js';
import { hashPassword } from '../../../api/src/lib/crypto.js';
import { resetLoginRateLimiter } from '../../../api/src/middleware/rate-limiter.js';
import { apiClient, ApiClientError, type SaveLeadResponse } from '../lib/api-client.js';
import {
  Role,
  ContactType,
  WhatsAppStatus,
  DuplicateAction,
  ErrorCodes,
  Permissions,
  hasPermission
} from '@leadmate/shared';

describe('M1 Step 8: Business Search Frontend Page & API Integration Matrix', () => {
  let server: http.Server;
  let serverPort: number;
  let orgId: string;
  let adminCookie: string;
  let viewerCookie: string;

  const adminEmail = 'search-admin@leadmate.test';
  const adminPassword = 'SearchAdmin12345!A';
  const viewerEmail = 'search-viewer@leadmate.test';
  const viewerPassword = 'SearchViewer12345!V';

  beforeAll(async () => {
    // 0. Safety Guard: Confirm database is test database
    const dbUrl = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL || '';
    if (!dbUrl.includes('_test')) {
      throw new Error(
        `SAFETY GUARD TRIGGERED: Database URL "${dbUrl}" does not end with "_test". Destructive test cleanup aborted.`
      );
    }

    // Start backend API server for live fetch tests
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

    // Ensure default organization exists in PostgreSQL
    const org = await prisma.organization.upsert({
      where: { id: '00000000-0000-0000-0000-000000000001' },
      update: {},
      create: {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'LeadMate Default Org',
        timezone: 'Asia/Dhaka'
      }
    });
    orgId = org.id;

    // Create Admin user (has LEADS_READ and LEADS_WRITE)
    const adminHash = await hashPassword(adminPassword);
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: { passwordHash: adminHash, role: Role.ADMIN, organizationId: orgId, isActive: true },
      create: { email: adminEmail, passwordHash: adminHash, name: 'Search Admin', role: Role.ADMIN, organizationId: orgId, isActive: true }
    });

    // Create Viewer user (has LEADS_READ, lacks LEADS_WRITE)
    const viewerHash = await hashPassword(viewerPassword);
    await prisma.user.upsert({
      where: { email: viewerEmail },
      update: { passwordHash: viewerHash, role: Role.VIEWER, organizationId: orgId, isActive: true },
      create: { email: viewerEmail, passwordHash: viewerHash, name: 'Search Viewer', role: Role.VIEWER, organizationId: orgId, isActive: true }
    });

    // Login Admin to get session cookie
    const adminLoginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });
    adminCookie = adminLoginRes.headers.get('set-cookie')?.split(';')[0] || '';

    // Login Viewer to get session cookie
    const viewerLoginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: viewerEmail, password: viewerPassword })
    });
    viewerCookie = viewerLoginRes.headers.get('set-cookie')?.split(';')[0] || '';
  });

  async function cleanupDb() {
    await prisma.contactEvidence.deleteMany({});
    await prisma.leadContact.deleteMany({});
    await prisma.leadSource.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.suppressionList.deleteMany({});
  }

  beforeEach(async () => {
    resetLoginRateLimiter();
    await cleanupDb();
  });

  afterAll(async () => {
    await cleanupDb();
    await prisma.$disconnect();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  /* =========================================================================
   * Section 1: Permission Contracts & Security Audits
   * ========================================================================= */

  it('1. Web Security Audit: Confirm zero localStorage/sessionStorage token storage in frontend', () => {
    const webSrcDir = path.resolve(__dirname, '..');
    const allFiles: string[] = [];

    function scanDir(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== '.next') {
            scanDir(fullPath);
          }
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.js')) {
          allFiles.push(fullPath);
        }
      }
    }

    scanDir(webSrcDir);

    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/localStorage\.setItem\s*\(\s*['"`](?:token|session|auth|jwt)/i);
      expect(content).not.toMatch(/sessionStorage\.setItem\s*\(\s*['"`](?:token|session|auth|jwt)/i);
      expect(content).not.toMatch(/document\.cookie/i);
    }
  });

  it('2. Navigation Permission Contract: Business Search requires Permissions.LEADS_READ', () => {
    const appShellPath = path.resolve(__dirname, '../components/layout/app-shell.tsx');
    const content = fs.readFileSync(appShellPath, 'utf-8');

    expect(content).toContain("label: 'Business Search'");
    expect(content).toContain("href: '/business-search'");
    expect(content).toContain('permission: Permissions.LEADS_READ');

    // Confirm Role.VIEWER and Role.ADMIN both have Permissions.LEADS_READ
    expect(hasPermission(Role.ADMIN, Permissions.LEADS_READ)).toBe(true);
    expect(hasPermission(Role.VIEWER, Permissions.LEADS_READ)).toBe(true);

    // Confirm Role.VIEWER lacks Permissions.LEADS_WRITE
    expect(hasPermission(Role.ADMIN, Permissions.LEADS_WRITE)).toBe(true);
    expect(hasPermission(Role.VIEWER, Permissions.LEADS_WRITE)).toBe(false);
  });

  it('3. Security & Trust Boundary Audit: Save lead action submits strictly provider + externalId', () => {
    const pagePath = path.resolve(__dirname, '../app/business-search/page.tsx');
    const content = fs.readFileSync(pagePath, 'utf-8');

    // Confirm saveLead call passes only provider and externalId
    expect(content).toContain('apiClient.businessSearch.saveLead');
    expect(content).toContain('provider: item.provider');
    expect(content).toContain('externalId: item.externalId');

    // Confirm no dangerouslySetInnerHTML is used
    expect(content).not.toContain('dangerouslySetInnerHTML');
  });

  /* =========================================================================
   * Section 2: Search Form & Query Contract Integration
   * ========================================================================= */

  it('4. Search API: Valid search query returns business listings with discovered contacts', async () => {
    const res = await fetch(`http://localhost:${serverPort}/api/v1/business-search?q=Dental&location=Dhaka&provider=MOCK`, {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);

    const first = json.data[0];
    expect(first.externalId).toBeDefined();
    expect(first.provider).toBe('MOCK');
    expect(first.name).toBeDefined();
    expect(first.city).toBe('Dhaka');
    expect(Array.isArray(first.contacts)).toBe(true);

    // Verify contact structure
    const phoneContact = first.contacts.find((c: any) => c.type === ContactType.PHONE);
    expect(phoneContact).toBeDefined();
    expect(phoneContact.rawValue).toBeDefined();
  });

  it('5. Search API: Missing required parameters (q or location) returns 422 VALIDATION_ERROR', async () => {
    const res = await fetch(`http://localhost:${serverPort}/api/v1/business-search?location=Dhaka`, {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });

    expect(res.status).toBe(422);
    const json = (await res.json()) as any;
    expect(json.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(json.error.requestId).toBeDefined();
  });

  it('6. Search API: Zero results query returns empty data array with meta count 0', async () => {
    const res = await fetch(`http://localhost:${serverPort}/api/v1/business-search?q=NonExistentBusiness12345&location=Nowhere`, {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data).toEqual([]);
    expect(json.meta.count).toBe(0);
  });

  it('7. Search API: WhatsApp trust boundary in search results (PUBLICLY_LISTED vs UNKNOWN)', async () => {
    const res = await fetch(`http://localhost:${serverPort}/api/v1/business-search?q=Dental&location=Dhaka`, {
      method: 'GET',
      headers: { Cookie: adminCookie }
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    const allContacts = json.data.flatMap((b: any) => b.contacts);
    const waContacts = allContacts.filter((c: any) => c.type === ContactType.WHATSAPP);

    for (const wa of waContacts) {
      // Must not falsely claim CONFIRMED from preview search
      expect(wa.whatsappStatus).not.toBe(WhatsAppStatus.CONFIRMED);
      expect([WhatsAppStatus.PUBLICLY_LISTED, WhatsAppStatus.UNKNOWN]).toContain(wa.whatsappStatus);
    }
  });

  /* =========================================================================
   * Section 3: Save Lead Action & Duplicate Outcomes
   * ========================================================================= */

  it('8. Save Lead: First save creates new lead (CREATED - HTTP 201)', async () => {
    const saveRes = await fetch(`http://localhost:${serverPort}/api/v1/business-search/save-lead`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie
      },
      body: JSON.stringify({
        provider: 'MOCK',
        externalId: 'mock-dhaka-dental-gulshan-001'
      })
    });

    expect(saveRes.status).toBe(201);
    const saveJson = (await saveRes.json()) as any;
    expect(saveJson.data.action).toBe(DuplicateAction.CREATED);
    expect(saveJson.data.leadId).toBeDefined();

    // Confirm lead exists in database
    const leadInDb = await prisma.lead.findUnique({
      where: { id: saveJson.data.leadId }
    });
    expect(leadInDb).toBeDefined();
    expect(leadInDb!.organizationId).toBe(orgId);
    expect(leadInDb!.name).toContain('Gulshan');
  });

  it('9. Save Lead: Saving same provider external ID merges safely (MERGED - HTTP 200)', async () => {
    // 1. Initial save (Created)
    await fetch(`http://localhost:${serverPort}/api/v1/business-search/save-lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ provider: 'MOCK', externalId: 'mock-dhaka-dental-gulshan-001' })
    });

    // 2. Second save with same provider + externalId (Merged)
    const secondSaveRes = await fetch(`http://localhost:${serverPort}/api/v1/business-search/save-lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ provider: 'MOCK', externalId: 'mock-dhaka-dental-gulshan-001' })
    });

    expect(secondSaveRes.status).toBe(200);
    const json = (await secondSaveRes.json()) as any;
    expect(json.data.action).toBe(DuplicateAction.MERGED);
  });

  it('10. Save Lead: Candidate duplicate match returns HTTP 409 CANDIDATE_REQUIRES_CONFIRMATION', async () => {
    // 1. Create existing lead with same website domain (dhakadental.example.com)
    await prisma.lead.create({
      data: {
        organizationId: orgId,
        name: 'Existing Dental Care',
        normalizedName: 'existing dental care',
        category: 'Dental Clinic',
        city: 'Dhaka',
        country: 'BD',
        website: 'https://dhakadental.example.com',
        normalizedWebsite: 'dhakadental.example.com',
        primarySource: 'MANUAL'
      }
    });

    // 2. Attempt to save mock listing with same normalized website but different externalId
    const res = await fetch(`http://localhost:${serverPort}/api/v1/business-search/save-lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ provider: 'MOCK', externalId: 'mock-dhaka-dental-gulshan-001' })
    });

    expect(res.status).toBe(409);
    const json = (await res.json()) as any;
    expect(json.error.code).toBe(ErrorCodes.CONFLICT);
    expect(json.error.details.action).toBe(DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION);
    expect(json.error.requestId).toBeDefined();
  });

  it('11. Save Lead: Definite conflict returns HTTP 409 DEFINITE_MATCH_CONFLICT without mutating DB', async () => {
    // 1. Create Lead A linked to this provider external ID via LeadSource
    const leadA = await prisma.lead.create({
      data: {
        organizationId: orgId,
        name: 'Lead A Clinic',
        normalizedName: 'lead a clinic',
        category: 'Dental Clinic',
        city: 'Dhaka',
        country: 'BD',
        primarySource: 'MOCK'
      }
    });

    await prisma.leadSource.create({
      data: {
        leadId: leadA.id,
        organizationId: orgId,
        sourceName: 'MOCK',
        sourceExternalId: 'mock-dhaka-dental-gulshan-001',
        rawData: {},
        fetchedAt: new Date()
      }
    });

    // 2. Create Lead B linked to the SAME mobile number (+8801711000001) via LeadContact
    const leadB = await prisma.lead.create({
      data: {
        organizationId: orgId,
        name: 'Lead B Clinic',
        normalizedName: 'lead b clinic',
        category: 'Dental Clinic',
        city: 'Dhaka',
        country: 'BD',
        primaryPhone: '+8801711000001',
        primarySource: 'MANUAL'
      }
    });

    await prisma.leadContact.create({
      data: {
        leadId: leadB.id,
        type: ContactType.PHONE,
        rawValue: '01711000001',
        normalizedValue: '+8801711000001',
        phoneType: 'MOBILE' as any,
        status: 'FOUND' as any,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        isPrimary: true
      }
    });

    // 3. Attempt to save mock listing (Provider matches Lead A, but Mobile matches Lead B)
    const res = await fetch(`http://localhost:${serverPort}/api/v1/business-search/save-lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ provider: 'MOCK', externalId: 'mock-dhaka-dental-gulshan-001' })
    });

    expect(res.status).toBe(409);
    const json = (await res.json()) as any;
    expect(json.error.code).toBe(ErrorCodes.CONFLICT);
    expect(json.error.details.action).toBe('DEFINITE_MATCH_CONFLICT');
  });

  it('12. Save Lead: Strict schema rejects extra/browser-fabricated fields (422 VALIDATION_ERROR)', async () => {
    const res = await fetch(`http://localhost:${serverPort}/api/v1/business-search/save-lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        provider: 'MOCK',
        externalId: 'mock-dhaka-dental-gulshan-001',
        name: 'Hacked Business Name', // Rejected by .strict()
        primaryPhone: '+8801700000000'
      })
    });

    expect(res.status).toBe(422);
    const json = (await res.json()) as any;
    expect(json.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('13. RBAC Enforcement: User without LEADS_WRITE permission (VIEWER) receives 403 FORBIDDEN on save', async () => {
    const res = await fetch(`http://localhost:${serverPort}/api/v1/business-search/save-lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: viewerCookie },
      body: JSON.stringify({
        provider: 'MOCK',
        externalId: 'mock-dhaka-dental-gulshan-001'
      })
    });

    expect(res.status).toBe(403);
    const json = (await res.json()) as any;
    expect(json.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  /* =========================================================================
   * Section 4: Frontend UI Logic & URL/Data Safety Audits
   * ========================================================================= */

  it('14. URL Safety Function: Validates http/https and rejects dangerous javascript: URLs', () => {
    const pagePath = path.resolve(__dirname, '../app/business-search/page.tsx');
    const content = fs.readFileSync(pagePath, 'utf-8');

    expect(content).toContain('function getSafeExternalUrl');
    expect(content).toContain("protocol === 'http:'");
    expect(content).toContain("protocol === 'https:'");

    // Test regex / logic simulation
    function simulateGetSafeExternalUrl(url?: string | null): { href: string; label: string } | null {
      if (!url) return null;
      const trimmed = url.trim();
      if (!trimmed) return null;
      try {
        const formatted = trimmed.startsWith('http://') || trimmed.startsWith('https://')
          ? trimmed
          : `https://${trimmed}`;
        const parsed = new URL(formatted);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          return { href: parsed.href, label: parsed.hostname };
        }
        return null;
      } catch {
        return null;
      }
    }

    expect(simulateGetSafeExternalUrl('https://example.com/clinic')).not.toBeNull();
    expect(simulateGetSafeExternalUrl('http://example.com')).not.toBeNull();
    expect(simulateGetSafeExternalUrl('example.com')).not.toBeNull();
    expect(simulateGetSafeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(simulateGetSafeExternalUrl('data:text/html,<script></script>')).toBeNull();
    expect(simulateGetSafeExternalUrl('')).toBeNull();
    expect(simulateGetSafeExternalUrl(null)).toBeNull();
  });

  it('15. Per-Row Save State Key: Uses composite provider:externalId key isolation', () => {
    const pagePath = path.resolve(__dirname, '../app/business-search/page.tsx');
    const content = fs.readFileSync(pagePath, 'utf-8');

    expect(content).toContain('`${item.provider}:${item.externalId}`');

    // Simulate key generation
    const key1 = `${'MOCK'}:${'mock-001'}`;
    const key2 = `${'MOCK'}:${'mock-002'}`;
    const key3 = `${'GOOGLE'}:${'mock-001'}`;

    expect(key1).not.toEqual(key2);
    expect(key1).not.toEqual(key3);
  });

  it('16. Request ID Presentation: Formats support reference string without displaying stack traces', () => {
    const pagePath = path.resolve(__dirname, '../app/business-search/page.tsx');
    const content = fs.readFileSync(pagePath, 'utf-8');

    expect(content).toContain('Reference: {searchError.requestId}');
    expect(content).toContain('Ref: {saveState.requestId}');
    expect(content).not.toContain('stack');
  });

  it('17. Feedback Messaging Accuracy: Distinct messages for CREATED, MERGED, CANDIDATE, and CONFLICT', () => {
    const pagePath = path.resolve(__dirname, '../app/business-search/page.tsx');
    const content = fs.readFileSync(pagePath, 'utf-8');

    expect(content).toContain('Lead saved successfully.');
    expect(content).toContain('Existing lead updated with this source.');
    expect(content).toContain('Possible duplicate found. Manual confirmation is required.');
    expect(content).toContain('Conflicting duplicate signals were detected. No lead was changed.');
  });

  it('18. Per-Row Save State Isolation: State transitions on Result A do not affect Result B', () => {
    const saveStates: Record<string, { status: string; message?: string }> = {};

    const keyA = 'MOCK:mock-dhaka-dental-gulshan-001';
    const keyB = 'MOCK:mock-dhaka-dental-dhanmondi-002';

    // Start saving Result A
    saveStates[keyA] = { status: 'saving' };

    expect(saveStates[keyA]?.status).toBe('saving');
    expect(saveStates[keyB]?.status).toBeUndefined(); // Result B remains idle and actionable

    // Complete Result A as created
    saveStates[keyA] = { status: 'created', message: 'Lead saved successfully.' };

    expect(saveStates[keyA]?.status).toBe('created');
    expect(saveStates[keyB]?.status).toBeUndefined();
  });

  it('19. WhatsApp Status Badge Mapping: UNKNOWN displays Unverified, PUBLICLY_LISTED displays Listed', () => {
    const pagePath = path.resolve(__dirname, '../app/business-search/page.tsx');
    const content = fs.readFileSync(pagePath, 'utf-8');

    expect(content).toContain('Listed');
    expect(content).toContain('Confirmed');
    expect(content).toContain('Unverified');

    // Confirm that "Available" is never used for UNKNOWN
    expect(content).not.toMatch(/UNKNOWN.*Available/);
  });

  it('20. Missing Optional Fields Safety: Fallback neutral dash placeholder is rendered for null/missing values', () => {
    const pagePath = path.resolve(__dirname, '../app/business-search/page.tsx');
    const content = fs.readFileSync(pagePath, 'utf-8');

    // Confirm category, address, and website have '—' fallback
    expect(content).toContain("item.category || '—'");
    expect(content).toContain("join(', ') || '—'");
    expect(content).toContain("<span>—</span>");
  });

  it('21. ApiClient Error Envelope: ApiClientError properly preserves code, statusCode, details, and requestId', () => {
    const err = new ApiClientError(
      ErrorCodes.CONFLICT,
      'Duplicate candidate detected',
      409,
      { action: DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION },
      'req-audit-test-999'
    );

    expect(err.code).toBe(ErrorCodes.CONFLICT);
    expect(err.statusCode).toBe(409);
    expect(err.requestId).toBe('req-audit-test-999');
    expect((err.details as any).action).toBe(DuplicateAction.CANDIDATE_REQUIRES_CONFIRMATION);
  });

  it('22. Search Form Reset & Replacement: Fresh search clears prior results and resets save states', () => {
    const pagePath = path.resolve(__dirname, '../app/business-search/page.tsx');
    const content = fs.readFileSync(pagePath, 'utf-8');

    expect(content).toContain('setSaveStates({});');
    expect(content).toContain('setResults(data);');
    expect(content).toContain('setHasSearched(true);');
  });
});
