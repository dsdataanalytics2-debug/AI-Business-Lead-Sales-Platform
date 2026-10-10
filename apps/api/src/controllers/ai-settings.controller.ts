/**
 * AI Settings Controller
 *
 * Exposes endpoints for managing tenant AI model configurations and keys.
 */

import { Request, Response, NextFunction } from 'express';
import {
  configureAiProviderSchema,
  testAiConnectionSchema,
  updateAiModelSchema
} from '@leadmate/shared';
import { aiSettingsService } from '../services/ai-settings.service.js';

export class AiSettingsController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await aiSettingsService.listAiProviders(req.user!.organizationId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async configureGemini(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = configureAiProviderSchema.parse({
        ...req.body,
        provider: req.body?.provider || req.params.provider || 'gemini'
      });
      const result = await aiSettingsService.configureGemini(
        req.user!.organizationId,
        req.user!.id,
        input.apiKey,
        input.model
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async testGemini(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = testAiConnectionSchema.parse(req.body);
      const result = await aiSettingsService.testGemini(
        req.user!.organizationId,
        input.apiKey,
        input.model
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async toggleProvider(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const provider = req.params.provider;
      const enabled = Boolean(req.body.enabled);
      const result = await aiSettingsService.setProviderEnabled(
        req.user!.organizationId,
        req.user!.id,
        provider,
        enabled
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async setModel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const provider = req.params.provider;
      const input = updateAiModelSchema.parse(req.body);
      const result = await aiSettingsService.setModel(
        req.user!.organizationId,
        req.user!.id,
        provider,
        input.model
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const aiSettingsController = new AiSettingsController();
