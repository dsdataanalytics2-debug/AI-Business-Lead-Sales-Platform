/**
 * Campaign Orchestration Service
 *
 * Coordinates multi-lead outreach campaigns built on existing M5 (AI Sales Assistant)
 * and M6 (Automated Delivery) infrastructure.
 *
 * INVARIANTS:
 * - approval != dispatch: Human approval of drafts NEVER automatically sends.
 * - Zero real external sends in automated tests.
 * - Strict multi-tenancy: All operations filtered by organizationId.
 * - Reuses existing SalesAssistantDraft and OutreachDelivery entities.
 */

import { prisma } from '@leadmate/db';
import {
  OutreachChannel,
  SalesAssistantDraftType,
  SalesAssistantDraftStatus,
  SalesAssistantLanguage,
  SalesAssistantTone,
  OutreachDeliveryStatus
} from '@leadmate/shared';
import type {
  CampaignSummary,
  CampaignStatus,
  CreateCampaignRequest
} from '@leadmate/shared';
import { salesAssistantService } from './sales-assistant.service.js';
import { BadRequestError } from '../lib/errors.js';


export class CampaignService {
  /**
   * Lists campaigns for an organization, aggregating metrics from existing drafts and deliveries.
   */
  async listCampaigns(organizationId: string): Promise<CampaignSummary[]> {
    // 1. Fetch all drafts with their associated outreach deliveries for this org
    const drafts = await prisma.salesAssistantDraft.findMany({
      where: { organizationId },
      include: {
        outreachDeliveries: true,
        lead: {
          select: { id: true, name: true, city: true, category: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Group drafts by objective or fallback campaign name
    const campaignGroups = new Map<string, {
      name: string;
      channel: OutreachChannel;
      drafts: typeof drafts;
      createdAt: Date;
      updatedAt: Date;
    }>();

    for (const draft of drafts) {
      const campName = draft.objective || (
        draft.type === SalesAssistantDraftType.WHATSAPP
          ? 'WhatsApp Direct Acquisition'
          : 'Email Professional Outreach'
      );

      const channel =
        draft.type === SalesAssistantDraftType.WHATSAPP
          ? OutreachChannel.WHATSAPP
          : OutreachChannel.EMAIL;

      if (!campaignGroups.has(campName)) {
        campaignGroups.set(campName, {
          name: campName,
          channel,
          drafts: [],
          createdAt: draft.createdAt,
          updatedAt: draft.updatedAt
        });
      }

      const group = campaignGroups.get(campName)!;
      group.drafts.push(draft);
      if (draft.createdAt < group.createdAt) group.createdAt = draft.createdAt;
      if (draft.updatedAt > group.updatedAt) group.updatedAt = draft.updatedAt;
    }

    const result: CampaignSummary[] = [];

    for (const [key, group] of campaignGroups.entries()) {
      const distinctLeads = new Set(group.drafts.map((d) => d.leadId));
      const draftCount = group.drafts.length;
      const approvedCount = group.drafts.filter(
        (d) => d.status === SalesAssistantDraftStatus.APPROVED
      ).length;

      let sentCount = 0;
      let failedCount = 0;

      for (const d of group.drafts) {
        for (const del of d.outreachDeliveries) {
          if (
            del.status === OutreachDeliveryStatus.SENT ||
            del.status === OutreachDeliveryStatus.DELIVERED
          ) {
            sentCount++;
          } else if (del.status === OutreachDeliveryStatus.FAILED) {
            failedCount++;
          }
        }
      }

      let status: CampaignStatus = 'DRAFT';
      if (sentCount > 0 && sentCount >= approvedCount && approvedCount > 0) {
        status = 'COMPLETED';
      } else if (sentCount > 0) {
        status = 'ACTIVE';
      } else if (approvedCount > 0) {
        status = 'READY';
      }

      // Generate stable deterministic ID from campaign name
      const id = Buffer.from(key).toString('base64url').slice(0, 32);

      result.push({
        id,
        name: group.name,
        status,
        channel: group.channel,
        leadCount: distinctLeads.size,
        draftCount,
        approvedCount,
        sentCount,
        failedCount,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt
      });
    }

    // If no custom campaigns have been run yet, show the standard default campaign overview
    if (result.length === 0) {
      const totalLeads = await prisma.lead.count({ where: { organizationId } });

      result.push({
        id: 'default-web-acquisition',
        name: 'Website Acquisition & StoreMate Outreach',
        status: 'DRAFT',
        channel: OutreachChannel.WHATSAPP,
        leadCount: totalLeads,
        draftCount: 0,
        approvedCount: 0,
        sentCount: 0,
        failedCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    return result;
  }

  /**
   * Creates a new campaign batch for selected leads, generating initial AI drafts.
   */
  async createCampaign(
    organizationId: string,
    userId: string,
    input: CreateCampaignRequest
  ): Promise<CampaignSummary> {
    const { name, channel, leadIds } = input;

    if (!leadIds || leadIds.length === 0) {
      throw new BadRequestError('At least one lead is required to create a campaign');
    }

    // Verify leads belong to organization
    const leads = await prisma.lead.findMany({
      where: {
        id: { in: leadIds },
        organizationId
      }
    });

    if (leads.length === 0) {
      throw new BadRequestError('No valid leads found in this organization');
    }

    const draftType =
      channel === OutreachChannel.WHATSAPP
        ? SalesAssistantDraftType.WHATSAPP
        : SalesAssistantDraftType.EMAIL;

    // Generate AI draft for each selected lead using existing M5 sales assistant service
    for (const lead of leads) {
      try {
        await salesAssistantService.generateDraft(
          {
            organizationId,
            userId,
            correlationId: `camp-${Date.now()}`
          },
          lead.id,
          {
            type: draftType,
            language: SalesAssistantLanguage.BANGLA,
            tone: SalesAssistantTone.PROFESSIONAL,
            objective: name
          }
        );
      } catch {
        // Continue generating for remaining leads if one fails
      }
    }

    return {
      id: Buffer.from(name).toString('base64url').slice(0, 32),
      name,
      status: 'DRAFT',
      channel,
      leadCount: leads.length,
      draftCount: leads.length,
      approvedCount: 0,
      sentCount: 0,
      failedCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

export const campaignService = new CampaignService();
