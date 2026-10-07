import defaultPrisma, { type PrismaClient } from '@leadmate/db';
import {
  OutreachDeliveryStatus,
  OutreachErrorCode
} from '@leadmate/shared';

export type NormalizedWebhookEventType = 'DELIVERED' | 'FAILED';

export interface NormalizedOutreachWebhookEvent {
  readonly providerName: string;
  readonly eventId: string;
  readonly providerMessageId: string;
  readonly eventType: NormalizedWebhookEventType;
  readonly timestamp?: Date;
  readonly safeErrorCode?: OutreachErrorCode | string;
  readonly safeErrorMessage?: string;
}

export interface WebhookProcessingResult {
  readonly ok: boolean;
  readonly duplicate: boolean;
  readonly matched: boolean;
  readonly deliveryId?: string;
  readonly previousStatus?: OutreachDeliveryStatus;
  readonly newStatus?: OutreachDeliveryStatus;
  readonly safeMessage?: string;
}

export interface WebhookEventProcessorOptions {
  prisma?: PrismaClient;
  clock?: () => Date;
}

export class OutreachWebhookEventProcessor {
  private readonly prisma: PrismaClient;
  private readonly clock: () => Date;

  constructor(options: WebhookEventProcessorOptions = {}) {
    this.prisma = options.prisma ?? defaultPrisma;
    this.clock = options.clock ?? (() => new Date());
  }

  /**
   * Processes an incoming verified normalized webhook event from a provider adapter.
   *
   * Guarantees:
   * 1. Replay Deduplication: Same (providerName, eventId) processed once; subsequent replays return success no-op.
   * 2. Authoritative Correlation: Delivery correlated via (providerName, providerMessageId); zero reliance on client tenant IDs.
   * 3. Forward-Only State Transitions: SENT -> DELIVERED, SENT -> FAILED.
   * 4. State Regression Invariant: Never regresses from terminal DELIVERED, FAILED, or CANCELLED.
   * 5. Audit Logging: Authoritative audit event written on valid transition only (never on duplicate replays).
   * 6. Zero Sensitive Payload Storage: Full headers, signatures, tokens, and payloads are strictly excluded.
   */
  public async processEvent(
    event: NormalizedOutreachWebhookEvent
  ): Promise<WebhookProcessingResult> {
    const now = this.clock();
    const eventTimestamp = event.timestamp ?? now;

    // 1. Replay Deduplication Check
    const existingEvent = await this.prisma.outreachWebhookEvent.findUnique({
      where: {
        providerName_eventId: {
          providerName: event.providerName,
          eventId: event.eventId
        }
      }
    });

    if (existingEvent) {
      return {
        ok: true,
        duplicate: true,
        matched: existingEvent.organizationId !== null,
        safeMessage: 'Event already processed'
      };
    }

    // 2. Correlate Delivery via (providerName, providerMessageId)
    const delivery = await this.prisma.outreachDelivery.findFirst({
      where: {
        providerName: event.providerName,
        providerMessageId: event.providerMessageId
      }
    });

    if (!delivery) {
      // Record unmatched event safely
      try {
        await this.prisma.outreachWebhookEvent.create({
          data: {
            providerName: event.providerName,
            eventId: event.eventId,
            providerMessageId: event.providerMessageId,
            eventType: event.eventType,
            receivedAt: now,
            processedAt: now,
            processingStatus: 'UNMATCHED',
            safeErrorMessage: 'No correlated delivery found'
          }
        });
      } catch {
        // Replay collision guard
      }

      return {
        ok: true,
        duplicate: false,
        matched: false,
        safeMessage: 'No matching outreach delivery found'
      };
    }

    const previousStatus = delivery.status as OutreachDeliveryStatus;
    let newStatus = previousStatus;
    let shouldAudit = false;
    let auditAction = '';
    let auditMetadata: Record<string, unknown> = {};

    // 3. Permissible State Transition Logic
    if (event.eventType === 'DELIVERED') {
      if (previousStatus === OutreachDeliveryStatus.SENT) {
        // SENT -> DELIVERED
        newStatus = OutreachDeliveryStatus.DELIVERED;
        await this.prisma.outreachDelivery.update({
          where: { id: delivery.id },
          data: {
            status: OutreachDeliveryStatus.DELIVERED,
            deliveredAt: eventTimestamp
          }
        });
        shouldAudit = true;
        auditAction = 'lead.outreach_delivered';
        auditMetadata = {
          leadId: delivery.leadId,
          draftId: delivery.draftId,
          channel: delivery.channel,
          status: OutreachDeliveryStatus.DELIVERED
        };
      } else {
        // Late or reordered event: delivery is already DELIVERED, FAILED, or CANCELLED
        // Do not regress or alter state
      }
    } else if (event.eventType === 'FAILED') {
      if (previousStatus === OutreachDeliveryStatus.SENT) {
        // SENT -> FAILED
        newStatus = OutreachDeliveryStatus.FAILED;
        const mappedCode =
          event.safeErrorCode ?? OutreachErrorCode.OUTREACH_DELIVERY_FAILED;
        const mappedMessage =
          event.safeErrorMessage ?? 'Downstream delivery failure reported by provider';

        await this.prisma.outreachDelivery.update({
          where: { id: delivery.id },
          data: {
            status: OutreachDeliveryStatus.FAILED,
            failedAt: eventTimestamp,
            lastErrorCode: mappedCode,
            safeLastErrorMessage: mappedMessage
          }
        });
        shouldAudit = true;
        auditAction = 'lead.outreach_failed';
        auditMetadata = {
          leadId: delivery.leadId,
          draftId: delivery.draftId,
          channel: delivery.channel,
          status: OutreachDeliveryStatus.FAILED,
          reason: 'WEBHOOK_FAILURE',
          errorCode: mappedCode
        };
      } else {
        // Late or reordered event: delivery is already DELIVERED, FAILED, or CANCELLED
        // Do not regress or alter state
      }
    }

    // 4. Record Webhook Event Record
    try {
      await this.prisma.outreachWebhookEvent.create({
        data: {
          organizationId: delivery.organizationId,
          providerName: event.providerName,
          eventId: event.eventId,
          providerMessageId: event.providerMessageId,
          eventType: event.eventType,
          receivedAt: now,
          processedAt: now,
          processingStatus: 'PROCESSED'
        }
      });
    } catch {
      // Replay collision guard
    }

    // 5. Emit Authoritative Audit Event (if state transitioned)
    if (shouldAudit) {
      try {
        await this.prisma.auditLog.create({
          data: {
            organizationId: delivery.organizationId,
            userId: delivery.requestedByUserId,
            action: auditAction,
            entityType: 'OutreachDelivery',
            entityId: delivery.id,
            after: auditMetadata as any
          }
        });
      } catch {
        // Best-effort audit logging
      }
    }

    return {
      ok: true,
      duplicate: false,
      matched: true,
      deliveryId: delivery.id,
      previousStatus,
      newStatus,
      safeMessage: 'Webhook event processed successfully'
    };
  }
}
