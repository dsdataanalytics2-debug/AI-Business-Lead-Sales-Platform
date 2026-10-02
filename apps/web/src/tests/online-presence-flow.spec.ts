import './setup-test-env.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';
import prisma from '@leadmate/db';
import { app } from '../../../api/src/app.js';
import { hashPassword } from '../../../api/src/lib/crypto.js';
import { resetLoginRateLimiter, resetAnalyzeRateLimiter } from '../../../api/src/middleware/rate-limiter.js';
import { apiClient, ApiClientError } from '../lib/api-client.js';
import {
  Role,
  ContactType,
  AnalysisWebsiteStatus,
  OnlinePresenceType,
  WebsiteStatus,
  ErrorCodes,
  CampaignType
} from '@leadmate/shared';
import { ensureTestDatabase } from './helpers/test-db-guard.js';
import { websiteAnalyzer } from '@leadmate/core';

describe('M2 Step 5: Frontend Online Presence Analysis API Flow Integration', () => {
  let server: http.Server;
  let serverPort: number;
  let orgId: string;
  let adminCookie: string;
  let viewerCookie: string;

  const adminEmail = 'm2-fe-admin@leadmate.test';
  const adminPassword = 'AdminPass12345!A';
  const viewerEmail = 'm2-fe-viewer@leadmate.test';
  const viewerPassword = 'ViewerPass12345!V';

  async function cleanupDb() {
    await ensureTestDatabase(prisma);
    await prisma.leadOnlinePresenceAnalysis.deleteMany({});
    await prisma.contactEvidence.deleteMany({});
    await prisma.leadContact.deleteMany({});
    await prisma.leadSource.deleteMany({});
    await prisma.lead.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.suppressionList.deleteMany({});
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

    // Ensure organization exists
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

    // Create Admin user (LEADS_READ + LEADS_WRITE)
    const adminHash = await hashPassword(adminPassword);
    await prisma.user.upsert({
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

    // Create Viewer user (LEADS_READ only)
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

    // Login Admin
    const adminLoginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });
    adminCookie = adminLoginRes.headers.get('set-cookie')?.split(';')[0] || '';

    // Login Viewer
    const viewerLoginRes = await fetch(`http://localhost:${serverPort}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: viewerEmail, password: viewerPassword })
    });
    viewerCookie = viewerLoginRes.headers.get('set-cookie')?.split(';')[0] || '';
  });

  beforeEach(async () => {
    resetLoginRateLimiter();
    resetAnalyzeRateLimiter();
    await cleanupDb();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanupDb();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('1. returns null for unanalyzed lead (Empty State)', async () => {
    const lead = await prisma.lead.create({
      data: {
        organizationId: orgId,
        name: 'Unanalyzed Business',
        normalizedName: 'unanalyzed business',
        category: 'Dental',
        city: 'Dhaka',
        primarySource: 'MANUAL',
        website: 'https://unanalyzed.com'
      }
    });

    const analysis = await apiClient.leads.getAnalysis(lead.id, {
      headers: { Cookie: adminCookie }
    });

    expect(analysis).toBeNull();
  });

  it('2. executes analysis and returns populated campaign scores & presence signals', async () => {
    const lead = await prisma.lead.create({
      data: {
        organizationId: orgId,
        name: 'Dhaka Care Dental',
        normalizedName: 'dhaka care dental',
        category: 'Healthcare',
        city: 'Dhaka',
        primarySource: 'MANUAL',
        website: 'https://dhakacaredental.com',
        contacts: {
          create: {
            type: ContactType.PHONE,
            rawValue: '01712345678',
            normalizedValue: '+8801712345678',
            phoneType: 'MOBILE',
            status: 'FOUND',
            isPrimary: true
          }
        }
      }
    });

    vi.spyOn(websiteAnalyzer, 'analyze').mockResolvedValue({
      websiteUrl: 'https://dhakacaredental.com',
      websiteStatus: AnalysisWebsiteStatus.REACHABLE,
      httpStatusCode: 200,
      isHttps: true,
      isRedirected: false,
      finalUrl: 'https://dhakacaredental.com',
      responseTimeMs: 250,
      pageTitle: 'Dhaka Care Dental Clinic - Banani',
      metaDescription: 'Specialist dental healthcare in Dhaka.'
    });

    const analysis = await apiClient.leads.analyze(lead.id, {
      headers: { Cookie: adminCookie }
    });

    expect(analysis).toBeDefined();
    expect(analysis.leadId).toBe(lead.id);
    expect(analysis.websiteStatus).toBe(AnalysisWebsiteStatus.REACHABLE);
    expect(analysis.hasWebsite).toBe(true);
    expect(analysis.pageTitle).toBe('Dhaka Care Dental Clinic - Banani');
    expect(analysis.metaDescription).toBe('Specialist dental healthcare in Dhaka.');
    expect(analysis.campaignScores.length).toBe(3);

    // Verify campaign types
    const campaignTypes = analysis.campaignScores.map((c) => c.campaignType);
    expect(campaignTypes).toContain(CampaignType.WEBSITE_ACQUISITION);
    expect(campaignTypes).toContain(CampaignType.WEBSITE_REDESIGN);
    expect(campaignTypes).toContain(CampaignType.ONLINE_PRESENCE_IMPROVEMENT);

    // Verify NO global score / ranking in campaignScores
    for (const c of analysis.campaignScores) {
      expect((c as any).overallScore).toBeUndefined();
      expect((c as any).rank).toBeUndefined();
      expect((c as any).isWinner).toBeUndefined();
    }
  });

  it('3. allows VIEWER to GET analysis, but rejects POST analyze with 403 FORBIDDEN', async () => {
    const lead = await prisma.lead.create({
      data: {
        organizationId: orgId,
        name: 'Viewer Test Business',
        normalizedName: 'viewer test business',
        category: 'Retail',
        city: 'Dhaka',
        primarySource: 'MANUAL',
        website: null
      }
    });

    // 1. Viewer can GET analysis (returns null)
    const getRes = await apiClient.leads.getAnalysis(lead.id, {
      headers: { Cookie: viewerCookie }
    });
    expect(getRes).toBeNull();

    // 2. Viewer POST analyze throws 403 ApiClientError
    let caughtError: ApiClientError | null = null;
    try {
      await apiClient.leads.analyze(lead.id, {
        headers: { Cookie: viewerCookie }
      });
    } catch (err) {
      caughtError = err as ApiClientError;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.statusCode).toBe(403);
    expect(caughtError?.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it('4. throws 404 NOT_FOUND when requesting analysis for non-existent lead', async () => {
    const fakeId = '00000000-0000-0000-0000-999999999999';

    let caughtError: ApiClientError | null = null;
    try {
      await apiClient.leads.getAnalysis(fakeId, {
        headers: { Cookie: adminCookie }
      });
    } catch (err) {
      caughtError = err as ApiClientError;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.statusCode).toBe(404);
    expect(caughtError?.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('5. handles 429 RATE_LIMITED when analyze rate limit is exceeded', async () => {
    const lead = await prisma.lead.create({
      data: {
        organizationId: orgId,
        name: 'Rate Limit FE Business',
        normalizedName: 'rate limit fe business',
        category: 'Retail',
        city: 'Dhaka',
        primarySource: 'MANUAL',
        website: null
      }
    });

    vi.spyOn(websiteAnalyzer, 'analyze').mockResolvedValue({
      websiteUrl: null,
      websiteStatus: AnalysisWebsiteStatus.NOT_APPLICABLE,
      httpStatusCode: null,
      isHttps: false,
      isRedirected: false,
      finalUrl: null,
      responseTimeMs: null,
      pageTitle: null,
      metaDescription: null
    });

    // Send 30 requests
    for (let i = 0; i < 30; i++) {
      await apiClient.leads.analyze(lead.id, {
        headers: { Cookie: adminCookie }
      });
    }

    // 31st request throws 429
    let caughtError: ApiClientError | null = null;
    try {
      await apiClient.leads.analyze(lead.id, {
        headers: { Cookie: adminCookie }
      });
    } catch (err) {
      caughtError = err as ApiClientError;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.statusCode).toBe(429);
    expect(caughtError?.code).toBe(ErrorCodes.RATE_LIMITED);
  });

  it('6. strictly distinguishes 200 { data: null } (unanalyzed) from 404 NOT_FOUND (missing lead)', async () => {
    // 1. Existing lead with no analysis -> resolves to null (200 OK)
    const existingLead = await prisma.lead.create({
      data: {
        organizationId: orgId,
        name: 'Distinction Check Lead',
        normalizedName: 'distinction check lead',
        category: 'Services',
        city: 'Dhaka',
        primarySource: 'MANUAL',
        website: 'https://distinction-test.com'
      }
    });

    const unanalyzedResult = await apiClient.leads.getAnalysis(existingLead.id, {
      headers: { Cookie: adminCookie }
    });
    expect(unanalyzedResult).toBeNull();

    // 2. Non-existent lead -> throws 404 ApiClientError (must NOT return null)
    const nonExistentId = '11111111-2222-3333-4444-555555555555';
    let caught404Error: ApiClientError | null = null;
    try {
      await apiClient.leads.getAnalysis(nonExistentId, {
        headers: { Cookie: adminCookie }
      });
    } catch (err) {
      caught404Error = err as ApiClientError;
    }

    expect(caught404Error).not.toBeNull();
    expect(caught404Error?.statusCode).toBe(404);
    expect(caught404Error?.code).toBe(ErrorCodes.NOT_FOUND);
    expect(caught404Error?.message).toContain('not found');
  });
});
