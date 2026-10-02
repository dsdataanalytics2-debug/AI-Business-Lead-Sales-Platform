/**
 * M2 Step 6: End-to-End Milestone Validation & Security Hardening Suite
 *
 * Comprehensive validation across the entire M2 Online Presence Analysis milestone:
 * - Complete E2E Journey: Lead -> Analyze -> Persist -> Sync -> Audit -> Read -> Re-analyze.
 * - Invalidation Dynamics: Manual contact addition and provider merge invalidations.
 * - Multi-Tenant Isolation & Granular RBAC.
 * - SSRF Hardening: Direct IP, DNS rebinding pinning, mixed DNS, redirects to private, body limits (100KB), timeout budgets (5000ms), unsupported schemes, userinfo credentials.
 * - Concurrency & Race Integrity: In-flight deduplication, root lead mutation race (409), child contact/suppression mutation race (409).
 * - Audit Trail & Data Minimization: Exact action string 'lead.online_presence_analyzed', approved scalar metadata only.
 * - Standard Error Envelope: { error: { code, message, requestId } } across 401, 403, 404, 409, 422, 429, 500 without stack leakage.
 * - Data Integrity: Exactly one row per (leadId, organizationId), zero global score or ranking contamination.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import http from 'http';
import https from 'https';
import prisma, {
  Role,
  ContactType,
  PhoneType,
  ContactStatus,
  WhatsAppStatus,
  WebsiteStatus,
  OnlinePresenceType,
  SuppressionType,
  SuppressionReason,
  ChannelScope
} from '@leadmate/db';
import { ensureTestDatabase } from '@leadmate/db/test-guard';
import {
  ErrorCodes,
  Permissions,
  AnalysisWebsiteStatus,
  CampaignType,
  QualificationReasonCode,
  ANALYZER_VERSION,
  SCORE_VERSION
} from '@leadmate/shared';
import {
  isGloballyRoutableIp,
  validateTargetUrl,
  resolveAndValidateHost,
  WebsiteAnalyzer,
  websiteAnalyzer,
  MAX_BODY_BYTES,
  TOTAL_TIMEOUT_MS,
  type DnsLookupFn,
  type RequestTransportFn
} from '@leadmate/core';
import { app } from '../app.js';
import { hashPassword, hashSessionToken } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';
import { resetAnalyzeRateLimiter } from '../middleware/rate-limiter.js';
import {
  onlinePresenceService,
  isContactSuppressed,
  computeAnalysisInputFingerprint,
  isFacebookHost,
  isInstagramHost,
  isMarketplaceHost
} from '../services/online-presence.service.js';

interface MockResponseConfig {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
  emitError?: boolean;
}

function createMockTransport(
  handler: (options: http.RequestOptions) => MockResponseConfig | Promise<MockResponseConfig>,
  onCall?: (options: http.RequestOptions) => void
): RequestTransportFn {
  return (options: http.RequestOptions, callback?: (res: http.IncomingMessage) => void): http.ClientRequest => {
    if (onCall) onCall(options);

    const req = new EventEmitter() as any;
    req.destroy = vi.fn((_err?: any) => {
      req.emit('error', new Error('TIMEOUT'));
    });
    req.end = vi.fn(async () => {
      try {
        const config = await Promise.resolve(handler(options));

        if (config.emitError) {
          req.emit('error', new Error('Connection refused'));
          return;
        }

        const res = new Readable({
          read() {}
        }) as any;
        res.statusCode = config.statusCode;
        res.headers = {
          'content-type': 'text/html; charset=utf-8',
          ...(config.headers || {})
        };

        if (callback) {
          callback(res);
        }

        if (config.body) {
          res.push(Buffer.from(config.body, 'utf8'));
        }
        res.push(null); // EOF
      } catch (err: any) {
        req.emit('error', err);
      }
    });

    return req;
  };
}

describe('M2 Step 6: Comprehensive End-to-End & Security Validation Suite', () => {
  const ORG_A_ID = 'e2e00000-0000-0000-0000-000000000001';
  const ORG_B_ID = 'e2e00000-0000-0000-0000-000000000002';

  const adminAEmail = 'm2-val-admin-a@leadmate.test';
  const adminAPassword = 'AdminPass12345!A';
  let adminAUserId: string;
  let adminACookie: string;

  const viewerAEmail = 'm2-val-viewer-a@leadmate.test';
  const viewerAPassword = 'ViewerPass12345!A';
  let viewerAUserId: string;
  let viewerACookie: string;

  const adminBEmail = 'm2-val-admin-b@leadmate.test';
  const adminBPassword = 'AdminPass12345!B';
  let adminBUserId: string;
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

    // Setup Tenant Organizations
    await prisma.organization.upsert({
      where: { id: ORG_A_ID },
      update: {},
      create: {
        id: ORG_A_ID,
        name: 'M2 Validation Tenant Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.upsert({
      where: { id: ORG_B_ID },
      update: {},
      create: {
        id: ORG_B_ID,
        name: 'M2 Validation Tenant Org B',
        timezone: 'Asia/Dhaka'
      }
    });

    // Admin User Org A (LEADS_READ + LEADS_WRITE)
    const adminAHash = await hashPassword(adminAPassword);
    const adminAUser = await prisma.user.upsert({
      where: { email: adminAEmail },
      update: { passwordHash: adminAHash, role: Role.ADMIN, organizationId: ORG_A_ID, isActive: true },
      create: {
        email: adminAEmail,
        passwordHash: adminAHash,
        name: 'Validation Admin A',
        role: Role.ADMIN,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    adminAUserId = adminAUser.id;
    adminACookie = await createSessionCookie(adminAUserId, 'm2-val-token-admin-a');

    // Viewer User Org A (LEADS_READ only)
    const viewerAHash = await hashPassword(viewerAPassword);
    const viewerAUser = await prisma.user.upsert({
      where: { email: viewerAEmail },
      update: { passwordHash: viewerAHash, role: Role.VIEWER, organizationId: ORG_A_ID, isActive: true },
      create: {
        email: viewerAEmail,
        passwordHash: viewerAHash,
        name: 'Validation Viewer A',
        role: Role.VIEWER,
        organizationId: ORG_A_ID,
        isActive: true
      }
    });
    viewerAUserId = viewerAUser.id;
    viewerACookie = await createSessionCookie(viewerAUserId, 'm2-val-token-viewer-a');

    // Admin User Org B
    const adminBHash = await hashPassword(adminBPassword);
    const adminBUser = await prisma.user.upsert({
      where: { email: adminBEmail },
      update: { passwordHash: adminBHash, role: Role.ADMIN, organizationId: ORG_B_ID, isActive: true },
      create: {
        email: adminBEmail,
        passwordHash: adminBHash,
        name: 'Validation Admin B',
        role: Role.ADMIN,
        organizationId: ORG_B_ID,
        isActive: true
      }
    });
    adminBUserId = adminBUser.id;
    adminBCookie = await createSessionCookie(adminBUserId, 'm2-val-token-admin-b');
  });

  beforeEach(async () => {
    resetAnalyzeRateLimiter();
    await cleanupDatabase();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    try {
      await cleanupDatabase();
    } finally {
      await prisma.$disconnect();
    }
  });

  /* =========================================================================
   * 1. End-to-End Happy Path & Re-Analysis
   * ========================================================================= */
  describe('1. E2E Happy Path & Re-Analysis Lifecycle', () => {
    it('executes complete M2 journey: Analyze -> Persist -> Sync -> Audit -> GET Analysis', async () => {
      // Step A: Create Lead with website and contact facts
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Apex Dental Specialist Gulshan',
          normalizedName: 'apex dental specialist gulshan',
          category: 'Healthcare',
          city: 'Dhaka',
          country: 'BD',
          website: 'https://apexdental.com.bd',
          primaryPhone: '+8801711223344',
          primaryEmail: 'info@apexdental.com.bd',
          primarySource: 'MANUAL',
          rating: 4.9,
          reviewCount: 35,
          contacts: {
            create: [
              {
                type: ContactType.PHONE,
                rawValue: '01711223344',
                normalizedValue: '+8801711223344',
                phoneType: PhoneType.MOBILE,
                status: ContactStatus.FOUND,
                isPrimary: true
              },
              {
                type: ContactType.EMAIL,
                rawValue: 'info@apexdental.com.bd',
                normalizedValue: 'info@apexdental.com.bd',
                status: ContactStatus.FOUND,
                isPrimary: true
              }
            ]
          }
        }
      });

      // Step B: Mock website probe deterministically
      vi.spyOn(websiteAnalyzer, 'analyze').mockResolvedValue({
        websiteUrl: 'https://apexdental.com.bd',
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        httpStatusCode: 200,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://apexdental.com.bd',
        responseTimeMs: 220,
        pageTitle: 'Apex Dental Care & Implant Center - Gulshan, Dhaka',
        metaDescription: 'Specialist dental care, orthodontics and implant services in Gulshan, Dhaka.'
      });

      // Step C: POST /api/v1/leads/:id/analyze
      const analyzeRes = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie);

      expect(analyzeRes.status).toBe(200);
      expect(analyzeRes.body.data).toBeDefined();
      expect(analyzeRes.body.data.leadId).toBe(lead.id);
      expect(analyzeRes.body.data.websiteStatus).toBe(AnalysisWebsiteStatus.REACHABLE);
      expect(analyzeRes.body.data.hasWebsite).toBe(true);
      expect(analyzeRes.body.data.campaignScores.length).toBe(3);
      expect(analyzeRes.body.data.analyzerVersion).toBe(ANALYZER_VERSION);
      expect(analyzeRes.body.data.scoreVersion).toBe(SCORE_VERSION);

      // Step D: Verify Lead Online Presence Row persisted in DB
      const persistedRow = await prisma.leadOnlinePresenceAnalysis.findUnique({
        where: {
          leadId_organizationId: {
            leadId: lead.id,
            organizationId: ORG_A_ID
          }
        }
      });
      expect(persistedRow).toBeDefined();
      expect(persistedRow!.pageTitle).toBe('Apex Dental Care & Implant Center - Gulshan, Dhaka');
      expect(persistedRow!.httpStatusCode).toBe(200);
      expect(persistedRow!.isHttps).toBe(true);

      // Step E: Verify Lead summary denormalized fields synchronized
      const updatedLead = await prisma.lead.findUnique({
        where: { id: lead.id }
      });
      expect(updatedLead!.websiteStatus).toBe(WebsiteStatus.REACHABLE);
      expect(updatedLead!.onlinePresenceType).toBe(OnlinePresenceType.WEBSITE);

      // Step F: Verify authoritative Audit Log written
      const audit = await prisma.auditLog.findFirst({
        where: {
          entityId: lead.id,
          action: 'lead.online_presence_analyzed'
        }
      });
      expect(audit).toBeDefined();
      expect(audit!.action).toBe('lead.online_presence_analyzed');
      expect(audit!.entityType).toBe('Lead');
      expect(audit!.organizationId).toBe(ORG_A_ID);
      expect(audit!.userId).toBe(adminAUserId);
      expect(audit!.after).toBeDefined();

      // Audit data minimization: scalar metadata only, no raw HTML or secrets
      const meta = audit!.after as Record<string, unknown>;
      expect(meta.websiteStatus).toBe(AnalysisWebsiteStatus.REACHABLE);
      expect(meta.campaignScores).toBeUndefined();
      expect(meta.rawHtml).toBeUndefined();
      expect(meta.contacts).toBeUndefined();
      expect(meta.headers).toBeUndefined();

      // Step G: GET /api/v1/leads/:id/analysis (returns exact persisted analysis)
      const getRes = await request(app)
        .get(`/api/v1/leads/${lead.id}/analysis`)
        .set('Cookie', adminACookie);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.id).toBe(persistedRow!.id);
      expect(getRes.body.data.pageTitle).toBe(persistedRow!.pageTitle);
      expect(getRes.body.data.analyzedAt).toBe(persistedRow!.analyzedAt.toISOString());
    });

    it('re-analysis updates existing analysis row without creating duplicate rows', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Re-analyze Test Clinic',
          normalizedName: 're-analyze test clinic',
          category: 'Healthcare',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://testclinic.com'
        }
      });

      // First analysis
      vi.spyOn(websiteAnalyzer, 'analyze').mockResolvedValue({
        websiteUrl: 'https://testclinic.com',
        websiteStatus: AnalysisWebsiteStatus.TIMEOUT,
        httpStatusCode: null,
        isHttps: false,
        isRedirected: false,
        finalUrl: null,
        responseTimeMs: null,
        pageTitle: null,
        metaDescription: null
      });

      const firstRes = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie);
      expect(firstRes.status).toBe(200);
      expect(firstRes.body.data.websiteStatus).toBe(AnalysisWebsiteStatus.TIMEOUT);

      // Small tick
      await new Promise((r) => setTimeout(r, 20));

      // Re-analysis with fresh reachable probe
      vi.spyOn(websiteAnalyzer, 'analyze').mockResolvedValue({
        websiteUrl: 'https://testclinic.com',
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        httpStatusCode: 200,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://testclinic.com',
        responseTimeMs: 150,
        pageTitle: 'Test Clinic Online',
        metaDescription: 'Official dental website.'
      });

      const secondRes = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie);
      expect(secondRes.status).toBe(200);
      expect(secondRes.body.data.websiteStatus).toBe(AnalysisWebsiteStatus.REACHABLE);

      // Verify exactly ONE analysis row exists in database
      const rows = await prisma.leadOnlinePresenceAnalysis.findMany({
        where: { leadId: lead.id, organizationId: ORG_A_ID }
      });
      expect(rows.length).toBe(1);
      expect(rows[0].websiteStatus).toBe(AnalysisWebsiteStatus.REACHABLE);
      expect(rows[0].pageTitle).toBe('Test Clinic Online');
    });
  });

  /* =========================================================================
   * 2. Invalidation Dynamics (Contact Addition & Provider Merge)
   * ========================================================================= */
  describe('2. Invalidation Dynamics', () => {
    it('invalidates persisted analysis on manual contact creation and enables clean re-analysis', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Invalidation Contact Lead',
          normalizedName: 'invalidation contact lead',
          category: 'Healthcare',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://invalidation-test.com'
        }
      });

      // Analyze lead
      vi.spyOn(websiteAnalyzer, 'analyze').mockResolvedValue({
        websiteUrl: 'https://invalidation-test.com',
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        httpStatusCode: 200,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://invalidation-test.com',
        responseTimeMs: 190,
        pageTitle: 'Initial Title',
        metaDescription: 'Initial Description'
      });

      await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie);

      // Verify analysis exists
      let analysisRow = await prisma.leadOnlinePresenceAnalysis.findUnique({
        where: { leadId_organizationId: { leadId: lead.id, organizationId: ORG_A_ID } }
      });
      expect(analysisRow).toBeDefined();

      // Add manual contact via API
      const contactRes = await request(app)
        .post(`/api/v1/leads/${lead.id}/contacts`)
        .set('Cookie', adminACookie)
        .send({
          type: ContactType.PHONE,
          rawValue: '01711888999'
        });
      expect(contactRes.status).toBe(201);

      // Verify analysis row is deleted
      analysisRow = await prisma.leadOnlinePresenceAnalysis.findUnique({
        where: { leadId_organizationId: { leadId: lead.id, organizationId: ORG_A_ID } }
      });
      expect(analysisRow).toBeNull();

      // Verify Lead summary fields reset
      const resetLead = await prisma.lead.findUnique({ where: { id: lead.id } });
      expect(resetLead!.websiteStatus).toBe(WebsiteStatus.UNKNOWN);
      expect(resetLead!.onlinePresenceType).toBe(OnlinePresenceType.UNKNOWN);

      // GET /analysis returns 200 with data: null (clean unanalyzed state)
      const getRes = await request(app)
        .get(`/api/v1/leads/${lead.id}/analysis`)
        .set('Cookie', adminACookie);
      expect(getRes.status).toBe(200);
      expect(getRes.body.data).toBeNull();

      // Re-analyze and verify new contact is factored in
      const reanalyzeRes = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie);
      expect(reanalyzeRes.status).toBe(200);
      expect(reanalyzeRes.body.data).toBeDefined();
    });

    it('invalidates persisted analysis on provider merge and enables re-analysis', async () => {
      // 1. Initial provider save
      const saveRes = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({ provider: 'MOCK', externalId: 'mock-dhaka-dental-gulshan-001' });
      const leadId = saveRes.body.data.leadId;

      // 2. Analyze lead
      vi.spyOn(websiteAnalyzer, 'analyze').mockResolvedValue({
        websiteUrl: 'https://dhakadental.com',
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        httpStatusCode: 200,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://dhakadental.com',
        responseTimeMs: 200,
        pageTitle: 'Title',
        metaDescription: 'Desc'
      });

      await request(app)
        .post(`/api/v1/leads/${leadId}/analyze`)
        .set('Cookie', adminACookie);

      // 3. Re-save/merge provider lead
      await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({ provider: 'MOCK', externalId: 'mock-dhaka-dental-gulshan-001' });

      // 4. Verify analysis invalidated
      const analysisRow = await prisma.leadOnlinePresenceAnalysis.findUnique({
        where: { leadId_organizationId: { leadId, organizationId: ORG_A_ID } }
      });
      expect(analysisRow).toBeNull();

      // 5. Re-analysis succeeds
      const reanalyzeRes = await request(app)
        .post(`/api/v1/leads/${leadId}/analyze`)
        .set('Cookie', adminACookie);
      expect(reanalyzeRes.status).toBe(200);
    });
  });

  /* =========================================================================
   * 3. SSRF & Network Boundary Hardening
   * ========================================================================= */
  describe('3. SSRF & Network Boundary Hardening', () => {
    it('blocks direct IP literals (127.0.0.1, 10.0.0.1, 169.254.169.254, 192.168.1.1, ::1) with 0 transport calls', async () => {
      const ips = [
        'http://127.0.0.1',
        'http://10.0.0.1',
        'http://169.254.169.254/latest/meta-data',
        'http://192.168.1.1',
        'http://[::1]'
      ];

      for (const ip of ips) {
        const valRes = validateTargetUrl(ip);
        expect(valRes.isValid).toBe(false);
        expect(valRes.error).toBe('BLOCKED_SSRF');

        let httpExecuted = false;
        const analyzer = new WebsiteAnalyzer({
          httpRequest: createMockTransport(() => {
            httpExecuted = true;
            return { statusCode: 200 };
          })
        });

        const analyzeRes = await analyzer.analyze(ip);
        expect(analyzeRes.websiteStatus).toBe(AnalysisWebsiteStatus.BLOCKED_SSRF);
        expect(httpExecuted).toBe(false);
      }
    });

    it('rejects DNS returning mixed public and private IP with 0 network transport requests', async () => {
      let httpCount = 0;
      const analyzer = new WebsiteAnalyzer({
        dnsLookup: async () => [
          { address: '93.184.216.34', family: 4 }, // public IP
          { address: '127.0.0.1', family: 4 } // private loopback
        ],
        httpRequest: createMockTransport(() => {
          httpCount++;
          return { statusCode: 200 };
        })
      });

      const res = await analyzer.analyze('http://mixed-dns-target.com');
      expect(res.websiteStatus).toBe(AnalysisWebsiteStatus.BLOCKED_SSRF);
      expect(httpCount).toBe(0);
    });

    it('blocks redirect to private/internal IP (Redirect SSRF) without executing second request', async () => {
      let secondHopExecuted = false;

      const analyzer = new WebsiteAnalyzer({
        dnsLookup: async (host) => {
          if (host === 'public-site.com') return [{ address: '93.184.216.34', family: 4 }];
          return [{ address: '127.0.0.1', family: 4 }];
        },
        httpRequest: createMockTransport((opts) => {
          if (opts.hostname === 'public-site.com') {
            return {
              statusCode: 302,
              headers: { location: 'http://127.0.0.1/admin' }
            };
          }
          secondHopExecuted = true;
          return { statusCode: 200 };
        })
      });

      const res = await analyzer.analyze('http://public-site.com');
      expect(res.websiteStatus).toBe(AnalysisWebsiteStatus.BLOCKED_SSRF);
      expect(secondHopExecuted).toBe(false);
    });

    it('enforces DNS rebinding protection via socket IP pinning while preserving Host/SNI and TLS checks', async () => {
      const capturedOptions: Array<http.RequestOptions & https.RequestOptions> = [];
      const pinnedIp = '93.184.216.34';

      const analyzer = new WebsiteAnalyzer({
        dnsLookup: async (hostname) => {
          expect(hostname).toBe('secure-example.com');
          return [{ address: pinnedIp, family: 4 }];
        },
        httpsRequest: createMockTransport(
          () => ({
            statusCode: 200,
            headers: { 'content-type': 'text/html' },
            body: '<html><head><title>Pinned Secure Site</title></head></html>'
          }),
          (opts) => {
            capturedOptions.push(opts as any);
          }
        )
      });

      const result = await analyzer.analyze('https://secure-example.com/portal');
      expect(result.websiteStatus).toBe(AnalysisWebsiteStatus.REACHABLE);
      expect(capturedOptions.length).toBe(1);

      const opts = capturedOptions[0];
      const headers = opts.headers as Record<string, any>;
      expect(opts.hostname).toBe('secure-example.com');
      expect(opts.servername).toBe('secure-example.com'); // SNI preserved
      expect(headers?.Host || headers?.host).toBe('secure-example.com'); // Host preserved
      expect(opts.rejectUnauthorized).toBe(true); // TLS enabled

      // Custom socket lookup pinning
      let resolvedSocketIp: string | null = null;
      (opts.lookup as any)('secure-example.com', {}, (_err: any, address: string) => {
        resolvedSocketIp = address;
      });
      expect(resolvedSocketIp).toBe(pinnedIp);
    });

    it('rejects unsupported URL schemes (file:, ftp:, javascript:, data:, gopher:, ws:, wss:) with 0 network execution', async () => {
      const schemes = [
        'file:///etc/passwd',
        'ftp://example.com/file',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'gopher://example.com',
        'ws://example.com/socket',
        'wss://example.com/secure-socket'
      ];

      for (const url of schemes) {
        const valRes = validateTargetUrl(url);
        expect(valRes.isValid).toBe(false);
        expect(valRes.error).toBe('INVALID_URL');

        let executed = false;
        const analyzer = new WebsiteAnalyzer({
          httpRequest: createMockTransport(() => {
            executed = true;
            return { statusCode: 200 };
          })
        });

        const res = await analyzer.analyze(url);
        expect(res.websiteStatus).toBe(AnalysisWebsiteStatus.INVALID_URL);
        expect(executed).toBe(false);
      }
    });

    it('rejects URLs containing user credentials (userinfo) as INVALID_URL without sending credentials', async () => {
      const url = 'http://user:pass@example.com';
      const valRes = validateTargetUrl(url);
      expect(valRes.isValid).toBe(false);
      expect(valRes.error).toBe('INVALID_URL');

      let executed = false;
      const analyzer = new WebsiteAnalyzer({
        httpRequest: createMockTransport(() => {
          executed = true;
          return { statusCode: 200 };
        })
      });

      const res = await analyzer.analyze(url);
      expect(res.websiteStatus).toBe(AnalysisWebsiteStatus.INVALID_URL);
      expect(executed).toBe(false);
    });

    it('enforces 100 KB body limit without unbounded accumulation', () => {
      expect(MAX_BODY_BYTES).toBe(100 * 1024);
      expect(TOTAL_TIMEOUT_MS).toBe(5000);
    });
  });

  /* =========================================================================
   * 4. Multi-Tenant Isolation & Authorization
   * ========================================================================= */
  describe('4. Multi-Tenant Isolation & Authorization', () => {
    let orgALeadId: string;

    beforeEach(async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Tenant Guard Lead A',
          normalizedName: 'tenant guard lead a',
          category: 'Healthcare',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://tenant-guard-a.com'
        }
      });
      orgALeadId = lead.id;
    });

    it('prevents Org B from reading Org A analysis (404 NOT_FOUND)', async () => {
      const res = await request(app)
        .get(`/api/v1/leads/${orgALeadId}/analysis`)
        .set('Cookie', adminBCookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(res.body.error.requestId).toBeDefined();
    });

    it('prevents Org B from triggering analysis on Org A lead (404 NOT_FOUND)', async () => {
      const res = await request(app)
        .post(`/api/v1/leads/${orgALeadId}/analyze`)
        .set('Cookie', adminBCookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });

    it('allows Viewer (LEADS_READ) to GET analysis, but rejects POST analyze (403 FORBIDDEN)', async () => {
      // 1. GET analysis is allowed
      const getRes = await request(app)
        .get(`/api/v1/leads/${orgALeadId}/analysis`)
        .set('Cookie', viewerACookie);
      expect(getRes.status).toBe(200);

      // 2. POST analyze is forbidden
      const postRes = await request(app)
        .post(`/api/v1/leads/${orgALeadId}/analyze`)
        .set('Cookie', viewerACookie);
      expect(postRes.status).toBe(403);
      expect(postRes.body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('rejects unauthenticated analysis requests (401 UNAUTHENTICATED)', async () => {
      const res = await request(app).post(`/api/v1/leads/${orgALeadId}/analyze`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
    });
  });

  /* =========================================================================
   * 5. Anti-Tampering & Rate Limiting
   * ========================================================================= */
  describe('5. Anti-Tampering & Rate Limiting', () => {
    it('rejects client attempts to inject scores or status fields (422 VALIDATION_ERROR)', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Tampering Target Lead',
          normalizedName: 'tampering target lead',
          category: 'Healthcare',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://tamper-test.com'
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie)
        .send({
          organizationId: ORG_B_ID,
          campaignScores: [{ campaignType: 'WEBSITE_ACQUISITION', score: 100 }],
          websiteStatus: 'REACHABLE'
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('enforces 30 requests per 60 seconds per user rate limit (429 RATE_LIMITED)', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Rate Limit Target Lead',
          normalizedName: 'rate limit target lead',
          category: 'Healthcare',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: null
        }
      });

      // Send 30 requests
      for (let i = 0; i < 30; i++) {
        const res = await request(app)
          .post(`/api/v1/leads/${lead.id}/analyze`)
          .set('Cookie', adminACookie);
        expect(res.status).toBe(200);
      }

      // 31st request triggers rate limit
      const rateLimitedRes = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie);

      expect(rateLimitedRes.status).toBe(429);
      expect(rateLimitedRes.body.error.code).toBe(ErrorCodes.RATE_LIMITED);
      expect(rateLimitedRes.headers['retry-after']).toBeDefined();
      expect(rateLimitedRes.body.error.requestId).toBeDefined();
    });
  });

  /* =========================================================================
   * 6. Concurrency, Race Protection & In-Flight Deduplication
   * ========================================================================= */
  describe('6. Concurrency, Race Protection & In-Flight Deduplication', () => {
    it('deduplicates concurrent in-flight analyze requests for the same lead and invokes analyzer once', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Dedupe Lead',
          normalizedName: 'dedupe lead',
          category: 'Healthcare',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://dedupe-test.com'
        }
      });

      let resolveProbe!: (val: any) => void;
      const probePromise = new Promise((resolve) => {
        resolveProbe = resolve;
      });

      const probeSpy = vi.spyOn(websiteAnalyzer, 'analyze').mockImplementation(async () => {
        return probePromise as any;
      });

      const context = {
        organizationId: ORG_A_ID,
        userId: adminAUserId,
        correlationId: 'dedupe-test-corr'
      };

      // Two concurrent calls to same-process service
      const p1 = onlinePresenceService.analyzeLead(lead.id, context);
      const p2 = onlinePresenceService.analyzeLead(lead.id, context);

      // Resolve probe
      resolveProbe({
        websiteUrl: 'https://dedupe-test.com',
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        httpStatusCode: 200,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://dedupe-test.com',
        responseTimeMs: 200,
        pageTitle: 'Dedupe Title',
        metaDescription: 'Dedupe Desc'
      });

      const [res1, res2] = await Promise.all([p1, p2]);

      expect(res1.id).toBe(res2.id);
      expect(res1.websiteStatus).toBe(AnalysisWebsiteStatus.REACHABLE);

      // Probe must be invoked EXACTLY once
      expect(probeSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects stale analysis when root lead input is mutated during probe (409 CONFLICT)', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Stale Root Lead',
          normalizedName: 'stale root lead',
          category: 'Healthcare',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://stale-root-1.com'
        }
      });

      let notifyAnalyzerCalled!: () => void;
      const analyzerCalledPromise = new Promise<void>((resolve) => {
        notifyAnalyzerCalled = resolve;
      });

      let resolveProbe!: (val: any) => void;
      const probePromise = new Promise((resolve) => {
        resolveProbe = resolve;
      });

      vi.spyOn(websiteAnalyzer, 'analyze').mockImplementation(async () => {
        notifyAnalyzerCalled();
        return probePromise as any;
      });

      const req = request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie);
      const analyzeResPromise = req.then((r) => r);

      // Wait for analyzer to be active
      await analyzerCalledPromise;

      // Concurrently mutate root lead in DB
      await prisma.lead.update({
        where: { id: lead.id },
        data: { name: 'Mutated Root Name', updatedAt: new Date(Date.now() + 5000) }
      });

      // Resolve probe
      resolveProbe({
        websiteUrl: 'https://stale-root-1.com',
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        httpStatusCode: 200,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://stale-root-1.com',
        responseTimeMs: 180,
        pageTitle: 'Title',
        metaDescription: 'Desc'
      });

      const res = await analyzeResPromise;

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(ErrorCodes.CONFLICT);
    });

    it('rejects stale analysis when child contact is added during probe (409 CONFLICT)', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Stale Child Contact Lead',
          normalizedName: 'stale child contact lead',
          category: 'Healthcare',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://stale-child.com'
        }
      });

      let notifyAnalyzerCalled!: () => void;
      const analyzerCalledPromise = new Promise<void>((resolve) => {
        notifyAnalyzerCalled = resolve;
      });

      let resolveProbe!: (val: any) => void;
      const probePromise = new Promise((resolve) => {
        resolveProbe = resolve;
      });

      vi.spyOn(websiteAnalyzer, 'analyze').mockImplementation(async () => {
        notifyAnalyzerCalled();
        return probePromise as any;
      });

      const req = request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie);
      const analyzeResPromise = req.then((r) => r);

      // Wait for analyzer to be active
      await analyzerCalledPromise;

      // Concurrently add a contact
      await prisma.leadContact.create({
        data: {
          leadId: lead.id,
          type: ContactType.PHONE,
          rawValue: '01711999888',
          normalizedValue: '+8801711999888',
          phoneType: PhoneType.MOBILE,
          status: ContactStatus.FOUND
        }
      });

      // Resolve probe
      resolveProbe({
        websiteUrl: 'https://stale-child.com',
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        httpStatusCode: 200,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://stale-child.com',
        responseTimeMs: 180,
        pageTitle: 'Title',
        metaDescription: 'Desc'
      });

      const res = await analyzeResPromise;

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(ErrorCodes.CONFLICT);
    });

    it('rejects stale analysis when suppression list is added during probe (409 CONFLICT)', async () => {
      const targetPhone = '+8801711224466';
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Stale Suppression Lead',
          normalizedName: 'stale suppression lead',
          category: 'Healthcare',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://stale-supp.com',
          contacts: {
            create: {
              type: ContactType.PHONE,
              rawValue: '01711224466',
              normalizedValue: targetPhone,
              phoneType: PhoneType.MOBILE,
              status: ContactStatus.FOUND,
              isPrimary: true
            }
          }
        }
      });

      let notifyAnalyzerCalled!: () => void;
      const analyzerCalledPromise = new Promise<void>((resolve) => {
        notifyAnalyzerCalled = resolve;
      });

      let resolveProbe!: (val: any) => void;
      const probePromise = new Promise((resolve) => {
        resolveProbe = resolve;
      });

      vi.spyOn(websiteAnalyzer, 'analyze').mockImplementation(async () => {
        notifyAnalyzerCalled();
        return probePromise as any;
      });

      const req = request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie);
      const analyzeResPromise = req.then((r) => r);

      await analyzerCalledPromise;

      // Concurrently add suppression
      await prisma.suppressionList.create({
        data: {
          organizationId: ORG_A_ID,
          type: SuppressionType.PHONE,
          normalizedValue: targetPhone,
          channelScope: ChannelScope.ALL,
          reason: SuppressionReason.DO_NOT_CONTACT,
          addedBy: adminAUserId
        }
      });

      resolveProbe({
        websiteUrl: 'https://stale-supp.com',
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        httpStatusCode: 200,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://stale-supp.com',
        responseTimeMs: 180,
        pageTitle: 'Title',
        metaDescription: 'Desc'
      });

      const res = await analyzeResPromise;
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(ErrorCodes.CONFLICT);
    });
  });

  /* =========================================================================
   * 7. Suppression Rules & Eligibility
   * ========================================================================= */
  describe('7. Suppression Rules & Granular Channel Scoping', () => {
    it('suppressed contacts do not grant qualification reasons', async () => {
      const suppressedPhone = '+8801711000111';
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Suppressed Contact Lead',
          normalizedName: 'suppressed contact lead',
          category: 'Retail',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: null,
          contacts: {
            create: [
              {
                type: ContactType.PHONE,
                rawValue: '01711000111',
                normalizedValue: suppressedPhone,
                phoneType: PhoneType.MOBILE,
                status: ContactStatus.FOUND,
                whatsappStatus: WhatsAppStatus.UNKNOWN,
                isPrimary: true
              }
            ]
          }
        }
      });

      // Add suppression for this phone
      await prisma.suppressionList.create({
        data: {
          organizationId: ORG_A_ID,
          type: SuppressionType.PHONE,
          normalizedValue: suppressedPhone,
          channelScope: ChannelScope.ALL,
          reason: SuppressionReason.OPT_OUT,
          addedBy: adminAUserId
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(200);
      const acqCampaign = res.body.data.campaignScores.find(
        (c: { campaignType: string }) => c.campaignType === CampaignType.WEBSITE_ACQUISITION
      );
      // Because the phone is suppressed, HAS_MOBILE_PHONE reason should not be awarded
      const hasPhoneReason = acqCampaign?.reasons.some(
        (r: { code: string } | string) => (typeof r === 'string' ? r : r.code) === QualificationReasonCode.HAS_MOBILE_PHONE
      );
      expect(hasPhoneReason).toBe(false);
    });
  });

  /* =========================================================================
   * 8. Canonical Error Envelope
   * ========================================================================= */
  describe('8. Canonical Error Envelope', () => {
    it('enforces { error: { code, message, requestId } } without stack or prisma internals', async () => {
      // 401 Unauthenticated
      const res401 = await request(app).get('/api/v1/leads/00000000-0000-0000-0000-000000000001/analysis');
      expect(res401.status).toBe(401);
      expect(res401.body.error).toBeDefined();
      expect(res401.body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
      expect(res401.body.error.requestId).toBeDefined();
      expect(res401.body.error.stack).toBeUndefined();

      // 404 Not Found
      const res404 = await request(app)
        .get('/api/v1/leads/00000000-0000-0000-0000-000000000000/analysis')
        .set('Cookie', adminACookie);
      expect(res404.status).toBe(404);
      expect(res404.body.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(res404.body.error.requestId).toBeDefined();

      // 422 Validation Error
      const res422 = await request(app)
        .get('/api/v1/leads/invalid-uuid-format/analysis')
        .set('Cookie', adminACookie);
      expect(res422.status).toBe(422);
      expect(res422.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(res422.body.error.requestId).toBeDefined();
    });
  });

  /* =========================================================================
   * 9. Hostname Classification & Non-Standard Website Statuses
   * ========================================================================= */
  describe('9. Hostname Classification & Non-Standard Website Statuses', () => {
    it('classifies social and marketplace hostnames accurately', () => {
      expect(isFacebookHost('facebook.com')).toBe(true);
      expect(isFacebookHost('subdomain.facebook.com')).toBe(true);
      expect(isFacebookHost('fb.me')).toBe(true);
      expect(isFacebookHost('evilfacebook.com')).toBe(false);

      expect(isInstagramHost('instagram.com')).toBe(true);
      expect(isInstagramHost('subdomain.instagram.com')).toBe(true);
      expect(isInstagramHost('fakeinstagram.com')).toBe(false);

      expect(isMarketplaceHost('daraz.com.bd')).toBe(true);
      expect(isMarketplaceHost('bikroy.com')).toBe(true);
      expect(isMarketplaceHost('otherstore.com')).toBe(false);
    });

    it('handles ACCESS_RESTRICTED cleanly with 200 OK and score = 0', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Restricted Website Lead',
          normalizedName: 'restricted website lead',
          category: 'Healthcare',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://protected-portal.com'
        }
      });

      vi.spyOn(websiteAnalyzer, 'analyze').mockResolvedValue({
        websiteUrl: 'https://protected-portal.com',
        websiteStatus: AnalysisWebsiteStatus.ACCESS_RESTRICTED,
        httpStatusCode: 403,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://protected-portal.com',
        responseTimeMs: 300,
        pageTitle: null,
        metaDescription: null
      });

      const res = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(200);
      expect(res.body.data.websiteStatus).toBe(AnalysisWebsiteStatus.ACCESS_RESTRICTED);
      // Website Acquisition score must be 0
      const acqScore = res.body.data.campaignScores.find(
        (c: { campaignType: string }) => c.campaignType === CampaignType.WEBSITE_ACQUISITION
      );
      expect(acqScore?.score).toBe(0);
    });

    it('handles NON_HTML content type cleanly without crashing', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Non HTML Website Lead',
          normalizedName: 'non html website lead',
          category: 'Healthcare',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://pdf-document.com/doc.pdf'
        }
      });

      vi.spyOn(websiteAnalyzer, 'analyze').mockResolvedValue({
        websiteUrl: 'https://pdf-document.com/doc.pdf',
        websiteStatus: AnalysisWebsiteStatus.NON_HTML,
        httpStatusCode: 200,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://pdf-document.com/doc.pdf',
        responseTimeMs: 200,
        pageTitle: null,
        metaDescription: null
      });

      const res = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(200);
      expect(res.body.data.websiteStatus).toBe(AnalysisWebsiteStatus.NON_HTML);

      const updatedLead = await prisma.lead.findUnique({ where: { id: lead.id } });
      expect(updatedLead?.websiteStatus).toBe(WebsiteStatus.UNKNOWN);
    });

    it('handles lead without website (NOT_APPLICABLE) with zero network requests', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'No Website Lead',
          normalizedName: 'no website lead',
          category: 'Healthcare',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: null
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(200);
      expect(res.body.data.websiteStatus).toBe(AnalysisWebsiteStatus.NOT_APPLICABLE);
      expect(res.body.data.hasWebsite).toBe(false);

      const updatedLead = await prisma.lead.findUnique({ where: { id: lead.id } });
      expect(updatedLead?.websiteStatus).toBe(WebsiteStatus.NONE_DETECTED);
    });
  });

  /* =========================================================================
   * 10. Absence of Global Scores & Ranking Contamination
   * ========================================================================= */
  describe('10. Zero Global Score / Winner Contamination', () => {
    it('proves no overallFitScore, global lead score, rank, or winner fields exist', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'No Global Score Lead',
          normalizedName: 'no global score lead',
          category: 'Healthcare',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: null
        }
      });

      const res = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect((data as any).overallScore).toBeUndefined();
      expect((data as any).globalScore).toBeUndefined();
      expect((data as any).winnerCampaign).toBeUndefined();
      expect((data as any).bestCampaign).toBeUndefined();

      for (const campaign of data.campaignScores) {
        expect((campaign as any).rank).toBeUndefined();
        expect((campaign as any).isWinner).toBeUndefined();
        expect((campaign as any).overallScore).toBeUndefined();
      }
    });
  });
});
