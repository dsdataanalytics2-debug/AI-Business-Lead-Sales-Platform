/**
 * AI Sales Assistant Domain Service
 *
 * Implements business logic and orchestration for AI Sales Assistant draft generation
 * and review lifecycle (DRAFT -> APPROVED / REJECTED).
 *
 * Invariants:
 * - Pure multi-tenancy: lookups always scoped by (organizationId, leadId)
 * - Safe context projection: strict data minimization, no credentials/CRM notes passed to AI
 * - Contact safety: PHONE != WHATSAPP strictly enforced during projection
 * - Provider decoupling: AI generation runs outside database transaction
 * - Auditability: authoritative audit logging for generation, approval, and rejection
 * - Human approval: initial draft status is always DRAFT; approve/reject transitions are atomic and guarded
 */

import prisma, {
  ContactType,
  ContactStatus,
  WhatsAppStatus,
  SalesAssistantDraftStatus,
  SalesAssistantDraftType,
  type SalesAssistantWarning
} from '@leadmate/db';
import {
  type GenerateSalesAssistantDraftRequest,
  type SalesAssistantDraftSummary,
  generatedSalesAssistantDraftSchema
} from '@leadmate/shared';
import {
  getSalesAssistantProvider,
  type SalesAssistantProviderClient,
  type NormalizedSalesAssistantInput,
  type NormalizedLeadContext
} from '@leadmate/ai';
import { NotFoundError, ConflictError } from '../lib/errors.js';

export interface SalesAssistantRequestContext {
  organizationId: string;
  userId: string;
  correlationId?: string;
}

