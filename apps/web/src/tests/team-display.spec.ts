import { describe, it, expect } from 'vitest';
import { Role, TeamErrorCode } from '@leadmate/shared';
import {
  ROLE_LABELS,
  ROLE_BADGE_CLASSES,
  formatRoleLabel,
  formatStatusLabel,
  getStatusBadgeClass,
  TEAM_ERROR_MESSAGES,
  getFriendlyTeamErrorMessage,
  getAllowedAssignableRoles,
  canActorMutateTarget
} from '../lib/team/team-display.js';

describe('M7 Step 3: Team Display Helpers & Permission Utilities', () => {
  describe('Role & Status Labels and Badges', () => {
    it('formats friendly role labels for all roles', () => {
      expect(formatRoleLabel(Role.SUPER_ADMIN)).toBe('Super Admin');
      expect(formatRoleLabel(Role.ADMIN)).toBe('Admin');
      expect(formatRoleLabel(Role.SALES_MANAGER)).toBe('Sales Manager');
      expect(formatRoleLabel(Role.SALES_EXECUTIVE)).toBe('Sales Executive');
      expect(formatRoleLabel(Role.VIEWER)).toBe('Viewer');
    });

    it('provides distinct badge styling classes for each role', () => {
      expect(ROLE_BADGE_CLASSES[Role.SUPER_ADMIN]).toContain('purple');
      expect(ROLE_BADGE_CLASSES[Role.ADMIN]).toContain('blue');
      expect(ROLE_BADGE_CLASSES[Role.SALES_MANAGER]).toContain('emerald');
      expect(ROLE_BADGE_CLASSES[Role.SALES_EXECUTIVE]).toContain('amber');
      expect(ROLE_BADGE_CLASSES[Role.VIEWER]).toContain('slate');
    });

    it('formats active and inactive status labels and badges', () => {
      expect(formatStatusLabel(true)).toBe('Active');
      expect(formatStatusLabel(false)).toBe('Inactive');
      expect(getStatusBadgeClass(true)).toContain('emerald');
      expect(getStatusBadgeClass(false)).toContain('slate');
    });
  });

  describe('Friendly Error Message Mapping', () => {
    it('maps all canonical TeamErrorCodes to user-friendly messages', () => {
      expect(getFriendlyTeamErrorMessage({ code: TeamErrorCode.TEAM_MEMBER_EMAIL_EXISTS }))
        .toBe('A team member with this email already exists.');
      expect(getFriendlyTeamErrorMessage({ code: TeamErrorCode.TEAM_ROLE_FORBIDDEN }))
        .toBe('You do not have permission to modify this member or assign this role.');
      expect(getFriendlyTeamErrorMessage({ code: TeamErrorCode.TEAM_SELF_ROLE_CHANGE_FORBIDDEN }))
        .toBe('You cannot change your own role.');
      expect(getFriendlyTeamErrorMessage({ code: TeamErrorCode.TEAM_SELF_DEACTIVATION_FORBIDDEN }))
        .toBe('You cannot deactivate your own account.');
      expect(getFriendlyTeamErrorMessage({ code: TeamErrorCode.LAST_SUPER_ADMIN_CANNOT_BE_MODIFIED }))
        .toBe('At least one active Super Admin must remain in the organization.');
      expect(getFriendlyTeamErrorMessage({ code: TeamErrorCode.TEAM_MEMBER_NOT_FOUND }))
        .toBe('Team member not found.');
    });

    it('returns custom message or safe fallback on unknown errors', () => {
      expect(getFriendlyTeamErrorMessage({ message: 'Custom network failure' }))
        .toBe('Custom network failure');
      expect(getFriendlyTeamErrorMessage(null))
        .toBe('An unexpected error occurred. Please try again.');
      expect(getFriendlyTeamErrorMessage({}))
        .toBe('An unexpected error occurred. Please try again.');
    });
  });

  describe('Role Assignment Hierarchy for Actors', () => {
    it('SUPER_ADMIN can assign all 5 roles', () => {
      const roles = getAllowedAssignableRoles(Role.SUPER_ADMIN);
      expect(roles).toEqual([
        Role.SUPER_ADMIN,
        Role.ADMIN,
        Role.SALES_MANAGER,
        Role.SALES_EXECUTIVE,
        Role.VIEWER
      ]);
    });

    it('ADMIN can only assign Sales Manager, Sales Executive, Viewer (no Admin or Super Admin)', () => {
      const roles = getAllowedAssignableRoles(Role.ADMIN);
      expect(roles).toEqual([
        Role.SALES_MANAGER,
        Role.SALES_EXECUTIVE,
        Role.VIEWER
      ]);
      expect(roles).not.toContain(Role.SUPER_ADMIN);
      expect(roles).not.toContain(Role.ADMIN);
    });

    it('Non-admin actors receive empty assignable roles', () => {
      expect(getAllowedAssignableRoles(Role.SALES_MANAGER)).toEqual([]);
      expect(getAllowedAssignableRoles(Role.SALES_EXECUTIVE)).toEqual([]);
      expect(getAllowedAssignableRoles(Role.VIEWER)).toEqual([]);
      expect(getAllowedAssignableRoles(undefined)).toEqual([]);
    });
  });

  describe('canActorMutateTarget Checks', () => {
    it('returns false for actors lacking USERS_MANAGE permission', () => {
      expect(
        canActorMutateTarget(Role.SALES_MANAGER, 'u1', Role.SALES_EXECUTIVE, 'u2', false)
      ).toBe(false);
      expect(
        canActorMutateTarget(Role.VIEWER, 'u1', Role.VIEWER, 'u2', false)
      ).toBe(false);
    });

    it('SUPER_ADMIN with USERS_MANAGE can mutate any member', () => {
      expect(
        canActorMutateTarget(Role.SUPER_ADMIN, 'u1', Role.SUPER_ADMIN, 'u2', true)
      ).toBe(true);
      expect(
        canActorMutateTarget(Role.SUPER_ADMIN, 'u1', Role.ADMIN, 'u3', true)
      ).toBe(true);
      expect(
        canActorMutateTarget(Role.SUPER_ADMIN, 'u1', Role.SALES_EXECUTIVE, 'u4', true)
      ).toBe(true);
    });

    it('ADMIN can mutate self (for name edit) and non-admin members, but cannot mutate other ADMINs or SUPER_ADMINs', () => {
      const adminId = 'admin-1';
      // Self: allowed (for name edit)
      expect(
        canActorMutateTarget(Role.ADMIN, adminId, Role.ADMIN, adminId, true)
      ).toBe(true);

      // Other ADMIN: forbidden
      expect(
        canActorMutateTarget(Role.ADMIN, adminId, Role.ADMIN, 'admin-2', true)
      ).toBe(false);

      // Other SUPER_ADMIN: forbidden
      expect(
        canActorMutateTarget(Role.ADMIN, adminId, Role.SUPER_ADMIN, 'sa-1', true)
      ).toBe(false);

      // Other manageable roles: allowed
      expect(
        canActorMutateTarget(Role.ADMIN, adminId, Role.SALES_MANAGER, 'sm-1', true)
      ).toBe(true);
      expect(
        canActorMutateTarget(Role.ADMIN, adminId, Role.SALES_EXECUTIVE, 'se-1', true)
      ).toBe(true);
      expect(
        canActorMutateTarget(Role.ADMIN, adminId, Role.VIEWER, 'v-1', true)
      ).toBe(true);
    });
  });
});
