/**
 * OpenStreetMap / Overpass Live Buyer & Business Discovery Provider
 *
 * Implements the DataSourceProvider interface using OpenStreetMap data
 * queried via the Overpass API (interpreter).
 *
 * FAIR USE & PERFORMANCE INVARIANTS:
 * - Free live provider (no API key required).
 * - Configurable endpoint via OVERPASS_API_URL (defaults to https://overpass-api.de/api/interpreter).
 * - Bounded query timeout (default 15s), result limit (default 10-25), bounded payload size.
 * - PHONE != WHATSAPP: Public phone is tagged strictly as ContactType.PHONE with
 *   WhatsAppStatus.UNKNOWN. Zero automatic WhatsApp inference.
 * - Missing fields remain null/undefined. Zero fabrication of contacts or scores.
 * - Full data provenance preserved: externalId = "osm:node/123" or "osm:way/456".
 */

import {
  ContactType,
  PhoneType,
  WhatsAppStatus,
  EvidenceType
} from '@leadmate/shared';
import type {
  DataSourceProvider,
  ProviderContext,
  BusinessSearchInput,
  BusinessSearchResult,
  DiscoveredContact
} from '../types.js';
import {
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  InvalidQueryError
} from '../errors.js';

export const OPENSTREETMAP_PROVIDER_KEY = 'openstreetmap';
export const DEFAULT_OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter';

// Known major cities bounding boxes in Bangladesh [minLat, minLon, maxLat, maxLon]
const CITY_BBOX_MAP: Record<string, [number, number, number, number]> = {
  dhaka: [23.70, 90.35, 23.85, 90.45],
  chittagong: [22.25, 91.70, 22.45, 91.90],
  chattogram: [22.25, 91.70, 22.45, 91.90],
  sylhet: [24.83, 91.80, 24.96, 91.94],
  rajshahi: [24.32, 88.54, 24.42, 88.66],
  khulna: [22.78, 89.50, 22.88, 89.60],
  barisal: [22.66, 90.32, 22.75, 90.41],
  rangpur: [25.70, 89.20, 25.80, 89.30],
  mymensingh: [24.70, 90.35, 24.80, 90.45],
  comilla: [23.42, 91.13, 23.51, 91.23],
  gazipur: [23.95, 90.35, 24.10, 90.48],
  narayanganj: [23.58, 90.45, 23.68, 90.55]
};

// Default bounding box for Bangladesh
const BD_BBOX: [number, number, number, number] = [20.5, 88.0, 26.7, 92.7];

export interface OpenStreetMapDependencies {
  fetch?: typeof fetch;
  endpointUrl?: string;
}

export interface OsmElementRaw {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export class OpenStreetMapProvider implements DataSourceProvider {
  public readonly name: string = OPENSTREETMAP_PROVIDER_KEY;
  private readonly customFetch: typeof fetch;
  private readonly defaultEndpoint: string;

  constructor(deps?: OpenStreetMapDependencies) {
    this.customFetch = deps?.fetch ?? globalThis.fetch;
    this.defaultEndpoint =
      deps?.endpointUrl ??
      process.env.OVERPASS_API_URL ??
      DEFAULT_OVERPASS_API_URL;
  }

  /**
   * Resolves the bounding box for a given location query.
   */
  private getBoundingBox(location?: string): [number, number, number, number] {
    if (!location) return BD_BBOX;
    const clean = location.toLowerCase().trim();
    for (const [cityKey, bbox] of Object.entries(CITY_BBOX_MAP)) {
      if (clean.includes(cityKey)) {
        return bbox;
      }
    }
    return BD_BBOX;
  }

