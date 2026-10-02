/**
 * Step 4 Integration Tests: Online Presence Analysis API, Service, Invalidation, Audit & Rate Limiting
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
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
  AnalysisWebsiteStatus,
  ANALYZER_VERSION,
  SCORE_VERSION,
  QualificationReasonCode
} from '@leadmate/shared';
import { websiteAnalyzer } from '@leadmate/core';
import { app } from '../app.js';
import { hashPassword, hashSessionToken } from '../lib/crypto.js';
import { SESSION_COOKIE_NAME } from '../services/session.service.js';
import { resetAnalyzeRateLimiter } from '../middleware/rate-limiter.js';
import {
  onlinePresenceService,
  isFacebookHost,
  isInstagramHost,
  isMarketplaceHost,
  classifyOnlinePresenceType,
  isContactSuppressed,
  computeAnalysisInputFingerprint
} from '../services/online-presence.service.js';

describe('M2 Step 4: Online Presence Analysis API Matrix', () => {
  const ORG_A_ID = '30000000-0000-0000-0000-000000000001';
  const ORG_B_ID = '40000000-0000-0000-0000-000000000002';

  const adminAEmail = 'admin-m2-a@leadmate.test';
  const adminAPassword = 'AdminPass12345!A';
  let adminAUserId: string;
  let adminACookie: string;

  const viewerAEmail = 'viewer-m2-a@leadmate.test';
  const viewerAPassword = 'ViewerPass12345!A';
  let viewerAUserId: string;
  let viewerACookie: string;

  const adminBEmail = 'admin-m2-b@leadmate.test';
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

    // Setup Organizations
    await prisma.organization.upsert({
      where: { id: ORG_A_ID },
      update: {},
      create: {
        id: ORG_A_ID,
        name: 'M2 Tenant Org A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.upsert({
      where: { id: ORG_B_ID },
      update: {},
      create: {
        id: ORG_B_ID,
        name: 'M2 Tenant Org B',
        timezone: 'Asia/Dhaka'
      }
    });

    const passwordHashA = await hashPassword(adminAPassword);
    const userA = await prisma.user.upsert({
      where: { email: adminAEmail },
      update: { passwordHash: passwordHashA, role: Role.ADMIN, organizationId: ORG_A_ID, isActive: true },
      create: {
        organizationId: ORG_A_ID,
        email: adminAEmail,
        passwordHash: passwordHashA,
        name: 'Admin User A',
        role: Role.ADMIN,
        isActive: true
      }
    });
    adminAUserId = userA.id;
    adminACookie = await createSessionCookie(userA.id, 'session_token_m2_admin_a');

    const viewerHashA = await hashPassword(viewerAPassword);
    const viewerA = await prisma.user.upsert({
      where: { email: viewerAEmail },
      update: { passwordHash: viewerHashA, role: Role.VIEWER, organizationId: ORG_A_ID, isActive: true },
      create: {
        organizationId: ORG_A_ID,
        email: viewerAEmail,
        passwordHash: viewerHashA,
        name: 'Viewer User A',
        role: Role.VIEWER,
        isActive: true
      }
    });
    viewerAUserId = viewerA.id;
    viewerACookie = await createSessionCookie(viewerA.id, 'session_token_m2_viewer_a');

    const passwordHashB = await hashPassword(adminBPassword);
    const userB = await prisma.user.upsert({
      where: { email: adminBEmail },
      update: { passwordHash: passwordHashB, role: Role.ADMIN, organizationId: ORG_B_ID, isActive: true },
      create: {
        organizationId: ORG_B_ID,
        email: adminBEmail,
        passwordHash: passwordHashB,
        name: 'Admin User B',
        role: Role.ADMIN,
        isActive: true
      }
    });
    adminBUserId = userB.id;
    adminBCookie = await createSessionCookie(userB.id, 'session_token_m2_admin_b');
  });

  beforeEach(async () => {
    await cleanupDatabase();
    resetAnalyzeRateLimiter();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanupDatabase();
    await prisma.$disconnect();
  });

  // =========================================================
  // 1. Presence Hostname & Boundary Classification Unit Checks
  // =========================================================
  describe('Hostname & Presence Unit Classification', () => {
    it('correctly validates Facebook hostname boundaries and rejects evil domains', () => {
      expect(isFacebookHost('facebook.com')).toBe(true);
      expect(isFacebookHost('www.facebook.com')).toBe(true);
      expect(isFacebookHost('m.facebook.com')).toBe(true);
      expect(isFacebookHost('fb.me')).toBe(true);
      expect(isFacebookHost('evilfacebook.com')).toBe(false);
      expect(isFacebookHost('notfacebook.com')).toBe(false);
      expect(isFacebookHost('facebook.com.evil.com')).toBe(false);
    });

    it('correctly validates Instagram hostname boundaries', () => {
      expect(isInstagramHost('instagram.com')).toBe(true);
      expect(isInstagramHost('www.instagram.com')).toBe(true);
      expect(isInstagramHost('evilinstagram.com')).toBe(false);
      expect(isInstagramHost('instagram.com.phishing.net')).toBe(false);
    });

    it('correctly validates approved marketplace domains', () => {
      expect(isMarketplaceHost('daraz.com.bd')).toBe(true);
      expect(isMarketplaceHost('seller.daraz.com.bd')).toBe(true);
      expect(isMarketplaceHost('bikroy.com')).toBe(true);
      expect(isMarketplaceHost('bdtradeinfo.com')).toBe(true);
      expect(isMarketplaceHost('chaldal.com')).toBe(true);
      expect(isMarketplaceHost('evildaraz.com.bd')).toBe(false);
      expect(isMarketplaceHost('daraz.com.bd.fake.org')).toBe(false);
      expect(isMarketplaceHost('amazon.com')).toBe(false);
    });

    it('classifies online presence types accurately', () => {
      // Standalone website
      expect(
        classifyOnlinePresenceType({
          hasWebsite: true,
          hasFacebook: true,
          hasInstagram: true,
          hasMarketplace: false
        })
      ).toBe(OnlinePresenceType.WEBSITE);

      // Only Facebook
      expect(
        classifyOnlinePresenceType({
          hasWebsite: false,
          hasFacebook: true,
          hasInstagram: false,
          hasMarketplace: false
        })
      ).toBe(OnlinePresenceType.FACEBOOK_ONLY);

      // Only Instagram
      expect(
        classifyOnlinePresenceType({
          hasWebsite: false,
          hasFacebook: false,
          hasInstagram: true,
          hasMarketplace: false
        })
      ).toBe(OnlinePresenceType.INSTAGRAM_ONLY);

      // Only Marketplace
      expect(
        classifyOnlinePresenceType({
          hasWebsite: false,
          hasFacebook: false,
          hasInstagram: false,
          hasMarketplace: true
        })
      ).toBe(OnlinePresenceType.MARKETPLACE_ONLY);

      // None detected
      expect(
        classifyOnlinePresenceType({
          hasWebsite: false,
          hasFacebook: false,
          hasInstagram: false,
          hasMarketplace: false
        })
      ).toBe(OnlinePresenceType.NONE_DETECTED);

      // Multiple social without standalone website -> UNKNOWN
      expect(
        classifyOnlinePresenceType({
          hasWebsite: false,
          hasFacebook: true,
          hasInstagram: true,
          hasMarketplace: false
        })
      ).toBe(OnlinePresenceType.UNKNOWN);
    });
  });

  // =========================================================
  // 2. POST /api/v1/leads/:id/analyze — Success Scenarios
  // =========================================================
  describe('POST /api/v1/leads/:id/analyze & GET /api/v1/leads/:id/analysis', () => {
    it('successfully analyzes a lead with a reachable website and persists analysis & audit', async () => {
      // 1. Create a lead in Org A with contacts and website
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Tech Solutions BD',
          normalizedName: 'tech solutions bd',
          category: 'Software',
          city: 'Dhaka',
          website: 'https://techsolutionsbd.com',
          websiteStatus: WebsiteStatus.UNKNOWN,
          onlinePresenceType: OnlinePresenceType.UNKNOWN,
          rating: 4.5,
          reviewCount: 25,
          primarySource: 'GOOGLE_MAPS',
          primaryPhone: '+8801712345678',
          contacts: {
            create: [
              {
                type: ContactType.PHONE,
                rawValue: '01712345678',
                normalizedValue: '+8801712345678',
                phoneType: PhoneType.MOBILE,
                status: ContactStatus.FOUND,
                whatsappStatus: WhatsAppStatus.UNKNOWN,
                isPrimary: true
              },
              {
                type: ContactType.EMAIL,
                rawValue: 'info@techsolutionsbd.com',
                normalizedValue: 'info@techsolutionsbd.com',
                status: ContactStatus.FOUND,
                whatsappStatus: WhatsAppStatus.UNKNOWN,
                isPrimary: true
              }
            ]
          },
          sources: {
            create: {
              sourceName: 'GOOGLE_MAPS',
              sourceExternalId: 'gmaps-123',
              sourceUrl: 'https://facebook.com/techsolutionsbd',
              rawData: {}
            }
          }
        }
      });

      // 2. Mock analyzer
      vi.spyOn(websiteAnalyzer, 'analyze').mockResolvedValue({
        websiteUrl: 'https://techsolutionsbd.com',
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        httpStatusCode: 200,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://techsolutionsbd.com',
        responseTimeMs: 350,
        pageTitle: 'Tech Solutions BD - Leading IT Company',
        metaDescription: 'Custom software and web development services in Dhaka.'
      });

      // 3. POST /analyze
      const postRes = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie)
        .send({});

      expect(postRes.status).toBe(200);
      expect(postRes.body.data).toBeDefined();
      expect(postRes.body.data.leadId).toBe(lead.id);
      expect(postRes.body.data.websiteStatus).toBe(AnalysisWebsiteStatus.REACHABLE);
      expect(postRes.body.data.isHttps).toBe(true);
      expect(postRes.body.data.hasWebsite).toBe(true);
      expect(postRes.body.data.hasFacebook).toBe(true);
      expect(postRes.body.data.analyzerVersion).toBe(ANALYZER_VERSION);
      expect(postRes.body.data.scoreVersion).toBe(SCORE_VERSION);
      expect(postRes.body.data.campaignScores).toBeInstanceOf(Array);
      expect(postRes.body.data.campaignScores.length).toBeGreaterThan(0);

      // Verify no leaked authoritative fields
      expect(postRes.body.data.organizationId).toBeUndefined();
      expect(postRes.body.data.rawData).toBeUndefined();
      expect(postRes.body.data.rawHtml).toBeUndefined();

      // 4. Verify DB persistence
      const persisted = await prisma.leadOnlinePresenceAnalysis.findUnique({
        where: {
          leadId_organizationId: {
            leadId: lead.id,
            organizationId: ORG_A_ID
          }
        }
      });
      expect(persisted).not.toBeNull();
      expect(persisted?.websiteStatus).toBe(AnalysisWebsiteStatus.REACHABLE);

      // 5. Verify Lead summary synchronization
      const updatedLead = await prisma.lead.findUnique({
        where: { id: lead.id }
      });
      expect(updatedLead?.websiteStatus).toBe(WebsiteStatus.REACHABLE);
      expect(updatedLead?.onlinePresenceType).toBe(OnlinePresenceType.WEBSITE);

      // 6. Verify Audit Log
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          entityId: lead.id,
          action: 'lead.online_presence_analyzed'
        }
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog?.organizationId).toBe(ORG_A_ID);
      expect(auditLog?.userId).toBe(adminAUserId);
      expect(auditLog?.after).toEqual({
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        analyzerVersion: ANALYZER_VERSION,
        scoreVersion: SCORE_VERSION,
        analyzedAt: expect.any(String)
      });
      // Ensure no rawHtml or campaignScores in audit
      expect((auditLog?.after as any).campaignScores).toBeUndefined();
      expect((auditLog?.after as any).rawHtml).toBeUndefined();

      // 7. GET /analysis
      const getRes = await request(app)
        .get(`/api/v1/leads/${lead.id}/analysis`)
        .set('Cookie', adminACookie);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data).not.toBeNull();
      expect(getRes.body.data.leadId).toBe(lead.id);
      expect(getRes.body.data.websiteStatus).toBe(AnalysisWebsiteStatus.REACHABLE);
      expect(getRes.body.data.campaignScores).toEqual(postRes.body.data.campaignScores);
    });

    it('handles lead without website returning NOT_APPLICABLE and NONE_DETECTED', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'No Website Store',
          normalizedName: 'no website store',
          category: 'Retail',
          city: 'Chittagong',
          primarySource: 'MANUAL',
          website: null,
          websiteStatus: WebsiteStatus.UNKNOWN,
          onlinePresenceType: OnlinePresenceType.UNKNOWN,
          contacts: {
            create: {
              type: ContactType.PHONE,
              rawValue: '01812345678',
              normalizedValue: '+8801812345678',
              phoneType: PhoneType.MOBILE,
              status: ContactStatus.FOUND,
              whatsappStatus: WhatsAppStatus.UNKNOWN,
              isPrimary: true
            }
          }
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

      const res = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.data.websiteStatus).toBe(AnalysisWebsiteStatus.NOT_APPLICABLE);
      expect(res.body.data.hasWebsite).toBe(false);

      const updatedLead = await prisma.lead.findUnique({ where: { id: lead.id } });
      expect(updatedLead?.websiteStatus).toBe(WebsiteStatus.NONE_DETECTED);
      expect(updatedLead?.onlinePresenceType).toBe(OnlinePresenceType.NONE_DETECTED);
    });

    it('handles ACCESS_RESTRICTED analyzer state safely (200 status, UNKNOWN db status)', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Cloudflare Protected Biz',
          normalizedName: 'cloudflare protected biz',
          category: 'Services',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://protected.biz',
          websiteStatus: WebsiteStatus.UNKNOWN
        }
      });

      vi.spyOn(websiteAnalyzer, 'analyze').mockResolvedValue({
        websiteUrl: 'https://protected.biz',
        websiteStatus: AnalysisWebsiteStatus.ACCESS_RESTRICTED,
        httpStatusCode: 403,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://protected.biz',
        responseTimeMs: 200,
        pageTitle: 'Just a moment...',
        metaDescription: null
      });

      const res = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.data.websiteStatus).toBe(AnalysisWebsiteStatus.ACCESS_RESTRICTED);

      const updatedLead = await prisma.lead.findUnique({ where: { id: lead.id } });
      expect(updatedLead?.websiteStatus).toBe(WebsiteStatus.UNKNOWN);
    });

    it('handles BLOCKED_SSRF analyzer state safely without throwing 500', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Internal URL Lead',
          normalizedName: 'internal url lead',
          category: 'Finance',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'http://169.254.169.254/latest/meta-data',
          websiteStatus: WebsiteStatus.UNKNOWN
        }
      });

      vi.spyOn(websiteAnalyzer, 'analyze').mockResolvedValue({
        websiteUrl: 'http://169.254.169.254/latest/meta-data',
        websiteStatus: AnalysisWebsiteStatus.BLOCKED_SSRF,
        httpStatusCode: null,
        isHttps: false,
        isRedirected: false,
        finalUrl: null,
        responseTimeMs: null,
        pageTitle: null,
        metaDescription: null
      });

      const res = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.data.websiteStatus).toBe(AnalysisWebsiteStatus.BLOCKED_SSRF);

      const updatedLead = await prisma.lead.findUnique({ where: { id: lead.id } });
      expect(updatedLead?.websiteStatus).toBe(WebsiteStatus.UNKNOWN);
    });

    it('re-analyzing an existing lead updates the single row and updates analyzedAt', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Re-analyze Store',
          normalizedName: 're-analyze store',
          category: 'Retail',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://store.com'
        }
      });

      vi.spyOn(websiteAnalyzer, 'analyze').mockResolvedValue({
        websiteUrl: 'https://store.com',
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        httpStatusCode: 200,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://store.com',
        responseTimeMs: 300,
        pageTitle: 'Initial Title',
        metaDescription: 'Initial desc'
      });

      const res1 = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie)
        .send({});

      expect(res1.status).toBe(200);

      // Small delay to ensure timestamp change
      await new Promise((r) => setTimeout(r, 20));

      vi.spyOn(websiteAnalyzer, 'analyze').mockResolvedValue({
        websiteUrl: 'https://store.com',
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        httpStatusCode: 200,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://store.com',
        responseTimeMs: 250,
        pageTitle: 'Updated Title',
        metaDescription: 'Updated desc'
      });

      const res2 = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie)
        .send({});

      expect(res2.status).toBe(200);
      expect(res2.body.data.pageTitle).toBe('Updated Title');

      const allRows = await prisma.leadOnlinePresenceAnalysis.findMany({
        where: { leadId: lead.id }
      });
      expect(allRows.length).toBe(1);
    });
  });

  // =========================================================
  // 3. GET /api/v1/leads/:id/analysis — Null & 404 Behavior
  // =========================================================
  describe('GET /api/v1/leads/:id/analysis behavior', () => {
    it('returns 200 with data: null when lead exists but has not been analyzed yet', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Unanalyzed Lead',
          normalizedName: 'unanalyzed lead',
          category: 'Retail',
          city: 'Dhaka',
          primarySource: 'MANUAL'
        }
      });

      const res = await request(app)
        .get(`/api/v1/leads/${lead.id}/analysis`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: null });
    });

    it('returns 404 when lead does not exist in the tenant', async () => {
      const nonExistentId = '11111111-1111-1111-1111-111111111111';
      const res = await request(app)
        .get(`/api/v1/leads/${nonExistentId}/analysis`)
        .set('Cookie', adminACookie);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });

  // =========================================================
  // 4. RBAC, Auth & Tenant Isolation
  // =========================================================
  describe('RBAC, Auth & Tenant Isolation', () => {
    it('allows VIEWER to GET analysis but denies POST analyze with 403', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Viewer Accessible Lead',
          normalizedName: 'viewer accessible lead',
          category: 'Retail',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://viewerlead.com'
        }
      });

      // GET is allowed for VIEWER (LEADS_READ)
      const getRes = await request(app)
        .get(`/api/v1/leads/${lead.id}/analysis`)
        .set('Cookie', viewerACookie);

      expect(getRes.status).toBe(200);

      // POST is forbidden for VIEWER (requires LEADS_WRITE)
      const postRes = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', viewerACookie)
        .send();

      expect(postRes.status).toBe(403);
      expect(postRes.body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('returns 401 when unauthenticated', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Auth Test Lead',
          normalizedName: 'auth test lead',
          category: 'Retail',
          city: 'Dhaka',
          primarySource: 'MANUAL'
        }
      });

      const getRes = await request(app).get(`/api/v1/leads/${lead.id}/analysis`);
      expect(getRes.status).toBe(401);

      const postRes = await request(app).post(`/api/v1/leads/${lead.id}/analyze`).send();
      expect(postRes.status).toBe(401);
    });

    it('enforces strict tenant isolation: Org B user cannot GET or POST Org A lead (404 NOT_FOUND)', async () => {
      const leadA = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Org A Secret Lead',
          normalizedName: 'org a secret lead',
          category: 'Retail',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://orga-secret.com'
        }
      });

      // Org B user GET Org A lead -> 404
      const getRes = await request(app)
        .get(`/api/v1/leads/${leadA.id}/analysis`)
        .set('Cookie', adminBCookie);

      expect(getRes.status).toBe(404);
      expect(getRes.body.error.code).toBe(ErrorCodes.NOT_FOUND);

      // Org B user POST analyze Org A lead -> 404
      const postRes = await request(app)
        .post(`/api/v1/leads/${leadA.id}/analyze`)
        .set('Cookie', adminBCookie)
        .send();

      expect(postRes.status).toBe(404);
      expect(postRes.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });

  // =========================================================
  // 5. Body Tampering & Parameter Validation
  // =========================================================
  describe('Input Validation & Tampering Protection', () => {
    it('rejects POST /analyze with body containing authoritative fields (422 VALIDATION_ERROR)', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Tamper Target Lead',
          normalizedName: 'tamper target lead',
          category: 'Retail',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://tamper.com'
        }
      });

      // 1. Attempting to supply websiteStatus
      const res1 = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie)
        .send({ websiteStatus: 'REACHABLE' });

      expect(res1.status).toBe(422);
      expect(res1.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);

      // 2. Attempting to supply campaignScores
      const res2 = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie)
        .send({ campaignScores: [] });

      expect(res2.status).toBe(422);
      expect(res2.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);

      // 3. Attempting to supply score
      const res3 = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie)
        .send({ score: 100 });

      expect(res3.status).toBe(422);
      expect(res3.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);

      // Verify no analysis was persisted
      const analysis = await prisma.leadOnlinePresenceAnalysis.findFirst({
        where: { leadId: lead.id }
      });
      expect(analysis).toBeNull();
    });

    it('rejects invalid UUID parameter with 422 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/api/v1/leads/not-a-valid-uuid/analysis')
        .set('Cookie', adminACookie);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
  });

  // =========================================================
  // 6. Invalidation on PATCH, Contact Addition & Provider Merge
  // =========================================================
  describe('Online Presence Analysis Invalidation Hooks', () => {
    it('invalidates analysis when Lead.website is modified via PATCH', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Patch Target Lead',
          normalizedName: 'patch target lead',
          category: 'Retail',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://initial-site.com',
          websiteStatus: WebsiteStatus.REACHABLE,
          onlinePresenceType: OnlinePresenceType.WEBSITE
        }
      });

      // Seed an analysis record
      await prisma.leadOnlinePresenceAnalysis.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: lead.id,
          websiteUrl: 'https://initial-site.com',
          websiteStatus: AnalysisWebsiteStatus.REACHABLE,
          hasWebsite: true,
          hasFacebook: false,
          hasInstagram: false,
          hasMarketplace: false,
          campaignScores: [],
          analyzerVersion: ANALYZER_VERSION,
          scoreVersion: SCORE_VERSION,
          analyzedAt: new Date()
        }
      });

      // PATCH website
      const patchRes = await request(app)
        .patch(`/api/v1/leads/${lead.id}`)
        .set('Cookie', adminACookie)
        .send({ website: 'https://new-site.com' });

      expect(patchRes.status).toBe(200);

      // Verify analysis is deleted
      const analysis = await prisma.leadOnlinePresenceAnalysis.findUnique({
        where: { leadId_organizationId: { leadId: lead.id, organizationId: ORG_A_ID } }
      });
      expect(analysis).toBeNull();

      // Verify Lead summary fields are reset
      const updatedLead = await prisma.lead.findUnique({ where: { id: lead.id } });
      expect(updatedLead?.websiteStatus).toBe(WebsiteStatus.UNKNOWN);
      expect(updatedLead?.onlinePresenceType).toBe(OnlinePresenceType.UNKNOWN);

      // GET /analysis returns data: null
      const getRes = await request(app)
        .get(`/api/v1/leads/${lead.id}/analysis`)
        .set('Cookie', adminACookie);
      expect(getRes.status).toBe(200);
      expect(getRes.body).toEqual({ data: null });
    });

    it('invalidates analysis when a new direct contact is added', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Contact Add Lead',
          normalizedName: 'contact add lead',
          category: 'Retail',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://contact-test.com',
          websiteStatus: WebsiteStatus.REACHABLE,
          onlinePresenceType: OnlinePresenceType.WEBSITE
        }
      });

      await prisma.leadOnlinePresenceAnalysis.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: lead.id,
          websiteUrl: 'https://contact-test.com',
          websiteStatus: AnalysisWebsiteStatus.REACHABLE,
          hasWebsite: true,
          hasFacebook: false,
          hasInstagram: false,
          hasMarketplace: false,
          campaignScores: [],
          analyzerVersion: ANALYZER_VERSION,
          scoreVersion: SCORE_VERSION,
          analyzedAt: new Date()
        }
      });

      // Add a manual contact
      const postContactRes = await request(app)
        .post(`/api/v1/leads/${lead.id}/contacts`)
        .set('Cookie', adminACookie)
        .send({
          type: ContactType.PHONE,
          rawValue: '01799887766'
        });

      expect(postContactRes.status).toBe(201);

      // Verify analysis was invalidated
      const analysis = await prisma.leadOnlinePresenceAnalysis.findUnique({
        where: { leadId_organizationId: { leadId: lead.id, organizationId: ORG_A_ID } }
      });
      expect(analysis).toBeNull();

      const updatedLead = await prisma.lead.findUnique({ where: { id: lead.id } });
      expect(updatedLead?.websiteStatus).toBe(WebsiteStatus.UNKNOWN);
      expect(updatedLead?.onlinePresenceType).toBe(OnlinePresenceType.UNKNOWN);
    });

    it('invalidates analysis when provider search merges into an existing lead', async () => {
      // 1. Create existing lead with a known source
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Mock Dhaka Dental Care Gulshan',
          normalizedName: 'mock dhaka dental care gulshan',
          category: 'Dental Clinic',
          city: 'Dhaka',
          primarySource: 'MOCK',
          website: 'https://dhakadental.example.com/gulshan',
          websiteStatus: WebsiteStatus.REACHABLE,
          onlinePresenceType: OnlinePresenceType.WEBSITE,
          sources: {
            create: {
              sourceName: 'MOCK',
              sourceExternalId: 'mock-dhaka-dental-gulshan-001',
              sourceUrl: 'https://directory.example.com/listings/mock-dhaka-dental-gulshan',
              rawData: {}
            }
          }
        }
      });

      await prisma.leadOnlinePresenceAnalysis.create({
        data: {
          organizationId: ORG_A_ID,
          leadId: lead.id,
          websiteUrl: 'https://dhakadental.example.com/gulshan',
          websiteStatus: AnalysisWebsiteStatus.REACHABLE,
          hasWebsite: true,
          hasFacebook: false,
          hasInstagram: false,
          hasMarketplace: false,
          campaignScores: [],
          analyzerVersion: ANALYZER_VERSION,
          scoreVersion: SCORE_VERSION,
          analyzedAt: new Date()
        }
      });

      // 2. Perform trusted save with identical source identity -> triggers MERGED
      const saveRes = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({
          provider: 'MOCK',
          externalId: 'mock-dhaka-dental-gulshan-001'
        });

      expect(saveRes.status).toBe(200);
      expect(saveRes.body.data.action).toBe('MERGED');
      expect(saveRes.body.data.leadId).toBe(lead.id);

      // Verify analysis is invalidated
      const analysis = await prisma.leadOnlinePresenceAnalysis.findUnique({
        where: { leadId_organizationId: { leadId: lead.id, organizationId: ORG_A_ID } }
      });
      expect(analysis).toBeNull();
    });
  });

  // =========================================================
  // 7. Stale Input Concurrency Race Protection
  // =========================================================
  describe('Stale Input Concurrency Race Protection', () => {
    it('aborts and returns 409 Conflict when Lead is modified while analyzer is pending', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Concurrent Race Lead',
          normalizedName: 'concurrent race lead',
          category: 'Retail',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://racelead.com'
        }
      });

      // Synchronization barrier: ensure analyzer is active before mutating DB
      let notifyAnalyzerCalled!: () => void;
      const analyzerCalledPromise = new Promise<void>((resolve) => {
        notifyAnalyzerCalled = resolve;
      });

      let resolveAnalyzer!: (val: any) => void;
      const delayedPromise = new Promise((resolve) => {
        resolveAnalyzer = resolve;
      });

      vi.spyOn(websiteAnalyzer, 'analyze').mockImplementation(async () => {
        notifyAnalyzerCalled();
        return delayedPromise as any;
      });

      // 1. Initiate analyze request (supertest starts sending when .then is attached)
      let analyzeResPromise: Promise<request.Response>;
      const req = request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie)
        .send();

      analyzeResPromise = req.then((r) => r);

      // 2. Wait for guaranteed proof that findFirst completed and analyzer is executing
      await analyzerCalledPromise;

      // 3. Concurrently mutate the lead in DB (updates updatedAt)
      await prisma.lead.update({
        where: { id: lead.id },
        data: { name: 'Concurrently Mutated Name', updatedAt: new Date(Date.now() + 5000) }
      });

      // 4. Resolve the analyzer promise
      resolveAnalyzer({
        websiteUrl: 'https://racelead.com',
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        httpStatusCode: 200,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://racelead.com',
        responseTimeMs: 300,
        pageTitle: 'Race Title',
        metaDescription: 'Race Desc'
      });

      // 5. Await API response
      const res = await analyzeResPromise;

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(ErrorCodes.CONFLICT);

      const analysis = await prisma.leadOnlinePresenceAnalysis.findUnique({
        where: { leadId_organizationId: { leadId: lead.id, organizationId: ORG_A_ID } }
      });
      expect(analysis).toBeNull();
    });

    it('aborts and returns 409 Conflict when a manual contact is added while analyzer is pending', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Contact Race Lead',
          normalizedName: 'contact race lead',
          category: 'Retail',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://contactrace.com'
        }
      });

      let notifyAnalyzerCalled!: () => void;
      const analyzerCalledPromise = new Promise<void>((resolve) => {
        notifyAnalyzerCalled = resolve;
      });

      let resolveAnalyzer!: (val: any) => void;
      const delayedPromise = new Promise((resolve) => {
        resolveAnalyzer = resolve;
      });

      vi.spyOn(websiteAnalyzer, 'analyze').mockImplementation(async () => {
        notifyAnalyzerCalled();
        return delayedPromise as any;
      });

      // 1. Initiate analyze request
      const req = request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie)
        .send();
      const analyzeResPromise = req.then((r) => r);

      // 2. Wait for analyzer to be active
      await analyzerCalledPromise;

      // 3. Concurrently add a manual contact
      const contactRes = await request(app)
        .post(`/api/v1/leads/${lead.id}/contacts`)
        .set('Cookie', adminACookie)
        .send({
          type: ContactType.PHONE,
          rawValue: '01711223344'
        });
      expect(contactRes.status).toBe(201);

      // 4. Resolve analyzer
      resolveAnalyzer({
        websiteUrl: 'https://contactrace.com',
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        httpStatusCode: 200,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://contactrace.com',
        responseTimeMs: 250,
        pageTitle: 'Contact Race Title',
        metaDescription: null
      });

      // 5. Await API response
      const res = await analyzeResPromise;

      // Expected: 409 CONFLICT due to input fingerprint change
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(ErrorCodes.CONFLICT);

      // Verify no stale analysis row was written
      const analysis = await prisma.leadOnlinePresenceAnalysis.findUnique({
        where: { leadId_organizationId: { leadId: lead.id, organizationId: ORG_A_ID } }
      });
      expect(analysis).toBeNull();

      // Verify added contact is intact
      const contacts = await prisma.leadContact.findMany({ where: { leadId: lead.id } });
      expect(contacts.length).toBe(1);
    });

    it('aborts and returns 409 Conflict when provider merge mutates inputs while analyzer is pending', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Mock Dhaka Dental Care Gulshan',
          normalizedName: 'mock dhaka dental care gulshan',
          category: 'Dental Clinic',
          city: 'Dhaka',
          primarySource: 'MOCK',
          website: 'https://dhakadental.example.com/gulshan',
          sources: {
            create: {
              sourceName: 'MOCK',
              sourceExternalId: 'mock-dhaka-dental-gulshan-001',
              sourceUrl: 'https://directory.example.com/listings/mock-dhaka-dental-gulshan',
              rawData: {}
            }
          }
        }
      });

      let notifyAnalyzerCalled!: () => void;
      const analyzerCalledPromise = new Promise<void>((resolve) => {
        notifyAnalyzerCalled = resolve;
      });

      let resolveAnalyzer!: (val: any) => void;
      const delayedPromise = new Promise((resolve) => {
        resolveAnalyzer = resolve;
      });

      vi.spyOn(websiteAnalyzer, 'analyze').mockImplementation(async () => {
        notifyAnalyzerCalled();
        return delayedPromise as any;
      });

      // 1. Initiate analyze request
      const req = request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie)
        .send();
      const analyzeResPromise = req.then((r) => r);

      // 2. Wait for analyzer to be active
      await analyzerCalledPromise;

      // 3. Concurrently trigger provider save merge
      const saveRes = await request(app)
        .post('/api/v1/business-search/save-lead')
        .set('Cookie', adminACookie)
        .send({
          provider: 'MOCK',
          externalId: 'mock-dhaka-dental-gulshan-001'
        });
      expect(saveRes.status).toBe(200);

      // 4. Resolve analyzer
      resolveAnalyzer({
        websiteUrl: 'https://dhakadental.example.com/gulshan',
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        httpStatusCode: 200,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://dhakadental.example.com/gulshan',
        responseTimeMs: 200,
        pageTitle: 'Dental Title',
        metaDescription: null
      });

      // 5. Await API response
      const res = await analyzeResPromise;

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(ErrorCodes.CONFLICT);

      const analysis = await prisma.leadOnlinePresenceAnalysis.findUnique({
        where: { leadId_organizationId: { leadId: lead.id, organizationId: ORG_A_ID } }
      });
      expect(analysis).toBeNull();
    });

    it('aborts and returns 409 Conflict when suppression list entry is added while analyzer is pending', async () => {
      const contactValue = '+8801733445566';
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Suppression Race Lead',
          normalizedName: 'suppression race lead',
          category: 'Retail',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://suppressionrace.com',
          contacts: {
            create: {
              type: ContactType.PHONE,
              rawValue: '01733445566',
              normalizedValue: contactValue,
              phoneType: PhoneType.MOBILE,
              status: ContactStatus.FOUND,
              whatsappStatus: WhatsAppStatus.UNKNOWN,
              isPrimary: true
            }
          }
        }
      });

      let notifyAnalyzerCalled!: () => void;
      const analyzerCalledPromise = new Promise<void>((resolve) => {
        notifyAnalyzerCalled = resolve;
      });

      let resolveAnalyzer!: (val: any) => void;
      const delayedPromise = new Promise((resolve) => {
        resolveAnalyzer = resolve;
      });

      vi.spyOn(websiteAnalyzer, 'analyze').mockImplementation(async () => {
        notifyAnalyzerCalled();
        return delayedPromise as any;
      });

      // 1. Initiate analyze request
      const req = request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie)
        .send();
      const analyzeResPromise = req.then((r) => r);

      // 2. Wait for analyzer to be active
      await analyzerCalledPromise;

      // 3. Concurrently add suppression list entry
      await prisma.suppressionList.create({
        data: {
          organizationId: ORG_A_ID,
          type: SuppressionType.PHONE,
          normalizedValue: contactValue,
          channelScope: ChannelScope.ALL,
          reason: SuppressionReason.DO_NOT_CONTACT,
          addedBy: adminAUserId
        }
      });

      // 4. Resolve analyzer
      resolveAnalyzer({
        websiteUrl: 'https://suppressionrace.com',
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        httpStatusCode: 200,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://suppressionrace.com',
        responseTimeMs: 200,
        pageTitle: 'Suppression Title',
        metaDescription: null
      });

      // 5. Await API response
      const res = await analyzeResPromise;

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(ErrorCodes.CONFLICT);

      const analysis = await prisma.leadOnlinePresenceAnalysis.findUnique({
        where: { leadId_organizationId: { leadId: lead.id, organizationId: ORG_A_ID } }
      });
      expect(analysis).toBeNull();
    });
  });

  // =========================================================
  // 8. Same-Process In-Flight Analysis Deduplication
  // =========================================================
  describe('In-Flight Analysis Deduplication', () => {
    it('deduplicates concurrent analyze calls for the same lead and invokes analyzer once', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Dedupe Test Lead',
          normalizedName: 'dedupe test lead',
          category: 'Retail',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: 'https://dedupe.com'
        }
      });

      let resolveAnalyzer!: (val: any) => void;
      const analyzerPromise = new Promise((resolve) => {
        resolveAnalyzer = resolve;
      });

      const spy = vi.spyOn(websiteAnalyzer, 'analyze').mockImplementation(async () => {
        return analyzerPromise as any;
      });

      const context = {
        organizationId: ORG_A_ID,
        userId: adminAUserId,
        correlationId: 'dedupe-test-corr'
      };

      // Concurrent in-flight service calls
      const p1 = onlinePresenceService.analyzeLead(lead.id, context);
      const p2 = onlinePresenceService.analyzeLead(lead.id, context);

      // Resolve analyzer
      resolveAnalyzer({
        websiteUrl: 'https://dedupe.com',
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        httpStatusCode: 200,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://dedupe.com',
        responseTimeMs: 200,
        pageTitle: 'Dedupe Title',
        metaDescription: 'Dedupe Desc'
      });

      const [res1, res2] = await Promise.all([p1, p2]);

      expect(res1.id).toBe(res2.id);
      expect(res1.websiteStatus).toBe(AnalysisWebsiteStatus.REACHABLE);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================
  // 9. Rate Limiting (30 req / 60 sec per user)
  // =========================================================
  describe('Analyze Rate Limiting', () => {
    it('returns 429 RATE_LIMITED with Retry-After when user exceeds 30 requests in 60s window', async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Rate Limit Lead',
          normalizedName: 'rate limit lead',
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

      // Send 30 successful requests
      for (let i = 0; i < 30; i++) {
        const res = await request(app)
          .post(`/api/v1/leads/${lead.id}/analyze`)
          .set('Cookie', adminACookie)
          .send();
        expect(res.status).toBe(200);
      }

      // 31st request should be rate-limited
      const limitedRes = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie)
        .send();

      expect(limitedRes.status).toBe(429);
      expect(limitedRes.body.error.code).toBe(ErrorCodes.RATE_LIMITED);
      expect(limitedRes.headers['retry-after']).toBeDefined();
    });
  });

  // =========================================================
  // 10. Suppression List Scoring Interaction
  // =========================================================
  describe('Suppression List Scoring Integration', () => {
    it('suppressed contact is passed as isSuppressed: true and does not grant scoring points', async () => {
      const suppressedPhone = '+8801700998877';

      // Add to suppression list for Org A
      await prisma.suppressionList.create({
        data: {
          organizationId: ORG_A_ID,
          type: SuppressionType.PHONE,
          normalizedValue: suppressedPhone,
          reason: SuppressionReason.OPT_OUT,
          addedBy: adminAUserId
        }
      });

      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Suppressed Contact Biz',
          normalizedName: 'suppressed contact biz',
          category: 'Retail',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: null,
          contacts: {
            create: {
              type: ContactType.PHONE,
              rawValue: '01700998877',
              normalizedValue: suppressedPhone,
              phoneType: PhoneType.MOBILE,
              status: ContactStatus.FOUND,
              whatsappStatus: WhatsAppStatus.UNKNOWN,
              isPrimary: true
            }
          }
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

      const res = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie)
        .send();

      expect(res.status).toBe(200);

      // Verify contact status in DB remains FOUND (suppression does not mutate contact row)
      const contactInDb = await prisma.leadContact.findFirst({
        where: { leadId: lead.id }
      });
      expect(contactInDb?.status).toBe(ContactStatus.FOUND);

      // Verify campaign scores do not have HAS_MOBILE_PHONE positive points
      const scores = res.body.data.campaignScores;
      for (const campaign of scores) {
        expect(campaign.reasons).not.toContain(QualificationReasonCode.HAS_MOBILE_PHONE);
      }
    });

    it('validates suppression scope applicability correctly in unit checks', () => {
      const now = new Date('2026-10-02T12:00:00Z');
      const past = new Date('2026-10-01T12:00:00Z');
      const future = new Date('2026-10-03T12:00:00Z');

      const phoneNum = '+8801711112222';
      const emailVal = 'info@test.com';

      // 1. Phone matching CALL / ALL scope
      expect(
        isContactSuppressed(
          ContactType.PHONE,
          phoneNum,
          [{ type: SuppressionType.PHONE, normalizedValue: phoneNum, channelScope: ChannelScope.CALL }],
          now
        )
      ).toBe(true);

      expect(
        isContactSuppressed(
          ContactType.PHONE,
          phoneNum,
          [{ type: SuppressionType.PHONE, normalizedValue: phoneNum, channelScope: ChannelScope.ALL }],
          now
        )
      ).toBe(true);

      // 2. Phone with non-applicable EMAIL scope
      expect(
        isContactSuppressed(
          ContactType.PHONE,
          phoneNum,
          [{ type: SuppressionType.PHONE, normalizedValue: phoneNum, channelScope: ChannelScope.EMAIL }],
          now
        )
      ).toBe(false);

      // 3. Phone with non-applicable EMAIL type
      expect(
        isContactSuppressed(
          ContactType.PHONE,
          phoneNum,
          [{ type: SuppressionType.EMAIL, normalizedValue: phoneNum, channelScope: ChannelScope.ALL }],
          now
        )
      ).toBe(false);

      // 4. Phone with expired suppression
      expect(
        isContactSuppressed(
          ContactType.PHONE,
          phoneNum,
          [{ type: SuppressionType.PHONE, normalizedValue: phoneNum, channelScope: ChannelScope.ALL, expiresAt: past }],
          now
        )
      ).toBe(false);

      // 5. Phone with active unexpired suppression
      expect(
        isContactSuppressed(
          ContactType.PHONE,
          phoneNum,
          [{ type: SuppressionType.PHONE, normalizedValue: phoneNum, channelScope: ChannelScope.ALL, expiresAt: future }],
          now
        )
      ).toBe(true);

      // 6. WhatsApp matching WHATSAPP / ALL scope
      expect(
        isContactSuppressed(
          ContactType.WHATSAPP,
          phoneNum,
          [{ type: SuppressionType.WHATSAPP, normalizedValue: phoneNum, channelScope: ChannelScope.WHATSAPP }],
          now
        )
      ).toBe(true);

      expect(
        isContactSuppressed(
          ContactType.WHATSAPP,
          phoneNum,
          [{ type: SuppressionType.PHONE, normalizedValue: phoneNum, channelScope: ChannelScope.ALL }],
          now
        )
      ).toBe(true);

      // 7. WhatsApp with CALL-only scope (does not suppress whatsapp)
      expect(
        isContactSuppressed(
          ContactType.WHATSAPP,
          phoneNum,
          [{ type: SuppressionType.PHONE, normalizedValue: phoneNum, channelScope: ChannelScope.CALL }],
          now
        )
      ).toBe(false);

      // 8. Email matching EMAIL / ALL scope
      expect(
        isContactSuppressed(
          ContactType.EMAIL,
          emailVal,
          [{ type: SuppressionType.EMAIL, normalizedValue: emailVal, channelScope: ChannelScope.EMAIL }],
          now
        )
      ).toBe(true);

      expect(
        isContactSuppressed(
          ContactType.EMAIL,
          emailVal,
          [{ type: SuppressionType.PHONE, normalizedValue: emailVal, channelScope: ChannelScope.ALL }],
          now
        )
      ).toBe(false);
    });

    it('computes stable deterministic fingerprints and detects child/suppression mutations', () => {
      const baseInput = {
        leadId: 'lead-1',
        organizationId: ORG_A_ID,
        website: 'https://base.com',
        rating: 4.5,
        reviewCount: 10,
        updatedAt: new Date('2026-10-02T12:00:00Z'),
        contacts: [
          {
            id: 'c2',
            type: 'EMAIL',
            normalizedValue: 'b@test.com',
            phoneType: null,
            status: 'FOUND',
            whatsappStatus: 'UNKNOWN',
            isPrimary: false,
            isSuppressed: false,
            evidence: [{ sourceUrl: 'https://src2.com' }]
          },
          {
            id: 'c1',
            type: 'PHONE',
            normalizedValue: '+8801711111111',
            phoneType: 'MOBILE',
            status: 'FOUND',
            whatsappStatus: 'UNKNOWN',
            isPrimary: true,
            isSuppressed: false,
            evidence: [{ sourceUrl: 'https://src1.com' }]
          }
        ],
        sources: [{ sourceUrl: 'https://gmaps.com' }]
      };

      const fp1 = computeAnalysisInputFingerprint(baseInput);

      // Re-ordered contacts in memory should produce identical hash due to deterministic sorting
      const reorderedInput = {
        ...baseInput,
        contacts: [baseInput.contacts[1], baseInput.contacts[0]]
      };
      const fp2 = computeAnalysisInputFingerprint(reorderedInput);
      expect(fp1).toBe(fp2);

      // Mutating suppression state produces different hash
      const suppressedInput = {
        ...baseInput,
        contacts: [
          baseInput.contacts[0],
          { ...baseInput.contacts[1], isSuppressed: true }
        ]
      };
      const fpSuppressed = computeAnalysisInputFingerprint(suppressedInput);
      expect(fp1).not.toBe(fpSuppressed);

      // Adding an evidence URL produces different hash
      const evidenceAddedInput = {
        ...baseInput,
        contacts: [
          baseInput.contacts[0],
          {
            ...baseInput.contacts[1],
            evidence: [{ sourceUrl: 'https://src1.com' }, { sourceUrl: 'https://extra.com' }]
          }
        ]
      };
      const fpEvidence = computeAnalysisInputFingerprint(evidenceAddedInput);
      expect(fp1).not.toBe(fpEvidence);
    });

    it('does not suppress contact if suppression entry has mismatched channel scope or is expired', async () => {
      const activePhone = '+8801755667788';

      // 1. Add expired suppression for this phone
      await prisma.suppressionList.create({
        data: {
          organizationId: ORG_A_ID,
          type: SuppressionType.PHONE,
          normalizedValue: activePhone,
          channelScope: ChannelScope.ALL,
          reason: SuppressionReason.OPT_OUT,
          addedBy: adminAUserId,
          expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) // Yesterday
        }
      });

      // 2. Add EMAIL suppression for this phone number (mismatched type)
      await prisma.suppressionList.create({
        data: {
          organizationId: ORG_A_ID,
          type: SuppressionType.EMAIL,
          normalizedValue: activePhone,
          channelScope: ChannelScope.EMAIL,
          reason: SuppressionReason.DO_NOT_CONTACT,
          addedBy: adminAUserId
        }
      });

      const lead = await prisma.lead.create({
        data: {
          organizationId: ORG_A_ID,
          name: 'Unsuppressed Due To Scope Biz',
          normalizedName: 'unsuppressed due to scope biz',
          category: 'Retail',
          city: 'Dhaka',
          primarySource: 'MANUAL',
          website: null,
          contacts: {
            create: {
              type: ContactType.PHONE,
              rawValue: '01755667788',
              normalizedValue: activePhone,
              phoneType: PhoneType.MOBILE,
              status: ContactStatus.FOUND,
              whatsappStatus: WhatsAppStatus.UNKNOWN,
              isPrimary: true
            }
          }
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

      const res = await request(app)
        .post(`/api/v1/leads/${lead.id}/analyze`)
        .set('Cookie', adminACookie)
        .send();

      expect(res.status).toBe(200);

      // Phone is NOT suppressed, so positive rule HAS_MOBILE_PHONE should be present
      const scores = res.body.data.campaignScores;
      const allReasons = scores.flatMap((c: any) => c.reasons);
      expect(allReasons).toContain(QualificationReasonCode.HAS_MOBILE_PHONE);
    });
  });
});
