import { z } from 'zod';
import { Role, TeamSortBy } from '../enums.js';

/* =========================================================
 * M7 Step 1: Team Management Schemas & Contracts
 *
 * Provider-agnostic, database-agnostic shared contracts for:
 * Team member listing, workload summaries, creation, profile
 * updates, activation/deactivation, and route parameters.
 * ========================================================= */

// Helper for parsing boolean query parameters correctly ("true" -> true, "false" -> false)
const booleanQueryParamSchema = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((val) => {
    if (val === undefined || val === null || val === '') return undefined;
    if (typeof val === 'boolean') return val;
    const lower = val.toLowerCase().trim();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
    return undefined;
  });

/* ---------------------------------------------------------
 * 1. Query Parameters Contract (GET /api/v1/team/members)
 * --------------------------------------------------------- */

export const teamMemberListQuerySchema = z
  .object({
    page: z.coerce.number().int('page must be an integer').min(1, 'page must be at least 1').default(1),
    limit: z.coerce
      .number()
      .int('limit must be an integer')
      .min(1, 'limit must be at least 1')
      .max(100, 'limit cannot exceed 100')
      .default(20),
    search: z
      .string()
      .trim()
      .max(100, 'search query cannot exceed 100 characters')
      .optional()
      .transform((val) => (val === '' ? undefined : val)),
    role: z.nativeEnum(Role, { errorMap: () => ({ message: 'Invalid role filter' }) }).optional(),
    isActive: booleanQueryParamSchema,
    sortBy: z
      .enum([TeamSortBy.NAME, TeamSortBy.CREATED_AT, TeamSortBy.ROLE], {
        errorMap: () => ({ message: 'sortBy must be one of: name, createdAt, role' })
      })
      .default(TeamSortBy.CREATED_AT),
    sortOrder: z
      .enum(['asc', 'desc'], {
        errorMap: () => ({ message: 'sortOrder must be asc or desc' })
      })
      .default('desc')
  })
  .strict();

export type TeamMemberListQuery = z.infer<typeof teamMemberListQuerySchema>;

/* ---------------------------------------------------------
 * 2. Workload & Member DTO Contracts
 * --------------------------------------------------------- */

export const teamMemberWorkloadSchema = z
  .object({
    assignedLeadsCount: z.number().int().nonnegative('assignedLeadsCount must be non-negative'),
    activeLeadsCount: z.number().int().nonnegative('activeLeadsCount must be non-negative'),
    pendingFollowUpsCount: z.number().int().nonnegative('pendingFollowUpsCount must be non-negative'),
    overdueFollowUpsCount: z.number().int().nonnegative('overdueFollowUpsCount must be non-negative')
  })
  .strict();

export type TeamMemberWorkload = z.infer<typeof teamMemberWorkloadSchema>;

/**
 * Safe summary DTO for team member listings.
 * Strictly excludes passwordHash, tokens, sessions, credentials, and raw audit data.
 */
export const teamMemberSummarySchema = z
  .object({
    id: z.string().uuid('Invalid user ID'),
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Invalid email address'),
    role: z.nativeEnum(Role),
    isActive: z.boolean(),
    createdAt: z.union([z.date(), z.string()]),
    workload: teamMemberWorkloadSchema
  })
  .strict();

export type TeamMemberSummary = z.infer<typeof teamMemberSummarySchema>;

/**
 * Detailed DTO for individual team member view / profile modal.
 */
export const teamMemberDetailSchema = z
  .object({
    id: z.string().uuid('Invalid user ID'),
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Invalid email address'),
    role: z.nativeEnum(Role),
    isActive: z.boolean(),
    createdAt: z.union([z.date(), z.string()]),
    updatedAt: z.union([z.date(), z.string()]),
    workload: teamMemberWorkloadSchema
  })
  .strict();

export type TeamMemberDetail = z.infer<typeof teamMemberDetailSchema>;

/* ---------------------------------------------------------
 * 3. Pagination & List Response Contracts
 * --------------------------------------------------------- */

export const teamPaginationMetaSchema = z
  .object({
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative()
  })
  .strict();

export type TeamPaginationMeta = z.infer<typeof teamPaginationMetaSchema>;

export const teamMemberListResponseSchema = z
  .object({
    items: z.array(teamMemberSummarySchema),
    pagination: teamPaginationMetaSchema
  })
  .strict();

export type TeamMemberListResponse = z.infer<typeof teamMemberListResponseSchema>;

/* ---------------------------------------------------------
 * 4. Create Member Request (POST /api/v1/team/members)
 * --------------------------------------------------------- */

export const createTeamMemberRequestSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100, 'Name cannot exceed 100 characters'),
    email: z
      .string()
      .trim()
      .email('Invalid email address')
      .max(255, 'Email cannot exceed 255 characters')
      .toLowerCase(),
    role: z.nativeEnum(Role, { errorMap: () => ({ message: 'Invalid role' }) }),
    temporaryPassword: z
      .string()
      .min(10, 'Temporary password must be at least 10 characters')
      .max(128, 'Temporary password cannot exceed 128 characters')
  })
  .strict();

export type CreateTeamMemberRequest = z.infer<typeof createTeamMemberRequestSchema>;

/* ---------------------------------------------------------
 * 5. Update Member Request (PATCH /api/v1/team/members/:userId)
 * --------------------------------------------------------- */

export const updateTeamMemberRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Name must be at least 2 characters')
      .max(100, 'Name cannot exceed 100 characters')
      .optional(),
    role: z.nativeEnum(Role, { errorMap: () => ({ message: 'Invalid role' }) }).optional()
  })
  .strict()
  .refine(
    (data) => data.name !== undefined || data.role !== undefined,
    { message: 'At least one field (name or role) must be provided for update' }
  );

export type UpdateTeamMemberRequest = z.infer<typeof updateTeamMemberRequestSchema>;

/* ---------------------------------------------------------
 * 6. Route Parameter & Action Schemas
 * --------------------------------------------------------- */

export const teamMemberUserIdParamSchema = z
  .object({
    userId: z.string().uuid('User ID must be a valid UUID')
  })
  .strict();

export type TeamMemberUserIdParam = z.infer<typeof teamMemberUserIdParamSchema>;

export const teamMemberActionResponseSchema = z
  .object({
    member: teamMemberDetailSchema,
    message: z.string().optional()
  })
  .strict();

export type TeamMemberActionResponse = z.infer<typeof teamMemberActionResponseSchema>;
