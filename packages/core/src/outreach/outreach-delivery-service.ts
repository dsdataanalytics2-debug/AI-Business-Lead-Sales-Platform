import defaultPrisma, { type PrismaClient } from '@leadmate/db';
import {
  Role,
  ContactType,
  ContactStatus,
  WhatsAppStatus,
  SuppressionType,
  ChannelScope,
  SalesAssistantDraftStatus,
  SalesAssistantDraftType,
  OutreachChannel,
  OutreachDeliveryStatus,
  OutreachErrorCode,
  Permissions,
  hasPermission,
  isOutreachChannelCompatible,
  maskRecipient,
  outreachIdempotencyKeySchema,
  type OutreachDeliverySummary
} from '@leadmate/shared';
import { normalizePhone } from '../normalization/phone.js';
import {
  computeApprovedDraftSnapshotHash,
  computeRequestFingerprint
} from './hashing.js';
import {
  type OutreachDeliveryQueue,
  InMemoryOutreachDeliveryQueue
} from './queue.js';
import { OutreachServiceError } from './service-errors.js';

export interface RequestOutreachDeliveryInput {
  readonly organizationId: string;
  readonly authenticatedUserId: string;
  readonly authenticatedUserRole: Role;
  readonly leadId: string;
  readonly draftId: string;
  readonly channel: OutreachChannel;
  readonly recipientContactId?: string;
  readonly idempotencyKey: string;
}

export interface OutreachDeliveryServiceOptions {
  prisma?: PrismaClient;
  queue?: OutreachDeliveryQueue;
  clock?: () => Date;
}

export class OutreachDeliveryService {
  private readonly prisma: PrismaClient;
  private readonly queue: OutreachDeliveryQueue;
  private readonly clock: () => Date;

  constructor(options: OutreachDeliveryServiceOptions = {}) {
    this.prisma = options.prisma ?? defaultPrisma;
    this.queue = options.queue ?? new InMemoryOutreachDeliveryQueue();
    this.clock = options.clock ?? (() => new Date());
  }

