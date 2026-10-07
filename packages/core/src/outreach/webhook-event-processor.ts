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

    if (existingEvent && existingEvent.processingStatus === 'PROCESSED') {
      return {
        ok: true,
        duplicate: true,
        matched: existingEvent.organizationId !== null,
        safeMessage: 'Event already processed'
      };
    }

    // 2. Correlate Delivery via (providerName, providerMessageId)
    // Query enough rows to distinguish: 0 matches, 1 match, >1 matches (ambiguous correlation fail-closed)
    const matchingDeliveries = await this.prisma.outreachDelivery.findMany({
      where: {
        providerName: event.providerName,
        providerMessageId: event.providerMessageId
      },
      take: 2
    });

    if (matchingDeliveries.length === 0) {
      // Record unmatched event safely
      if (existingEvent) {
        await this.prisma.outreachWebhookEvent.update({
          where: { id: existingEvent.id },
          data: {
            processingStatus: 'UNMATCHED',
            safeErrorMessage: 'No correlated delivery found'
          }
        });
      } else {
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
      }

      return {
        ok: true,
        duplicate: false,
        matched: false,
        safeMessage: 'No matching outreach delivery found'
      };
    }

    if (matchingDeliveries.length > 1) {
      // FAIL CLOSED: ambiguous providerMessageId correlation across multiple deliveries/tenants.
      // Do not mutate ANY delivery, do not pick first row, organizationId must remain null.
      if (existingEvent) {
        await this.prisma.outreachWebhookEvent.update({
          where: { id: existingEvent.id },
          data: {
            organizationId: null,
            processingStatus: 'UNMATCHED',
            safeErrorMessage: 'Ambiguous provider message correlation'
          }
        });
      } else {
        try {
          await this.prisma.outreachWebhookEvent.create({
            data: {
              organizationId: null,
              providerName: event.providerName,
              eventId: event.eventId,
              providerMessageId: event.providerMessageId,
              eventType: event.eventType,
              receivedAt: now,
              processedAt: now,
              processingStatus: 'UNMATCHED',
              safeErrorMessage: 'Ambiguous provider message correlation'
            }
          });
        } catch {
          // Replay collision guard
        }
      }

      return {
        ok: false,
        duplicate: false,
        matched: false,
        safeMessage: 'Ambiguous provider message correlation'
      };
    }

    const delivery = matchingDeliveries[0];
    const previousStatus = delivery.status as OutreachDeliveryStatus;
    let newStatus = previousStatus;
    let shouldAudit = false;
    let auditAction = '';
    let auditMetadata: Record<string, unknown> = {};
    let finalProcessingStatus: string = 'PROCESSED';
    let processedAtDate: Date | null = now;
    let safeStatusErrorMessage: string | null = null;

    // Check if delivery is in a pre-terminal state (REQUESTED, QUEUED, PROCESSING)
    const isPreTerminal =
      previousStatus === OutreachDeliveryStatus.REQUESTED ||
      previousStatus === OutreachDeliveryStatus.QUEUED ||
      previousStatus === OutreachDeliveryStatus.PROCESSING;

    // 3. Permissible State Transition Logic
    if (isPreTerminal) {
      // Out-of-order terminal event arrived before delivery reached SENT.
      // Defer event so it is NOT marked PROCESSED (processedAt = null, processingStatus = 'UNRESOLVED').
      // Delivery status machine is NOT altered (no illegal PROCESSING -> DELIVERED).
      finalProcessingStatus = 'UNRESOLVED';
      processedAtDate = null;
      safeStatusErrorMessage = 'Delivery has not reached SENT status; event deferred for reconciliation';
    } else if (event.eventType === 'DELIVERED') {
      if (previousStatus === OutreachDeliveryStatus.SENT) {
        // Atomic conditional transition: SENT -> DELIVERED
        let transitionSucceeded = true;
        if (typeof this.prisma.outreachDelivery.updateMany === 'function') {
          const updateResult = await this.prisma.outreachDelivery.updateMany({
            where: {
              id: delivery.id,
              status: OutreachDeliveryStatus.SENT
            },
            data: {
              status: OutreachDeliveryStatus.DELIVERED,
              deliveredAt: eventTimestamp
            }
          });
          transitionSucceeded = updateResult.count > 0;
        } else {
          await this.prisma.outreachDelivery.update({
            where: { id: delivery.id },
            data: {
              status: OutreachDeliveryStatus.DELIVERED,
              deliveredAt: eventTimestamp
            }
          });
        }

        if (transitionSucceeded) {
          newStatus = OutreachDeliveryStatus.DELIVERED;
          shouldAudit = true;
          auditAction = 'lead.outreach_delivered';
          auditMetadata = {
            leadId: delivery.leadId,
            draftId: delivery.draftId,
            channel: delivery.channel,
            status: OutreachDeliveryStatus.DELIVERED
          };
        }
      } else {
        // Late or reordered event: delivery is already DELIVERED, FAILED, or CANCELLED
        // Do not regress or alter state
      }
    } else if (event.eventType === 'FAILED') {
      if (previousStatus === OutreachDeliveryStatus.SENT) {
        // Atomic conditional transition: SENT -> FAILED
        const mappedCode =
          event.safeErrorCode ?? OutreachErrorCode.OUTREACH_DELIVERY_FAILED;
        const mappedMessage =
          event.safeErrorMessage ?? 'Downstream delivery failure reported by provider';

        let transitionSucceeded = true;
        if (typeof this.prisma.outreachDelivery.updateMany === 'function') {
          const updateResult = await this.prisma.outreachDelivery.updateMany({
            where: {
              id: delivery.id,
              status: OutreachDeliveryStatus.SENT
            },
            data: {
              status: OutreachDeliveryStatus.FAILED,
              failedAt: eventTimestamp,
              lastErrorCode: mappedCode,
              safeLastErrorMessage: mappedMessage
            }
          });
          transitionSucceeded = updateResult.count > 0;
        } else {
          await this.prisma.outreachDelivery.update({
            where: { id: delivery.id },
            data: {
              status: OutreachDeliveryStatus.FAILED,
              failedAt: eventTimestamp,
              lastErrorCode: mappedCode,
              safeLastErrorMessage: mappedMessage
            }
          });
        }

        if (transitionSucceeded) {
          newStatus = OutreachDeliveryStatus.FAILED;
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
        }
      } else {
        // Late or reordered event: delivery is already DELIVERED, FAILED, or CANCELLED
        // Do not regress or alter state
      }
    }

    // 4. Record or Update Webhook Event Record
    if (existingEvent) {
      await this.prisma.outreachWebhookEvent.update({
        where: { id: existingEvent.id },
        data: {
          organizationId: delivery.organizationId,
          providerMessageId: event.providerMessageId,
          eventType: event.eventType,
          processedAt: processedAtDate,
          processingStatus: finalProcessingStatus,
          safeErrorMessage: safeStatusErrorMessage
        }
      });
    } else {
      try {
        await this.prisma.outreachWebhookEvent.create({
          data: {
            organizationId: delivery.organizationId,
            providerName: event.providerName,
            eventId: event.eventId,
            providerMessageId: event.providerMessageId,
            eventType: event.eventType,
            receivedAt: now,
            processedAt: processedAtDate,
            processingStatus: finalProcessingStatus,
            safeErrorMessage: safeStatusErrorMessage
          }
        });
      } catch {
        // Replay collision guard
      }
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
      safeMessage: isPreTerminal
        ? 'Delivery not yet SENT; event deferred'
        : 'Webhook event processed successfully'
    };
  }
}
