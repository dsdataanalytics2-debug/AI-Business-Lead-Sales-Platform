import { z } from 'zod';
import { OutreachChannel } from '../enums.js';

export const campaignStatusSchema = z.enum([
  'DRAFT',
  'READY',
  'ACTIVE',
  'PAUSED',
  'COMPLETED'
]);

export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

export const campaignSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: campaignStatusSchema,
  channel: z.nativeEnum(OutreachChannel),
  leadCount: z.number().int().min(0),
  draftCount: z.number().int().min(0),
  approvedCount: z.number().int().min(0),
  sentCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  createdAt: z.union([z.date(), z.string()]),
  updatedAt: z.union([z.date(), z.string()])
});

export type CampaignSummary = z.infer<typeof campaignSummarySchema>;

export const createCampaignRequestSchema = z.object({
  name: z.string().trim().min(2, 'Campaign name must be at least 2 characters').max(100),
  channel: z.nativeEnum(OutreachChannel),
  leadIds: z.array(z.string().uuid()).min(1, 'Please select at least one lead for this campaign')
});

export type CreateCampaignRequest = z.infer<typeof createCampaignRequestSchema>;
