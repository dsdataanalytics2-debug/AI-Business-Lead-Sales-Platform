import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  createSalesMissionSchema,
  listSalesMissionsQuerySchema,
  analyzeProductInputSchema
} from '@leadmate/shared';
import { salesMissionService } from '../services/sales-mission.service.js';
import { aiProductAnalysisService } from '../services/ai-product-analysis.service.js';

export class SalesMissionController {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createSalesMissionSchema.parse(req.body);
      const mission = await salesMissionService.createMission(input, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(201).json({
        data: mission
      });
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const mission = await salesMissionService.getMissionById(id, req.user!.organizationId);

      res.status(200).json({
        data: mission
      });
    } catch (err) {
      next(err);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = listSalesMissionsQuerySchema.parse(req.query);
      const result = await salesMissionService.listMissions(query, req.user!.organizationId);

      res.status(200).json({
        data: result.missions,
        meta: {
          total: result.total,
          page: result.page,
          totalPages: result.totalPages
        }
      });
    } catch (err) {
      next(err);
    }
  }

  async analyze(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const mission = await salesMissionService.analyzeMission(id, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({
        data: mission
      });
    } catch (err) {
      next(err);
    }
  }

  async analyzeDirect(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = analyzeProductInputSchema.parse(req.body);
      const analysis = await aiProductAnalysisService.analyzeProductForBuyerDiscovery(input, {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        correlationId: String(req.id || 'unknown')
      });

      res.status(200).json({
        data: analysis
      });
    } catch (err) {
      next(err);
    }
  }

  async discover(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const targetCategoriesOverride = Array.isArray(req.body?.targetCategories)
        ? req.body.targetCategories.map((c: any) => String(c).trim()).filter(Boolean)
        : undefined;

      const mission = await salesMissionService.discoverBuyers(
        id,
        targetCategoriesOverride,
        {
          organizationId: req.user!.organizationId,
          userId: req.user!.id,
          correlationId: String(req.id || 'unknown')
        }
      );

      res.status(200).json({
        data: mission
      });
    } catch (err) {
      next(err);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const mission = await salesMissionService.discoverBuyers(
        id,
        undefined,
        {
          organizationId: req.user!.organizationId,
          userId: req.user!.id,
          correlationId: String(req.id || 'unknown')
        }
      );

      res.status(200).json({
        data: mission
      });
    } catch (err) {
      next(err);
    }
  }
}

export const salesMissionController = new SalesMissionController();
