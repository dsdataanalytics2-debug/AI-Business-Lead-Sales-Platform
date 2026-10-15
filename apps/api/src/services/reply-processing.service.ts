import prisma from '@leadmate/db';
import {
  type ProcessInboundReplyInput,
  type BuyerInteractionDto,
  type ReplyClassificationCategory
} from '@leadmate/shared';
import { NotFoundError } from '../lib/errors.js';
import { classifyInboundReply } from '@leadmate/core';
import { suppressionService } from './suppression.service.js';

export interface ReplyProcessingContext {
  organizationId: string;
  userId?: string;
  correlationId?: string;
}

export class ReplyProcessingService {
  /**
   * Ingests and classifies an inbound reply, logs the interaction, updates conversion lifecycle,
   * and triggers automatic organization-scoped suppression if opt-out is detected.
   */
  async processInboundReply(
    salesMissionBuyerId: string,
    input: ProcessInboundReplyInput,
    context: ReplyProcessingContext
  ): Promise<{
    interaction: BuyerInteractionDto;
    classification: ReplyClassificationCategory;
    isOptOut: boolean;
    autoSuppressed: boolean;
  }> {
    const buyer = await prisma.salesMissionBuyer.findFirst({
      where: {
        id: salesMissionBuyerId,
        organizationId: context.organizationId
      }
    });

    if (!buyer) {
      throw new NotFoundError(`SalesMissionBuyer "${salesMissionBuyerId}" not found.`);
    }

    // 1. Pure deterministic classification (English + Bangla)
    const classified = classifyInboundReply(input.content);

    // 2. Persist interaction log
    const interaction = await prisma.buyerInteraction.create({
      data: {
        organizationId: context.organizationId,
        salesMissionBuyerId: buyer.id,
        direction: 'INBOUND',
        channel: input.channel,
        content: input.content,
        rawPayload: {
          senderPhone: input.senderPhone || buyer.phone,
          senderEmail: input.senderEmail,
          processedAt: new Date().toISOString()
        },
        classification: classified.classification,
        classificationConfidence: classified.confidence,
        classificationSignals: classified.matchedSignals
      }
    });

    let autoSuppressed = false;

    // 3. Process UNSUBSCRIBE / Opt-Out
    if (classified.classification === 'UNSUBSCRIBE') {
      autoSuppressed = true;
      // Immediately create organization-scoped suppression
      await suppressionService.createSuppression(
        {
          phone: input.senderPhone || buyer.phone || undefined,
          email: input.senderEmail || undefined,
          domain: buyer.website || undefined,
          salesMissionBuyerId: buyer.id,
          reason: 'UNSUBSCRIBE',
          source: 'INBOUND_REPLY'
        },
        context
      );

      // INVARIANT: Suppression != Commercial LOST.
      // Do NOT automatically force conversionStage = 'LOST' upon unsubscribe.
      // If the buyer was at DISCOVERED or CONTACTED, advance to REPLIED to reflect inbound response;
      // otherwise, preserve existing commercial conversion stage.
      if (buyer.conversionStage === 'DISCOVERED' || buyer.conversionStage === 'CONTACTED') {
        await prisma.salesMissionBuyer.update({
          where: { id: buyer.id },
          data: { conversionStage: 'REPLIED' }
        });
      }
    } else {
      // 4. Update conversion stage based on classification
      let nextStage: string | null = null;

      switch (classified.classification) {
        case 'ORDER_INTENT':
          // INVARIANT: ORDER_INTENT != WON. Moves to NEGOTIATING or INTERESTED, NEVER WON.
          nextStage = 'NEGOTIATING';
          break;
        case 'PRICE_REQUEST':
        case 'MOQ_REQUEST':
        case 'PRODUCT_INFO_REQUEST':
        case 'INTERESTED':
          nextStage = 'INTERESTED';
          break;
        case 'FOLLOW_UP_LATER':
          nextStage = 'FOLLOW_UP';
          break;
        case 'NOT_INTERESTED':
          nextStage = 'NOT_INTERESTED';
          break;
        default:
          // UNCLASSIFIED or general response
          if (buyer.conversionStage === 'DISCOVERED' || buyer.conversionStage === 'CONTACTED') {
            nextStage = 'REPLIED';
          }
          break;
      }

      if (nextStage && nextStage !== buyer.conversionStage) {
        await prisma.salesMissionBuyer.update({
          where: { id: buyer.id },
          data: { conversionStage: nextStage }
        });

        await prisma.conversionEvent.create({
          data: {
            organizationId: context.organizationId,
            salesMissionBuyerId: buyer.id,
            fromStage: buyer.conversionStage,
            toStage: nextStage,
            evidence: {
              trigger: 'INBOUND_REPLY_CLASSIFICATION',
              classification: classified.classification,
              interactionId: interaction.id
            },
            notes: `Auto stage update from reply classification: ${classified.classification}`
          }
        });
      }
    }

    return {
      interaction: {
        id: interaction.id,
        organizationId: interaction.organizationId,
        salesMissionBuyerId: interaction.salesMissionBuyerId,
        direction: interaction.direction,
        channel: interaction.channel,
        content: interaction.content,
        rawPayload: interaction.rawPayload,
        classification: interaction.classification,
        classificationConfidence: interaction.classificationConfidence,
        classificationSignals: interaction.classificationSignals as any,
        createdAt: interaction.createdAt
      },
      classification: classified.classification,
      isOptOut: classified.isOptOut,
      autoSuppressed
    };
  }

  /**
   * Lists interactions for a buyer.
   */
  async listInteractionsForBuyer(
    salesMissionBuyerId: string,
    organizationId: string
  ): Promise<BuyerInteractionDto[]> {
    const list = await prisma.buyerInteraction.findMany({
      where: { salesMissionBuyerId, organizationId },
      orderBy: { createdAt: 'desc' }
    });

    return list.map((i) => ({
      id: i.id,
      organizationId: i.organizationId,
      salesMissionBuyerId: i.salesMissionBuyerId,
      direction: i.direction,
      channel: i.channel,
      content: i.content,
      rawPayload: i.rawPayload,
      classification: i.classification,
      classificationConfidence: i.classificationConfidence,
      classificationSignals: i.classificationSignals as any,
      createdAt: i.createdAt
    }));
  }
}

export const replyProcessingService = new ReplyProcessingService();
