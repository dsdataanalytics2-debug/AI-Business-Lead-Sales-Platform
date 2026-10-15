import { z } from 'zod';

export type OutreachDraftChannel = 'EMAIL' | 'WHATSAPP_DRAFT' | 'SMS_DRAFT' | 'CALL_SCRIPT';

export const outreachDraftChannelSchema = z.enum(['EMAIL', 'WHATSAPP_DRAFT', 'SMS_DRAFT', 'CALL_SCRIPT']);

export type OutreachDraftStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'READY_FOR_DISPATCH';

export const outreachDraftStatusSchema = z.enum([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'READY_FOR_DISPATCH'
]);

export interface OutreachDraftEditRecord {
  editedByUserId: string;
  editedAt: string | Date;
  previousSubject?: string | null;
  previousBody: string;
}

export interface OutreachDraftDto {
  id: string;
  organizationId: string;
  salesMissionBuyerId: string;
  salesMissionId: string;
  channel: OutreachDraftChannel | string;
  status: OutreachDraftStatus | string;
  subject?: string | null;
  body: string;
  language: 'EN' | 'BN' | string;
  aiContextSnapshot?: any;
  editHistory?: OutreachDraftEditRecord[] | null;
  approvedByUserId?: string | null;
  approvedAt?: string | Date | null;
  rejectedByUserId?: string | null;
  rejectedAt?: string | Date | null;
  rejectionReason?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export const createOutreachDraftInputSchema = z.object({
  channel: outreachDraftChannelSchema.default('EMAIL'),
  language: z.enum(['EN', 'BN']).default('EN')
});

export type CreateOutreachDraftInput = z.infer<typeof createOutreachDraftInputSchema>;

export const editOutreachDraftInputSchema = z.object({
  subject: z.string().trim().max(300).optional().nullable(),
  body: z.string().trim().min(5, 'Draft body must contain at least 5 characters')
});

export type EditOutreachDraftInput = z.infer<typeof editOutreachDraftInputSchema>;

export const rejectOutreachDraftInputSchema = z.object({
  rejectionReason: z.string().trim().min(3, 'Rejection reason must be at least 3 characters')
});

export type RejectOutreachDraftInput = z.infer<typeof rejectOutreachDraftInputSchema>;

// ==========================================
// REPLY CLASSIFICATION
// ==========================================

export type ReplyClassificationCategory =
  | 'INTERESTED'
  | 'NOT_INTERESTED'
  | 'PRICE_REQUEST'
  | 'MOQ_REQUEST'
  | 'PRODUCT_INFO_REQUEST'
  | 'FOLLOW_UP_LATER'
  | 'ORDER_INTENT'
  | 'UNSUBSCRIBE'
  | 'UNCLASSIFIED';

export const replyClassificationCategorySchema = z.enum([
  'INTERESTED',
  'NOT_INTERESTED',
  'PRICE_REQUEST',
  'MOQ_REQUEST',
  'PRODUCT_INFO_REQUEST',
  'FOLLOW_UP_LATER',
  'ORDER_INTENT',
  'UNSUBSCRIBE',
  'UNCLASSIFIED'
]);

export interface BuyerInteractionDto {
  id: string;
  organizationId: string;
  salesMissionBuyerId: string;
  direction: 'INBOUND' | 'OUTBOUND' | string;
  channel: string;
  content: string;
  rawPayload?: any;
  classification?: ReplyClassificationCategory | string | null;
  classificationConfidence?: number | null;
  classificationSignals?: string[] | null;
  createdAt: string | Date;
}

export const processInboundReplyInputSchema = z.object({
  content: z.string().trim().min(1, 'Inbound message content is required'),
  channel: z.enum(['EMAIL', 'WHATSAPP', 'SMS', 'PHONE_CALL']).default('EMAIL'),
  senderPhone: z.string().trim().optional().nullable(),
  senderEmail: z.string().trim().optional().nullable()
});

export type ProcessInboundReplyInput = z.infer<typeof processInboundReplyInputSchema>;

// ==========================================
// SUPPRESSION (DO-NOT-CONTACT)
// ==========================================

export interface SuppressionRecordDto {
  id: string;
  organizationId: string;
  reason: 'UNSUBSCRIBE' | 'DO_NOT_CONTACT' | 'MANUAL_OPTOUT' | string;
  source: 'INBOUND_REPLY' | 'MANUAL_OPERATOR' | 'IMPORT' | string;
  phone?: string | null;
  email?: string | null;
  domain?: string | null;
  salesMissionBuyerId?: string | null;
  metadata?: any;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export const createSuppressionInputSchema = z.object({
  phone: z.string().trim().optional().nullable(),
  email: z.string().trim().email().optional().nullable(),
  domain: z.string().trim().optional().nullable(),
  salesMissionBuyerId: z.string().uuid().optional().nullable(),
  reason: z.enum(['UNSUBSCRIBE', 'DO_NOT_CONTACT', 'MANUAL_OPTOUT']).default('DO_NOT_CONTACT'),
  source: z.enum(['INBOUND_REPLY', 'MANUAL_OPERATOR', 'IMPORT']).default('MANUAL_OPERATOR')
});

export type CreateSuppressionInput = z.infer<typeof createSuppressionInputSchema>;

// ==========================================
// CONVERSION TRACKING
// ==========================================

export type ConversionStage =
  | 'DISCOVERED'
  | 'CONTACTED'
  | 'REPLIED'
  | 'INTERESTED'
  | 'NOT_INTERESTED'
  | 'FOLLOW_UP'
  | 'NEGOTIATING'
  | 'WON'
  | 'LOST';

export const conversionStageSchema = z.enum([
  'DISCOVERED',
  'CONTACTED',
  'REPLIED',
  'INTERESTED',
  'NOT_INTERESTED',
  'FOLLOW_UP',
  'NEGOTIATING',
  'WON',
  'LOST'
]);

export type ConversionLostReason =
  | 'PRICE_HIGH'
  | 'COMPETITOR_CHOSEN'
  | 'NO_BUDGET'
  | 'NO_REPLY'
  | 'OUT_OF_STOCK'
  | 'NOT_RELEVANT'
  | 'OTHER';

export const conversionLostReasonSchema = z.enum([
  'PRICE_HIGH',
  'COMPETITOR_CHOSEN',
  'NO_BUDGET',
  'NO_REPLY',
  'OUT_OF_STOCK',
  'NOT_RELEVANT',
  'OTHER'
]);

export const conversionWonEvidenceSchema = z.object({
  dealValue: z.coerce.number().positive('dealValue must be a positive number'),
  currency: z.string().trim().min(1, 'currency is required').default('BDT'),
  closedAt: z.coerce.date().or(z.string().trim().min(1)),
  notes: z.string().trim().min(10, 'notes must be at least 10 characters explaining deal outcome'),
  verifiedByUserId: z.string().trim().min(1, 'verifiedByUserId is required'),
  invoiceOrPoReference: z.string().trim().optional().nullable(),
  orderReference: z.string().trim().optional().nullable()
});

export type ConversionWonEvidence = z.infer<typeof conversionWonEvidenceSchema>;

export const transitionStageInputSchema = z.object({
  stage: conversionStageSchema,
  wonEvidence: conversionWonEvidenceSchema.optional().nullable(),
  lostReason: conversionLostReasonSchema.optional().nullable(),
  notes: z.string().trim().optional().nullable()
}).superRefine((data, ctx) => {
  if (data.stage === 'WON' && !data.wonEvidence) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Explicit commercial evidence (dealValue, currency, closedAt, notes, verifiedByUserId) is required when marking stage as WON.',
      path: ['wonEvidence']
    });
  }
  if (data.stage === 'LOST' && !data.lostReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Standard loss reason (PRICE_HIGH, COMPETITOR_CHOSEN, NO_BUDGET, NO_REPLY, OUT_OF_STOCK, NOT_RELEVANT, OTHER) is required when marking stage as LOST.',
      path: ['lostReason']
    });
  }
});

export type TransitionStageInput = z.infer<typeof transitionStageInputSchema>;
