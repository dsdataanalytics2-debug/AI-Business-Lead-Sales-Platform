import prisma, { CrmStage, FollowUpStatus, Prisma } from '@leadmate/db';
import {
  Role,
  TeamErrorCode,
  TeamMemberListQuery,
  TeamMemberListResponse,
  TeamMemberSummary,
  TeamMemberDetail,
  TeamMemberActionResponse,
  CreateTeamMemberRequest,
  UpdateTeamMemberRequest,
  TeamMemberWorkload
} from '@leadmate/shared';
import { hashPassword } from '../lib/crypto.js';

export interface TeamActorContext {
  actorId: string;
  organizationId: string;
  role: Role;
}

export class TeamServiceError extends Error {
  public readonly code: TeamErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(code: TeamErrorCode, message: string, statusCode?: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'TeamServiceError';
    this.code = code;
    this.statusCode = statusCode ?? getDefaultTeamStatusCode(code);
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function getDefaultTeamStatusCode(code: TeamErrorCode): number {
  switch (code) {
    case TeamErrorCode.TEAM_MEMBER_NOT_FOUND:
      return 404;
    case TeamErrorCode.TEAM_ROLE_FORBIDDEN:
      return 403;
    case TeamErrorCode.TEAM_MEMBER_EMAIL_EXISTS:
    case TeamErrorCode.TEAM_SELF_ROLE_CHANGE_FORBIDDEN:
    case TeamErrorCode.TEAM_SELF_DEACTIVATION_FORBIDDEN:
    case TeamErrorCode.LAST_SUPER_ADMIN_CANNOT_BE_MODIFIED:
      return 409;
    case TeamErrorCode.TEAM_MEMBER_INACTIVE:
      return 400;
    default:
      return 500;
  }
}

export function isSerializationFailure(err: any): boolean {
  if (!err) return false;
  if (err.code === 'P2034') return true;
  if (err.meta?.code === '40001') return true;
  if (
    typeof err.message === 'string' &&
    (err.message.includes('P2034') ||
      err.message.includes('40001') ||
      err.message.includes('could not serialize access'))
  ) {
    return true;
  }
  return false;
}

export async function runWithSerializationRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      return await operation();
    } catch (err: any) {
      if (isSerializationFailure(err) && attempt < maxAttempts) {
        continue;
      }
      throw err;
    }
  }
  throw new Error('Transaction retry exhausted');
}

export class TeamService {
  /**
   * Helper: compute workload for a single user in tenant.
   */
  private async computeSingleWorkload(organizationId: string, userId: string): Promise<TeamMemberWorkload> {
    const now = new Date();
    const [assignedLeadsCount, activeLeadsCount, pendingFollowUpsCount, overdueFollowUpsCount] =
      await Promise.all([
        prisma.lead.count({
          where: { organizationId, assignedUserId: userId }
        }),
        prisma.lead.count({
          where: {
            organizationId,
            assignedUserId: userId,
            crmStage: { notIn: [CrmStage.WON, CrmStage.LOST] }
          }
        }),
        prisma.followUpTask.count({
          where: {
            organizationId,
            assignedUserId: userId,
            status: FollowUpStatus.PENDING
          }
        }),
        prisma.followUpTask.count({
          where: {
            organizationId,
            assignedUserId: userId,
            status: FollowUpStatus.PENDING,
            dueAt: { lt: now }
          }
        })
      ]);

    return {
      assignedLeadsCount,
      activeLeadsCount,
      pendingFollowUpsCount,
      overdueFollowUpsCount
    };
  }

