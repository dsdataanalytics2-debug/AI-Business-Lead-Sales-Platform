/**
 * Demo Website Domain Service
 *
 * Implements business logic and orchestration for StoreMate demo website generation.
 * Enforces strict multi-tenancy, idempotency (one active demo per lead),
 * data minimization, contact trust safety (PHONE != WHATSAPP),
 * and lifecycle state transitions.
 *
 * NOTE: Provider calls are executed outside database transactions to prevent
 * holding open connections during asynchronous or external operations.
 */

import prisma, {
  ContactType,
  ContactStatus,
  WhatsAppStatus,
  type Prisma
} from '@leadmate/db';
import {
  DemoWebsiteStatus,
  DemoWebsiteProvider,
  type CreateDemoWebsiteRequest,
  type DemoWebsiteSummary,
  type StoreMateOutboundPayload,
  isValidDemoWebsiteTransition,
  DemoWebsiteErrorCode
} from '@leadmate/shared';
import {
  getDemoWebsiteProvider,
  type DemoWebsiteProviderClient
} from '@leadmate/storemate';
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors.js';

export interface DemoWebsiteRequestContext {
  organizationId: string;
  userId: string;
  correlationId?: string;
}

const DEFAULT_TTL_DAYS = 14;

/**
 * Reads and validates configured demo TTL in days.
 */
export function getConfiguredTtlDays(): number {
  const envVal = process.env.STOREMATE_DEMO_TTL_DAYS;
  if (!envVal) {
    return DEFAULT_TTL_DAYS;
  }
  const parsed = parseInt(envVal, 10);
  if (isNaN(parsed) || parsed <= 0 || parsed > 365) {
    return DEFAULT_TTL_DAYS;
  }
  return parsed;
}

/**
 * Calculates demo expiration timestamp from a ready timestamp.
 */
export function calculateDemoExpiresAt(readyAt: Date, ttlDays = getConfiguredTtlDays()): Date {
  const expiresAt = new Date(readyAt.getTime());
  expiresAt.setDate(expiresAt.getDate() + ttlDays);
  return expiresAt;
}

/**
 * Maps raw database entity to safe DemoWebsiteSummary contract.
 */
