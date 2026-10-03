/**
 * Master Lead Database Service
 *
 * Implements tenant-isolated Lead queries with cursor pagination,
 * full detail retrieval, secure PATCH updates with normalization and duplicate safety,
 * and manual contact creation with strict server-side normalization.
 */

import prisma, {
  Prisma,
  ContactType,
  PhoneType,
  WhatsAppStatus,
  CrmActivityType
} from '@leadmate/db';
import {
  type LeadListQuery,
  type LeadSummary,
  type LeadDetail,
  type LeadUpdateRequest,
  type ManualContactRequest,
  type LeadContact,
  type PaginatedResult,
  type LeadAssignmentRequest,
  type LeadAssignmentResponse
} from '@leadmate/shared';
import {
  normalizeBusinessName,
  normalizeWebsite,
  normalizeContact
} from '@leadmate/core';
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
  ValidationError
} from '../lib/errors.js';
import { invalidateLeadOnlinePresenceAnalysis } from './online-presence.service.js';

export interface LeadRequestContext {
  organizationId: string;
  userId: string;
  correlationId: string;
}

export class LeadService {
  /**
   * Lists leads for the authenticated organization with cursor pagination and filters.
   */
  async listLeads(
    query: LeadListQuery,
    context: LeadRequestContext
  ): Promise<PaginatedResult<LeadSummary>> {
    const {
      limit = 50,
      cursor,
      search,
      city,
      category,
      websiteStatus,
      onlinePresence,
      hasPhone,
      hasEmail,
      hasWhatsApp
    } = query;

    const { organizationId } = context;

    // 1. Build strict tenant-scoped WHERE filter
    const where: Prisma.LeadWhereInput = {
      organizationId
    };

    if (search) {
      const trimmed = search.trim();
      const norm = trimmed.toLowerCase();
      where.OR = [
        { name: { contains: trimmed, mode: 'insensitive' } },
        { normalizedName: { contains: norm, mode: 'insensitive' } },
        { primaryPhone: { contains: trimmed } },
        { primaryEmail: { contains: norm, mode: 'insensitive' } }
      ];
    }

    if (city) {
      where.city = { equals: city.trim(), mode: 'insensitive' };
    }

    if (category) {
      where.category = { equals: category.trim(), mode: 'insensitive' };
    }

    if (websiteStatus) {
      where.websiteStatus = websiteStatus as any;
    }

    if (onlinePresence) {
      where.onlinePresenceType = onlinePresence as any;
    }

    if (hasPhone === true) {
      where.primaryPhone = { not: null };
    } else if (hasPhone === false) {
      where.primaryPhone = null;
    }

    if (hasEmail === true) {
      where.primaryEmail = { not: null };
    } else if (hasEmail === false) {
      where.primaryEmail = null;
    }

    if (hasWhatsApp === true) {
      where.contacts = {
        some: {
          type: ContactType.WHATSAPP,
          whatsappStatus: { in: [WhatsAppStatus.PUBLICLY_LISTED, WhatsAppStatus.CONFIRMED] }
        }
      };
    } else if (hasWhatsApp === false) {
      where.contacts = {
        none: {
          type: ContactType.WHATSAPP,
          whatsappStatus: { in: [WhatsAppStatus.PUBLICLY_LISTED, WhatsAppStatus.CONFIRMED] }
        }
      };
    }

    // 2. Validate cursor security if provided
    if (cursor) {
      const cursorLead = await prisma.lead.findFirst({
        where: { id: cursor, organizationId }
      });

      if (!cursorLead) {
        throw new BadRequestError('Invalid pagination cursor');
      }
    }

    // 3. Query total count and paginated items in parallel
    const [total, rawLeads] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      })
    ]);

    const hasNextPage = rawLeads.length > limit;
    const items = hasNextPage ? rawLeads.slice(0, limit) : rawLeads;
    const nextCursor = hasNextPage ? items[items.length - 1].id : null;

    const mappedItems: LeadSummary[] = items.map((l) => ({
      id: l.id,
      name: l.name,
      normalizedName: l.normalizedName,
      category: l.category,
      locality: l.locality,
      city: l.city,
      region: l.region,
      country: l.country,
      primaryPhone: l.primaryPhone,
      primaryEmail: l.primaryEmail,
      website: l.website,
      websiteStatus: l.websiteStatus as any,
      onlinePresenceType: l.onlinePresenceType as any,
      rating: l.rating,
      reviewCount: l.reviewCount,
      primarySource: l.primarySource,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt
    }));

    return {
      data: mappedItems,
      nextCursor,
      total
    };
  }

  /**
   * Retrieves a single lead detail with contacts, evidence, and sanitized sources.
   */
  async getLeadById(id: string, context: LeadRequestContext): Promise<LeadDetail> {
    const { organizationId } = context;

    const lead = await prisma.lead.findFirst({
      where: {
        id,
        organizationId
      },
      include: {
        contacts: {
          include: { evidence: true },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
        },
        sources: {
          orderBy: { fetchedAt: 'desc' }
        }
      }
    });

    if (!lead) {
      throw new NotFoundError(`Lead with ID "${id}" not found`);
    }

    // Derive suppression metadata for direct contacts
    const suppressionEntries = await prisma.suppressionList.findMany({
      where: { organizationId }
    });
    const suppressionMap = new Map(suppressionEntries.map((s) => [s.normalizedValue, s.reason]));

    const contacts: LeadContact[] = lead.contacts.map((c) => ({
      id: c.id,
      leadId: c.leadId,
      type: c.type as any,
      rawValue: c.rawValue,
      normalizedValue: c.normalizedValue,
      phoneType: c.phoneType as any,
      status: c.status as any,
      whatsappStatus: c.whatsappStatus as any,
      isPrimary: c.isPrimary,
      isSuppressed: suppressionMap.has(c.normalizedValue),
      suppressionReason: (suppressionMap.get(c.normalizedValue) as any) || null,
      evidence: c.evidence.map((e) => ({
        id: e.id,
        contactId: e.contactId,
        sourceName: e.sourceName,
        sourceUrl: e.sourceUrl,
        evidenceType: e.evidenceType as any,
        snippet: e.snippet,
        discoveredAt: e.discoveredAt
      })),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    }));

    // Sanitize sources to avoid leaking raw provider internals
    const sources = lead.sources.map((s) => ({
      id: s.id,
      leadId: s.leadId,
      sourceName: s.sourceName,
      sourceExternalId: s.sourceExternalId,
      sourceUrl: s.sourceUrl,
      fetchedAt: s.fetchedAt
    }));

    return {
      id: lead.id,
      name: lead.name,
      normalizedName: lead.normalizedName,
      category: lead.category,
      description: lead.description,
      address: lead.address,
      locality: lead.locality,
      city: lead.city,
      region: lead.region,
      country: lead.country,
      latitude: lead.latitude,
      longitude: lead.longitude,
      primaryPhone: lead.primaryPhone,
      primaryEmail: lead.primaryEmail,
      website: lead.website,
      normalizedWebsite: lead.normalizedWebsite,
      websiteStatus: lead.websiteStatus as any,
      onlinePresenceType: lead.onlinePresenceType as any,
      rating: lead.rating,
      reviewCount: lead.reviewCount,
      primarySource: lead.primarySource,
      contacts,
      sources,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt
    };
  }

  /**
   * Updates lead scalar attributes with strict normalization, duplicate collision prevention,
   * and transactional audit logging.
   */
  async updateLead(
    id: string,
    input: LeadUpdateRequest,
    context: LeadRequestContext
  ): Promise<LeadDetail> {
    const { organizationId, userId } = context;

    const existing = await prisma.lead.findFirst({
      where: {
        id,
        organizationId
      }
    });

    if (!existing) {
      throw new NotFoundError(`Lead with ID "${id}" not found`);
    }

    // Normalization
    let normalizedName: string | undefined;
    if (input.name) {
      normalizedName = normalizeBusinessName(input.name);
    }

    let normalizedWebsite: string | null | undefined;
    if (input.website !== undefined) {
      if (input.website === null || input.website === '') {
        normalizedWebsite = null;
      } else {
        const webNorm = normalizeWebsite(input.website);
        if (!webNorm.isValid) {
          throw new BadRequestError(`Invalid website URL format: "${input.website}"`);
        }
        normalizedWebsite = webNorm.normalizedDomain;
      }
    }

    // Duplicate Safety: Prevent manual patch from creating an unsafe definite collision
    if (normalizedWebsite && normalizedWebsite !== existing.normalizedWebsite) {
      const duplicateWebsiteLead = await prisma.lead.findFirst({
        where: {
          organizationId,
          normalizedWebsite,
          id: { not: id }
        }
      });

      if (duplicateWebsiteLead) {
        throw new ConflictError(
          `Another lead with website "${normalizedWebsite}" already exists ("${duplicateWebsiteLead.name}")`
        );
      }
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.lead.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name, normalizedName } : {}),
          ...(input.category ? { category: input.category } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
          ...(input.locality !== undefined ? { locality: input.locality } : {}),
          ...(input.city ? { city: input.city } : {}),
          ...(input.website !== undefined ? { website: input.website, normalizedWebsite } : {})
        },
        include: {
          contacts: {
            include: { evidence: true },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
          },
          sources: {
            orderBy: { fetchedAt: 'desc' }
          }
        }
      });

      // Invalidate existing analysis if website was modified
      if (input.website !== undefined) {
        await invalidateLeadOnlinePresenceAnalysis(tx, organizationId, id, 'LEAD_PATCH');
      }

      // Audit Log
      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'lead.updated',
          entityType: 'Lead',
          entityId: id,
          before: {
            name: existing.name,
            category: existing.category,
            city: existing.city,
            website: existing.website,
            address: existing.address,
            locality: existing.locality
          },
          after: {
            name: updated.name,
            category: updated.category,
            city: updated.city,
            website: updated.website,
            address: updated.address,
            locality: updated.locality
          }
        }
      });

      const sources = updated.sources.map((s) => ({
        id: s.id,
        leadId: s.leadId,
        sourceName: s.sourceName,
        sourceExternalId: s.sourceExternalId,
        sourceUrl: s.sourceUrl,
        fetchedAt: s.fetchedAt
      }));

      return {
        id: updated.id,
        name: updated.name,
        normalizedName: updated.normalizedName,
        category: updated.category,
        description: updated.description,
        address: updated.address,
        locality: updated.locality,
        city: updated.city,
        region: updated.region,
        country: updated.country,
        latitude: updated.latitude,
        longitude: updated.longitude,
        primaryPhone: updated.primaryPhone,
        primaryEmail: updated.primaryEmail,
        website: updated.website,
        normalizedWebsite: updated.normalizedWebsite,
        websiteStatus: updated.websiteStatus as any,
        onlinePresenceType: updated.onlinePresenceType as any,
        rating: updated.rating,
        reviewCount: updated.reviewCount,
        primarySource: updated.primarySource,
        contacts: updated.contacts as any,
        sources,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt
      };
    });
  }

  /**
   * Adds a manual contact to an existing lead with server-side normalization,
   * duplicate handling with optional primary promotion, and strict WhatsApp safety.
   */
  async addManualContact(
    leadId: string,
    input: ManualContactRequest,
    context: LeadRequestContext
  ): Promise<LeadContact> {
    const { organizationId, userId } = context;

    const existingLead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        organizationId
      }
    });

    if (!existingLead) {
      throw new NotFoundError(`Lead with ID "${leadId}" not found`);
    }

    // Trust boundary: Client cannot claim WhatsApp CONFIRMED
    if (input.whatsappStatus === WhatsAppStatus.CONFIRMED) {
      throw new BadRequestError('Manual contact cannot be created with CONFIRMED WhatsApp status');
    }

    // Server-side normalization
    const norm = normalizeContact({
      type: input.type,
      rawValue: input.rawValue,
      whatsappStatus: input.whatsappStatus
    });

    // Manual contacts cannot fabricate trusted provider evidence.
    // WhatsApp status for manual entry is always UNKNOWN.
    const resolvedWaStatus =
      norm.type === ContactType.WHATSAPP
        ? WhatsAppStatus.UNKNOWN
        : norm.whatsappStatus;

    const shouldBePrimary = Boolean(input.isPrimary && norm.isValid);

    // Duplicate Check: Same type and normalizedValue within same lead
    const existingContact = await prisma.leadContact.findFirst({
      where: {
        leadId,
        type: norm.type,
        normalizedValue: norm.normalizedValue || norm.rawValue
      },
      include: { evidence: true }
    });

    if (existingContact) {
      // If primary promotion is requested on an existing non-primary contact
      if (shouldBePrimary && !existingContact.isPrimary) {
        return prisma.$transaction(async (tx) => {
          // Demote other contacts of the same type
          await tx.leadContact.updateMany({
            where: {
              leadId,
              id: { not: existingContact.id },
              type: norm.type
            },
            data: { isPrimary: false }
          });

          const updatedContact = await tx.leadContact.update({
            where: { id: existingContact.id },
            data: { isPrimary: true },
            include: { evidence: true }
          });

          // Lead.primaryPhone is exclusively for PHONE channel
          if (norm.type === ContactType.PHONE && norm.normalizedValue) {
            await tx.lead.update({
              where: { id: leadId },
              data: { primaryPhone: norm.normalizedValue }
            });
          } else if (norm.type === ContactType.EMAIL && norm.normalizedValue) {
            await tx.lead.update({
              where: { id: leadId },
              data: { primaryEmail: norm.normalizedValue }
            });
          }

          // Invalidate existing analysis upon promoting a contact to primary
          await invalidateLeadOnlinePresenceAnalysis(tx, organizationId, leadId, 'CONTACT_PROMOTED');

          // Transactional Audit Log for promotion
          await tx.auditLog.create({
            data: {
              organizationId,
              userId,
              action: 'lead.contact_updated',
              entityType: 'LeadContact',
              entityId: updatedContact.id,
              before: { isPrimary: false },
              after: { isPrimary: true }
            }
          });

          const suppressed = await tx.suppressionList.findFirst({
            where: {
              organizationId,
              normalizedValue: updatedContact.normalizedValue
            }
          });

          return {
            id: updatedContact.id,
            leadId: updatedContact.leadId,
            type: updatedContact.type as any,
            rawValue: updatedContact.rawValue,
            normalizedValue: updatedContact.normalizedValue,
            phoneType: updatedContact.phoneType as any,
            status: updatedContact.status as any,
            whatsappStatus: updatedContact.whatsappStatus as any,
            isPrimary: updatedContact.isPrimary,
            isSuppressed: !!suppressed,
            suppressionReason: (suppressed?.reason as any) || null,
            evidence: updatedContact.evidence.map((e) => ({
              id: e.id,
              contactId: e.contactId,
              sourceName: e.sourceName,
              sourceUrl: e.sourceUrl,
              evidenceType: e.evidenceType as any,
              snippet: e.snippet,
              discoveredAt: e.discoveredAt
            })),
            createdAt: updatedContact.createdAt,
            updatedAt: updatedContact.updatedAt
          };
        });
      }

      // Zero-mutation duplicate request: return existing safely with NO audit log
      const suppressed = await prisma.suppressionList.findFirst({
        where: {
          organizationId,
          normalizedValue: existingContact.normalizedValue
        }
      });

      return {
        id: existingContact.id,
        leadId: existingContact.leadId,
        type: existingContact.type as any,
        rawValue: existingContact.rawValue,
        normalizedValue: existingContact.normalizedValue,
        phoneType: existingContact.phoneType as any,
        status: existingContact.status as any,
        whatsappStatus: existingContact.whatsappStatus as any,
        isPrimary: existingContact.isPrimary,
        isSuppressed: !!suppressed,
        suppressionReason: (suppressed?.reason as any) || null,
        evidence: existingContact.evidence.map((e) => ({
          id: e.id,
          contactId: e.contactId,
          sourceName: e.sourceName,
          sourceUrl: e.sourceUrl,
          evidenceType: e.evidenceType as any,
          snippet: e.snippet,
          discoveredAt: e.discoveredAt
        })),
        createdAt: existingContact.createdAt,
        updatedAt: existingContact.updatedAt
      };
    }

    return prisma.$transaction(async (tx) => {
      const createdContact = await tx.leadContact.create({
        data: {
          leadId,
          type: norm.type,
          rawValue: norm.rawValue,
          normalizedValue: norm.normalizedValue || norm.rawValue,
          phoneType: norm.phoneType || PhoneType.UNKNOWN,
          status: norm.status,
          whatsappStatus: resolvedWaStatus,
          isPrimary: shouldBePrimary
        },
        include: { evidence: true }
      });

      // Primary promotion handling
      if (shouldBePrimary) {
        await tx.leadContact.updateMany({
          where: {
            leadId,
            id: { not: createdContact.id },
            type: norm.type
          },
          data: { isPrimary: false }
        });

        // Lead.primaryPhone is exclusively for PHONE channel
        if (norm.type === ContactType.PHONE && norm.normalizedValue) {
          await tx.lead.update({
            where: { id: leadId },
            data: { primaryPhone: norm.normalizedValue }
          });
        } else if (norm.type === ContactType.EMAIL && norm.normalizedValue) {
          await tx.lead.update({
            where: { id: leadId },
            data: { primaryEmail: norm.normalizedValue }
          });
        }
      } else {
        // Auto-promote if lead has no primary value and contact is valid
        if (
          !existingLead.primaryPhone &&
          norm.type === ContactType.PHONE &&
          norm.isValid &&
          norm.phoneType === PhoneType.MOBILE &&
          norm.normalizedValue
        ) {
          await tx.lead.update({
            where: { id: leadId },
            data: { primaryPhone: norm.normalizedValue }
          });
          await tx.leadContact.update({
            where: { id: createdContact.id },
            data: { isPrimary: true }
          });
          createdContact.isPrimary = true;
        } else if (
          !existingLead.primaryEmail &&
          norm.type === ContactType.EMAIL &&
          norm.isValid &&
          norm.normalizedValue
        ) {
          await tx.lead.update({
            where: { id: leadId },
            data: { primaryEmail: norm.normalizedValue }
          });
          await tx.leadContact.update({
            where: { id: createdContact.id },
            data: { isPrimary: true }
          });
          createdContact.isPrimary = true;
        }
      }

      // Audit Log for contact creation
      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'lead.contact_added',
          entityType: 'LeadContact',
          entityId: createdContact.id,
          after: {
            leadId,
            type: createdContact.type,
            rawValue: createdContact.rawValue,
            normalizedValue: createdContact.normalizedValue,
            phoneType: createdContact.phoneType,
            status: createdContact.status,
            isPrimary: createdContact.isPrimary
          }
        }
      });

      // Invalidate existing analysis upon adding a direct contact
      await invalidateLeadOnlinePresenceAnalysis(tx, organizationId, leadId, 'CONTACT_ADDED');

      // Suppression check
      const suppressed = await tx.suppressionList.findFirst({
        where: {
          organizationId,
          normalizedValue: createdContact.normalizedValue
        }
      });

      return {
        id: createdContact.id,
        leadId: createdContact.leadId,
        type: createdContact.type as any,
        rawValue: createdContact.rawValue,
        normalizedValue: createdContact.normalizedValue,
        phoneType: createdContact.phoneType as any,
        status: createdContact.status as any,
        whatsappStatus: createdContact.whatsappStatus as any,
        isPrimary: createdContact.isPrimary,
        isSuppressed: !!suppressed,
        suppressionReason: (suppressed?.reason as any) || null,
        evidence: [],
        createdAt: createdContact.createdAt,
        updatedAt: createdContact.updatedAt
      };
    });
  }

  /**
   * Assigns, reassigns, or unassigns a lead to a team member within the same tenant.
   * Enforces tenant-safe lookups, active user validation, deterministic no-ops,
   * atomic CRM activity logging, and audit tracking.
   */
  async updateAssignment(
    id: string,
    input: LeadAssignmentRequest,
    context: LeadRequestContext
  ): Promise<LeadAssignmentResponse> {
    const { organizationId, userId } = context;
    const { assignedUserId } = input;

    return prisma.$transaction(async (tx) => {
      // 1. Verify lead exists and belongs to the authenticated tenant
      const existingLead = await tx.lead.findFirst({
        where: {
          id,
          organizationId
        },
        include: {
          assignedUser: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      });

      if (!existingLead) {
        throw new NotFoundError(`Lead with ID "${id}" not found`);
      }

      // 2. If assigning to a user, verify assignee exists in the same tenant and is active
      if (assignedUserId !== null) {
        const targetUser = await tx.user.findFirst({
          where: {
            id: assignedUserId,
            organizationId
          },
          select: {
            id: true,
            name: true,
            email: true,
            isActive: true
          }
        });

        if (!targetUser) {
          throw new NotFoundError(`Assignee user with ID "${assignedUserId}" not found`);
        }

        if (!targetUser.isActive) {
          throw new ValidationError('Selected assignee is inactive');
        }
      }

      const previousAssignedUserId = existingLead.assignedUserId;

      // 3. Check for No-op (same user -> same user, or null -> null)
      if (previousAssignedUserId === assignedUserId) {
        return {
          leadId: existingLead.id,
          assignedUserId: existingLead.assignedUserId,
          assignedAt: existingLead.assignedAt,
          assignedUser: existingLead.assignedUser
            ? {
                id: existingLead.assignedUser.id,
                name: existingLead.assignedUser.name,
                email: existingLead.assignedUser.email
              }
            : null
        };
      }

      // 4. Determine operation, activity type, metadata, and assignedAt
      let operation: 'ASSIGN' | 'REASSIGN' | 'UNASSIGN';
      let activityType: CrmActivityType;
      let activityMetadata: Prisma.InputJsonValue;
      let assignedAt: Date | null;

      if (previousAssignedUserId === null && assignedUserId !== null) {
        operation = 'ASSIGN';
        activityType = CrmActivityType.LEAD_ASSIGNED;
        activityMetadata = { assignedUserId };
        assignedAt = new Date();
      } else if (previousAssignedUserId !== null && assignedUserId !== null) {
        operation = 'REASSIGN';
        activityType = CrmActivityType.LEAD_REASSIGNED;
        activityMetadata = { previousAssignedUserId, assignedUserId };
        assignedAt = new Date();
      } else {
        // previousAssignedUserId !== null && assignedUserId === null
        operation = 'UNASSIGN';
        activityType = CrmActivityType.LEAD_UNASSIGNED;
        activityMetadata = { previousAssignedUserId };
        assignedAt = null;
      }

      // 5. Update lead assignment
      const updatedLead = await tx.lead.update({
        where: { id },
        data: {
          assignedUserId,
          assignedAt
        },
        include: {
          assignedUser: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      });

      // 6. Record CRM activity
      await tx.crmActivity.create({
        data: {
          organizationId,
          leadId: id,
          actorUserId: userId,
          type: activityType,
          metadata: activityMetadata
        }
      });

      // 7. Record Audit Log
      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'lead.assignment_changed',
          entityType: 'Lead',
          entityId: id,
          before: {
            assignedUserId: previousAssignedUserId
          },
          after: {
            assignedUserId,
            operation
          }
        }
      });

      return {
        leadId: updatedLead.id,
        assignedUserId: updatedLead.assignedUserId,
        assignedAt: updatedLead.assignedAt,
        assignedUser: updatedLead.assignedUser
          ? {
              id: updatedLead.assignedUser.id,
              name: updatedLead.assignedUser.name,
              email: updatedLead.assignedUser.email
            }
          : null
      };
    });
  }
}

export const leadService = new LeadService();
