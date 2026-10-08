import { Role, TeamErrorCode } from '@leadmate/shared';

export const ROLE_LABELS: Record<Role, string> = {
  [Role.SUPER_ADMIN]: 'Super Admin',
  [Role.ADMIN]: 'Admin',
  [Role.SALES_MANAGER]: 'Sales Manager',
  [Role.SALES_EXECUTIVE]: 'Sales Executive',
  [Role.VIEWER]: 'Viewer'
};

export const ROLE_BADGE_CLASSES: Record<Role, string> = {
  [Role.SUPER_ADMIN]: 'bg-purple-950/60 text-purple-300 border-purple-700/60',
  [Role.ADMIN]: 'bg-blue-950/60 text-blue-300 border-blue-700/60',
  [Role.SALES_MANAGER]: 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60',
  [Role.SALES_EXECUTIVE]: 'bg-amber-950/60 text-amber-300 border-amber-700/60',
  [Role.VIEWER]: 'bg-slate-800 text-slate-300 border-slate-700'
};

export function formatRoleLabel(role: Role): string {
  return ROLE_LABELS[role] || role;
}

export function formatStatusLabel(isActive: boolean): string {
  return isActive ? 'Active' : 'Inactive';
}

export function getStatusBadgeClass(isActive: boolean): string {
  return isActive
    ? 'bg-emerald-950/50 text-emerald-300 border-emerald-700/60'
    : 'bg-slate-800 text-slate-400 border-slate-700';
}

export const TEAM_ERROR_MESSAGES: Record<string, string> = {
  [TeamErrorCode.TEAM_MEMBER_EMAIL_EXISTS]: 'A team member with this email already exists.',
  [TeamErrorCode.TEAM_ROLE_FORBIDDEN]: 'You do not have permission to modify this member or assign this role.',
  [TeamErrorCode.TEAM_SELF_ROLE_CHANGE_FORBIDDEN]: 'You cannot change your own role.',
  [TeamErrorCode.TEAM_SELF_DEACTIVATION_FORBIDDEN]: 'You cannot deactivate your own account.',
  [TeamErrorCode.LAST_SUPER_ADMIN_CANNOT_BE_MODIFIED]: 'At least one active Super Admin must remain in the organization.',
  [TeamErrorCode.TEAM_MEMBER_NOT_FOUND]: 'Team member not found.'
};

export function getFriendlyTeamErrorMessage(error: unknown): string {
  if (!error) return 'An unexpected error occurred. Please try again.';

  if (typeof error === 'object' && error !== null) {
    const err = error as { code?: string; message?: string };
    if (err.code && TEAM_ERROR_MESSAGES[err.code]) {
      return TEAM_ERROR_MESSAGES[err.code];
    }
    if (err.message) {
      return err.message;
    }
  }

  return 'An unexpected error occurred. Please try again.';
}

/**
 * Returns allowed roles that the current actor can assign when creating or updating members.
 */
export function getAllowedAssignableRoles(actorRole?: Role | string): Role[] {
  if (actorRole === Role.SUPER_ADMIN) {
    return [
      Role.SUPER_ADMIN,
      Role.ADMIN,
      Role.SALES_MANAGER,
      Role.SALES_EXECUTIVE,
      Role.VIEWER
    ];
  }
  if (actorRole === Role.ADMIN) {
    return [
      Role.SALES_MANAGER,
      Role.SALES_EXECUTIVE,
      Role.VIEWER
    ];
  }
  return [];
}

/**
 * Determines if actor can mutate a specific target member.
 * - Non-USERS_MANAGE actors cannot mutate anyone.
 * - ADMINs cannot modify ADMIN or SUPER_ADMIN members (except their own name via edit self).
 * - SUPER_ADMINs can mutate any member.
 */
export function canActorMutateTarget(
  actorRole: Role | string | undefined,
  actorId: string | undefined,
  targetRole: Role,
  targetId: string,
  hasUsersManage: boolean
): boolean {
  if (!hasUsersManage) return false;
  if (actorRole === Role.SUPER_ADMIN) return true;
  if (actorRole === Role.ADMIN) {
    // If target is self, actor can edit own name
    if (actorId === targetId) return true;
    // Cannot modify other Admin or Super Admin
    if (targetRole === Role.SUPER_ADMIN || targetRole === Role.ADMIN) return false;
    return true;
  }
  return false;
}
