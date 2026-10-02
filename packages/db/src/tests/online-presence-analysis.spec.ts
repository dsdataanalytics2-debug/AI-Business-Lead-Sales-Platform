import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma, {
  AnalysisWebsiteStatus,
  WebsiteStatus,
  OnlinePresenceType
} from '../index.js';
import { ensureTestDatabase } from '../test-guard.js';

describe('M2 Step 3: LeadOnlinePresenceAnalysis Database Model Verification', () => {
  const orgAId = '00000000-0000-0000-0000-00000000000a';
  const orgBId = '00000000-0000-0000-0000-00000000000b';

  let leadAId: string;
  let leadBId: string;

  beforeAll(async () => {
    await ensureTestDatabase(prisma);

    // Upsert Org A and Org B
    await prisma.organization.upsert({
      where: { id: orgAId },
      update: {},
      create: {
        id: orgAId,
        name: 'Organization A',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.organization.upsert({
      where: { id: orgBId },
      update: {},
      create: {
        id: orgBId,
        name: 'Organization B',
        timezone: 'Asia/Dhaka'
      }
    });

    // Create Lead A in Org A
    const leadA = await prisma.lead.create({
      data: {
        organizationId: orgAId,
        name: 'Dhanmondi Tech House',
        normalizedName: 'dhanmondi tech house',
        category: 'Software Agency',
        city: 'Dhaka',
        primarySource: 'MOCK_SEARCH',
        website: 'https://dhanmonditech.com',
        normalizedWebsite: 'dhanmonditech.com',
        websiteStatus: WebsiteStatus.REACHABLE,
        onlinePresenceType: OnlinePresenceType.WEBSITE
      }
    });
    leadAId = leadA.id;

    // Create Lead B in Org B
    const leadB = await prisma.lead.create({
      data: {
        organizationId: orgBId,
        name: 'Uttara Fashion',
        normalizedName: 'uttara fashion',
        category: 'Clothing Store',
        city: 'Dhaka',
        primarySource: 'MOCK_SEARCH',
        websiteStatus: WebsiteStatus.NONE_DETECTED,
        onlinePresenceType: OnlinePresenceType.FACEBOOK_ONLY
      }
    });
    leadBId = leadB.id;
  });

  afterAll(async () => {
    try {
      await ensureTestDatabase(prisma);
      await prisma.leadOnlinePresenceAnalysis.deleteMany({
        where: { organizationId: { in: [orgAId, orgBId] } }
      }).catch(() => {});

      await prisma.lead.deleteMany({
        where: { organizationId: { in: [orgAId, orgBId] } }
      }).catch(() => {});

      await prisma.organization.deleteMany({
        where: { id: { in: [orgAId, orgBId] } }
      }).catch(() => {});
    } finally {
      await prisma.$disconnect();
    }
  });

  it('1. Successfully creates LeadOnlinePresenceAnalysis row with full fields and campaignScores JSON', async () => {
    const campaignScores = [
      {
        campaignType: 'WEBSITE_ACQUISITION',
        score: 85,
        reasons: ['HAS_WEBSITE', 'WEBSITE_REACHABLE', 'VALID_EMAIL']
      },
      {
        campaignType: 'WHATSAPP_GROWTH',
        score: 70,
        reasons: ['HAS_WHATSAPP']
      }
    ];

    const analysis = await prisma.leadOnlinePresenceAnalysis.create({
      data: {
        organizationId: orgAId,
        leadId: leadAId,
        websiteUrl: 'https://dhanmonditech.com',
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        httpStatusCode: 200,
        isHttps: true,
        isRedirected: false,
        finalUrl: 'https://dhanmonditech.com',
        responseTimeMs: 340,
        pageTitle: 'Dhanmondi Tech — Premier Software Agency',
        metaDescription: 'Custom web development and AI solutions in Dhaka.',
        hasWebsite: true,
        hasFacebook: false,
        hasInstagram: false,
        hasMarketplace: false,
        campaignScores,
        analyzerVersion: 'v1',
        scoreVersion: 'v1'
      }
    });

    expect(analysis.id).toBeDefined();
    expect(analysis.organizationId).toBe(orgAId);
    expect(analysis.leadId).toBe(leadAId);
    expect(analysis.websiteStatus).toBe(AnalysisWebsiteStatus.REACHABLE);
    expect(analysis.httpStatusCode).toBe(200);
    expect(analysis.isHttps).toBe(true);
    expect(analysis.isRedirected).toBe(false);
    expect(analysis.pageTitle).toBe('Dhanmondi Tech — Premier Software Agency');
    expect(analysis.metaDescription).toBe('Custom web development and AI solutions in Dhaka.');
    expect(analysis.hasWebsite).toBe(true);
    expect(analysis.campaignScores).toEqual(campaignScores);
    expect(analysis.analyzerVersion).toBe('v1');
    expect(analysis.scoreVersion).toBe('v1');
    expect(analysis.analyzedAt).toBeInstanceOf(Date);
  });

  it('2. Reads analysis via composite key and via Lead reverse relation', async () => {
    // Read by composite unique key
    const analysis = await prisma.leadOnlinePresenceAnalysis.findUnique({
      where: {
        leadId_organizationId: {
          leadId: leadAId,
          organizationId: orgAId
        }
      }
    });

    expect(analysis).not.toBeNull();
    expect(analysis?.pageTitle).toBe('Dhanmondi Tech — Premier Software Agency');

    // Read through Lead relation
    const leadWithAnalysis = await prisma.lead.findUnique({
      where: { id: leadAId },
      include: { onlinePresenceAnalysis: true }
    });

    expect(leadWithAnalysis?.onlinePresenceAnalysis).not.toBeNull();
    expect(leadWithAnalysis?.onlinePresenceAnalysis?.websiteStatus).toBe(AnalysisWebsiteStatus.REACHABLE);
  });

  it('3. Successfully updates an existing LeadOnlinePresenceAnalysis row', async () => {
    const updated = await prisma.leadOnlinePresenceAnalysis.update({
      where: {
        leadId_organizationId: {
          leadId: leadAId,
          organizationId: orgAId
        }
      },
      data: {
        responseTimeMs: 280,
        metaDescription: 'Updated meta description for testing.'
      }
    });

    expect(updated.responseTimeMs).toBe(280);
    expect(updated.metaDescription).toBe('Updated meta description for testing.');
  });

  it('4. Handles optional/nullable metadata fields correctly', async () => {
    // Create Lead in Org A with minimal analysis (e.g. NOT_APPLICABLE)
    const minimalLead = await prisma.lead.create({
      data: {
        organizationId: orgAId,
        name: 'Local Street Vendor',
        normalizedName: 'local street vendor',
        category: 'Street Vendor',
        city: 'Dhaka',
        primarySource: 'MOCK_SEARCH'
      }
    });

    const minimalAnalysis = await prisma.leadOnlinePresenceAnalysis.create({
      data: {
        organizationId: orgAId,
        leadId: minimalLead.id,
        websiteUrl: null,
        websiteStatus: AnalysisWebsiteStatus.NOT_APPLICABLE,
        httpStatusCode: null,
        isHttps: false,
        isRedirected: false,
        finalUrl: null,
        responseTimeMs: null,
        pageTitle: null,
        metaDescription: null,
        hasWebsite: false,
        hasFacebook: false,
        hasInstagram: false,
        hasMarketplace: false,
        campaignScores: []
      }
    });

    expect(minimalAnalysis.websiteUrl).toBeNull();
    expect(minimalAnalysis.websiteStatus).toBe(AnalysisWebsiteStatus.NOT_APPLICABLE);
    expect(minimalAnalysis.httpStatusCode).toBeNull();
    expect(minimalAnalysis.finalUrl).toBeNull();
    expect(minimalAnalysis.responseTimeMs).toBeNull();
    expect(minimalAnalysis.pageTitle).toBeNull();
    expect(minimalAnalysis.metaDescription).toBeNull();
  });

  it('5. Rejects duplicate row creation for same (organizationId, leadId) via unique constraint', async () => {
    let duplicateError: any = null;

    try {
      await prisma.leadOnlinePresenceAnalysis.create({
        data: {
          organizationId: orgAId,
          leadId: leadAId,
          websiteStatus: AnalysisWebsiteStatus.REACHABLE,
          campaignScores: []
        }
      });
    } catch (err) {
      duplicateError = err;
    }

    expect(duplicateError).toBeDefined();
    // Prisma P2002 indicates unique constraint violation
    expect(duplicateError.code).toBe('P2002');
  });

  it('6. Cross-org tenant isolation: rejects analysis referencing Lead B with Org A organizationId', async () => {
    // Attempting to attach Lead B (which belongs to Org B) using Org A organizationId
    // Composite foreign key (lead_id, organization_id) -> leads(id, organization_id) MUST reject this
    let crossOrgError: any = null;

    try {
      await prisma.leadOnlinePresenceAnalysis.create({
        data: {
          organizationId: orgAId, // Org A
          leadId: leadBId, // Lead B (belongs to Org B)
          websiteStatus: AnalysisWebsiteStatus.REACHABLE,
          campaignScores: []
        }
      });
    } catch (err) {
      crossOrgError = err;
    }

    expect(crossOrgError).toBeDefined();
    // Prisma P2003 indicates foreign key constraint violation
    expect(crossOrgError.code).toBe('P2003');
  });

  it('7. Cascade delete: deleting Lead cascades and deletes its LeadOnlinePresenceAnalysis', async () => {
    const tempLead = await prisma.lead.create({
      data: {
        organizationId: orgAId,
        name: 'Temporary Dental Care',
        normalizedName: 'temporary dental care',
        category: 'Dental',
        city: 'Dhaka',
        primarySource: 'TEST'
      }
    });

    const analysis = await prisma.leadOnlinePresenceAnalysis.create({
      data: {
        organizationId: orgAId,
        leadId: tempLead.id,
        websiteStatus: AnalysisWebsiteStatus.REACHABLE,
        campaignScores: []
      }
    });

    const analysisId = analysis.id;

    // Delete lead
    await prisma.lead.delete({
      where: { id: tempLead.id }
    });

    // Verify analysis is deleted
    const check = await prisma.leadOnlinePresenceAnalysis.findUnique({
      where: { id: analysisId }
    });

    expect(check).toBeNull();
  });
});