interface RawDraftRecord {
  id: string;
  leadId: string;
  organizationId: string;
  type: string;
  language: string;
  tone: string;
  status: string;
  objective: string | null;
  customInstruction: string | null;
  content: string | null;
  emailSubject: string | null;
  emailBody: string | null;
  warnings: SalesAssistantWarning[];
  createdByUserId: string;
  createdByUser?: { id: string; name: string; email: string } | null;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  approvedByUser?: { id: string; name: string; email: string } | null;
  rejectedAt: Date | null;
  rejectedByUserId: string | null;
  rejectedByUser?: { id: string; name: string; email: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Maps raw database entity to safe SalesAssistantDraftSummary contract.
 * Zero provider metadata, system prompts, reasoning, or raw tokens exposed.
 */
function mapToDraftSummary(raw: RawDraftRecord): SalesAssistantDraftSummary {
  return {
    id: raw.id,
    leadId: raw.leadId,
    organizationId: raw.organizationId,
    type: raw.type as SalesAssistantDraftSummary['type'],
    language: raw.language as SalesAssistantDraftSummary['language'],
    tone: raw.tone as SalesAssistantDraftSummary['tone'],
    status: raw.status as SalesAssistantDraftSummary['status'],
    objective: raw.objective ?? undefined,
    content: raw.content ?? undefined,
    emailSubject: raw.emailSubject ?? undefined,
    emailBody: raw.emailBody ?? undefined,
    warnings: raw.warnings as unknown as SalesAssistantDraftSummary['warnings'],
    createdByUserId: raw.createdByUserId,
    createdByUser: raw.createdByUser
      ? {
          id: raw.createdByUser.id,
          name: raw.createdByUser.name,
          email: raw.createdByUser.email
        }
      : undefined,
    approvedAt: raw.approvedAt ?? undefined,
    approvedByUserId: raw.approvedByUserId ?? undefined,
    approvedByUser: raw.approvedByUser
      ? {
          id: raw.approvedByUser.id,
          name: raw.approvedByUser.name,
          email: raw.approvedByUser.email
        }
      : undefined,
    rejectedAt: raw.rejectedAt ?? undefined,
    rejectedByUserId: raw.rejectedByUserId ?? undefined,
    rejectedByUser: raw.rejectedByUser
      ? {
          id: raw.rejectedByUser.id,
          name: raw.rejectedByUser.name,
          email: raw.rejectedByUser.email
        }
      : undefined,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
}

/**
 * Extracts and projects safe lead context for AI generation.
 * Enforces strict data minimization and PHONE != WHATSAPP.
 */
export function buildNormalizedLeadContext(lead: {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  locality: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  website: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  contacts?: Array<{
    type: ContactType;
    rawValue: string;
    normalizedValue: string;
    status: ContactStatus;
    whatsappStatus: WhatsAppStatus;
  }>;
}): NormalizedLeadContext {
  // Format location string safely from address components
  const locationParts = [lead.locality, lead.city, lead.region, lead.country].filter(Boolean);
  const location = locationParts.length > 0 ? locationParts.join(', ') : undefined;

  // Extract verified/public WhatsApp contact strictly (PHONE != WHATSAPP invariant)
  let verifiedWhatsApp: string | undefined = undefined;
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
    leadId: lead.id,
    businessName: lead.name,
    category: lead.category || undefined,
    description: lead.description || undefined,
    location,
    website: lead.website || undefined,
    email: lead.primaryEmail || undefined,
    phone: lead.primaryPhone || undefined,
    whatsapp: verifiedWhatsApp
  };
}

export class SalesAssistantService {
  private defaultProvider: SalesAssistantProviderClient;

  constructor(provider?: SalesAssistantProviderClient) {
    this.defaultProvider = provider ?? getSalesAssistantProvider('MOCK');
  }

  /**
   * Override default provider instance (e.g. for testing controlled failure modes).
   */
  public setDefaultProvider(provider: SalesAssistantProviderClient): void {
    this.defaultProvider = provider;
  }

  /**
   * Reset default provider instance back to default MOCK provider.
   */
  public resetDefaultProvider(): void {
    this.defaultProvider = getSalesAssistantProvider('MOCK');
  }

  /**
   * Generates a sales assistant draft for a lead.
   *
   * Flow:
   * 1. Tenant-safe lead lookup
   * 2. Safe context projection (PHONE != WHATSAPP)
   * 3. AI Provider invocation (executed outside DB transaction)
   * 4. Output schema validation
   * 5. Atomic persistence + audit log creation
   */
  public async generateDraft(
    ctx: SalesAssistantRequestContext,
    leadId: string,
    input: GenerateSalesAssistantDraftRequest,
    providerOverride?: SalesAssistantProviderClient
  ): Promise<SalesAssistantDraftSummary> {
    const { organizationId, userId } = ctx;

    // 1. Tenant-safe lead lookup
    const lead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        organizationId
      },
      include: {
        contacts: true,
        organization: true
      }
    });

    if (!lead) {
      throw new NotFoundError(`Lead with ID "${leadId}" not found`);
    }

    // 2. Safe normalized lead context
    const leadContext = buildNormalizedLeadContext(lead);

    // Trusted business context from organization (verified company name; product/price not fabricated)
    const businessContext = lead.organization
      ? { companyName: lead.organization.name }
      : undefined;

    const normalizedInput: NormalizedSalesAssistantInput = {
      draftType: input.type,
      language: input.language,
      tone: input.tone,
      objective: input.objective,
      customInstruction: input.customInstruction,
      leadContext,
      businessContext
    };

    // 3. Resolve AI provider (default MOCK or injected/overridden in tests)
    const provider = providerOverride ?? this.defaultProvider;

    // 4. Invoke provider OUTSIDE database transaction
    const generated = await provider.generateDraft(normalizedInput);

    // 5. Guaranteed contract validation
    const validatedDraft = generatedSalesAssistantDraftSchema.parse(generated);

