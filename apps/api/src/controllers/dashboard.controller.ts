import { Request, Response, NextFunction } from 'express';
import { Role, dashboardFilterQuerySchema } from '@leadmate/shared';
import { analyticsService, AnalyticsActorContext } from '../services/analytics.service.js';

function getActorContext(req: Request): AnalyticsActorContext {
  return {
    actorId: req.user!.id,
    organizationId: req.user!.organizationId,
    role: req.user!.role as unknown as Role
  };
}

export class DashboardController {
  async getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = dashboardFilterQuerySchema.parse(req.query);
      const actor = getActorContext(req);
      const result = await analyticsService.getSummary(actor, query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async getFunnel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = dashboardFilterQuerySchema.parse(req.query);
      const actor = getActorContext(req);
      const result = await analyticsService.getFunnel(actor, query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async getSources(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = dashboardFilterQuerySchema.parse(req.query);
      const actor = getActorContext(req);
      const result = await analyticsService.getSources(actor, query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async getOutreach(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = dashboardFilterQuerySchema.parse(req.query);
      const actor = getActorContext(req);
      const result = await analyticsService.getOutreach(actor, query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async getTeamPerformance(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = dashboardFilterQuerySchema.parse(req.query);
      const actor = getActorContext(req);
      const result = await analyticsService.getTeamPerformance(actor, query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const dashboardController = new DashboardController();