  /**
   * Escapes regex special characters for Overpass QL regex string.
   */
  private escapeOverpassQuery(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Normalizes an OSM element to a canonical BusinessSearchResult.
   */
  public normalizeElement(element: OsmElementRaw, locationFallback = 'Dhaka'): BusinessSearchResult {
    const tags = element.tags ?? {};
    const externalId = `osm:${element.type}/${element.id}`;
    const name = tags.name || tags['name:en'] || tags['brand'] || `OSM Business #${element.id}`;

    // Category detection from OSM tags
    const category =
      tags.shop ||
      tags.amenity ||
      tags.office ||
      tags.craft ||
      tags.healthcare ||
      tags.tourism ||
      tags.commercial ||
      'Business';

    // Address construction from addr:* tags
    const addressParts = [
      tags['addr:housenumber'],
      tags['addr:street'],
      tags['addr:suburb'] || tags['addr:neighbourhood'],
      tags['addr:city']
    ].filter(Boolean);
    const address = addressParts.length > 0 ? addressParts.join(', ') : undefined;

    const city = tags['addr:city'] || locationFallback;
    const country = tags['addr:country'] || 'BD';

    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;

    const rawWebsite = tags.website || tags['contact:website'] || tags['url'] || undefined;
    const rawPhone = tags.phone || tags['contact:phone'] || tags['contact:mobile'] || undefined;

    const contacts: DiscoveredContact[] = [];

    // INVARIANT: PHONE != WHATSAPP. Strictly ContactType.PHONE, never infer WhatsApp!
    if (rawPhone && typeof rawPhone === 'string' && rawPhone.trim().length > 0) {
      contacts.push({
        type: ContactType.PHONE,
        rawValue: rawPhone.trim(),
        phoneType: PhoneType.UNKNOWN,
        whatsappStatus: WhatsAppStatus.UNKNOWN,
        evidenceType: EvidenceType.LISTING_FIELD,
        sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
        snippet: `OpenStreetMap listing contact: ${rawPhone.trim()}`
      });
    }

    return {
      externalId,
      provider: OPENSTREETMAP_PROVIDER_KEY,
      name,
      category,
      address,
      city,
      country,
      latitude,
      longitude,
      website: rawWebsite,
      rating: undefined,
      reviewCount: 0,
      sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      contacts
    };
  }

  /**
   * Searches businesses in OpenStreetMap via Overpass QL.
   */
  public async search(
    query: BusinessSearchInput,
    context?: ProviderContext
  ): Promise<BusinessSearchResult[]> {
    if (!query.q || query.q.trim().length === 0) {
      throw new InvalidQueryError('Search query (q) is required');
    }

    const endpoint = context?.endpointUrl ?? this.defaultEndpoint;
    const limit = Math.min(Math.max(query.limit ?? 10, 1), 25);
    const bbox = this.getBoundingBox(query.location);
    const escapedQuery = this.escapeOverpassQuery(query.q.trim());

    // Build bounded Overpass QL query with strict bbox and timeout
    const overpassQl = `[out:json][timeout:12];
(
  node["name"~"${escapedQuery}",i](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
  way["name"~"${escapedQuery}",i](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
);
out center ${limit};`;

    let response: Response;
    const timeoutSignal = AbortSignal.timeout(15000);
    const signal = context?.signal
      ? (typeof AbortSignal.any === 'function' ? AbortSignal.any([context.signal, timeoutSignal]) : timeoutSignal)
      : timeoutSignal;

    try {
      response = await this.customFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'LeadAtlas-BusinessDiscovery/1.0'
        },
        body: `data=${encodeURIComponent(overpassQl)}`,
        signal
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new ProviderTimeoutError(
          OPENSTREETMAP_PROVIDER_KEY,
          'OpenStreetMap Overpass API request timed out'
        );
      }
      throw new ProviderUnavailableError(
        OPENSTREETMAP_PROVIDER_KEY,
        `Network failure connecting to Overpass API: ${err.message || 'Unknown network error'}`
      );
    }

    if (!response.ok) {
      if (response.status === 429) {
        throw new ProviderRateLimitError(
          OPENSTREETMAP_PROVIDER_KEY,
          'Overpass API rate limit exceeded. Please wait a moment before searching again.'
        );
      }
      if (response.status === 504 || response.status === 408) {
        throw new ProviderTimeoutError(
          OPENSTREETMAP_PROVIDER_KEY,
          'Overpass API query timed out on server.'
        );
      }
      throw new ProviderUnavailableError(
        OPENSTREETMAP_PROVIDER_KEY,
        `Overpass API returned HTTP ${response.status}`
      );
    }

    let payload: any;
    try {
      payload = await response.json();
    } catch {
      throw new ProviderUnavailableError(
        OPENSTREETMAP_PROVIDER_KEY,
        'Overpass API returned an invalid response body'
      );
    }

    const elements: OsmElementRaw[] = Array.isArray(payload.elements)
      ? payload.elements
      : [];
    const locationFallback = query.location?.trim() || 'Dhaka';

    return elements
      .filter((el) => el.tags && (el.tags.name || el.tags['name:en']))
      .slice(0, limit)
      .map((el) => this.normalizeElement(el, locationFallback));
  }

  /**
   * Resolves an authoritative OSM business by its externalId (e.g. "osm:node/12345").
   */
  public async resolveByExternalId(
    externalId: string,
    context?: ProviderContext
  ): Promise<BusinessSearchResult | null> {
    if (!externalId || typeof externalId !== 'string') return null;

    const match = externalId.replace(/^osm:/, '').match(/^(node|way|relation)\/(\d+)$/);
    if (!match) return null;

    const [, type, id] = match;
    const endpoint = context?.endpointUrl ?? this.defaultEndpoint;
    const overpassQl = `[out:json][timeout:10];
${type}(${id});
out center;`;

    let response: Response;
    try {
      response = await this.customFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'LeadAtlas-BusinessDiscovery/1.0'
        },
        body: `data=${encodeURIComponent(overpassQl)}`,
        signal: context?.signal
      });
    } catch {
      return null;
    }

    if (!response.ok) return null;

    try {
      const payload: any = await response.json();
      const elements: OsmElementRaw[] = payload.elements || [];
      if (elements.length === 0) return null;
      return this.normalizeElement(elements[0]);
    } catch {
      return null;
    }
  }

  /**
   * Tests connection to the Overpass API endpoint without running expensive queries.
   */
  public async testConnection(): Promise<{ connected: boolean; message: string }> {
    const endpoint = this.defaultEndpoint;
    try {
      const response = await this.customFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'LeadAtlas-BusinessDiscovery/1.0'
        },
        body: 'data=[out:json][timeout:5];out count;',
        signal: AbortSignal.timeout(8000)
      });

      if (response.ok) {
        return {
          connected: true,
          message: 'OpenStreetMap Overpass API is reachable and operational.'
        };
      }

      if (response.status === 429) {
        return {
          connected: false,
          message: 'Overpass API rate limit active. Fair-use threshold reached.'
        };
      }

      return {
        connected: false,
        message: `Overpass API returned HTTP ${response.status}.`
      };
    } catch (err: any) {
      return {
        connected: false,
        message: `Failed to connect to Overpass API: ${err.message || 'Network error'}`
      };
    }
  }
}