    // 6. Atomic persistence + AuditLog in a short transaction
    return prisma.$transaction(async (tx) => {
      const isEmail = validatedDraft.type === SalesAssistantDraftType.EMAIL;

      const created = await tx.salesAssistantDraft.create({
        data: {
          organizationId,
          leadId,
          createdByUserId: userId,
          type: validatedDraft.type,
          language: validatedDraft.language,
          tone: validatedDraft.tone,
          status: SalesAssistantDraftStatus.DRAFT,
          objective: input.objective ?? null,
          customInstruction: input.customInstruction ?? null,
          content: isEmail ? null : validatedDraft.content,
          emailSubject: isEmail ? validatedDraft.subject : null,
          emailBody: isEmail ? validatedDraft.body : null,
          warnings: validatedDraft.warnings ?? []
        },
        include: {
          createdByUser: {
            select: { id: true, name: true, email: true }
          },
          approvedByUser: {
            select: { id: true, name: true, email: true }
          },
          rejectedByUser: {
            select: { id: true, name: true, email: true }
          }
        }
      });

      // 7. Audit log creation with minimized metadata (NO content, NO secrets, NO system prompts)
      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'lead.sales_assistant_draft_generated',
          entityType: 'SalesAssistantDraft',
          entityId: created.id,
          after: {
            leadId,
            type: created.type,
            language: created.language,
            tone: created.tone,
            warningsCount: created.warnings.length,
            warnings: created.warnings
          }
        }
      });

      return mapToDraftSummary(created as unknown as RawDraftRecord);
    });
  }

  /**
   * Retrieves a single sales assistant draft by leadId and draftId within the caller's organization.
   */
  public async getDraft(
    ctx: SalesAssistantRequestContext,
    leadId: string,
    draftId: string
  ): Promise<SalesAssistantDraftSummary> {
    const { organizationId } = ctx;

    const draft = await prisma.salesAssistantDraft.findFirst({
      where: {
        id: draftId,
        leadId,
        organizationId
      },
      include: {
        createdByUser: {
          select: { id: true, name: true, email: true }
        },
        approvedByUser: {
          select: { id: true, name: true, email: true }
        },
        rejectedByUser: {
          select: { id: true, name: true, email: true }
        }
      }
    });

    if (!draft) {
      throw new NotFoundError('Sales assistant draft not found');
    }

    return mapToDraftSummary(draft as unknown as RawDraftRecord);
  }

  /**
   * Lists all sales assistant drafts for a lead in chronological order (newest first).
   */
  public async listDrafts(
    ctx: SalesAssistantRequestContext,
    leadId: string
  ): Promise<SalesAssistantDraftSummary[]> {
    const { organizationId } = ctx;

    // Verify lead existence first to avoid revealing existence across tenants
    const lead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        organizationId
      },
      select: { id: true }
    });

    if (!lead) {
      throw new NotFoundError(`Lead with ID "${leadId}" not found`);
    }

    const drafts = await prisma.salesAssistantDraft.findMany({
      where: {
        leadId,
        organizationId
      },
      include: {
        createdByUser: {
          select: { id: true, name: true, email: true }
        },
        approvedByUser: {
          select: { id: true, name: true, email: true }
        },
        rejectedByUser: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' }
      ]
    });

    return drafts.map((d) => mapToDraftSummary(d as unknown as RawDraftRecord));
  }

  /**
   * Approves a sales assistant draft (DRAFT -> APPROVED).
   * Guards against concurrent review mutations and invalid transitions.
   */
  public async approveDraft(
    ctx: SalesAssistantRequestContext,
    leadId: string,
    draftId: string
  ): Promise<SalesAssistantDraftSummary> {
    const { organizationId, userId } = ctx;
    const now = new Date();

    return prisma.$transaction(async (tx) => {
      // Conditional update for atomic DRAFT -> APPROVED transition
      const updateResult = await tx.salesAssistantDraft.updateMany({
        where: {
          id: draftId,
          leadId,
          organizationId,
          status: SalesAssistantDraftStatus.DRAFT
        },
        data: {
          status: SalesAssistantDraftStatus.APPROVED,
          approvedAt: now,
          approvedByUserId: userId,
          rejectedAt: null,
          rejectedByUserId: null
        }
      });

      if (updateResult.count === 0) {
        // Distinguish NotFound from Conflict/Terminal state
        const existing = await tx.salesAssistantDraft.findFirst({
          where: {
            id: draftId,
            leadId,
            organizationId
          }
        });

        if (!existing) {
          throw new NotFoundError('Sales assistant draft not found');
        }

        throw new ConflictError(
          `Cannot approve draft with status '${existing.status}'. Only drafts in '${SalesAssistantDraftStatus.DRAFT}' status can be reviewed.`
        );
      }

      const updated = await tx.salesAssistantDraft.findUniqueOrThrow({
        where: {
          id_organizationId: {
            id: draftId,
            organizationId
          }
        },
        include: {
          createdByUser: {
            select: { id: true, name: true, email: true }
          },
          approvedByUser: {
            select: { id: true, name: true, email: true }
          },
          rejectedByUser: {
            select: { id: true, name: true, email: true }
          }
        }
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'lead.sales_assistant_draft_approved',
          entityType: 'SalesAssistantDraft',
          entityId: draftId,
          before: {
            leadId,
            status: SalesAssistantDraftStatus.DRAFT
          },
          after: {
            leadId,
            status: SalesAssistantDraftStatus.APPROVED,
            approvedByUserId: userId,
            approvedAt: now.toISOString()
          }
        }
      });

      return mapToDraftSummary(updated as unknown as RawDraftRecord);
    });
  }

  /**
   * Rejects a sales assistant draft (DRAFT -> REJECTED).
   * Guards against concurrent review mutations and invalid transitions.
   */
  public async rejectDraft(
    ctx: SalesAssistantRequestContext,
    leadId: string,
    draftId: string
  ): Promise<SalesAssistantDraftSummary> {
    const { organizationId, userId } = ctx;
    const now = new Date();

    return prisma.$transaction(async (tx) => {
      // Conditional update for atomic DRAFT -> REJECTED transition
      const updateResult = await tx.salesAssistantDraft.updateMany({
        where: {
          id: draftId,
          leadId,
          organizationId,
          status: SalesAssistantDraftStatus.DRAFT
        },
        data: {
          status: SalesAssistantDraftStatus.REJECTED,
          rejectedAt: now,
          rejectedByUserId: userId,
          approvedAt: null,
          approvedByUserId: null
        }
      });

      if (updateResult.count === 0) {
        // Distinguish NotFound from Conflict/Terminal state
        const existing = await tx.salesAssistantDraft.findFirst({
          where: {
            id: draftId,
            leadId,
            organizationId
          }
        });

        if (!existing) {
          throw new NotFoundError('Sales assistant draft not found');
        }

        throw new ConflictError(
          `Cannot reject draft with status '${existing.status}'. Only drafts in '${SalesAssistantDraftStatus.DRAFT}' status can be reviewed.`
        );
      }

      const updated = await tx.salesAssistantDraft.findUniqueOrThrow({
        where: {
          id_organizationId: {
            id: draftId,
            organizationId
          }
        },
        include: {
          createdByUser: {
            select: { id: true, name: true, email: true }
          },
          approvedByUser: {
            select: { id: true, name: true, email: true }
          },
          rejectedByUser: {
            select: { id: true, name: true, email: true }
          }
        }
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'lead.sales_assistant_draft_rejected',
          entityType: 'SalesAssistantDraft',
          entityId: draftId,
          before: {
            leadId,
            status: SalesAssistantDraftStatus.DRAFT
          },
          after: {
            leadId,
            status: SalesAssistantDraftStatus.REJECTED,
            rejectedByUserId: userId,
            rejectedAt: now.toISOString()
          }
        }
      });

      return mapToDraftSummary(updated as unknown as RawDraftRecord);
    });
  }
}

export const salesAssistantService = new SalesAssistantService();
