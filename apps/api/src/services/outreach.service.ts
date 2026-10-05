/**
 * Automated Outreach & Delivery Domain Service (API Layer)
 *
 * Exposes orchestrations for:
 * - POST dispatching approved outreach delivery (idempotent, tenant-scoped, audit-logged)
 * - GET listing outreach delivery history for a lead
 * - GET single outreach delivery detail
 *
 * Invariants:
 * - Strict multi-tenancy: entity lookups scoped by (organizationId, leadId)
 * - RBAC & Assignment: Sales Executives may only access assigned leads
 * - Safe DTO projection: recipient is masked, snapshots/hashes/keys/secrets are omitted
 * - Audit logging: creates authoritative audit event for new dispatches (excludes secrets & duplicate replays)
 */

import defaultPrisma, { type PrismaClient } from '@leadmate/db';
import {
  type SendOutreachDeliveryRequest,
  type OutreachDeliverySummary,
  type ListOutreachDeliveriesQuery,
  type OutreachDeliveryListResponse,
  OutreachChannel,
  OutreachDeliveryStatus,
  OutreachErrorCode,
  Role,
  maskRecipient
} from '@leadmate/shared';
import {
  OutreachDeliveryService,
  type OutreachDeliveryQueue
} from '@leadmate/core';
import { BullMQOutreachDeliveryQueue } from '@leadmate/queues';
import { NotFoundError, ForbiddenError } from '../lib/errors.js';

export interface OutreachRequestContext {
  organizationId: string;
  userId: string;
  role: Role;
  correlationId?: string;
}

export class OutreachService {
  private readonly prisma: PrismaClient;
  private queue: OutreachDeliveryQueue;
  private deliveryService: OutreachDeliveryService;

  constructor(prismaClient?: PrismaClient, queueInstance?: OutreachDeliveryQueue) {
    this.prisma = prismaClient ?? defaultPrisma;
    this.queue = queueInstance ?? new BullMQOutreachDeliveryQueue();
    this.deliveryService = new OutreachDeliveryService({
      prisma: this.prisma,
      queue: this.queue
    });
  }

  /**
   * Test helper to inject an in-memory or mock queue.
   */
  public setQueue(queue: OutreachDeliveryQueue): void {
    this.queue = queue;
    this.deliveryService = new OutreachDeliveryService({
      prisma: this.prisma,
      queue: this.queue
    });
  }

  /**
   * Test helper to inject an OutreachDeliveryService instance.
   */
  public setDeliveryService(service: OutreachDeliveryService): void {
    this.deliveryService = service;
  }

