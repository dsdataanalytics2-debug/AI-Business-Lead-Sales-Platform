import { z } from 'zod';
import { FollowUpStatus } from '../enums.js';
import { assigneeSummarySchema } from './crm.js';

/* =========================================================
 * M3: CRM Follow-Up Task Schemas
 * ========================================================= */

/**
 * Request schema for creating a follow-up task
 */
export const createFollowUpRequestSchema = z
  .object({
    dueAt: z.coerce.date({
      required_error: 'dueAt is required',
      invalid_type_error: 'dueAt must be a valid ISO datetime'
    }),
    assignedUserId: z.string().uuid('Assigned user ID must be a valid UUID').nullable().optional(),
    note: z
      .string()
      .trim()
      .max(2000, 'Note cannot exceed 2000 characters')
      .nullable()
      .optional()
      .transform((val) => (val && val.length > 0 ? val : null))
  })
  .strict();

export type CreateFollowUpRequest = z.infer<typeof createFollowUpRequestSchema>;

/**
 * Request schema for updating a follow-up task
 */
export const updateFollowUpRequestSchema = z
  .object({
    dueAt: z.coerce
      .date({
        invalid_type_error: 'dueAt must be a valid ISO datetime'
      })
      .optional(),
    assignedUserId: z.string().uuid('Assigned user ID must be a valid UUID').nullable().optional(),
    note: z
      .string()
      .trim()
      .max(2000, 'Note cannot exceed 2000 characters')
      .nullable()
      .optional()
      .transform((val) => (val && val.length > 0 ? val : null))
  })
  .strict();

export type UpdateFollowUpRequest = z.infer<typeof updateFollowUpRequestSchema>;

/**
 * Full FollowUpTask response schema
 */
export const followUpTaskSchema = z
  .object({
    id: z.string().uuid(),
    leadId: z.string().uuid(),
    assignedUserId: z.string().uuid().nullable(),
    assignedUser: assigneeSummarySchema.nullable().optional(),
    createdByUserId: z.string().uuid(),
    createdBy: assigneeSummarySchema.optional(),
    dueAt: z.union([z.date(), z.string()]),
    note: z.string().nullable(),
    status: z.nativeEnum(FollowUpStatus, {
      errorMap: () => ({ message: 'Invalid follow-up status' })
    }),
    completedAt: z.union([z.date(), z.string()]).nullable(),
    createdAt: z.union([z.date(), z.string()]),
    updatedAt: z.union([z.date(), z.string()])
  })
  .strict();

export type FollowUpTask = z.infer<typeof followUpTaskSchema>;

/**
 * List of FollowUpTasks
 */
export const followUpListResponseSchema = z.array(followUpTaskSchema);

export type FollowUpListResponse = z.infer<typeof followUpListResponseSchema>;
