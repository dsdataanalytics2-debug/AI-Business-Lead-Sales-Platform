import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '@leadmate/db';
import { demoWebsiteService } from '../services/demo-website.service.js';
import { campaignService } from '../services/campaign.service.js';
import { leadService } from '../services/lead.service.js';
import {
  CrmStage,
  OutreachChannel
} from '@leadmate/shared';

describe('Fast-Track Backend Services: Demos, Campaigns, & CRM Pipeline', () => {
  const orgId = '00000000-0000-0000-0000-00000000000a';
  const userId = '00000000-0000-0000-0000-000000000001';

  let testLeadId: string;

  beforeAll(async () => {
    await prisma.organization.upsert({
      where: { id: orgId },
      update: {},
      create: {
        id: orgId,
        name: 'Fast Track Org',
        timezone: 'Asia/Dhaka'
      }
    });

    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        email: 'user-fast-track@leadatlas.local',
        passwordHash: 'dummyhash',
        name: 'Fast Track User',
        role: 'ADMIN',
        organizationId: orgId,
        isActive: true
      }
    });
  });

  beforeEach(async () => {
    // Find an existing lead in test database for this org
    const lead = await prisma.lead.findFirst({
      where: { organizationId: orgId }
    });

    if (lead) {
      testLeadId = lead.id;
    } else {
      const created = await prisma.lead.create({
        data: {
          organizationId: orgId,
          name: 'Fast Track Dental Care',
          normalizedName: 'fast track dental care',
          category: 'Dental Clinic',
          city: 'Dhaka',
          country: 'BD',
          primarySource: 'MOCK',
          crmStage: CrmStage.NEW
        }
      });
      testLeadId = created.id;
    }
  });

  it('1. Demo Website Service: Lists organization demo catalog with lead details', async () => {
    const demos = await demoWebsiteService.listDemoWebsites({
      organizationId: orgId,
      userId
    });

    expect(Array.isArray(demos)).toBe(true);
    // If demos exist, verify structure
    if (demos.length > 0) {
      const demo = demos[0];
      expect(demo.id).toBeDefined();
      expect(demo.leadId).toBeDefined();
      expect(demo.businessName).toBeDefined();
      expect(demo.status).toBeDefined();
    }
  });

  it('2. Campaign Service: Lists and creates outreach campaigns without external sends', async () => {
    const initialCampaigns = await campaignService.listCampaigns(orgId);
    expect(Array.isArray(initialCampaigns)).toBe(true);
    expect(initialCampaigns.length).toBeGreaterThanOrEqual(1);

    // Create a new campaign for test lead
    const created = await campaignService.createCampaign(orgId, userId, {
      name: 'Spring 2026 Dentist Outreach',
      channel: OutreachChannel.WHATSAPP,
      leadIds: [testLeadId]
    });

    expect(created.name).toBe('Spring 2026 Dentist Outreach');
    expect(created.channel).toBe(OutreachChannel.WHATSAPP);
    expect(created.leadCount).toBe(1);
    expect(created.status).toBe('DRAFT');
    // Invariant: zero automatic sends
    expect(created.sentCount).toBe(0);
  });

  it('3. CRM Pipeline: Updates lead stage through existing service and preserves CrmStage enum', async () => {
    const updateResult = await leadService.updateCrmStage(
      testLeadId,
      { stage: CrmStage.QUALIFIED },
      {
        organizationId: orgId,
        userId,
        correlationId: 'test-crm-stage'
      }
    );

    expect(updateResult.crmStage).toBe(CrmStage.QUALIFIED);

    // Verify lead listing includes crmStage
    const listRes = await leadService.listLeads(
      { crmStage: CrmStage.QUALIFIED, limit: 10 },
      {
        organizationId: orgId,
        userId,
        correlationId: 'test-list-leads'
      }
    );

    expect(listRes.data.some((l) => l.id === testLeadId)).toBe(true);

  });
});