  /**
   * Dispatches an approved sales assistant draft for outreach delivery.
   * Idempotent: same key + same payload returns existing delivery.
   */
  public async requestDelivery(
    context: OutreachRequestContext,
    leadId: string,
    input: SendOutreachDeliveryRequest,
    idempotencyKey: string
  ): Promise<OutreachDeliverySummary> {
    const { organizationId, userId, role } = context;

    // 1. Check if a delivery record already exists for this (organizationId, idempotencyKey)
    const existingBefore = await this.prisma.outreachDelivery.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId,
          idempotencyKey
        }
      }
    });

    // 2. Execute domain service dispatch
    const summary = await this.deliveryService.requestDelivery({
      organizationId,
      authenticatedUserId: userId,
      authenticatedUserRole: role,
      leadId,
      draftId: input.draftId,
      channel: input.channel,
      recipientContactId: input.recipientContactId,
      idempotencyKey
    });

    // 3. If this was a newly created delivery (not an idempotent replay), record audit log
    if (!existingBefore) {
      try {
        await this.prisma.auditLog.create({
          data: {
            organizationId,
            userId,
            action: 'lead.outreach_requested',
            entityType: 'OutreachDelivery',
            entityId: summary.id,
            after: {
              leadId,
              draftId: input.draftId,
              channel: summary.channel,
              status: summary.status,
              recipientMasked: summary.recipientMasked
            }
          }
        });
      } catch {
        // Best-effort audit logging consistent with repository architecture
      }
    }

    return summary;
  }

  /**
   * Lists outreach delivery history for a lead.
   */
  public async listDeliveries(
    context: OutreachRequestContext,
    leadId: string,
    query?: ListOutreachDeliveriesQuery
  ): Promise<OutreachDeliveryListResponse> {
    const { organizationId, userId, role } = context;

    // 1. Verify lead exists in organization
    const lead = await this.prisma.lead.findUnique({
      where: {
        id_organizationId: {
          id: leadId,
          organizationId
        }
      }
    });

    if (!lead) {
      throw new NotFoundError('Lead not found in organization');
    }

    // 2. Sales Executive lead assignment boundary
    if (role === Role.SALES_EXECUTIVE) {
      if (!lead.assignedUserId || lead.assignedUserId !== userId) {
        throw new ForbiddenError('Sales Executives can only view outreach for leads assigned to them');
      }
    }

    // 3. Query deliveries with deterministic ordering and bounded limit
    const limit = 50;
    const whereClause: any = {
      organizationId,
      leadId
    };

    if (query?.status) {
      whereClause.status = query.status;
    }

    if (query?.channel) {
      whereClause.channel = query.channel;
    }

    const [rawDeliveries, total] = await Promise.all([
      this.prisma.outreachDelivery.findMany({
        where: whereClause,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit
      }),
      this.prisma.outreachDelivery.count({
        where: whereClause
      })
    ]);

    return {
      deliveries: rawDeliveries.map((raw) => this.mapToSummary(raw)),
      total
    };
  }

  /**
   * Retrieves single outreach delivery detail.
   */
  public async getDelivery(
    context: OutreachRequestContext,
    leadId: string,
    deliveryId: string
  ): Promise<OutreachDeliverySummary> {
    const { organizationId, userId, role } = context;

    // 1. Verify lead exists in organization
    const lead = await this.prisma.lead.findUnique({
      where: {
        id_organizationId: {
          id: leadId,
          organizationId
        }
      }
    });

    if (!lead) {
      throw new NotFoundError('Lead not found in organization');
    }

    // 2. Sales Executive lead assignment boundary
    if (role === Role.SALES_EXECUTIVE) {
      if (!lead.assignedUserId || lead.assignedUserId !== userId) {
        throw new ForbiddenError('Sales Executives can only view outreach for leads assigned to them');
      }
    }

    // 3. Find delivery scoped to lead and organization
    const rawDelivery = await this.prisma.outreachDelivery.findFirst({
      where: {
        id: deliveryId,
        leadId,
        organizationId
      }
    });

    if (!rawDelivery) {
      throw new NotFoundError('Outreach delivery not found');
    }

    return this.mapToSummary(rawDelivery);
  }

  /**
   * Safe mapping from raw database record to public OutreachDeliverySummary DTO.
   * Data minimization: strictly excludes recipientNormalized, snapshot fields,
   * hashes, idempotency keys, and provider internal message IDs.
   */
  private mapToSummary(raw: any): OutreachDeliverySummary {
    return {
      id: raw.id,
      leadId: raw.leadId,
      draftId: raw.draftId,
      channel: raw.channel as OutreachChannel,
      status: raw.status as OutreachDeliveryStatus,
      recipientMasked: maskRecipient(raw.recipientNormalized),
      recipientContactId: raw.recipientContactId ?? undefined,
      attemptCount: raw.attemptCount ?? 0,
      lastErrorCode: (raw.lastErrorCode as OutreachErrorCode) ?? undefined,
      safeLastErrorMessage: raw.safeLastErrorMessage ?? undefined,
      requestedAt: raw.requestedAt,
      queuedAt: raw.queuedAt ?? undefined,
      sentAt: raw.sentAt ?? undefined,
      deliveredAt: raw.deliveredAt ?? undefined,
      failedAt: raw.failedAt ?? undefined,
      cancelledAt: raw.cancelledAt ?? undefined,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt
    };
  }
}

export const outreachService = new OutreachService();
