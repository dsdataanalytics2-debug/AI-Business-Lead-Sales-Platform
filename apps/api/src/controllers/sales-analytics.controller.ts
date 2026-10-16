import { Request, Response, NextFunction } from 'express';
import { salesAnalyticsService } from '../services/sales-analytics.service.js';

export class SalesAnalyticsController {
  async getDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.user!.organizationId;
      const kpis = await salesAnalyticsService.getDashboardKpis(organizationId);
      res.status(200).json({ data: kpis });
    } catch (err) {
      next(err);
    }
  }

  async getProductAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.user!.organizationId;
      const { productId } = req.params;
      const data = await salesAnalyticsService.getProductAnalytics(organizationId, productId);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  }

  async getSources(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.user!.organizationId;
      const data = await salesAnalyticsService.getSourceEffectiveness(organizationId);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  }

  async getRecommendations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.user!.organizationId;
      const productId = typeof req.query.productId === 'string' ? req.query.productId : undefined;
      const data = await salesAnalyticsService.getRecommendations(organizationId, productId);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  }
}

export const salesAnalyticsController = new SalesAnalyticsController();