  /**
   * List team members with filters, sorting, bounded pagination, and batched workload aggregation.
   * Completely avoids N+1 per-member counting.
   */
  async listMembers(actor: TeamActorContext, query: TeamMemberListQuery): Promise<TeamMemberListResponse> {
    const where: any = {
      organizationId: actor.organizationId
    };

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } }
      ];
    }

    if (query.role) {
      where.role = query.role;
    }

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    const orderBy: any[] = [
      { [query.sortBy]: query.sortOrder },
      { id: 'desc' }
    ];

    const take = query.limit;
    const skip = (query.page - 1) * query.limit;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true
        },
        orderBy,
        take,
        skip
      }),
      prisma.user.count({ where })
    ]);

    if (users.length === 0) {
      return {
        items: [],
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit)
        }
      };
    }

    const userIds = users.map((u) => u.id);
    const now = new Date();

    // Batched aggregates: exactly 4 grouped queries regardless of page size
    const [assignedLeads, activeLeads, pendingFollowUps, overdueFollowUps] = await Promise.all([
      prisma.lead.groupBy({
        by: ['assignedUserId'],
        where: {
          organizationId: actor.organizationId,
          assignedUserId: { in: userIds }
        },
        _count: { _all: true }
      }),
      prisma.lead.groupBy({
        by: ['assignedUserId'],
        where: {
          organizationId: actor.organizationId,
          assignedUserId: { in: userIds },
          crmStage: { notIn: [CrmStage.WON, CrmStage.LOST] }
        },
        _count: { _all: true }
      }),
      prisma.followUpTask.groupBy({
        by: ['assignedUserId'],
        where: {
          organizationId: actor.organizationId,
          assignedUserId: { in: userIds },
          status: FollowUpStatus.PENDING
        },
        _count: { _all: true }
      }),
      prisma.followUpTask.groupBy({
        by: ['assignedUserId'],
        where: {
          organizationId: actor.organizationId,
          assignedUserId: { in: userIds },
          status: FollowUpStatus.PENDING,
          dueAt: { lt: now }
        },
        _count: { _all: true }
      })
    ]);

    const assignedMap = new Map<string, number>();
    for (const item of assignedLeads) {
      if (item.assignedUserId) assignedMap.set(item.assignedUserId, item._count._all);
    }
    const activeMap = new Map<string, number>();
    for (const item of activeLeads) {
      if (item.assignedUserId) activeMap.set(item.assignedUserId, item._count._all);
    }
    const pendingMap = new Map<string, number>();
    for (const item of pendingFollowUps) {
      if (item.assignedUserId) pendingMap.set(item.assignedUserId, item._count._all);
    }
    const overdueMap = new Map<string, number>();
    for (const item of overdueFollowUps) {
      if (item.assignedUserId) overdueMap.set(item.assignedUserId, item._count._all);
    }

    const items: TeamMemberSummary[] = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role as unknown as Role,
      isActive: u.isActive,
      createdAt: u.createdAt.toISOString(),
      workload: {
        assignedLeadsCount: assignedMap.get(u.id) ?? 0,
        activeLeadsCount: activeMap.get(u.id) ?? 0,
        pendingFollowUpsCount: pendingMap.get(u.id) ?? 0,
        overdueFollowUpsCount: overdueMap.get(u.id) ?? 0
      }
    }));

    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit)
      }
    };
  }

  /**
   * Get single team member detail by UUID.
   */
  async getMemberDetail(actor: TeamActorContext, targetUserId: string): Promise<TeamMemberDetail> {
    const user = await prisma.user.findFirst({
      where: {
        id: targetUserId,
        organizationId: actor.organizationId
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!user) {
      throw new TeamServiceError(TeamErrorCode.TEAM_MEMBER_NOT_FOUND, 'Team member not found', 404);
    }

    const workload = await this.computeSingleWorkload(actor.organizationId, user.id);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role as unknown as Role,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      workload
    };
  }

  /**
   * Create a new team member with temporary password and role hierarchy guards.
   * Atomic create + audit transaction. (Creation increases/preserves super admins, no last-owner serialization needed).
   */
  async createMember(actor: TeamActorContext, input: CreateTeamMemberRequest): Promise<TeamMemberDetail> {
    // Role hierarchy validation
    if (actor.role === Role.ADMIN) {
      const allowedRoles: Role[] = [Role.SALES_MANAGER, Role.SALES_EXECUTIVE, Role.VIEWER];
      if (!allowedRoles.includes(input.role as Role)) {
        throw new TeamServiceError(
          TeamErrorCode.TEAM_ROLE_FORBIDDEN,
          'Administrators cannot create Admin or Super Admin members',
          403
        );
      }
    } else if (actor.role !== Role.SUPER_ADMIN) {
      throw new TeamServiceError(
        TeamErrorCode.TEAM_ROLE_FORBIDDEN,
        'Insufficient permissions to create team members',
        403
      );
    }

    // Precheck email uniqueness
    const existing = await prisma.user.findUnique({
      where: { email: input.email }
    });
    if (existing) {
      throw new TeamServiceError(
        TeamErrorCode.TEAM_MEMBER_EMAIL_EXISTS,
        `User with email '${input.email}' already exists`,
        409
      );
    }

    const passwordHash = await hashPassword(input.temporaryPassword);

    try {
      const createdUser = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            organizationId: actor.organizationId,
            email: input.email,
            passwordHash,
            name: input.name,
            role: input.role as any,
            isActive: true
          },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
            updatedAt: true
          }
        });

        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            userId: actor.actorId,
            action: 'team.member_created',
            entityType: 'User',
            entityId: user.id,
            after: {
              targetUserId: user.id,
              role: user.role,
              email: user.email
            }
          }
        });

        return user;
      });

      return {
        id: createdUser.id,
        name: createdUser.name,
        email: createdUser.email,
        role: createdUser.role as unknown as Role,
        isActive: createdUser.isActive,
        createdAt: createdUser.createdAt.toISOString(),
        updatedAt: createdUser.updatedAt.toISOString(),
        workload: {
          assignedLeadsCount: 0,
          activeLeadsCount: 0,
          pendingFollowUpsCount: 0,
          overdueFollowUpsCount: 0
        }
      };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new TeamServiceError(
          TeamErrorCode.TEAM_MEMBER_EMAIL_EXISTS,
          `User with email '${input.email}' already exists`,
          409
        );
      }
      throw err;
    }
  }

  /**
   * Update team member name and/or role with role hierarchy and last SUPER_ADMIN protections.
   * Operations that can reduce active SUPER_ADMIN population execute in Serializable isolation
   * with bounded retry (max 3 attempts) for concurrency safety.
   */
  async updateMember(
    actor: TeamActorContext,
    targetUserId: string,
    input: UpdateTeamMemberRequest
  ): Promise<TeamMemberDetail> {
    // Early self-role change prohibition check
    if (
      actor.actorId === targetUserId &&
      input.role !== undefined &&
      input.role !== actor.role
    ) {
      throw new TeamServiceError(
        TeamErrorCode.TEAM_SELF_ROLE_CHANGE_FORBIDDEN,
        'Users cannot change their own role',
        409
      );
    }

    // Role hierarchy permission check
    if (actor.role === Role.ADMIN) {
      if (actor.actorId !== targetUserId && input.role !== undefined) {
        const allowedAssignRoles: Role[] = [Role.SALES_MANAGER, Role.SALES_EXECUTIVE, Role.VIEWER];
        if (!allowedAssignRoles.includes(input.role as Role)) {
          throw new TeamServiceError(
            TeamErrorCode.TEAM_ROLE_FORBIDDEN,
            'Administrators cannot assign Admin or Super Admin roles',
            403
          );
        }
      }
    } else if (actor.role !== Role.SUPER_ADMIN) {
      throw new TeamServiceError(
        TeamErrorCode.TEAM_ROLE_FORBIDDEN,
        'Insufficient permissions to update team members',
        403
      );
    }

    const updatedUser = await runWithSerializationRetry(async () => {
      return prisma.$transaction(
        async (tx) => {
          // 1. tenant-scope target lookup inside serializable transaction
          const target = await tx.user.findFirst({
            where: {
              id: targetUserId,
              organizationId: actor.organizationId
            }
          });

          if (!target) {
            throw new TeamServiceError(TeamErrorCode.TEAM_MEMBER_NOT_FOUND, 'Team member not found', 404);
          }

          // Self role change protection against actual target record
          if (
            actor.actorId === target.id &&
            input.role !== undefined &&
            input.role !== target.role
          ) {
            throw new TeamServiceError(
              TeamErrorCode.TEAM_SELF_ROLE_CHANGE_FORBIDDEN,
              'Users cannot change their own role',
              409
            );
          }

          // 2. Validate actor/target hierarchy
          if (actor.role === Role.ADMIN) {
            // Administrators cannot modify other Admin or Super Admin members
            if (target.id !== actor.actorId && (target.role === Role.SUPER_ADMIN || target.role === Role.ADMIN)) {
              throw new TeamServiceError(
                TeamErrorCode.TEAM_ROLE_FORBIDDEN,
                'Administrators cannot modify Admin or Super Admin members',
                403
              );
            }
          }

          // 3. Count active SUPER_ADMIN users in same organization if target is an active SUPER_ADMIN being demoted
          const isDemotingSuperAdmin =
            target.role === Role.SUPER_ADMIN &&
            target.isActive &&
            input.role !== undefined &&
            input.role !== Role.SUPER_ADMIN;

          if (isDemotingSuperAdmin) {
            // Count all active SUPER_ADMIN users in tenant
            const activeSuperAdminCount = await tx.user.count({
              where: {
                organizationId: actor.organizationId,
                role: Role.SUPER_ADMIN,
                isActive: true
              }
            });

            if (activeSuperAdminCount <= 1) {
              throw new TeamServiceError(
                TeamErrorCode.LAST_SUPER_ADMIN_CANNOT_BE_MODIFIED,
                'The organization must have at least one active Super Admin',
                409
              );
            }
          }

          // 5. Perform mutation
          const user = await tx.user.update({
            where: { id: target.id },
            data: {
              ...(input.name ? { name: input.name } : {}),
              ...(input.role ? { role: input.role as any } : {})
            },
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              isActive: true,
              createdAt: true,
              updatedAt: true
            }
          });

          const changedFields: string[] = [];
          if (input.name && input.name !== target.name) changedFields.push('name');
          if (input.role && input.role !== target.role) changedFields.push('role');

          // 6. Write audit log atomically
          if (input.role && input.role !== target.role) {
            await tx.auditLog.create({
              data: {
                organizationId: actor.organizationId,
                userId: actor.actorId,
                action: 'team.member_role_changed',
                entityType: 'User',
                entityId: user.id,
                before: { role: target.role },
                after: {
                  targetUserId: user.id,
                  oldRole: target.role,
                  newRole: user.role,
                  changedFields
                }
              }
            });
          }

          if (input.name && input.name !== target.name) {
            await tx.auditLog.create({
              data: {
                organizationId: actor.organizationId,
                userId: actor.actorId,
                action: 'team.member_updated',
                entityType: 'User',
                entityId: user.id,
                before: { name: target.name },
                after: {
                  targetUserId: user.id,
                  name: user.name,
                  changedFields: ['name']
                }
              }
            });
          }

          return user;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }
      );
    });

    const workload = await this.computeSingleWorkload(actor.organizationId, updatedUser.id);

    return {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role as unknown as Role,
      isActive: updatedUser.isActive,
      createdAt: updatedUser.createdAt.toISOString(),
      updatedAt: updatedUser.updatedAt.toISOString(),
      workload
    };
  }

  /**
   * Activate team member. Idempotent if already active.
   * Ordinary atomic transaction (activation increases/preserves active super admins, no last-owner serialization needed).
   * Hierarchy and tenant checks run before returning idempotent response.
   */
  async activateMember(actor: TeamActorContext, targetUserId: string): Promise<TeamMemberActionResponse> {
    const target = await prisma.user.findFirst({
      where: {
        id: targetUserId,
        organizationId: actor.organizationId
      }
    });

    if (!target) {
      throw new TeamServiceError(TeamErrorCode.TEAM_MEMBER_NOT_FOUND, 'Team member not found', 404);
    }

    // Role hierarchy rules
    if (actor.role === Role.ADMIN) {
      if (target.role === Role.SUPER_ADMIN || target.role === Role.ADMIN) {
        throw new TeamServiceError(
          TeamErrorCode.TEAM_ROLE_FORBIDDEN,
          'Administrators cannot modify Admin or Super Admin members',
          403
        );
      }
    } else if (actor.role !== Role.SUPER_ADMIN) {
      throw new TeamServiceError(
        TeamErrorCode.TEAM_ROLE_FORBIDDEN,
        'Insufficient permissions to activate team members',
        403
      );
    }

    // Idempotent no-op if already active (hierarchy checked first)
    if (target.isActive) {
      const workload = await this.computeSingleWorkload(actor.organizationId, target.id);
      return {
        member: {
          id: target.id,
          name: target.name,
          email: target.email,
          role: target.role as unknown as Role,
          isActive: true,
          createdAt: target.createdAt.toISOString(),
          updatedAt: target.updatedAt.toISOString(),
          workload
        },
        message: 'Member is already active'
      };
    }

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: target.id },
        data: { isActive: true },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true
        }
      });

      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.actorId,
          action: 'team.member_activated',
          entityType: 'User',
          entityId: user.id,
          after: {
            targetUserId: user.id,
            role: user.role
          }
        }
      });

      return user;
    });

    const workload = await this.computeSingleWorkload(actor.organizationId, updated.id);

    return {
      member: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role as unknown as Role,
        isActive: updated.isActive,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        workload
      },
      message: 'Member activated successfully'
    };
  }

  /**
   * Deactivate team member. Never hard deletes. Preserves historical leads/follow-ups.
   * Operations execute in Serializable isolation with bounded retry (max 3 attempts).
   * Hierarchy and tenant checks run before returning idempotent response.
   */
  async deactivateMember(actor: TeamActorContext, targetUserId: string): Promise<TeamMemberActionResponse> {
    // 10. Self-deactivation check happens BEFORE transaction logic
    if (actor.actorId === targetUserId) {
      throw new TeamServiceError(
        TeamErrorCode.TEAM_SELF_DEACTIVATION_FORBIDDEN,
        'Users cannot deactivate themselves',
        409
      );
    }

    // Hierarchy check on actor role
    if (actor.role !== Role.SUPER_ADMIN && actor.role !== Role.ADMIN) {
      throw new TeamServiceError(
        TeamErrorCode.TEAM_ROLE_FORBIDDEN,
        'Insufficient permissions to deactivate team members',
        403
      );
    }

    const result = await runWithSerializationRetry(async () => {
      return prisma.$transaction(
        async (tx) => {
          // 1. tenant-scope target lookup inside serializable transaction
          const target = await tx.user.findFirst({
            where: {
              id: targetUserId,
              organizationId: actor.organizationId
            }
          });

          if (!target) {
            throw new TeamServiceError(TeamErrorCode.TEAM_MEMBER_NOT_FOUND, 'Team member not found', 404);
          }

          // 2. Validate actor/target hierarchy
          if (actor.role === Role.ADMIN) {
            if (target.role === Role.SUPER_ADMIN || target.role === Role.ADMIN) {
              throw new TeamServiceError(
                TeamErrorCode.TEAM_ROLE_FORBIDDEN,
                'Administrators cannot modify Admin or Super Admin members',
                403
              );
            }
          }

          // Idempotent no-op if already inactive (hierarchy checked first)
          if (!target.isActive) {
            return {
              user: target,
              isAlreadyInactive: true
            };
          }

          // 3. Count active SUPER_ADMIN users in same organization if target is an active SUPER_ADMIN
          if (target.role === Role.SUPER_ADMIN) {
            const activeSuperAdminCount = await tx.user.count({
              where: {
                organizationId: actor.organizationId,
                role: Role.SUPER_ADMIN,
                isActive: true
              }
            });

            if (activeSuperAdminCount <= 1) {
              throw new TeamServiceError(
                TeamErrorCode.LAST_SUPER_ADMIN_CANNOT_BE_MODIFIED,
                'The organization must have at least one active Super Admin',
                409
              );
            }
          }

          // 5. Perform mutation
          const user = await tx.user.update({
            where: { id: target.id },
            data: { isActive: false },
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              isActive: true,
              createdAt: true,
              updatedAt: true
            }
          });

          // 6. Write audit log atomically
          await tx.auditLog.create({
            data: {
              organizationId: actor.organizationId,
              userId: actor.actorId,
              action: 'team.member_deactivated',
              entityType: 'User',
              entityId: user.id,
              after: {
                targetUserId: user.id,
                role: user.role
              }
            }
          });

          return {
            user,
            isAlreadyInactive: false
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }
      );
    });

    const workload = await this.computeSingleWorkload(actor.organizationId, result.user.id);

    return {
      member: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role as unknown as Role,
        isActive: result.user.isActive,
        createdAt: result.user.createdAt.toISOString(),
        updatedAt: result.user.updatedAt.toISOString(),
        workload
      },
      message: result.isAlreadyInactive ? 'Member is already inactive' : 'Member deactivated successfully'
    };
  }
}

export const teamService = new TeamService();
