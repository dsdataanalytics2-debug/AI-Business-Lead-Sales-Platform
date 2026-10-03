import { z } from 'zod';
import { CrmStage, CrmActivityType } from '../enums.js';

/* =========================================================
 * Assignee Summary Schema
 * ========================================================= */

export const assigneeSummarySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1, 'Name cannot be empty').max(255),
    email: z.string().trim().email('Invalid email address').toLowerCase()
  })
  .strict();

export type AssigneeSummary = z.infer<typeof assigneeSummarySchema>;

/* =========================================================
 * Lead Assignment Request Schema
 * ========================================================= */

export const leadAssignmentRequestSchema = z
  .object({
    assignedUserId: z.string().uuid('Assigned user ID must be a valid UUID').nullable()
  })
  .strict();

export type LeadAssignmentRequest = z.infer<typeof leadAssignmentRequestSchema>;

/* =========================================================
 * Lead Assignment Response Schema
 * ========================================================= */

export const leadAssignmentResponseSchema = z
  .object({
    leadId: z.string().uuid(),
    assignedUserId: z.string().uuid().nullable(),
    assignedAt: z.union([z.date(), z.string()]).nullable(),
    assignedUser: assigneeSummarySchema.nullable()
  })
  .strict();

export type LeadAssignmentResponse = z.infer<typeof leadAssignmentResponseSchema>;

/* =========================================================
 * CRM Stage Update Request Schema
 * ========================================================= */

export const crmStageUpdateRequestSchema = z
  .object({
    stage: z.nativeEnum(CrmStage, {
      errorMap: () => ({ message: 'Invalid CRM stage' })
    })
  })
  .strict();

export type CrmStageUpdateRequest = z.infer<typeof crmStageUpdateRequestSchema>;

/* =========================================================
 * CRM Stage Update Response Schema
 * ========================================================= */

export const crmStageUpdateResponseSchema = z
  .object({
    leadId: z.string().uuid(),
    crmStage: z.nativeEnum(CrmStage)
  })
  .strict();

export type CrmStageUpdateResponse = z.infer<typeof crmStageUpdateResponseSchema>;

/* =========================================================
 * CRM Note Request & Response Schemas
 * ========================================================= */

export const crmNoteRequestSchema = z
  .object({
    content: z
      .string()
      .trim()
      .min(1, 'Note content cannot be empty')
      .max(5000, 'Note content cannot exceed 5000 characters')
  })
  .strict();

export type CrmNoteRequest = z.infer<typeof crmNoteRequestSchema>;

export const crmNoteSchema = z
  .object({
    id: z.string().uuid(),
    leadId: z.string().uuid(),
    userId: z.string().uuid(),
    author: assigneeSummarySchema.optional(),
    content: z.string().min(1).max(5000),
    createdAt: z.union([z.date(), z.string()]),
    updatedAt: z.union([z.date(), z.string()])
  })
  .strict();

export type CrmNote = z.infer<typeof crmNoteSchema>;

/* =========================================================
 * CRM Activity Schema
 * ========================================================= */

export const crmActivitySchema = z
  .object({
    id: z.string().uuid(),
    leadId: z.string().uuid(),
    type: z.nativeEnum(CrmActivityType, {
      errorMap: () => ({ message: 'Invalid CRM activity type' })
    }),
    actorUserId: z.string().uuid().nullable().optional(),
    actor: assigneeSummarySchema.nullable().optional(),
    metadata: z.record(z.unknown()).default({}),
    createdAt: z.union([z.date(), z.string()])
  })
  .strict();

export type CrmActivity = z.infer<typeof crmActivitySchema>;

/* =========================================================
 * CRM Lead Summary Fragment Schema
 * ========================================================= */

export const crmLeadSummaryFragmentSchema = z
  .object({
    crmStage: z.nativeEnum(CrmStage),
    assignedUserId: z.string().uuid().nullable().optional(),
    assignedUser: assigneeSummarySchema.nullable().optional(),
    assignedAt: z.union([z.date(), z.string()]).nullable().optional()
  })
  .strict();

export type CrmLeadSummaryFragment = z.infer<typeof crmLeadSummaryFragmentSchema>;
