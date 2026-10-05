import './setup-test-env.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import prisma from '@leadmate/db';
import { app } from '../../../api/src/app.js';
import { hashPassword } from '../../../api/src/lib/crypto.js';
import { resetLoginRateLimiter, resetSalesAssistantRateLimiter } from '../../../api/src/middleware/rate-limiter.js';
import { apiClient, ApiClientError } from '../lib/api-client.js';
import {
  Role,
  SalesAssistantDraftType,
  SalesAssistantLanguage,
  SalesAssistantTone,
  SalesAssistantDraftStatus,
  SalesAssistantWarning
} from '@leadmate/shared';
import {
  classifySalesAssistantError,
  formatDraftForClipboard
} from '../lib/leads/sales-assistant-display.js';
import { ensureTestDatabase } from './helpers/test-db-guard.js';

describe('M5 Step 6: Frontend Sales Assistant API Client Flow & State Transition Verification', () => {
  let server: http.Server;
  let serverPort: number;
  let orgId: string;
  let adminCookie: string;
  let repCookie: string;
  let viewerCookie: string;
  let adminUserId: string;
  let repUserId: string;
  let testLeadId: string;

  const adminEmail = 'm5-fe-admin@leadmate.test';
  const adminPassword = 'AdminPassword123!Safe';
  const repEmail = 'm5-fe-rep@leadmate.test';
  const repPassword = 'RepPassword123!Safe';
  const viewerEmail = 'm5-fe-viewer@leadmate.test';
  const viewerPassword = 'ViewerPassword123!Safe';

  async function cleanupDb() {
    await ensureTestDatabase(prisma);
    await prisma.salesAssistantDraft.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.contactEvidence.deleteMany({});
    await prisma.leadContact.deleteMany({});
    await prisma.leadSource.deleteMany({});
    await prisma.lead.deleteMany({});
  }

  beforeAll(async () => {
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

    // Ensure test organization exists
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

    // Create Admin user (LEADS_READ, SALES_ASSISTANT_GENERATE, SALES_ASSISTANT_REVIEW)
    const adminHash = await hashPassword(adminPassword);
    const adminUser = await prisma.user.upsert({
      where: { email: adminEmail },
      update: { passwordHash: adminHash, role: Role.ADMIN, organizationId: orgId, isActive: true },
      create: {
        email: adminEmail,
        passwordHash: adminHash,
        name: 'FE Admin',
        role: Role.ADMIN,
        organizationId: orgId,
        isActive: true
      }
    });
    adminUserId = adminUser.id;

    // Create Sales Executive user (LEADS_READ, SALES_ASSISTANT_GENERATE - lacks SALES_ASSISTANT_REVIEW)
    const repHash = await hashPassword(repPassword);
    const repUser = await prisma.user.upsert({
      where: { email: repEmail },
      update: { passwordHash: repHash, role: Role.SALES_EXECUTIVE, organizationId: orgId, isActive: true },
      create: {
        email: repEmail,
        passwordHash: repHash,
        name: 'FE Sales Rep',
        role: Role.SALES_EXECUTIVE,
        organizationId: orgId,
        isActive: true
      }
    });
    repUserId = repUser.id;

    // Create Viewer user (LEADS_READ only - lacks GENERATE & REVIEW)
    const viewerHash = await hashPassword(viewerPassword);
    await prisma.user.upsert({
      where: { email: viewerEmail },
      update: { passwordHash: viewerHash, role: Role.VIEWER, organizationId: orgId, isActive: true },
      create: {
        email: viewerEmail,
        passwordHash: viewerHash,
        name: 'FE Viewer',
        role: Role.VIEWER,
        organizationId: orgId,
        isActive: true
      }
    });

    // Acquire session cookies via login
    resetLoginRateLimiter();
    const adminLoginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });
    adminCookie = adminLoginRes.headers.get('set-cookie')?.split(';')[0] || '';

    resetLoginRateLimiter();
    const repLoginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: repEmail, password: repPassword })
    });
    repCookie = repLoginRes.headers.get('set-cookie')?.split(';')[0] || '';

    resetLoginRateLimiter();
    const viewerLoginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: viewerEmail, password: viewerPassword })
    });
    viewerCookie = viewerLoginRes.headers.get('set-cookie')?.split(';')[0] || '';
  });

  afterAll(async () => {
    await cleanupDb();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  beforeEach(async () => {
    await cleanupDb();
    resetSalesAssistantRateLimiter();

    // Create a fresh test lead
    const lead = await prisma.lead.create({
      data: {
        organizationId: orgId,
        name: 'Delta Digital Enterprise',
        normalizedName: 'delta digital enterprise',
        category: 'Information Technology',
        city: 'Dhaka',
        locality: 'Gulshan',
        country: 'Bangladesh',
        primaryPhone: '+8801711223344',
        primarySource: 'MANUAL'
      }
    });
    testLeadId = lead.id;
  });

  it('1. generates a sales assistant draft via apiClient with correct payload and returns DRAFT status', async () => {
    const draft = await apiClient.leads.generateSalesAssistantDraft(
      testLeadId,
      {
        type: SalesAssistantDraftType.WHATSAPP,
        language: SalesAssistantLanguage.BANGLA,
        tone: SalesAssistantTone.PROFESSIONAL,
        objective: 'Schedule demo session'
      },
      { headers: { Cookie: repCookie } }
    );

    expect(draft.id).toBeDefined();
    expect(draft.leadId).toBe(testLeadId);
    expect(draft.type).toBe(SalesAssistantDraftType.WHATSAPP);
    expect(draft.language).toBe(SalesAssistantLanguage.BANGLA);
    expect(draft.tone).toBe(SalesAssistantTone.PROFESSIONAL);
    expect(draft.status).toBe(SalesAssistantDraftStatus.DRAFT);
    expect(draft.content).toContain('Delta Digital Enterprise');
    expect(draft.warnings).toContain(SalesAssistantWarning.UNVERIFIED_WHATSAPP);
  });

  it('2. lists draft history newest first and retrieves single draft by ID via apiClient', async () => {
    const d1 = await apiClient.leads.generateSalesAssistantDraft(
      testLeadId,
      {
        type: SalesAssistantDraftType.WHATSAPP,
        language: SalesAssistantLanguage.BANGLA,
        tone: SalesAssistantTone.PROFESSIONAL
      },
      { headers: { Cookie: repCookie } }
    );

    const d2 = await apiClient.leads.generateSalesAssistantDraft(
      testLeadId,
      {
        type: SalesAssistantDraftType.EMAIL,
        language: SalesAssistantLanguage.ENGLISH,
        tone: SalesAssistantTone.PERSUASIVE
      },
      { headers: { Cookie: repCookie } }
    );

    const history = await apiClient.leads.listSalesAssistantDrafts(testLeadId, {
      headers: { Cookie: repCookie }
    });

    expect(history).toHaveLength(2);
    expect(history[0].id).toBe(d2.id);
    expect(history[1].id).toBe(d1.id);

    const single = await apiClient.leads.getSalesAssistantDraft(testLeadId, d1.id, {
      headers: { Cookie: repCookie }
    });
    expect(single.id).toBe(d1.id);
    expect(single.type).toBe(SalesAssistantDraftType.WHATSAPP);
  });

  it('3. approves draft via apiClient and receives server-confirmed APPROVED status with attribution', async () => {
    const draft = await apiClient.leads.generateSalesAssistantDraft(
      testLeadId,
      {
        type: SalesAssistantDraftType.WHATSAPP,
        language: SalesAssistantLanguage.BANGLA,
        tone: SalesAssistantTone.PROFESSIONAL
      },
      { headers: { Cookie: repCookie } }
    );

    const approved = await apiClient.leads.approveSalesAssistantDraft(testLeadId, draft.id, {
      headers: { Cookie: adminCookie }
    });

    expect(approved.status).toBe(SalesAssistantDraftStatus.APPROVED);
    expect(approved.approvedAt).toBeDefined();
    expect(approved.approvedByUserId).toBe(adminUserId);
    expect(approved.approvedByUser?.name).toBe('FE Admin');

    // Confirm DB was mutated ONLY after server completed
    const dbRecord = await prisma.salesAssistantDraft.findUnique({ where: { id: draft.id } });
    expect(dbRecord!.status).toBe(SalesAssistantDraftStatus.APPROVED);
  });

  it('4. rejects draft via apiClient and receives server-confirmed REJECTED status with attribution', async () => {
    const draft = await apiClient.leads.generateSalesAssistantDraft(
      testLeadId,
      {
        type: SalesAssistantDraftType.WHATSAPP,
        language: SalesAssistantLanguage.BANGLA,
        tone: SalesAssistantTone.PROFESSIONAL
      },
      { headers: { Cookie: repCookie } }
    );

    const rejected = await apiClient.leads.rejectSalesAssistantDraft(testLeadId, draft.id, {
      headers: { Cookie: adminCookie }
    });

    expect(rejected.status).toBe(SalesAssistantDraftStatus.REJECTED);
    expect(rejected.rejectedAt).toBeDefined();
    expect(rejected.rejectedByUserId).toBe(adminUserId);
    expect(rejected.rejectedByUser?.name).toBe('FE Admin');
  });

  it('5. handles 409 CONFLICT on already-reviewed draft and classifies error with safe refresh guidance', async () => {
    const draft = await apiClient.leads.generateSalesAssistantDraft(
      testLeadId,
      {
        type: SalesAssistantDraftType.WHATSAPP,
        language: SalesAssistantLanguage.BANGLA,
        tone: SalesAssistantTone.PROFESSIONAL
      },
      { headers: { Cookie: repCookie } }
    );

    // First review succeeds
    await apiClient.leads.approveSalesAssistantDraft(testLeadId, draft.id, {
      headers: { Cookie: adminCookie }
    });

    // Second review attempts duplicate mutation -> 409 Conflict
    let caughtErr: unknown = null;
    try {
      await apiClient.leads.approveSalesAssistantDraft(testLeadId, draft.id, {
        headers: { Cookie: adminCookie }
      });
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).toBeInstanceOf(ApiClientError);
    const clientErr = caughtErr as ApiClientError;
    expect(clientErr.statusCode).toBe(409);

    const classified = classifySalesAssistantError(clientErr);
    expect(classified.isConflict).toBe(true);
    expect(classified.message).toBe(
      'This draft has already been reviewed. Refreshing its latest status.'
    );
  });

  it('6. handles 429 RATE_LIMITED on excessive draft generations and classifies error safely', async () => {
    resetSalesAssistantRateLimiter();

    // Exhaust 30 allowed requests
    for (let i = 0; i < 30; i++) {
      await apiClient.leads.generateSalesAssistantDraft(
        testLeadId,
        {
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.BANGLA,
          tone: SalesAssistantTone.PROFESSIONAL
        },
        { headers: { Cookie: repCookie } }
      );
    }

    // 31st call triggers 429
    let caughtErr: unknown = null;
    try {
      await apiClient.leads.generateSalesAssistantDraft(
        testLeadId,
        {
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.BANGLA,
          tone: SalesAssistantTone.PROFESSIONAL
        },
        { headers: { Cookie: repCookie } }
      );
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).toBeInstanceOf(ApiClientError);
    const clientErr = caughtErr as ApiClientError;
    expect(clientErr.statusCode).toBe(429);

    const classified = classifySalesAssistantError(clientErr);
    expect(classified.isRateLimited).toBe(true);
    expect(classified.message).toBe('Too many requests. Please wait a moment and try again.');
  });

  it('7. enforces frontend RBAC: VIEWER cannot generate (403), SALES_EXECUTIVE can generate but cannot approve (403)', async () => {
    // VIEWER attempt to generate -> 403 Forbidden
    let viewerErr: unknown = null;
    try {
      await apiClient.leads.generateSalesAssistantDraft(
        testLeadId,
        {
          type: SalesAssistantDraftType.WHATSAPP,
          language: SalesAssistantLanguage.BANGLA,
          tone: SalesAssistantTone.PROFESSIONAL
        },
        { headers: { Cookie: viewerCookie } }
      );
    } catch (err) {
      viewerErr = err;
    }
    expect(viewerErr).toBeInstanceOf(ApiClientError);
    expect((viewerErr as ApiClientError).statusCode).toBe(403);
    expect(classifySalesAssistantError(viewerErr).isForbidden).toBe(true);

    // SALES_EXECUTIVE generates successfully
    const draft = await apiClient.leads.generateSalesAssistantDraft(
      testLeadId,
      {
        type: SalesAssistantDraftType.WHATSAPP,
        language: SalesAssistantLanguage.BANGLA,
        tone: SalesAssistantTone.PROFESSIONAL
      },
      { headers: { Cookie: repCookie } }
    );
    expect(draft.id).toBeDefined();

    // SALES_EXECUTIVE attempt to review -> 403 Forbidden
    let repReviewErr: unknown = null;
    try {
      await apiClient.leads.approveSalesAssistantDraft(testLeadId, draft.id, {
        headers: { Cookie: repCookie }
      });
    } catch (err) {
      repReviewErr = err;
    }
    expect(repReviewErr).toBeInstanceOf(ApiClientError);
    expect((repReviewErr as ApiClientError).statusCode).toBe(403);
    expect(classifySalesAssistantError(repReviewErr).isForbidden).toBe(true);
  });

  it('8. formats clipboard text cleanly for both email (subject + body) and non-email drafts', async () => {
    const emailDraft = await apiClient.leads.generateSalesAssistantDraft(
      testLeadId,
      {
        type: SalesAssistantDraftType.EMAIL,
        language: SalesAssistantLanguage.ENGLISH,
        tone: SalesAssistantTone.PERSUASIVE
      },
      { headers: { Cookie: repCookie } }
    );

    const waDraft = await apiClient.leads.generateSalesAssistantDraft(
      testLeadId,
      {
        type: SalesAssistantDraftType.WHATSAPP,
        language: SalesAssistantLanguage.BANGLA,
        tone: SalesAssistantTone.PROFESSIONAL
      },
      { headers: { Cookie: repCookie } }
    );

    const emailCopy = formatDraftForClipboard(emailDraft);
    expect(emailCopy).toContain('Subject:');
    expect(emailCopy).toContain(emailDraft.emailSubject);
    expect(emailCopy).toContain(emailDraft.emailBody);

    const waCopy = formatDraftForClipboard(waDraft);
    expect(waCopy).not.toContain('Subject:');
    expect(waCopy).toBe(waDraft.content);
  });
});
