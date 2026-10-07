import defaultPrisma, { type PrismaClient } from '@leadmate/db';
import {
  OutreachChannel,
  OutreachDeliveryStatus,
  OutreachErrorCode,
  SuppressionType,
  ChannelScope
} from '@leadmate/shared';
import {
  type OutreachDeliveryProviderRegistry,
  getOutreachDeliveryProvider
} from './registry.js';
import {
  type OutreachProviderSendInput,
  type OutreachProviderSendResult
} from './interfaces.js';
import {
  OutreachDeliveryProviderError,
  mapProviderErrorToPublicErrorCode
} from './errors.js';
import { computeApprovedDraftSnapshotHash } from './hashing.js';

export class OutreachRequestedRaceError extends Error {
  public readonly deliveryId: string;

  constructor(deliveryId: string) {
    super(`Outreach delivery ${deliveryId} is still in REQUESTED status; transient requeue`);
    this.name = 'OutreachRequestedRaceError';
    this.deliveryId = deliveryId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface WorkerDeliveryExecutionResult {
  readonly ok: boolean;
  readonly deliveryId: string;
  readonly status: OutreachDeliveryStatus;
  readonly skipped?: boolean;
  readonly ambiguous?: boolean;
  readonly retryable?: boolean;
  readonly providerMessageId?: string;
  readonly errorCode?: OutreachErrorCode | string;
  readonly safeErrorMessage?: string;
}

export interface WorkerDeliveryExecutorOptions {
  prisma?: PrismaClient;
  providerRegistry?: OutreachDeliveryProviderRegistry;
  clock?: () => Date;
  maxAttempts?: number;
}

export class WorkerDeliveryExecutor {
  private readonly prisma: PrismaClient;
  private readonly providerRegistry?: OutreachDeliveryProviderRegistry;
  private readonly clock: () => Date;
  private readonly maxAttempts: number;

  constructor(options: WorkerDeliveryExecutorOptions = {}) {
    this.prisma = options.prisma ?? defaultPrisma;
    this.providerRegistry = options.providerRegistry;
    this.clock = options.clock ?? (() => new Date());
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  /**
   * Executes background outbound delivery processing for a given deliveryId.
   *
   * Responsibilities:
   * 1. Reload authoritative PostgreSQL delivery record with tenant foreign-key relations
   * 2. Verify cross-model tenant consistency (fail closed if inconsistent)
   * 3. Handle non-dispatchable states (CANCELLED, SENT, DELIVERED, FAILED -> no-op)
   * 4. Handle REQUESTED enqueue race condition safely (transient requeue / throw)
   * 5. Handle pre-existing PROCESSING state (avoid duplicate physical resend / ambiguity guard)
   * 6. Atomically claim QUEUED -> PROCESSING
   * 7. Enforce Suppression Gate B immediately before provider invocation
   * 8. Verify immutable approved draft snapshot hash
   * 9. Increment attemptCount exactly once for the physical transport attempt
   * 10. Invoke provider outside any database transaction using stable idempotency token
   * 11. Persist result:
   *     - Success: SENT, providerMessageId, sentAt, safe audit log
   *     - Retryable failure (budget remaining): QUEUED, safe error, throw to BullMQ
   *     - Non-retryable failure or budget exhausted: FAILED, failedAt, safe error, safe audit log
   */
  public async executeDelivery(deliveryId: string): Promise<WorkerDeliveryExecutionResult> {
    const now = this.clock();

    // 1. Reload authoritative database record
    const delivery = await this.prisma.outreachDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        lead: true,
        draft: true,
        requestedByUser: true
      }
    });

    if (!delivery) {
      return {
        ok: false,
        deliveryId,
        status: OutreachDeliveryStatus.FAILED,
        skipped: true,
        safeErrorMessage: 'Delivery record not found'
      };
    }

    // 2. Tenant Relational Consistency Check
    const isTenantConsistent =
      delivery.organizationId === delivery.lead?.organizationId &&
      delivery.organizationId === delivery.draft?.organizationId &&
      delivery.organizationId === delivery.requestedByUser?.organizationId;

    if (!isTenantConsistent) {
      // Fail closed: mark FAILED, do not call provider
      await this.prisma.outreachDelivery.update({
        where: { id: delivery.id },
        data: {
          status: OutreachDeliveryStatus.FAILED,
          failedAt: now,
          lastErrorCode: OutreachErrorCode.OUTREACH_DELIVERY_FAILED,
          safeLastErrorMessage: 'Tenant relational integrity check failed'
        }
      });

      return {
        ok: false,
        deliveryId: delivery.id,
        status: OutreachDeliveryStatus.FAILED,
        errorCode: OutreachErrorCode.OUTREACH_DELIVERY_FAILED,
        safeErrorMessage: 'Tenant relational integrity check failed'
      };
    }

    const currentStatus = delivery.status as OutreachDeliveryStatus;

    // 3. Terminal & Cancelled Check (No-Op)
    if (currentStatus === OutreachDeliveryStatus.CANCELLED) {
      return {
        ok: true,
        deliveryId: delivery.id,
        status: OutreachDeliveryStatus.CANCELLED,
        skipped: true,
        safeErrorMessage: 'Delivery was cancelled'
      };
    }

    if (
      currentStatus === OutreachDeliveryStatus.SENT ||
      currentStatus === OutreachDeliveryStatus.DELIVERED ||
      currentStatus === OutreachDeliveryStatus.FAILED
    ) {
      return {
        ok: true,
        deliveryId: delivery.id,
        status: currentStatus,
        skipped: true,
        safeErrorMessage: `Delivery already reached state ${currentStatus}`
      };
    }

    // 4. Pre-existing PROCESSING Ambiguity Check
    if (currentStatus === OutreachDeliveryStatus.PROCESSING) {
      return {
        ok: false,
        deliveryId: delivery.id,
        status: OutreachDeliveryStatus.PROCESSING,
        ambiguous: true,
        safeErrorMessage: 'Delivery is already in PROCESSING status; awaiting reconciliation'
      };
    }

    // 5. Enqueue-before-QUEUED Race Check (status === REQUESTED)
    if (currentStatus === OutreachDeliveryStatus.REQUESTED) {
      throw new OutreachRequestedRaceError(delivery.id);
    }

    // 6. Atomic Claim: QUEUED -> PROCESSING
    const claimResult = await this.prisma.outreachDelivery.updateMany({
      where: {
        id: delivery.id,
        status: OutreachDeliveryStatus.QUEUED
      },
      data: {
        status: OutreachDeliveryStatus.PROCESSING,
        processingAt: now
      }
    });

    if (claimResult.count === 0) {
      // Another worker or cancellation won the race
      const reloaded = await this.prisma.outreachDelivery.findUnique({
        where: { id: delivery.id }
      });
      const reloadedStatus = (reloaded?.status as OutreachDeliveryStatus) ?? currentStatus;
      return {
        ok: true,
        deliveryId: delivery.id,
        status: reloadedStatus,
        skipped: true,
        safeErrorMessage: `Claim lost; current status is ${reloadedStatus}`
      };
    }

    // 7. Gate B Suppression Check (mandatory immediately before provider dispatch)
    const isSuppressed = await this.checkSuppressionGateB(
      delivery.organizationId,
      delivery.channel as OutreachChannel,
      delivery.recipientNormalized,
      now
    );

    if (isSuppressed) {
      // Attempt count is NOT incremented because provider was never called
      await this.prisma.outreachDelivery.update({
        where: { id: delivery.id },
        data: {
          status: OutreachDeliveryStatus.FAILED,
          failedAt: now,
          lastErrorCode: OutreachErrorCode.OUTREACH_RECIPIENT_SUPPRESSED,
          safeLastErrorMessage: 'Recipient is suppressed from outreach delivery'
        }
      });

      await this.recordAuditLog(
        delivery.organizationId,
        delivery.requestedByUserId,
        'lead.outreach_failed',
        delivery.id,
        {
          leadId: delivery.leadId,
          draftId: delivery.draftId,
          channel: delivery.channel,
          status: OutreachDeliveryStatus.FAILED,
          reason: 'RECIPIENT_SUPPRESSED'
        }
      );

      return {
        ok: false,
        deliveryId: delivery.id,
        status: OutreachDeliveryStatus.FAILED,
        errorCode: OutreachErrorCode.OUTREACH_RECIPIENT_SUPPRESSED,
        safeErrorMessage: 'Recipient is suppressed from outreach delivery'
      };
    }

    // 8. Approved Draft Snapshot Hash Verification
    const computedHash = computeApprovedDraftSnapshotHash({
      channel: delivery.channel as OutreachChannel,
      subject: delivery.snapshotSubject,
      body: delivery.snapshotBody,
      content: delivery.snapshotContent
    });

    if (computedHash !== delivery.approvedDraftSnapshotHash) {
      await this.prisma.outreachDelivery.update({
        where: { id: delivery.id },
        data: {
          status: OutreachDeliveryStatus.FAILED,
          failedAt: now,
          lastErrorCode: OutreachErrorCode.OUTREACH_CONTENT_REJECTED,
          safeLastErrorMessage: 'Approved draft snapshot content mismatch'
        }
      });

      await this.recordAuditLog(
        delivery.organizationId,
        delivery.requestedByUserId,
        'lead.outreach_failed',
        delivery.id,
        {
          leadId: delivery.leadId,
          draftId: delivery.draftId,
          channel: delivery.channel,
          status: OutreachDeliveryStatus.FAILED,
          reason: 'CONTENT_REJECTED'
        }
      );

      return {
        ok: false,
        deliveryId: delivery.id,
        status: OutreachDeliveryStatus.FAILED,
        errorCode: OutreachErrorCode.OUTREACH_CONTENT_REJECTED,
        safeErrorMessage: 'Approved draft snapshot content mismatch'
      };
    }

    // 9. Increment attemptCount for the actual physical transport attempt
    const nextAttemptCount = delivery.attemptCount + 1;
    await this.prisma.outreachDelivery.update({
      where: { id: delivery.id },
      data: {
        attemptCount: nextAttemptCount
      }
    });

    // 10. Construct Normalized Provider Payload
    let providerInput: OutreachProviderSendInput;
    if (delivery.channel === OutreachChannel.WHATSAPP) {
      providerInput = {
        channel: OutreachChannel.WHATSAPP,
        deliveryId: delivery.id,
        organizationId: delivery.organizationId,
        recipientNormalized: delivery.recipientNormalized,
        providerIdempotencyToken: delivery.id,
        content: delivery.snapshotContent ?? ''
      };
    } else {
      providerInput = {
        channel: OutreachChannel.EMAIL,
        deliveryId: delivery.id,
        organizationId: delivery.organizationId,
        recipientNormalized: delivery.recipientNormalized,
        providerIdempotencyToken: delivery.id,
        subject: delivery.snapshotSubject,
        body: delivery.snapshotBody ?? ''
      };
    }

    // 11. Provider Invocation Outside Database Transaction
    let sendResult: OutreachProviderSendResult;
    try {
      const provider = this.providerRegistry
        ? this.providerRegistry.getProvider(delivery.channel as OutreachChannel)
        : getOutreachDeliveryProvider(delivery.channel as OutreachChannel);

      sendResult = await provider.send(providerInput);
    } catch (providerErr: unknown) {
      const isRetryable =
        providerErr instanceof OutreachDeliveryProviderError
          ? providerErr.retryable
          : false;
      const safeMessage =
        providerErr instanceof OutreachDeliveryProviderError
          ? providerErr.safeMessage
          : 'Outreach delivery transport failure';
      const publicErrorCode = mapProviderErrorToPublicErrorCode(providerErr);

      const hasRemainingAttempts = isRetryable && nextAttemptCount < this.maxAttempts;

      if (hasRemainingAttempts) {
        // Retryable failure within budget: PROCESSING -> QUEUED
        await this.prisma.outreachDelivery.update({
          where: { id: delivery.id },
          data: {
            status: OutreachDeliveryStatus.QUEUED,
            lastErrorCode: publicErrorCode,
            safeLastErrorMessage: safeMessage
          }
        });

        // Throw error to trigger BullMQ exponential backoff retry
        throw providerErr;
      } else {
        // Non-retryable OR retry budget exhausted: PROCESSING -> FAILED
        await this.prisma.outreachDelivery.update({
          where: { id: delivery.id },
          data: {
            status: OutreachDeliveryStatus.FAILED,
            failedAt: now,
            lastErrorCode: publicErrorCode,
            safeLastErrorMessage: safeMessage
          }
        });

        await this.recordAuditLog(
          delivery.organizationId,
          delivery.requestedByUserId,
          'lead.outreach_failed',
          delivery.id,
          {
            leadId: delivery.leadId,
            draftId: delivery.draftId,
            channel: delivery.channel,
            status: OutreachDeliveryStatus.FAILED,
            attemptCount: nextAttemptCount,
            lastErrorCode: publicErrorCode
          }
        );

        return {
          ok: false,
          deliveryId: delivery.id,
          status: OutreachDeliveryStatus.FAILED,
          errorCode: publicErrorCode,
          safeErrorMessage: safeMessage
        };
      }
    }

    // 12. Provider Success Acceptance: PROCESSING -> SENT
    await this.prisma.outreachDelivery.update({
      where: { id: delivery.id },
      data: {
        status: OutreachDeliveryStatus.SENT,
        providerName: sendResult.providerName,
        providerMessageId: sendResult.providerMessageId,
        sentAt: sendResult.acceptedAt,
        lastErrorCode: null,
        safeLastErrorMessage: null
      }
    });

    await this.recordAuditLog(
      delivery.organizationId,
      delivery.requestedByUserId,
      'lead.outreach_sent',
      delivery.id,
      {
        leadId: delivery.leadId,
        draftId: delivery.draftId,
        channel: delivery.channel,
        status: OutreachDeliveryStatus.SENT,
        attemptCount: nextAttemptCount
      }
    );

    return {
      ok: true,
      deliveryId: delivery.id,
      status: OutreachDeliveryStatus.SENT,
      providerMessageId: sendResult.providerMessageId
    };
  }

