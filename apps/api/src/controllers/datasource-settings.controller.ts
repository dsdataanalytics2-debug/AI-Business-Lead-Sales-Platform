import type { Request, Response, NextFunction } from 'express';
import { datasourceSettingsService } from '../services/datasource-settings.service.js';
import {
  configureGooglePlacesSchema,
  testGooglePlacesSchema,
  configureProviderCredentialSchema
} from '@leadmate/shared';
import { BadRequestError } from '../lib/errors.js';


export class DatasourceSettingsController {
  async listDataSources(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.user!.organizationId;
      const data = await datasourceSettingsService.listDataSources(organizationId);
      res.status(200).json(data);
    } catch (err) {
      next(err);
    }
  }

  async configureGooglePlaces(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.user!.organizationId;
      const userId = req.user!.id;
      const parsed = configureGooglePlacesSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError(parsed.error.errors[0]?.message || 'Invalid request body');
      }

      const result = await datasourceSettingsService.configureGooglePlaces(
        organizationId,
        userId,
        parsed.data.apiKey
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async testGooglePlaces(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.user!.organizationId;
      const parsed = testGooglePlacesSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError(parsed.error.errors[0]?.message || 'Invalid request body');
      }

      const result = await datasourceSettingsService.testGooglePlaces(
        organizationId,
        parsed.data.apiKey
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async configureProvider(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.user!.organizationId;
      const userId = req.user!.id;
      const { provider } = req.params;
      const parsed = configureProviderCredentialSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError(parsed.error.errors[0]?.message || 'Invalid request body');
      }

      const result = await datasourceSettingsService.configureProvider(
        organizationId,
        userId,
        provider,
        parsed.data.apiKey
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async testProvider(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.user!.organizationId;
      const { provider } = req.params;
      const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey : undefined;

      const result = await datasourceSettingsService.testProvider(
        organizationId,
        provider,
        apiKey
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async setActiveProvider(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.user!.organizationId;
      const userId = req.user!.id;
      const { provider } = req.params;

      const result = await datasourceSettingsService.setActiveProvider(
        organizationId,
        userId,
        provider
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async toggleProviderEnabled(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.user!.organizationId;
      const userId = req.user!.id;
      const { provider } = req.params;
      const enabled = Boolean(req.body.enabled);

      const result = await datasourceSettingsService.setProviderEnabled(
        organizationId,
        userId,
        provider,
        enabled
      );

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const datasourceSettingsController = new DatasourceSettingsController();
