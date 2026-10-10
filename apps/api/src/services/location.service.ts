/**
 * Location Suggestion Service
 *
 * Provides real-time geographic location suggestions for buyer market search.
 * Leverages Google Places API (New) Autocomplete when configured for the tenant,
 * restricted to Bangladesh ('bd') and bounded to cost-controlled suggestion limits.
 *
 * SECURITY & PRIVACY INVARIANTS:
 * - Server-side only: Credentials NEVER returned to frontend or logged.
 * - Tenant isolation: Uses tenant-scoped encrypted Google Places credentials.
 * - Safe fallback: Falls back to curated Bangladesh commercial hubs when Google is unconfigured or offline.
 * - Bounded costs: Minimum input length, max results cap (5-8), and no eager Place Details fetching.
 */

import type { LocationSuggestionItem } from '@leadmate/shared';
import { datasourceSettingsService } from './datasource-settings.service.js';

export interface LocationServiceDependencies {
  fetch?: typeof fetch;
}

const PLACES_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';

export const BANGLADESH_FALLBACK_LOCATIONS: LocationSuggestionItem[] = [
  { id: 'bd-dha', label: 'Dhaka, Bangladesh', primaryText: 'Dhaka', secondaryText: 'Bangladesh' },
  { id: 'bd-mir', label: 'Mirpur, Dhaka, Bangladesh', primaryText: 'Mirpur', secondaryText: 'Dhaka, Bangladesh' },
  { id: 'bd-gul', label: 'Gulshan, Dhaka, Bangladesh', primaryText: 'Gulshan', secondaryText: 'Dhaka, Bangladesh' },
  { id: 'bd-dha-nm', label: 'Dhanmondi, Dhaka, Bangladesh', primaryText: 'Dhanmondi', secondaryText: 'Dhaka, Bangladesh' },
  { id: 'bd-utt', label: 'Uttara, Dhaka, Bangladesh', primaryText: 'Uttara', secondaryText: 'Dhaka, Bangladesh' },
  { id: 'bd-ban', label: 'Banani, Dhaka, Bangladesh', primaryText: 'Banani', secondaryText: 'Dhaka, Bangladesh' },
  { id: 'bd-mot', label: 'Motijheel, Dhaka, Bangladesh', primaryText: 'Motijheel', secondaryText: 'Dhaka, Bangladesh' },
  { id: 'bd-ctg', label: 'Chattogram, Bangladesh', primaryText: 'Chattogram', secondaryText: 'Bangladesh' },
  { id: 'bd-syl', label: 'Sylhet, Bangladesh', primaryText: 'Sylhet', secondaryText: 'Bangladesh' },
  { id: 'bd-raj', label: 'Rajshahi, Bangladesh', primaryText: 'Rajshahi', secondaryText: 'Bangladesh' },
  { id: 'bd-khu', label: 'Khulna, Bangladesh', primaryText: 'Khulna', secondaryText: 'Bangladesh' },
  { id: 'bd-bar', label: 'Barishal, Bangladesh', primaryText: 'Barishal', secondaryText: 'Bangladesh' },
  { id: 'bd-ran', label: 'Rangpur, Bangladesh', primaryText: 'Rangpur', secondaryText: 'Bangladesh' },
  { id: 'bd-mym', label: 'Mymensingh, Bangladesh', primaryText: 'Mymensingh', secondaryText: 'Bangladesh' },
  { id: 'bd-gaz', label: 'Gazipur, Bangladesh', primaryText: 'Gazipur', secondaryText: 'Bangladesh' },
  { id: 'bd-nar', label: 'Narayanganj, Bangladesh', primaryText: 'Narayanganj', secondaryText: 'Bangladesh' },
  { id: 'bd-cum', label: 'Cumilla, Bangladesh', primaryText: 'Cumilla', secondaryText: 'Bangladesh' },
  { id: 'bd-bog', label: 'Bogura, Bangladesh', primaryText: 'Bogura', secondaryText: 'Bangladesh' },
  { id: 'bd-cox', label: "Cox's Bazar, Bangladesh", primaryText: "Cox's Bazar", secondaryText: 'Bangladesh' }
];

export class LocationService {
  private readonly customFetch: typeof fetch;

  constructor(deps?: LocationServiceDependencies) {
    this.customFetch = deps?.fetch ?? globalThis.fetch;
  }

  /**
   * Suggests standardized geographic locations for a search query.
   */
  async suggest(
    query: { q: string; limit?: number },
    context: { organizationId: string }
  ): Promise<LocationSuggestionItem[]> {
    const trimmedQ = (query.q || '').trim();
    if (trimmedQ.length < 2) {
      return [];
    }

    const limit = Math.min(Math.max(query.limit ?? 5, 1), 10);

    // 1. Resolve tenant's active Google Places credentials securely
    const providerContext = await datasourceSettingsService.getActiveProviderContext(
      context.organizationId
    );

    if (providerContext.apiKey && providerContext.apiKey.trim().length > 0) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await this.customFetch(PLACES_AUTOCOMPLETE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': providerContext.apiKey.trim()
          },
          body: JSON.stringify({
            input: trimmedQ,
            includedRegionCodes: ['bd']
          }),
          signal: controller.signal
        }).finally(() => clearTimeout(timeoutId));

        if (response.ok) {
          const payload = (await response.json()) as { suggestions?: any[] };
          const suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
          const items: LocationSuggestionItem[] = [];

          for (const s of suggestions) {
            if (items.length >= limit) break;
            const pred = s?.placePrediction;
            if (!pred) continue;

            const id = pred.placeId || pred.place || `loc-${items.length}`;
            const label = pred.text?.text?.trim() || pred.structuredFormat?.mainText?.text?.trim();
            const primaryText = pred.structuredFormat?.mainText?.text?.trim() || label;
            const secondaryText = pred.structuredFormat?.secondaryText?.text?.trim() || undefined;

            if (label && primaryText) {
              items.push({
                id,
                label,
                primaryText,
                secondaryText
              });
            }
          }

          if (items.length > 0) {
            return items;
          }
        }
      } catch {
        // Fall back gracefully to curated Bangladesh locations on timeout or network error
      }
    }

    // 2. Curated fallback matching for Bangladesh
    const lowerQ = trimmedQ.toLowerCase();
    const fallbackMatches = BANGLADESH_FALLBACK_LOCATIONS.filter((item) => {
      const matchLabel = item.label.toLowerCase().includes(lowerQ);
      const matchPrimary = item.primaryText.toLowerCase().includes(lowerQ);
      const matchSecondary = item.secondaryText?.toLowerCase().includes(lowerQ);
      return matchLabel || matchPrimary || matchSecondary;
    });

    return fallbackMatches.slice(0, limit);
  }
}

export const locationService = new LocationService();