  private async checkSuppressionGateB(
    organizationId: string,
    channel: OutreachChannel,
    recipientNormalized: string,
    now: Date
  ): Promise<boolean> {
    if (channel === OutreachChannel.WHATSAPP) {
      const suppressed = await this.prisma.suppressionList.findFirst({
        where: {
          organizationId,
          normalizedValue: recipientNormalized,
          type: { in: [SuppressionType.WHATSAPP as any, SuppressionType.PHONE as any] },
          channelScope: { in: [ChannelScope.ALL as any, ChannelScope.WHATSAPP as any] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
        }
      });
      return !!suppressed;
    } else {
      const valuesToCheck = [recipientNormalized];
      const atIdx = recipientNormalized.indexOf('@');
      if (atIdx > 0) {
        valuesToCheck.push(recipientNormalized.slice(atIdx + 1));
      }
      const suppressed = await this.prisma.suppressionList.findFirst({
        where: {
          organizationId,
          normalizedValue: { in: valuesToCheck },
          type: { in: [SuppressionType.EMAIL as any, SuppressionType.DOMAIN as any] },
          channelScope: { in: [ChannelScope.ALL as any, ChannelScope.EMAIL as any] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
        }
      });
      return !!suppressed;
    }
  }

  private async recordAuditLog(
    organizationId: string,
    userId: string,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId,
          userId,
          action,
          entityType: 'OutreachDelivery',
          entityId,
          after: metadata as any
        }
      });
    } catch {
      // Best-effort audit logging
    }
  }
}
