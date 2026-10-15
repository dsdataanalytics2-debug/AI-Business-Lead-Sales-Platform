import prisma from '@leadmate/db';
import {
  checkSuppression,
  type SuppressionMatchResult,
  type SuppressionRecordCandidate
} from '@leadmate/core';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import type { CreateSuppressionInput } from '@leadmate/shared';

export interface SuppressionRequestContext {
  organizationId: string;
  userId?: string;
  correlationId?: string;
}

export class SuppressionService {
  /**
   * Checks whether a buyer is suppressed in the organization.
   */
  async checkBuyerSuppression(
    buyer: {
      id?: string;
      phone?: string | null;
      email?: string | null;
      website?: string | null;
      businessName?: string | null;
      locality?: string | null;
      city?: string | null;
    },
    organizationId: string
  ): Promise<SuppressionMatchResult> {
    const records = await prisma.suppressionRecord.findMany({
      where: { organizationId }
    });

    const candidates: SuppressionRecordCandidate[] = records.map((r) => ({
      id: r.id,
      phone: r.phone,
      email: r.email,
      domain: r.domain,
      salesMissionBuyerId: r.salesMissionBuyerId,
      reason: r.reason
    }));

    return checkSuppression(buyer, candidates);
  }

  /**
   * Creates an organization-scoped suppression record.
   */
  async createSuppression(
    input: CreateSuppressionInput,
    context: SuppressionRequestContext
  ) {
    if (!input.phone && !input.email && !input.domain && !input.salesMissionBuyerId) {
      throw new BadRequestError('At least one suppression key (phone, email, domain, or salesMissionBuyerId) must be provided.');
    }

    const created = await prisma.suppressionRecord.create({
      data: {
        organizationId: context.organizationId,
        reason: input.reason,
        source: input.source,
        phone: input.phone || null,
        email: input.email ? input.email.trim().toLowerCase() : null,
        domain: input.domain ? input.domain.trim().toLowerCase() : null,
        salesMissionBuyerId: input.salesMissionBuyerId || null,
        metadata: {
          createdByUserId: context.userId,
          createdAt: new Date().toISOString()
        }
      }
    });

    return created;
  }

  /**
   * Lists all suppression records for an organization.
   */
  async listSuppressionRecords(organizationId: string) {
    return prisma.suppressionRecord.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' }
    });
  }
}

export const suppressionService = new SuppressionService();
