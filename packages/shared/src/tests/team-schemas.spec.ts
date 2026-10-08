import { describe, it, expect } from 'vitest';
import {
  Role,
  TeamSortBy,
  TeamErrorCode,
  Permissions,
  ROLE_PERMISSIONS,
  hasPermission,
  teamMemberListQuerySchema,
  teamMemberWorkloadSchema,
  teamMemberSummarySchema,
  teamMemberDetailSchema,
  teamMemberListResponseSchema,
  createTeamMemberRequestSchema,
  updateTeamMemberRequestSchema,
  teamMemberUserIdParamSchema,
  teamMemberActionResponseSchema
} from '../index.js';

describe('M7 Step 1: Team Management Shared Contracts & RBAC', () => {
  /* ---------------------------------------------------------
   * 1. RBAC Permission Constants & Role Mapping
   * --------------------------------------------------------- */
  describe('RBAC Permissions & USERS_READ Matrix', () => {
    it('defines USERS_READ and USERS_MANAGE permission constants', () => {
      expect(Permissions.USERS_READ).toBe('users:read');
      expect(Permissions.USERS_MANAGE).toBe('users:manage');
      expect(Permissions.REPORTS_READ).toBe('reports:read');
    });

    it('grants USERS_READ, USERS_MANAGE, and REPORTS_READ to SUPER_ADMIN', () => {
      expect(hasPermission(Role.SUPER_ADMIN, Permissions.USERS_READ)).toBe(true);
      expect(hasPermission(Role.SUPER_ADMIN, Permissions.USERS_MANAGE)).toBe(true);
      expect(hasPermission(Role.SUPER_ADMIN, Permissions.REPORTS_READ)).toBe(true);
    });

    it('grants USERS_READ, USERS_MANAGE, and REPORTS_READ to ADMIN', () => {
      expect(hasPermission(Role.ADMIN, Permissions.USERS_READ)).toBe(true);
      expect(hasPermission(Role.ADMIN, Permissions.USERS_MANAGE)).toBe(true);
      expect(hasPermission(Role.ADMIN, Permissions.REPORTS_READ)).toBe(true);
    });

    it('grants USERS_READ and REPORTS_READ to SALES_MANAGER, but NO USERS_MANAGE', () => {
      expect(hasPermission(Role.SALES_MANAGER, Permissions.USERS_READ)).toBe(true);
      expect(hasPermission(Role.SALES_MANAGER, Permissions.REPORTS_READ)).toBe(true);
      expect(hasPermission(Role.SALES_MANAGER, Permissions.USERS_MANAGE)).toBe(false);
    });

    it('grants REPORTS_READ to SALES_EXECUTIVE, but NO USERS_READ and NO USERS_MANAGE', () => {
      expect(hasPermission(Role.SALES_EXECUTIVE, Permissions.REPORTS_READ)).toBe(true);
      expect(hasPermission(Role.SALES_EXECUTIVE, Permissions.USERS_READ)).toBe(false);
      expect(hasPermission(Role.SALES_EXECUTIVE, Permissions.USERS_MANAGE)).toBe(false);
    });

    it('grants REPORTS_READ to VIEWER, but NO USERS_READ and NO USERS_MANAGE', () => {
      expect(hasPermission(Role.VIEWER, Permissions.REPORTS_READ)).toBe(true);
      expect(hasPermission(Role.VIEWER, Permissions.USERS_READ)).toBe(false);
      expect(hasPermission(Role.VIEWER, Permissions.USERS_MANAGE)).toBe(false);
    });

    it('preserves unrelated permissions for all roles', () => {
      expect(hasPermission(Role.SUPER_ADMIN, Permissions.INTEGRATIONS_MANAGE)).toBe(true);
      expect(hasPermission(Role.ADMIN, Permissions.INTEGRATIONS_MANAGE)).toBe(false);
      expect(hasPermission(Role.SALES_MANAGER, Permissions.LEADS_ASSIGN)).toBe(true);
      expect(hasPermission(Role.SALES_EXECUTIVE, Permissions.LEADS_ASSIGN)).toBe(false);
      expect(hasPermission(Role.VIEWER, Permissions.LEADS_WRITE)).toBe(false);
    });
  });

  /* ---------------------------------------------------------
   * 2. Team Member List Query Validation
   * --------------------------------------------------------- */
  describe('teamMemberListQuerySchema', () => {
    it('applies default page (1), limit (20), sortBy (createdAt), and sortOrder (desc)', () => {
      const parsed = teamMemberListQuerySchema.parse({});
      expect(parsed.page).toBe(1);
      expect(parsed.limit).toBe(20);
      expect(parsed.sortBy).toBe(TeamSortBy.CREATED_AT);
      expect(parsed.sortOrder).toBe('desc');
      expect(parsed.search).toBeUndefined();
      expect(parsed.role).toBeUndefined();
      expect(parsed.isActive).toBeUndefined();
    });

    it('accepts valid custom pagination and filters', () => {
      const parsed = teamMemberListQuerySchema.parse({
        page: '3',
        limit: '50',
        search: '  Ahmad  ',
        role: Role.SALES_EXECUTIVE,
        isActive: 'true',
        sortBy: TeamSortBy.NAME,
        sortOrder: 'asc'
      });
      expect(parsed.page).toBe(3);
      expect(parsed.limit).toBe(50);
      expect(parsed.search).toBe('Ahmad');
      expect(parsed.role).toBe(Role.SALES_EXECUTIVE);
      expect(parsed.isActive).toBe(true);
      expect(parsed.sortBy).toBe(TeamSortBy.NAME);
      expect(parsed.sortOrder).toBe('asc');
    });

    it('transforms empty search string to undefined', () => {
      const parsed = teamMemberListQuerySchema.parse({ search: '   ' });
      expect(parsed.search).toBeUndefined();
    });

    it('parses isActive from boolean, "true", "false", "1", "0"', () => {
      expect(teamMemberListQuerySchema.parse({ isActive: true }).isActive).toBe(true);
      expect(teamMemberListQuerySchema.parse({ isActive: false }).isActive).toBe(false);
      expect(teamMemberListQuerySchema.parse({ isActive: 'true' }).isActive).toBe(true);
      expect(teamMemberListQuerySchema.parse({ isActive: 'false' }).isActive).toBe(false);
      expect(teamMemberListQuerySchema.parse({ isActive: '1' }).isActive).toBe(true);
      expect(teamMemberListQuerySchema.parse({ isActive: '0' }).isActive).toBe(false);
    });

    it('enforces limit maximum of 100', () => {
      expect(() => teamMemberListQuerySchema.parse({ limit: 101 })).toThrow();
    });

    it('enforces page minimum of 1', () => {
      expect(() => teamMemberListQuerySchema.parse({ page: 0 })).toThrow();
      expect(() => teamMemberListQuerySchema.parse({ page: -1 })).toThrow();
    });

    it('rejects invalid role string', () => {
      expect(() => teamMemberListQuerySchema.parse({ role: 'PRESIDENT' })).toThrow();
    });

    it('rejects un-whitelisted sortBy field (e.g. passwordHash, organizationId)', () => {
      expect(() => teamMemberListQuerySchema.parse({ sortBy: 'passwordHash' })).toThrow();
      expect(() => teamMemberListQuerySchema.parse({ sortBy: 'organizationId' })).toThrow();
      expect(() => teamMemberListQuerySchema.parse({ sortBy: 'email' })).toThrow();
    });

    it('rejects invalid sortOrder', () => {
      expect(() => teamMemberListQuerySchema.parse({ sortOrder: 'random' })).toThrow();
    });

    it('strictly rejects unknown query properties', () => {
      expect(() => teamMemberListQuerySchema.parse({ unknownField: 'hack' })).toThrow();
    });
  });

  /* ---------------------------------------------------------
   * 3. Create Team Member Request Validation
   * --------------------------------------------------------- */
  describe('createTeamMemberRequestSchema', () => {
    it('accepts valid member creation payload and normalizes email and name', () => {
      const valid = {
        name: '  Rahim Chowdhury  ',
        email: '  Rahim.Chowdhury@Company.com  ',
        role: Role.SALES_EXECUTIVE,
        temporaryPassword: 'SecurePassword123!'
      };
      const parsed = createTeamMemberRequestSchema.parse(valid);
      expect(parsed.name).toBe('Rahim Chowdhury');
      expect(parsed.email).toBe('rahim.chowdhury@company.com');
      expect(parsed.role).toBe(Role.SALES_EXECUTIVE);
      expect(parsed.temporaryPassword).toBe('SecurePassword123!');
    });

    it('rejects short name (< 2 characters)', () => {
      expect(() =>
        createTeamMemberRequestSchema.parse({
          name: 'A',
          email: 'valid@example.com',
          role: Role.SALES_EXECUTIVE,
          temporaryPassword: 'SecurePassword123!'
        })
      ).toThrow();
    });

    it('rejects invalid email address', () => {
      expect(() =>
        createTeamMemberRequestSchema.parse({
          name: 'Rahim Chowdhury',
          email: 'not-an-email',
          role: Role.SALES_EXECUTIVE,
          temporaryPassword: 'SecurePassword123!'
        })
      ).toThrow();
    });

    it('rejects temporary password shorter than 10 characters', () => {
      expect(() =>
        createTeamMemberRequestSchema.parse({
          name: 'Rahim Chowdhury',
          email: 'rahim@company.com',
          role: Role.SALES_EXECUTIVE,
          temporaryPassword: 'short'
        })
      ).toThrow();
    });

    it('strictly rejects injected organizationId or tenantId', () => {
      expect(() =>
        createTeamMemberRequestSchema.parse({
          name: 'Rahim Chowdhury',
          email: 'rahim@company.com',
          role: Role.SALES_EXECUTIVE,
          temporaryPassword: 'SecurePassword123!',
          organizationId: '123e4567-e89b-12d3-a456-426614174000'
        })
      ).toThrow();

      expect(() =>
        createTeamMemberRequestSchema.parse({
          name: 'Rahim Chowdhury',
          email: 'rahim@company.com',
          role: Role.SALES_EXECUTIVE,
          temporaryPassword: 'SecurePassword123!',
          tenantId: '123e4567-e89b-12d3-a456-426614174000'
        })
      ).toThrow();
    });

    it('strictly rejects injected passwordHash, permissions, createdByUserId, or isActive fields', () => {
      expect(() =>
        createTeamMemberRequestSchema.parse({
          name: 'Rahim Chowdhury',
          email: 'rahim@company.com',
          role: Role.SALES_EXECUTIVE,
          temporaryPassword: 'SecurePassword123!',
          passwordHash: '$argon2id$v=19$m=65536...',
          isActive: true
        })
      ).toThrow();

      expect(() =>
        createTeamMemberRequestSchema.parse({
          name: 'Rahim Chowdhury',
          email: 'rahim@company.com',
          role: Role.SALES_EXECUTIVE,
          temporaryPassword: 'SecurePassword123!',
          permissions: ['users:read']
        })
      ).toThrow();

      expect(() =>
        createTeamMemberRequestSchema.parse({
          name: 'Rahim Chowdhury',
          email: 'rahim@company.com',
          role: Role.SALES_EXECUTIVE,
          temporaryPassword: 'SecurePassword123!',
          createdByUserId: '123e4567-e89b-12d3-a456-426614174000'
        })
      ).toThrow();
    });
  });

  /* ---------------------------------------------------------
   * 4. Update Team Member Request Validation
   * --------------------------------------------------------- */
  describe('updateTeamMemberRequestSchema', () => {
    it('accepts name update only', () => {
      const parsed = updateTeamMemberRequestSchema.parse({ name: '  Karim Uddin  ' });
      expect(parsed.name).toBe('Karim Uddin');
      expect(parsed.role).toBeUndefined();
    });

    it('accepts role update only', () => {
      const parsed = updateTeamMemberRequestSchema.parse({ role: Role.SALES_MANAGER });
      expect(parsed.role).toBe(Role.SALES_MANAGER);
      expect(parsed.name).toBeUndefined();
    });

    it('accepts both name and role update', () => {
      const parsed = updateTeamMemberRequestSchema.parse({
        name: 'Karim Uddin',
        role: Role.SALES_MANAGER
      });
      expect(parsed.name).toBe('Karim Uddin');
      expect(parsed.role).toBe(Role.SALES_MANAGER);
    });

    it('rejects empty update object (requires at least name or role)', () => {
      expect(() => updateTeamMemberRequestSchema.parse({})).toThrow();
    });

    it('strictly rejects email modification (immutable in M7)', () => {
      expect(() =>
        updateTeamMemberRequestSchema.parse({
          name: 'Karim Uddin',
          email: 'newemail@example.com'
        })
      ).toThrow();
    });

    it('strictly rejects unknown properties or injected security credentials', () => {
      expect(() =>
        updateTeamMemberRequestSchema.parse({
          name: 'Karim Uddin',
          passwordHash: '$argon2id...',
          organizationId: '123e4567-e89b-12d3-a456-426614174000',
          permissions: ['users:manage']
        })
      ).toThrow();
    });
  });

  /* ---------------------------------------------------------
   * 5. Route Parameter Validation
   * --------------------------------------------------------- */
  describe('teamMemberUserIdParamSchema', () => {
    it('accepts valid UUID userId', () => {
      const parsed = teamMemberUserIdParamSchema.parse({
        userId: '123e4567-e89b-12d3-a456-426614174000'
      });
      expect(parsed.userId).toBe('123e4567-e89b-12d3-a456-426614174000');
    });

    it('rejects invalid non-UUID userId', () => {
      expect(() => teamMemberUserIdParamSchema.parse({ userId: 'not-a-uuid' })).toThrow();
    });

    it('strictly rejects extra route parameters', () => {
      expect(() =>
        teamMemberUserIdParamSchema.parse({
          userId: '123e4567-e89b-12d3-a456-426614174000',
          extra: 'invalid'
        })
      ).toThrow();
    });
  });

  /* ---------------------------------------------------------
   * 6. Safe Response DTOs & Workload Contracts
   * --------------------------------------------------------- */
  describe('Team Member Response DTOs', () => {
    it('validates safe teamMemberSummarySchema and excludes sensitive credentials', () => {
      const sampleSummary = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Fatima Begum',
        email: 'fatima@company.com',
        role: Role.SALES_EXECUTIVE,
        isActive: true,
        createdAt: '2026-10-07T12:00:00.000Z',
        workload: {
          assignedLeadsCount: 15,
          activeLeadsCount: 12,
          pendingFollowUpsCount: 4,
          overdueFollowUpsCount: 1
        }
      };

      const parsed = teamMemberSummarySchema.parse(sampleSummary);
      expect(parsed.name).toBe('Fatima Begum');
      expect(parsed.workload.activeLeadsCount).toBe(12);

      // Rejects injected passwordHash, temporaryPassword, or session/token fields
      expect(() =>
        teamMemberSummarySchema.parse({
          ...sampleSummary,
          passwordHash: 'secret'
        })
      ).toThrow();

      expect(() =>
        teamMemberSummarySchema.parse({
          ...sampleSummary,
          temporaryPassword: 'SecurePassword123!'
        })
      ).toThrow();

      expect(() =>
        teamMemberSummarySchema.parse({
          ...sampleSummary,
          token: 'jwt-token-here'
        })
      ).toThrow();

      expect(() =>
        teamMemberSummarySchema.parse({
          ...sampleSummary,
          sessionToken: 'session-id'
        })
      ).toThrow();
    });

    it('validates teamMemberWorkloadSchema rejects negative numbers', () => {
      expect(() =>
        teamMemberWorkloadSchema.parse({
          assignedLeadsCount: -1,
          activeLeadsCount: 0,
          pendingFollowUpsCount: 0,
          overdueFollowUpsCount: 0
        })
      ).toThrow();
    });

    it('validates teamMemberListResponseSchema with pagination meta', () => {
      const listResponse = {
        items: [
          {
            id: '123e4567-e89b-12d3-a456-426614174000',
            name: 'Fatima Begum',
            email: 'fatima@company.com',
            role: Role.SALES_EXECUTIVE,
            isActive: true,
            createdAt: '2026-10-07T12:00:00.000Z',
            workload: {
              assignedLeadsCount: 10,
              activeLeadsCount: 8,
              pendingFollowUpsCount: 2,
              overdueFollowUpsCount: 0
            }
          }
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1
        }
      };

      const parsed = teamMemberListResponseSchema.parse(listResponse);
      expect(parsed.items).toHaveLength(1);
      expect(parsed.pagination.total).toBe(1);
    });

    it('validates teamMemberActionResponseSchema', () => {
      const actionRes = {
        member: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Fatima Begum',
          email: 'fatima@company.com',
          role: Role.SALES_EXECUTIVE,
          isActive: false,
          createdAt: '2026-10-07T12:00:00.000Z',
          updatedAt: '2026-10-07T14:30:00.000Z',
          workload: {
            assignedLeadsCount: 10,
            activeLeadsCount: 0,
            pendingFollowUpsCount: 0,
            overdueFollowUpsCount: 0
          }
        },
        message: 'Member deactivated successfully'
      };

      const parsed = teamMemberActionResponseSchema.parse(actionRes);
      expect(parsed.member.isActive).toBe(false);
      expect(parsed.message).toBe('Member deactivated successfully');
    });
  });

  /* ---------------------------------------------------------
   * 7. TeamErrorCode Enum
   * --------------------------------------------------------- */
  describe('TeamErrorCode Enum', () => {
    it('defines all required team domain error codes', () => {
      expect(TeamErrorCode.TEAM_MEMBER_NOT_FOUND).toBe('TEAM_MEMBER_NOT_FOUND');
      expect(TeamErrorCode.TEAM_MEMBER_EMAIL_EXISTS).toBe('TEAM_MEMBER_EMAIL_EXISTS');
      expect(TeamErrorCode.TEAM_ROLE_FORBIDDEN).toBe('TEAM_ROLE_FORBIDDEN');
      expect(TeamErrorCode.TEAM_SELF_ROLE_CHANGE_FORBIDDEN).toBe('TEAM_SELF_ROLE_CHANGE_FORBIDDEN');
      expect(TeamErrorCode.TEAM_SELF_DEACTIVATION_FORBIDDEN).toBe('TEAM_SELF_DEACTIVATION_FORBIDDEN');
      expect(TeamErrorCode.LAST_SUPER_ADMIN_CANNOT_BE_MODIFIED).toBe(
        'LAST_SUPER_ADMIN_CANNOT_BE_MODIFIED'
      );
      expect(TeamErrorCode.TEAM_MEMBER_INACTIVE).toBe('TEAM_MEMBER_INACTIVE');
    });
  });
});
