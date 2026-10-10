/**
 * Location Controller
 *
 * Exposes GET /api/v1/locations/suggest for authenticated location autocomplete.
 */

import { Request, Response, NextFunction } from 'express';
import { locationSuggestionQuerySchema } from '@leadmate/shared';
import { locationService } from '../services/location.service.js';

export class LocationController {
  /**
   * GET /api/v1/locations/suggest
   *
   * Query params:
   * - q: search query string (min 1, max 100)
   * - limit: optional max items (default 5, max 10)
   */
  async suggest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = locationSuggestionQuerySchema.parse(req.query);

      if (query.q.trim().length < 2) {
        res.status(200).json({ data: [] });
        return;
      }

      const results = await locationService.suggest(query, {
        organizationId: req.user!.organizationId
      });

      res.status(200).json({ data: results });
    } catch (err) {
      next(err);
    }
  }
}

export const locationController = new LocationController();
