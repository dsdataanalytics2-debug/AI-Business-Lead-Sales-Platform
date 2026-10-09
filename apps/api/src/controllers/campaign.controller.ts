import type { Request, Response, NextFunction } from 'express';
import { campaignService } from '../services/campaign.service.js';
import { createCampaignRequestSchema } from '@leadmate/shared';
import { BadRequestError } from '../lib/errors.js';


export class CampaignController {
  async listCampaigns(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.user!.organizationId;
      const campaigns = await campaignService.listCampaigns(organizationId);
      res.status(200).json({ data: campaigns });
    } catch (err) {
      next(err);
    }
  }

  async createCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.user!.organizationId;
      const userId = req.user!.id;
      const parsed = createCampaignRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError(parsed.error.errors[0]?.message || 'Invalid campaign request');
      }

      const created = await campaignService.createCampaign(organizationId, userId, parsed.data);
      res.status(201).json({ data: created });
    } catch (err) {
      next(err);
    }
  }
}

export const campaignController = new CampaignController();