  /**
   * Main entry point for requesting outbound outreach delivery.
   *
   * Orchestrates:
   * 1. Idempotency key syntax validation
   * 2. Role-based authorization & Sales Executive assignment check
   * 3. Tenant-scoped Lead & Draft verification
   * 4. Draft approval & lead-draft relation invariants
   * 5. Channel compatibility enforcement
   * 6. Recipient trust resolution (enforcing PHONE != WHATSAPP)
   * 7. Suppression List Gate A verification
   * 8. Immutable snapshot generation & canonical SHA-256 hashing
   * 9. Deterministic request fingerprinting
   * 10. Idempotent persistence (REQUESTED -> Enqueue -> QUEUED)
   */
  public async requestDelivery(
    input: RequestOutreachDeliveryInput
  ): Promise<OutreachDeliverySummary> {
    const now = this.clock();

    // 1. Validate Idempotency Key
    this.validateIdempotencyKey(input.idempotencyKey);

    // 2. Enforce Role Authorization (Defense in Depth)
    this.checkRoleAuthorization(input.authenticatedUserRole);

    // 3. Load Lead Scoped by Organization
    const lead = await this.prisma.lead.findUnique({
      where: {
        id_organizationId: {
          id: input.leadId,
          organizationId: input.organizationId
        }
      },
      include: {
        contacts: true
      }
    });

    if (!lead) {
      throw new OutreachServiceError({
        code: 'NOT_FOUND',
        message: 'Lead not found in organization'
      });
    }

    // 4. Sales Executive Assignment Boundary
    if (input.authenticatedUserRole === Role.SALES_EXECUTIVE) {
      if (!lead.assignedUserId || lead.assignedUserId !== input.authenticatedUserId) {
        throw new OutreachServiceError({
          code: 'FORBIDDEN',
          message: 'Sales Executives can only initiate outreach for leads assigned to them'
        });
      }
    }

    // 5. Load Draft Scoped by Organization
    const draft = await this.prisma.salesAssistantDraft.findUnique({
      where: {
        id_organizationId: {
          id: input.draftId,
          organizationId: input.organizationId
        }
      }
    });

    if (!draft) {
      throw new OutreachServiceError({
        code: 'NOT_FOUND',
        message: 'Sales assistant draft not found in organization'
      });
    }

    // Invariant: Draft must belong to requested Lead
    if (draft.leadId !== lead.id) {
      throw new OutreachServiceError({
        code: OutreachErrorCode.OUTREACH_DRAFT_NOT_APPROVED,
        message: 'Sales assistant draft does not belong to the specified lead'
      });
    }

    // Invariant: Draft must be APPROVED with human approver recorded
    const draftStatus = draft.status as unknown as SalesAssistantDraftStatus;
    if (
      draftStatus !== SalesAssistantDraftStatus.APPROVED ||
      !draft.approvedAt ||
      !draft.approvedByUserId
    ) {
      throw new OutreachServiceError({
        code: OutreachErrorCode.OUTREACH_DRAFT_NOT_APPROVED,
        message: 'Only approved sales assistant drafts can be dispatched'
      });
    }

    // 6. Channel Compatibility Enforcement
    const draftType = draft.type as unknown as SalesAssistantDraftType;
    if (!isOutreachChannelCompatible(draftType, input.channel)) {
      throw new OutreachServiceError({
        code: OutreachErrorCode.OUTREACH_CHANNEL_INCOMPATIBLE,
        message: `Channel ${input.channel} is incompatible with draft type ${draft.type}`
      });
    }

    // 7. Resolve Recipient Trust & Contact Provenance (PHONE != WHATSAPP)
    const { resolvedRecipientContactId, resolvedRecipientNormalized } =
      this.resolveRecipient(lead, input.channel, input.recipientContactId);

    // 8. Extract Immutable Transport Snapshot from Approved Draft
    const { snapshotSubject, snapshotBody, snapshotContent } =
      this.buildApprovedSnapshot(draft, input.channel);

    // 9. Compute Hashes
    const approvedDraftSnapshotHash = computeApprovedDraftSnapshotHash({
      channel: input.channel,
      subject: snapshotSubject,
      body: snapshotBody,
      content: snapshotContent
    });

    const requestFingerprint = computeRequestFingerprint({
      organizationId: input.organizationId,
      leadId: lead.id,
      draftId: draft.id,
      channel: input.channel,
      recipientNormalized: resolvedRecipientNormalized,
      recipientContactId: resolvedRecipientContactId
    });

    // 10. Idempotency Handling
    const existing = await this.prisma.outreachDelivery.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey: input.idempotencyKey
        }
      }
    });

    if (existing) {
      if (existing.requestFingerprint === requestFingerprint) {
        const existingStatus = existing.status as unknown as OutreachDeliveryStatus;
        if (existingStatus === OutreachDeliveryStatus.REQUESTED) {
          // CASE 2: REQUESTED recovery attempt -> check Gate A before re-attempting enqueue
          await this.checkSuppressionGateA(
            input.organizationId,
            input.channel,
            resolvedRecipientNormalized,
            now
          );

          try {
            await this.queue.enqueue({ deliveryId: existing.id });
            const updateResult = await this.prisma.outreachDelivery.updateMany({
              where: {
                id: existing.id,
                organizationId: input.organizationId,
                status: OutreachDeliveryStatus.REQUESTED as any
              },
              data: {
                status: OutreachDeliveryStatus.QUEUED as any,
                queuedAt: now
              }
            });
            if (updateResult.count === 0) {
              const reloaded = await this.prisma.outreachDelivery.findUnique({
                where: { id: existing.id }
              });
              return this.mapToSummary(reloaded ?? existing);
            }
            return this.mapToSummary({
              ...existing,
              status: OutreachDeliveryStatus.QUEUED,
              queuedAt: now
            });
          } catch (queueErr) {
            throw new OutreachServiceError({
              code: 'QUEUE_ERROR',
              message: 'Failed to enqueue outreach delivery for background processing',
              cause: queueErr
            });
          }
        }

        // CASE 1: Non-REQUESTED replay -> return historical delivery immediately without re-running Gate A
        return this.mapToSummary(existing);
      } else {
        // CASE 3: Different fingerprint -> throw idempotency conflict
        throw new OutreachServiceError({
          code: OutreachErrorCode.OUTREACH_IDEMPOTENCY_KEY_REUSED,
          message: 'Idempotency-Key has already been used with different request parameters'
        });
      }
    }

    // CASE 4: No existing delivery -> Run Gate A BEFORE creation
    await this.checkSuppressionGateA(
      input.organizationId,
      input.channel,
      resolvedRecipientNormalized,
      now
    );

    // 11. Create New Delivery Record in REQUESTED Status
    let delivery: any;
    try {
      delivery = await this.prisma.outreachDelivery.create({
        data: {
          organizationId: input.organizationId,
          leadId: lead.id,
          draftId: draft.id,
          channel: input.channel as any,
          status: OutreachDeliveryStatus.REQUESTED as any,
          recipientContactId: resolvedRecipientContactId,
          recipientNormalized: resolvedRecipientNormalized,
          snapshotSubject,
          snapshotBody,
          snapshotContent,
          approvedDraftSnapshotHash,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint,
          attemptCount: 0,
          requestedByUserId: input.authenticatedUserId,
          requestedAt: now,
          queuedAt: null
        }
      });
    } catch (dbErr: any) {
      // Handle concurrent insert race via unique constraint P2002
      if (
        dbErr?.code === 'P2002' ||
        (typeof dbErr?.message === 'string' && dbErr.message.includes('unique constraint'))
      ) {
        const raced = await this.prisma.outreachDelivery.findUnique({
          where: {
            organizationId_idempotencyKey: {
              organizationId: input.organizationId,
              idempotencyKey: input.idempotencyKey
            }
          }
        });
        if (raced) {
          if (raced.requestFingerprint === requestFingerprint) {
            const racedStatus = raced.status as unknown as OutreachDeliveryStatus;
            if (racedStatus === OutreachDeliveryStatus.REQUESTED) {
              await this.checkSuppressionGateA(
                input.organizationId,
                input.channel,
                resolvedRecipientNormalized,
                now
              );

              try {
                await this.queue.enqueue({ deliveryId: raced.id });
                const updateResult = await this.prisma.outreachDelivery.updateMany({
                  where: {
                    id: raced.id,
                    organizationId: input.organizationId,
                    status: OutreachDeliveryStatus.REQUESTED as any
                  },
                  data: {
                    status: OutreachDeliveryStatus.QUEUED as any,
                    queuedAt: now
                  }
                });
                if (updateResult.count === 0) {
                  const reloaded = await this.prisma.outreachDelivery.findUnique({
                    where: { id: raced.id }
                  });
                  return this.mapToSummary(reloaded ?? raced);
                }
                return this.mapToSummary({
                  ...raced,
                  status: OutreachDeliveryStatus.QUEUED,
                  queuedAt: now
                });
              } catch (queueErr) {
                throw new OutreachServiceError({
                  code: 'QUEUE_ERROR',
                  message: 'Failed to enqueue outreach delivery for background processing',
                  cause: queueErr
                });
              }
            }
            return this.mapToSummary(raced);
          } else {
            throw new OutreachServiceError({
              code: OutreachErrorCode.OUTREACH_IDEMPOTENCY_KEY_REUSED,
              message: 'Idempotency-Key has already been used with different request parameters'
            });
          }
        }
      }
      throw dbErr;
    }

    // 12. Enqueue Outside DB Transaction Boundary
    try {
      await this.queue.enqueue({ deliveryId: delivery.id });
      const updateResult = await this.prisma.outreachDelivery.updateMany({
        where: {
          id: delivery.id,
          organizationId: input.organizationId,
          status: OutreachDeliveryStatus.REQUESTED as any
        },
        data: {
          status: OutreachDeliveryStatus.QUEUED as any,
          queuedAt: now
        }
      });
      if (updateResult.count === 0) {
        // Reload authoritative delivery to preserve newer state
        const reloaded = await this.prisma.outreachDelivery.findUnique({
          where: { id: delivery.id }
        });
        return this.mapToSummary(reloaded ?? delivery);
      }
      return this.mapToSummary({
        ...delivery,
        status: OutreachDeliveryStatus.QUEUED,
        queuedAt: now
      });
    } catch (queueErr) {
      // Keep record in REQUESTED status for retry recovery
      throw new OutreachServiceError({
        code: 'QUEUE_ERROR',
        message: 'Outreach delivery created but background queueing failed; delivery remains in REQUESTED status for retry',
        cause: queueErr
      });
    }
  }

  private validateIdempotencyKey(key: unknown): void {
    const parseResult = outreachIdempotencyKeySchema.safeParse(key);
    if (!parseResult.success) {
      throw new OutreachServiceError({
        code: 'INVALID_INPUT',
        message: parseResult.error.errors[0]?.message ?? 'Invalid Idempotency-Key'
      });
    }
  }

  private checkRoleAuthorization(role: Role): void {
    if (!hasPermission(role, Permissions.OUTREACH_SEND)) {
      throw new OutreachServiceError({
        code: 'FORBIDDEN',
        message: `Role ${role} is not authorized to dispatch outreach deliveries`
      });
    }
  }

  private resolveRecipient(
    lead: {
      id: string;
      primaryEmail: string | null;
      primaryPhone: string | null;
      contacts: Array<{
        id: string;
        leadId: string;
        type: any;
        rawValue: string;
        normalizedValue: string;
        status: any;
        whatsappStatus: any;
        isPrimary: boolean;
      }>;
    },
    channel: OutreachChannel,
    recipientContactId?: string
  ): {
    resolvedRecipientContactId: string | null;
    resolvedRecipientNormalized: string;
  } {
    if (recipientContactId) {
      const contact = lead.contacts.find((c) => c.id === recipientContactId);
      if (!contact) {
        throw new OutreachServiceError({
          code: OutreachErrorCode.OUTREACH_RECIPIENT_INVALID,
          message: 'Specified recipient contact ID does not belong to lead'
        });
      }

      if (channel === OutreachChannel.WHATSAPP) {
        if (contact.type !== ContactType.WHATSAPP) {
          throw new OutreachServiceError({
            code: OutreachErrorCode.OUTREACH_RECIPIENT_INVALID,
            message: 'Selected contact is not a WhatsApp contact (PHONE != WHATSAPP)'
          });
        }
        const isVerified =
          contact.status === ContactStatus.VERIFIED ||
          contact.whatsappStatus === WhatsAppStatus.PUBLICLY_LISTED ||
          contact.whatsappStatus === WhatsAppStatus.CONFIRMED;

        if (!isVerified) {
          throw new OutreachServiceError({
            code: OutreachErrorCode.OUTREACH_RECIPIENT_INVALID,
            message: 'Selected WhatsApp contact does not have verified provenance'
          });
        }

        const phoneNorm = normalizePhone(contact.normalizedValue || contact.rawValue);
        const normalized = phoneNorm.normalizedValue || contact.normalizedValue.trim();

        return {
          resolvedRecipientContactId: contact.id,
          resolvedRecipientNormalized: normalized
        };
      } else {
        // EMAIL
        if (contact.type !== ContactType.EMAIL) {
          throw new OutreachServiceError({
            code: OutreachErrorCode.OUTREACH_RECIPIENT_INVALID,
            message: 'Selected contact is not an Email contact'
          });
        }
        const normalized = (contact.normalizedValue || contact.rawValue).trim().toLowerCase();
        if (!normalized || !normalized.includes('@')) {
          throw new OutreachServiceError({
            code: OutreachErrorCode.OUTREACH_RECIPIENT_INVALID,
            message: 'Selected Email contact has invalid email format'
          });
        }
        return {
          resolvedRecipientContactId: contact.id,
          resolvedRecipientNormalized: normalized
        };
      }
    }

    // Auto-resolve recipient when recipientContactId is omitted
    if (channel === OutreachChannel.WHATSAPP) {
      const waContacts = lead.contacts.filter(
        (c) =>
          c.type === ContactType.WHATSAPP &&
          (c.status === ContactStatus.VERIFIED ||
            c.whatsappStatus === WhatsAppStatus.PUBLICLY_LISTED ||
            c.whatsappStatus === WhatsAppStatus.CONFIRMED)
      );

      if (waContacts.length === 0) {
        throw new OutreachServiceError({
          code: OutreachErrorCode.OUTREACH_RECIPIENT_INVALID,
          message: 'No verified WhatsApp contact found for lead (PHONE != WHATSAPP)'
        });
      }

      if (waContacts.length > 1) {
        throw new OutreachServiceError({
          code: OutreachErrorCode.OUTREACH_RECIPIENT_INVALID,
          message: 'Multiple verified WhatsApp contacts found; recipientContactId must be specified'
        });
      }

      const target = waContacts[0]!;
      const phoneNorm = normalizePhone(target.normalizedValue || target.rawValue);
      const normalized = phoneNorm.normalizedValue || target.normalizedValue.trim();

      return {
        resolvedRecipientContactId: target.id,
        resolvedRecipientNormalized: normalized
      };
    } else {
      // EMAIL
      const emailContacts = lead.contacts.filter((c) => c.type === ContactType.EMAIL);

      if (emailContacts.length === 1) {
        const target = emailContacts[0]!;
        const normalized = (target.normalizedValue || target.rawValue).trim().toLowerCase();
        return {
          resolvedRecipientContactId: target.id,
          resolvedRecipientNormalized: normalized
        };
      }

      if (emailContacts.length > 1) {
        const primaryEmails = emailContacts.filter((c) => c.isPrimary);
        if (primaryEmails.length === 1) {
          const target = primaryEmails[0]!;
          const normalized = (target.normalizedValue || target.rawValue).trim().toLowerCase();
          return {
            resolvedRecipientContactId: target.id,
            resolvedRecipientNormalized: normalized
          };
        }
        throw new OutreachServiceError({
          code: OutreachErrorCode.OUTREACH_RECIPIENT_INVALID,
          message: 'Multiple email contacts found; recipientContactId must be specified'
        });
      }

      // 0 email contacts in LeadContact: check lead.primaryEmail
      if (lead.primaryEmail && lead.primaryEmail.trim().length > 0) {
        const normalized = lead.primaryEmail.trim().toLowerCase();
        if (!normalized.includes('@')) {
          throw new OutreachServiceError({
            code: OutreachErrorCode.OUTREACH_RECIPIENT_INVALID,
            message: 'Lead primary email has invalid format'
          });
        }
        return {
          resolvedRecipientContactId: null,
          resolvedRecipientNormalized: normalized
        };
      }

      throw new OutreachServiceError({
        code: OutreachErrorCode.OUTREACH_RECIPIENT_INVALID,
        message: 'No trusted email contact found for lead'
      });
    }
  }

  private async checkSuppressionGateA(
    organizationId: string,
    channel: OutreachChannel,
    recipientNormalized: string,
    now: Date
  ): Promise<void> {
    if (channel === OutreachChannel.WHATSAPP) {
      const suppressed = await this.prisma.suppressionList.findFirst({
        where: {
          organizationId,
          normalizedValue: recipientNormalized,
          type: { in: [SuppressionType.WHATSAPP as any, SuppressionType.PHONE as any] },
          channelScope: { in: [ChannelScope.ALL as any, ChannelScope.WHATSAPP as any] },
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } }
          ]
        }
      });

      if (suppressed) {
        throw new OutreachServiceError({
          code: OutreachErrorCode.OUTREACH_RECIPIENT_SUPPRESSED,
          message: 'Recipient is suppressed from WhatsApp outreach delivery'
        });
      }
    } else {
      // EMAIL
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
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } }
          ]
        }
      });

      if (suppressed) {
        throw new OutreachServiceError({
          code: OutreachErrorCode.OUTREACH_RECIPIENT_SUPPRESSED,
          message: 'Recipient is suppressed from Email outreach delivery'
        });
      }
    }
  }

  private buildApprovedSnapshot(
    draft: {
      id: string;
      type: any;
      content: string | null;
      emailSubject: string | null;
      emailBody: string | null;
    },
    channel: OutreachChannel
  ): {
    snapshotSubject: string | null;
    snapshotBody: string | null;
    snapshotContent: string | null;
  } {
    if (channel === OutreachChannel.WHATSAPP) {
      if (!draft.content || draft.content.trim().length === 0) {
        throw new OutreachServiceError({
          code: OutreachErrorCode.OUTREACH_DRAFT_NOT_APPROVED,
          message: 'Approved WhatsApp draft is missing content'
        });
      }
      return {
        snapshotSubject: null,
        snapshotBody: null,
        snapshotContent: draft.content
      };
    } else {
      // EMAIL
      if (!draft.emailBody || draft.emailBody.trim().length === 0) {
        throw new OutreachServiceError({
          code: OutreachErrorCode.OUTREACH_DRAFT_NOT_APPROVED,
          message: 'Approved Email draft is missing body'
        });
      }
      return {
        snapshotSubject: draft.emailSubject ?? null,
        snapshotBody: draft.emailBody,
        snapshotContent: null
      };
    }
  }

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
      lastErrorCode: raw.lastErrorCode ?? undefined,
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