function mapToDemoWebsiteSummary(raw: {
  id: string;
  leadId: string;
  organizationId: string;
  status: DemoWebsiteStatus | string;
  provider: DemoWebsiteProvider | string;
  providerSiteId: string | null;
  demoUrl: string | null;
  requestedByUserId: string;
  requestedByUser?: { id: string; name: string; email: string } | null;
  readyAt: Date | null;
  expiresAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessageSafe: string | null;
  createdAt: Date;
  updatedAt: Date;
}): DemoWebsiteSummary {
  return {
    id: raw.id,
    leadId: raw.leadId,
    organizationId: raw.organizationId,
    status: raw.status as DemoWebsiteStatus,
    provider: raw.provider as DemoWebsiteProvider,
    providerSiteId: raw.providerSiteId,
    demoUrl: raw.demoUrl,
    requestedByUserId: raw.requestedByUserId,
    requestedByUser: raw.requestedByUser
      ? {
          id: raw.requestedByUser.id,
          name: raw.requestedByUser.name,
          email: raw.requestedByUser.email
        }
      : undefined,
    readyAt: raw.readyAt,
    expiresAt: raw.expiresAt,
    lastErrorCode: raw.lastErrorCode,
    lastErrorMessageSafe: raw.lastErrorMessageSafe,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
}

/**
 * Constructs normalized outbound payload strictly from verified lead data.
 * Adheres to data minimization and PHONE != WHATSAPP invariants.
 */
export function buildOutboundDemoPayload(
  lead: {
    id: string;
    organizationId: string;
    name: string;
    category: string;
    description: string | null;
    address: string | null;
    locality: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
    primaryPhone: string | null;
    primaryEmail: string | null;
    contacts?: Array<{
      type: ContactType;
      rawValue: string;
      normalizedValue: string;
      status: ContactStatus;
      whatsappStatus: WhatsAppStatus;
    }>;
  },
  customHeadline?: string | null,
  customDescription?: string | null,
  templateKey = 'generic-local-business'
): StoreMateOutboundPayload {
  // Construct formatted address
  const addressParts = [
    lead.address,
    lead.locality,
    lead.city,
    lead.region,
    lead.country
  ].filter(Boolean);
  const formattedAddress = addressParts.length > 0 ? addressParts.join(', ') : null;

  // Extract verified/public WhatsApp contact strictly (PHONE != WHATSAPP)
  let verifiedWhatsApp: string | null = null;
  if (lead.contacts && Array.isArray(lead.contacts)) {
    const waContact = lead.contacts.find(
      (c) =>
        c.type === ContactType.WHATSAPP &&
        (c.status === ContactStatus.VERIFIED ||
          c.whatsappStatus === WhatsAppStatus.PUBLICLY_LISTED ||
          c.whatsappStatus === WhatsAppStatus.CONFIRMED)
    );
    if (waContact) {
      verifiedWhatsApp = waContact.normalizedValue || waContact.rawValue;
    }
  }

  return {
    business: {
      name: lead.name,
      category: lead.category || null,
      description: customDescription ?? lead.description ?? null
    },
    contact: {
      phone: lead.primaryPhone || null,
      email: lead.primaryEmail || null,
      address: formattedAddress
    },
    social: {
      whatsapp: verifiedWhatsApp || undefined
    },
    metadata: {
      leadId: lead.id,
      organizationId: lead.organizationId,
      templateKey,
      isDemo: true,
      noindex: true,
      nofollow: true
    }
  };
}

export class DemoWebsiteService {
  /**
   * Retrieves tenant-scoped demo website record for a lead.
   */
  public async getDemoWebsite(
    ctx: DemoWebsiteRequestContext,
    leadId: string
  ): Promise<DemoWebsiteSummary> {
    const record = await prisma.demoWebsite.findUnique({
      where: {
        leadId_organizationId: {
          leadId,
          organizationId: ctx.organizationId
        }
      },
      include: {
        requestedByUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!record) {
      throw new NotFoundError('Demo website not found for this lead');
    }

    return mapToDemoWebsiteSummary(record);
  }

  /**
   * Requests creation or retrieval of a demo website for a lead.
   * Enforces idempotency (reuses existing READY demo if not expired).
   */
  public async requestDemoWebsite(
    ctx: DemoWebsiteRequestContext,
    leadId: string,
    request?: CreateDemoWebsiteRequest,
    providerOverride?: DemoWebsiteProviderClient
  ): Promise<DemoWebsiteSummary> {
    // 1. Validate Requester
    const user = await prisma.user.findFirst({
      where: {
        id: ctx.userId,
        organizationId: ctx.organizationId
      }
    });

    if (!user) {
      throw new NotFoundError('Requesting user not found in organization');
    }

    if (!user.isActive) {
      throw new ValidationError('Inactive users cannot request demo websites');
    }

    // 2. Validate Lead (tenant-safe)
    const lead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        organizationId: ctx.organizationId
      },
      include: {
        contacts: true
      }
    });

    if (!lead) {
      throw new NotFoundError('Lead not found in organization');
    }

    // 3. Check for existing DemoWebsite record
    const existing = await prisma.demoWebsite.findUnique({
      where: {
        leadId_organizationId: {
          leadId,
          organizationId: ctx.organizationId
        }
      },
      include: {
        requestedByUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    // Idempotency check: if READY and active, return existing
    if (existing) {
      const isExpired = existing.expiresAt ? existing.expiresAt.getTime() <= Date.now() : false;
      if (existing.status === DemoWebsiteStatus.READY && !isExpired) {
        return mapToDemoWebsiteSummary(existing);
      }
      if (existing.status === DemoWebsiteStatus.CREATING) {
        return mapToDemoWebsiteSummary(existing);
      }
    }

    // Determine target provider
    const providerType = (existing?.provider as DemoWebsiteProvider) ?? DemoWebsiteProvider.MOCK;
    const provider = providerOverride ?? getDemoWebsiteProvider(providerType);

    // 4. Upsert or update record to CREATING state (inside DB transaction)
    const txResult = await prisma.$transaction(async (tx) => {
      if (existing) {
        const updated = await tx.demoWebsite.update({
          where: { id: existing.id },
          data: {
            status: DemoWebsiteStatus.CREATING,
            lastErrorCode: null,
            lastErrorMessageSafe: null
          },
          include: {
            requestedByUser: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        });
        return { demoRecord: updated, isCreationOwner: true };
      } else {
        try {
          const created = await tx.demoWebsite.create({
            data: {
              organizationId: ctx.organizationId,
              leadId: lead.id,
              requestedByUserId: ctx.userId,
              provider: providerType,
              status: DemoWebsiteStatus.CREATING
            },
            include: {
              requestedByUser: {
                select: {
                  id: true,
                  name: true,
                  email: true
                }
              }
            }
          });
          return { demoRecord: created, isCreationOwner: true };
        } catch (err: unknown) {
          // Handle concurrent creation race (unique constraint violation P2002)
          if (
            err &&
            typeof err === 'object' &&
            'code' in err &&
            (err as { code: string }).code === 'P2002'
          ) {
            const concurrentRecord = await tx.demoWebsite.findUniqueOrThrow({
              where: {
                leadId_organizationId: {
                  leadId: lead.id,
                  organizationId: ctx.organizationId
                }
              },
              include: {
                requestedByUser: {
                  select: {
                    id: true,
                    name: true,
                    email: true
                  }
                }
              }
            });
            return { demoRecord: concurrentRecord, isCreationOwner: false };
          }
          throw err;
        }
      }
    });

    // If another concurrent request won the initial creation race, return existing state immediately
    // to prevent duplicate provider site creation.
    if (!txResult.isCreationOwner) {
      return mapToDemoWebsiteSummary(txResult.demoRecord);
    }

    let demoRecord = txResult.demoRecord;

    // 5. Build outbound payload and call provider OUTSIDE database transaction
    const outboundPayload = buildOutboundDemoPayload(
      lead,
      request?.customHeadline,
      request?.customDescription,
      request?.templateKey
    );

    let providerResult;
    try {
      providerResult = await provider.createDemo(outboundPayload);
    } catch (err: unknown) {
      providerResult = {
        providerSiteId: demoRecord.providerSiteId ?? `failed_${lead.id.slice(0, 8)}`,
        status: DemoWebsiteStatus.FAILED,
        demoUrl: null,
        readyAt: null,
        lastErrorCode: DemoWebsiteErrorCode.INTERNAL_ERROR,
        lastErrorMessageSafe: err instanceof Error ? err.message : 'Unknown provider error during demo creation'
      };
    }

    // 6. Persist result in DB
    const isSuccess = providerResult.status === DemoWebsiteStatus.READY;
    const readyAt = isSuccess ? (providerResult.readyAt ?? new Date()) : null;
    const expiresAt = isSuccess && readyAt ? calculateDemoExpiresAt(readyAt) : null;

    demoRecord = await prisma.demoWebsite.update({
      where: { id: demoRecord.id },
      data: {
        status: providerResult.status,
        providerSiteId: providerResult.providerSiteId,
        demoUrl: providerResult.demoUrl ?? null,
        readyAt,
        expiresAt,
        lastErrorCode: providerResult.lastErrorCode ?? null,
        lastErrorMessageSafe: providerResult.lastErrorMessageSafe ?? null
      },
      include: {
        requestedByUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    return mapToDemoWebsiteSummary(demoRecord);
  }

  /**
   * Regenerates a demo website for a lead, reusing the existing database record.
   */
  public async regenerateDemoWebsite(
    ctx: DemoWebsiteRequestContext,
    leadId: string,
    request?: CreateDemoWebsiteRequest,
    providerOverride?: DemoWebsiteProviderClient
  ): Promise<DemoWebsiteSummary> {
    const existing = await prisma.demoWebsite.findUnique({
      where: {
        leadId_organizationId: {
          leadId,
          organizationId: ctx.organizationId
        }
      }
    });

    if (!existing) {
      throw new NotFoundError('No existing demo website found for this lead. Use requestDemoWebsite instead.');
    }

    // Validate transition to REQUESTED/CREATING
    if (!isValidDemoWebsiteTransition(existing.status as DemoWebsiteStatus, DemoWebsiteStatus.REQUESTED) &&
        !isValidDemoWebsiteTransition(existing.status as DemoWebsiteStatus, DemoWebsiteStatus.CREATING)) {
      throw new ValidationError(`Cannot regenerate demo website from current status: ${existing.status}`);
    }

    // Delegate to requestDemoWebsite with same leadId
    return this.requestDemoWebsite(ctx, leadId, request, providerOverride);
  }

  /**
   * Marks a demo website expired on provider and database.
   */
  public async expireDemoWebsite(
    ctx: DemoWebsiteRequestContext,
    leadId: string,
    providerOverride?: DemoWebsiteProviderClient
  ): Promise<DemoWebsiteSummary> {
    const existing = await prisma.demoWebsite.findUnique({
      where: {
        leadId_organizationId: {
          leadId,
          organizationId: ctx.organizationId
        }
      },
      include: {
        requestedByUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!existing) {
      throw new NotFoundError('Demo website not found for this lead');
    }

    // Idempotent no-op if already EXPIRED
    if (existing.status === DemoWebsiteStatus.EXPIRED) {
      return mapToDemoWebsiteSummary(existing);
    }

    if (!isValidDemoWebsiteTransition(existing.status as DemoWebsiteStatus, DemoWebsiteStatus.EXPIRED)) {
      throw new ValidationError(`Cannot transition demo website from ${existing.status} to EXPIRED`);
    }

    // Provider expiration call
    const provider = providerOverride ?? getDemoWebsiteProvider(existing.provider as DemoWebsiteProvider);
    if (existing.providerSiteId) {
      await provider.expireDemo(existing.providerSiteId);
    }

    const updated = await prisma.demoWebsite.update({
      where: { id: existing.id },
      data: {
        status: DemoWebsiteStatus.EXPIRED
      },
      include: {
        requestedByUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    return mapToDemoWebsiteSummary(updated);
  }

  /**
   * Removes / unpublishes a demo website from provider and database.
   * Does NOT hard-delete the database record.
   */
  public async removeDemoWebsite(
    ctx: DemoWebsiteRequestContext,
    leadId: string,
    providerOverride?: DemoWebsiteProviderClient
  ): Promise<DemoWebsiteSummary> {
    const existing = await prisma.demoWebsite.findUnique({
      where: {
        leadId_organizationId: {
          leadId,
          organizationId: ctx.organizationId
        }
      },
      include: {
        requestedByUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!existing) {
      throw new NotFoundError('Demo website not found for this lead');
    }

    // Idempotent no-op if already REMOVED
    if (existing.status === DemoWebsiteStatus.REMOVED) {
      return mapToDemoWebsiteSummary(existing);
    }

    if (!isValidDemoWebsiteTransition(existing.status as DemoWebsiteStatus, DemoWebsiteStatus.REMOVED)) {
      throw new ValidationError(`Cannot transition demo website from ${existing.status} to REMOVED`);
    }

    // Provider removal call
    const provider = providerOverride ?? getDemoWebsiteProvider(existing.provider as DemoWebsiteProvider);
    if (existing.providerSiteId) {
      await provider.removeDemo(existing.providerSiteId);
    }

    const updated = await prisma.demoWebsite.update({
      where: { id: existing.id },
      data: {
        status: DemoWebsiteStatus.REMOVED,
        demoUrl: null
      },
      include: {
        requestedByUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    return mapToDemoWebsiteSummary(updated);
  }
}

export const demoWebsiteService = new DemoWebsiteService();
