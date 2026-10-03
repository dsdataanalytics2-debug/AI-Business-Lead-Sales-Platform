/**
 * Follow-Up Tasks Service
 *
 * Provides business logic and database access for CRM follow-up tasks.
 * Enforces strict multi-tenant isolation, active user validation,
 * audit logging, transaction atomicity, and deterministic ordering.
 */

import prisma, {
  FollowUpStatus,
  type Prisma
} from '@leadmate/db';
import {
  type CreateFollowUpRequest,
  type UpdateFollowUpRequest,
  type FollowUpTask
} from '@leadmate/shared';
import { NotFoundError, ValidationError } from '../lib/errors.js';

export interface FollowUpRequestContext {
  organizationId: string;
  userId: string;
  correlationId?: string;
}

function mapToFollowUpTask(raw: {
  id: string;
  leadId: string;
  assignedUserId: string | null;
  assignedUser?: { id: string; name: string; email: string } | null;
  createdByUserId: string;
  createdByUser?: { id: string; name: string; email: string } | null;
  dueAt: Date;
  note: string | null;
  status: FollowUpStatus;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): FollowUpTask {
  return {
    id: raw.id,
    leadId: raw.leadId,
    assignedUserId: raw.assignedUserId,
    assignedUser: raw.assignedUser
      ? {
          id: raw.assignedUser.id,
          name: raw.assignedUser.name,
          email: raw.assignedUser.email
        }
      : null,
    createdByUserId: raw.createdByUserId,
    createdBy: raw.createdByUser
      ? {
          id: raw.createdByUser.id,
          name: raw.createdByUser.name,
          email: raw.createdByUser.email
        }
      : undefined,
    dueAt: raw.dueAt,
    note: raw.note,
    status: raw.status as FollowUpTask['status'],
    completedAt: raw.completedAt,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt
  };
}

const followUpUserSelect = {
  id: true,
  name: true,
  email: true,
  isActive: true
};

export class FollowUpService {
  /**
   * Creates a new follow-up task for a lead.
   * If assignedUserId is omitted, defaults to the lead's current assignee.
   * Enforces tenant-safe lookups, active assignee validation, and audit logging.
   */
  async createFollowUp(
    leadId: string,
    input: CreateFollowUpRequest,
    context: FollowUpRequestContext
  ): Promise<FollowUpTask> {
    const { organizationId, userId } = context;

    return prisma.$transaction(async (tx) => {
      // 1. Verify lead exists and belongs to the authenticated tenant
      const lead = await tx.lead.findFirst({
        where: {
          id: leadId,
          organizationId
        },
        select: {
          id: true,
          assignedUserId: true
        }
      });

      if (!lead) {
        throw new NotFoundError(`Lead with ID "${leadId}" not found`);
      }

      // 2. Determine target assignee
      // If assignedUserId was explicitly provided, use it; otherwise default to lead.assignedUserId
      let targetAssignedUserId: string | null = null;
      if (input.assignedUserId !== undefined) {
        targetAssignedUserId = input.assignedUserId;
      } else if (lead.assignedUserId) {
        targetAssignedUserId = lead.assignedUserId;
      }

      // 3. If target assignee is non-null, verify they exist in the same tenant and are active
      if (targetAssignedUserId !== null) {
        const targetUser = await tx.user.findFirst({
          where: {
            id: targetAssignedUserId,
            organizationId
          },
          select: followUpUserSelect
        });

        if (!targetUser) {
          throw new NotFoundError(`Assignee user with ID "${targetAssignedUserId}" not found`);
        }

        if (!targetUser.isActive) {
          throw new ValidationError('Selected assignee is inactive');
        }
      }

      // 4. Create FollowUpTask
      const created = await tx.followUpTask.create({
        data: {
          organizationId,
          leadId: lead.id,
          assignedUserId: targetAssignedUserId,
          createdByUserId: userId,
          dueAt: input.dueAt,
          note: input.note ?? null,
          status: FollowUpStatus.PENDING,
          completedAt: null
        },
        include: {
          assignedUser: {
            select: { id: true, name: true, email: true }
          },
          createdByUser: {
            select: { id: true, name: true, email: true }
          }
        }
      });

      // 5. Create AuditLog entry
      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'lead.follow_up_created',
          entityType: 'FollowUpTask',
          entityId: created.id,
          after: {
            leadId: lead.id,
            dueAt: created.dueAt.toISOString(),
            assignedUserId: targetAssignedUserId,
            status: FollowUpStatus.PENDING
          }
        }
      });

      return mapToFollowUpTask(created);
    });
  }

  /**
   * Lists all follow-up tasks for a lead.
   * Deterministic ordering: PENDING tasks first by dueAt ASC, then completed/cancelled by updatedAt DESC.
   */
  async listFollowUps(
    leadId: string,
    context: FollowUpRequestContext
  ): Promise<FollowUpTask[]> {
    const { organizationId } = context;

    // 1. Verify lead exists and belongs to the authenticated tenant
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

    // 2. Fetch all follow-up tasks
    const tasks = await prisma.followUpTask.findMany({
      where: {
        leadId: lead.id,
        organizationId
      },
      include: {
        assignedUser: {
          select: { id: true, name: true, email: true }
        },
        createdByUser: {
          select: { id: true, name: true, email: true }
        }
      }
    });

    // 3. Sort deterministically: PENDING first by dueAt ASC; completed/cancelled by updatedAt DESC
    const sorted = tasks.sort((a, b) => {
      const aIsPending = a.status === FollowUpStatus.PENDING;
      const bIsPending = b.status === FollowUpStatus.PENDING;

      if (aIsPending && !bIsPending) return -1;
      if (!aIsPending && bIsPending) return 1;

      if (aIsPending && bIsPending) {
        const timeDiff = a.dueAt.getTime() - b.dueAt.getTime();
        return timeDiff !== 0 ? timeDiff : a.id.localeCompare(b.id);
      }

      const updatedDiff = b.updatedAt.getTime() - a.updatedAt.getTime();
      return updatedDiff !== 0 ? updatedDiff : a.id.localeCompare(b.id);
    });

    return sorted.map(mapToFollowUpTask);
  }

  /**
   * Updates an existing follow-up task.
   * Rejects edits if task is already in terminal state (COMPLETED or CANCELLED).
   */
  async updateFollowUp(
    leadId: string,
    followUpId: string,
    input: UpdateFollowUpRequest,
    context: FollowUpRequestContext
  ): Promise<FollowUpTask> {
    const { organizationId, userId } = context;

    return prisma.$transaction(async (tx) => {
      // 1. Verify lead exists
      const lead = await tx.lead.findFirst({
        where: {
          id: leadId,
          organizationId
        },
        select: { id: true }
      });

      if (!lead) {
        throw new NotFoundError(`Lead with ID "${leadId}" not found`);
      }

      // 2. Verify follow-up task exists for this lead
      const existingTask = await tx.followUpTask.findFirst({
        where: {
          id: followUpId,
          leadId: lead.id,
          organizationId
        },
        include: {
          assignedUser: {
            select: { id: true, name: true, email: true }
          },
          createdByUser: {
            select: { id: true, name: true, email: true }
          }
        }
      });

      if (!existingTask) {
        throw new NotFoundError(`Follow-up task with ID "${followUpId}" not found`);
      }

      // 3. Terminal edit policy: Completed or Cancelled tasks cannot be edited
      if (
        existingTask.status === FollowUpStatus.COMPLETED ||
        existingTask.status === FollowUpStatus.CANCELLED
      ) {
        throw new ValidationError('Cannot update a completed or cancelled follow-up task');
      }

      // 4. Validate assignee if changed
      let newAssignedUserId = existingTask.assignedUserId;
      if (input.assignedUserId !== undefined) {
        newAssignedUserId = input.assignedUserId;

        if (newAssignedUserId !== null) {
          const targetUser = await tx.user.findFirst({
            where: {
              id: newAssignedUserId,
              organizationId
            },
            select: followUpUserSelect
          });

          if (!targetUser) {
            throw new NotFoundError(`Assignee user with ID "${newAssignedUserId}" not found`);
          }

          if (!targetUser.isActive) {
            throw new ValidationError('Selected assignee is inactive');
          }
        }
      }

      const newDueAt = input.dueAt !== undefined ? input.dueAt : existingTask.dueAt;
      const newNote = input.note !== undefined ? input.note : existingTask.note;

      // 5. Update FollowUpTask
      const updated = await tx.followUpTask.update({
        where: { id: existingTask.id },
        data: {
          dueAt: newDueAt,
          assignedUserId: newAssignedUserId,
          note: newNote
        },
        include: {
          assignedUser: {
            select: { id: true, name: true, email: true }
          },
          createdByUser: {
            select: { id: true, name: true, email: true }
          }
        }
      });

      // 6. Create AuditLog entry
      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'lead.follow_up_updated',
          entityType: 'FollowUpTask',
          entityId: updated.id,
          before: {
            dueAt: existingTask.dueAt.toISOString(),
            assignedUserId: existingTask.assignedUserId,
            note: existingTask.note
          },
          after: {
            leadId: lead.id,
            dueAt: updated.dueAt.toISOString(),
            assignedUserId: updated.assignedUserId,
            note: updated.note
          }
        }
      });

      return mapToFollowUpTask(updated);
    });
  }

  /**
   * Marks a follow-up task as COMPLETED.
   * If already COMPLETED, returns deterministic no-op 200 without duplicate audit.
   */
  async completeFollowUp(
    leadId: string,
    followUpId: string,
    context: FollowUpRequestContext
  ): Promise<FollowUpTask> {
    const { organizationId, userId } = context;

    return prisma.$transaction(async (tx) => {
      // 1. Verify lead exists
      const lead = await tx.lead.findFirst({
        where: {
          id: leadId,
          organizationId
        },
        select: { id: true }
      });

      if (!lead) {
        throw new NotFoundError(`Lead with ID "${leadId}" not found`);
      }

      // 2. Verify follow-up exists
      const existingTask = await tx.followUpTask.findFirst({
        where: {
          id: followUpId,
          leadId: lead.id,
          organizationId
        },
        include: {
          assignedUser: {
            select: { id: true, name: true, email: true }
          },
          createdByUser: {
            select: { id: true, name: true, email: true }
          }
        }
      });

      if (!existingTask) {
        throw new NotFoundError(`Follow-up task with ID "${followUpId}" not found`);
      }

      // 3. Deterministic No-op if already COMPLETED; reject if CANCELLED
      if (existingTask.status === FollowUpStatus.COMPLETED) {
        return mapToFollowUpTask(existingTask);
      }

      if (existingTask.status === FollowUpStatus.CANCELLED) {
        throw new ValidationError('Cannot complete a cancelled follow-up task');
      }

      // 4. Update status to COMPLETED
      const completedAt = new Date();
      const updated = await tx.followUpTask.update({
        where: { id: existingTask.id },
        data: {
          status: FollowUpStatus.COMPLETED,
          completedAt
        },
        include: {
          assignedUser: {
            select: { id: true, name: true, email: true }
          },
          createdByUser: {
            select: { id: true, name: true, email: true }
          }
        }
      });

      // 5. Create AuditLog entry
      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'lead.follow_up_completed',
          entityType: 'FollowUpTask',
          entityId: updated.id,
          before: {
            status: existingTask.status,
            completedAt: existingTask.completedAt ? existingTask.completedAt.toISOString() : null
          },
          after: {
            leadId: lead.id,
            status: FollowUpStatus.COMPLETED,
            completedAt: completedAt.toISOString()
          }
        }
      });

      return mapToFollowUpTask(updated);
    });
  }

  /**
   * Marks a follow-up task as CANCELLED.
   * If already CANCELLED, returns deterministic no-op 200 without duplicate audit.
   */
  async cancelFollowUp(
    leadId: string,
    followUpId: string,
    context: FollowUpRequestContext
  ): Promise<FollowUpTask> {
    const { organizationId, userId } = context;

    return prisma.$transaction(async (tx) => {
      // 1. Verify lead exists
      const lead = await tx.lead.findFirst({
        where: {
          id: leadId,
          organizationId
        },
        select: { id: true }
      });

      if (!lead) {
        throw new NotFoundError(`Lead with ID "${leadId}" not found`);
      }

      // 2. Verify follow-up exists
      const existingTask = await tx.followUpTask.findFirst({
        where: {
          id: followUpId,
          leadId: lead.id,
          organizationId
        },
        include: {
          assignedUser: {
            select: { id: true, name: true, email: true }
          },
          createdByUser: {
            select: { id: true, name: true, email: true }
          }
        }
      });

      if (!existingTask) {
        throw new NotFoundError(`Follow-up task with ID "${followUpId}" not found`);
      }

      // 3. Deterministic No-op if already CANCELLED; reject if COMPLETED
      if (existingTask.status === FollowUpStatus.CANCELLED) {
        return mapToFollowUpTask(existingTask);
      }

      if (existingTask.status === FollowUpStatus.COMPLETED) {
        throw new ValidationError('Cannot cancel a completed follow-up task');
      }

      // 4. Update status to CANCELLED
      const updated = await tx.followUpTask.update({
        where: { id: existingTask.id },
        data: {
          status: FollowUpStatus.CANCELLED,
          completedAt: null
        },
        include: {
          assignedUser: {
            select: { id: true, name: true, email: true }
          },
          createdByUser: {
            select: { id: true, name: true, email: true }
          }
        }
      });

      // 5. Create AuditLog entry
      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'lead.follow_up_cancelled',
          entityType: 'FollowUpTask',
          entityId: updated.id,
          before: {
            status: existingTask.status
          },
          after: {
            leadId: lead.id,
            status: FollowUpStatus.CANCELLED
          }
        }
      });

      return mapToFollowUpTask(updated);
    });
  }
}

export const followUpService = new FollowUpService();
