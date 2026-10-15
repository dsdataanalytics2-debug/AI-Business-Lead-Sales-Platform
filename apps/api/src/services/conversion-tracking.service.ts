import prisma from '@leadmate/db';
import {
  type TransitionStageInput,
  type SalesMissionBuyerDto
} from '@leadmate/shared';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { salesMissionService } from './sales-mission.service.js';

export interface ConversionRequestContext {
  organizationId: string;
  userId: string;
  correlationId?: string;
}

export class ConversionTrackingService {
  /**
   * Transitions a buyer to a new conversion lifecycle stage.
   * Enforces strict commercial evidence for WON and standardized loss reason for LOST.
   */
  async transitionStage(
    salesMissionBuyerId: string,
    input: TransitionStageInput,
    context: ConversionRequestContext
  ) {
    const buyer = await prisma.salesMissionBuyer.findFirst({
      where: {
        id: salesMissionBuyerId,
        organizationId: context.organizationId
      }
    });

    if (!buyer) {
      throw new NotFoundError(`SalesMissionBuyer "${salesMissionBuyerId}" not found.`);
    }

    const targetStage = input.stage;

    // 1. STRICT WON INVARIANT: Commercial evidence strictly required
    if (targetStage === 'WON') {
      if (!input.wonEvidence) {
        throw new BadRequestError(
          'Stage transition to WON rejected: Explicit commercial evidence is strictly required.'
        );
      }

      const { dealValue, currency, closedAt, notes, verifiedByUserId } = input.wonEvidence;

      if (!dealValue || Number(dealValue) <= 0) {
        throw new BadRequestError('Stage transition to WON rejected: dealValue must be a positive number.');
      }
      if (!currency || !currency.trim()) {
        throw new BadRequestError('Stage transition to WON rejected: currency is required.');
      }
      if (!closedAt) {
        throw new BadRequestError('Stage transition to WON rejected: closedAt date is required.');
      }
      if (!notes || notes.trim().length < 10) {
        throw new BadRequestError(
          'Stage transition to WON rejected: notes must contain at least 10 characters explaining deal outcome.'
        );
      }
      if (!verifiedByUserId || !verifiedByUserId.trim()) {
        throw new BadRequestError('Stage transition to WON rejected: verifiedByUserId is required.');
      }
    }

    // 2. STRICT LOST INVARIANT: Standard loss reason required
    if (targetStage === 'LOST') {
      if (!input.lostReason) {
        throw new BadRequestError(
          'Stage transition to LOST rejected: Standard loss reason (PRICE_HIGH, COMPETITOR_CHOSEN, NO_BUDGET, NO_REPLY, OUT_OF_STOCK, NOT_RELEVANT, OTHER) is required.'
        );
      }
    }

    const previousStage = buyer.conversionStage;

    // 3. Update SalesMissionBuyer
    const updated = await prisma.salesMissionBuyer.update({
      where: { id: buyer.id },
      data: {
        conversionStage: targetStage,
        conversionWonEvidence: targetStage === 'WON' ? (input.wonEvidence as any) : null,
        conversionLostReason: targetStage === 'LOST' ? input.lostReason : null,
        conversionLostAt: targetStage === 'LOST' ? new Date() : null
      }
    });

    // 4. Record ConversionEvent log
    const event = await prisma.conversionEvent.create({
      data: {
        organizationId: context.organizationId,
        salesMissionBuyerId: buyer.id,
        fromStage: previousStage,
        toStage: targetStage,
        evidence: targetStage === 'WON' ? (input.wonEvidence as any) : null,
        userId: context.userId,
        notes: input.notes || (targetStage === 'LOST' ? `Marked LOST: ${input.lostReason}` : null)
      }
    });

    return {
      buyer: salesMissionService.serializeBuyer(updated),
      conversionEvent: event
    };
  }

  /**
   * Lists conversion history events for a buyer.
   */
  async listConversionEvents(
    salesMissionBuyerId: string,
    organizationId: string
  ) {
    return prisma.conversionEvent.findMany({
      where: { salesMissionBuyerId, organizationId },
      orderBy: { createdAt: 'desc' }
    });
  }
}

export const conversionTrackingService = new ConversionTrackingService();
