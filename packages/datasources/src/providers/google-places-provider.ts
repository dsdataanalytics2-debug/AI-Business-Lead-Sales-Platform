/**
 * Google Places API (New) Live Datasource Provider
 *
 * Implements DataSourceProvider interface connecting to Google's official
 * Places API (New) web services:
 * - Text Search: https://places.googleapis.com/v1/places:searchText
 * - Place Details: https://places.googleapis.com/v1/places/{placeId}
 *
 * SECURITY & INTEGRITY INVARIANTS:
 * - Server-side only: Browser NEVER calls Google or receives secret keys.
 * - Strict field masks: Prohibits expensive atmosphere and review fields.
 * - PHONE != WHATSAPP: Public phone is saved strictly as ContactType.PHONE with
 *   WhatsAppStatus.UNKNOWN. Zero automatic WhatsApp inference.
 * - Zero fabrication: Missing website, email, or phone remain omitted/null.
 * - Provenance: Preserves authoritative Google Place ID as externalId.
 * - Cost Control: Bounded page sizes (10-20), search-first with on-demand detail resolution.
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
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  InvalidQueryError
} from '../errors.js';

export const GOOGLE_PLACES_PROVIDER_KEY = 'google-places';

const PLACES_BASE_URL = 'https://places.googleapis.com/v1';

// Strict field masks to bound Google Places (New) billing
const SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.primaryType',
  'places.types',
  'places.location',
  'places.addressComponents'
].join(',');

const DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'nationalPhoneNumber',
  'internationalPhoneNumber',
  'websiteUri',
  'rating',
  'userRatingCount',
  'primaryType',
  'types',
  'location',
  'addressComponents'
].join(',');

export interface GooglePlacesDependencies {
  fetch?: typeof fetch;
}

export interface GooglePlaceRawItem {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string; languageCode?: string };
  types?: string[];
  location?: { latitude?: number; longitude?: number };
  addressComponents?: Array<{
    longText?: string;
    shortText?: string;
    types?: string[];
  }>;
}

export class GooglePlacesProvider implements DataSourceProvider {
  public readonly name: string = GOOGLE_PLACES_PROVIDER_KEY;
  private readonly customFetch: typeof fetch;

  constructor(deps?: GooglePlacesDependencies) {
    this.customFetch = deps?.fetch ?? globalThis.fetch;
  }

  /**
   * Normalizes a raw Google Places (New) response item to canonical BusinessSearchResult.
   */
  public normalizePlace(place: GooglePlaceRawItem, locationFallback = 'Dhaka'): BusinessSearchResult {
    const externalId = place.id ? `google:${place.id}` : `google:unknown-${Date.now()}`;
    const name = place.displayName?.text?.trim() || 'Google Places Business';

    let category = 'Business';
    if (place.primaryType) {
      category = place.primaryType
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
    } else if (place.types && place.types.length > 0) {
      category = place.types[0]
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    const address = place.formattedAddress?.trim() || undefined;

    let city = locationFallback;
    let country = 'BD';

    if (place.addressComponents && Array.isArray(place.addressComponents)) {
      for (const comp of place.addressComponents) {
        if (comp.types?.includes('locality') && comp.longText) {
          city = comp.longText;
        }
        if (comp.types?.includes('country') && comp.shortText) {
          country = comp.shortText;
        }
      }
    }

    const latitude = place.location?.latitude;
    const longitude = place.location?.longitude;
    const website = place.websiteUri?.trim() || undefined;
    const rating = typeof place.rating === 'number' ? place.rating : undefined;
    const reviewCount = typeof place.userRatingCount === 'number' ? place.userRatingCount : 0;

    const rawPhone = place.nationalPhoneNumber?.trim() || place.internationalPhoneNumber?.trim();
    const contacts: DiscoveredContact[] = [];

    // INVARIANT: PHONE != WHATSAPP. Phone numbers from Google Places are saved strictly as ContactType.PHONE.
    // Zero WhatsApp status inference without verified evidence.
    if (rawPhone && rawPhone.length > 0) {
      contacts.push({
        type: ContactType.PHONE,
        rawValue: rawPhone,
        phoneType: PhoneType.UNKNOWN,
        whatsappStatus: WhatsAppStatus.UNKNOWN, // Zero WhatsApp inference!
        evidenceType: EvidenceType.AUTHORIZED_API,
        sourceUrl: place.id ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(place.id)}` : undefined,
        snippet: `Google Places verified business phone: ${rawPhone}`
      });
    }

    return {
      externalId,
      provider: GOOGLE_PLACES_PROVIDER_KEY,
      name,
      category,
      address,
      city,
      country,
      latitude,
      longitude,
      website,
      rating,
      reviewCount,
      sourceUrl: place.id ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(place.id)}` : undefined,
      contacts
    };
  }

  /**
   * Searches businesses using Google Places API (New) Text Search.
   */
  public async search(
    query: BusinessSearchInput,
    context?: ProviderContext
  ): Promise<BusinessSearchResult[]> {
    const apiKey = context?.apiKey;
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new ProviderAuthError(
        GOOGLE_PLACES_PROVIDER_KEY,
        'Google Places API key is not configured or missing for this organization.'
      );
    }

    if (!query.q || query.q.trim().length === 0) {
      throw new InvalidQueryError('Search query (q) is required');
    }

    const textQuery = query.location
      ? `${query.q.trim()} in ${query.location.trim()}`
      : query.q.trim();

    const limit = Math.min(Math.max(query.limit ?? 10, 1), 20);
    const endpoint = `${PLACES_BASE_URL}/places:searchText`;

    let response: Response;
    try {
      response = await this.customFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey.trim(),
          'X-Goog-FieldMask': SEARCH_FIELD_MASK
        },
        body: JSON.stringify({
          textQuery,
          pageSize: limit
        }),
        signal: context?.signal
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new ProviderTimeoutError(
          GOOGLE_PLACES_PROVIDER_KEY,
          'Google Places API request timed out'
        );
      }
      throw new ProviderUnavailableError(
        GOOGLE_PLACES_PROVIDER_KEY,
        `Network transport failure contacting Google Places API: ${err.message || 'Unknown network error'}`
      );
    }

    if (!response.ok) {
      await this.handleHttpError(response);
    }

    let payload: any;
    try {
      payload = await response.json();
    } catch {
      throw new ProviderUnavailableError(
        GOOGLE_PLACES_PROVIDER_KEY,
        'Google Places API returned a non-JSON response'
      );
    }

    const places: GooglePlaceRawItem[] = Array.isArray(payload.places) ? payload.places : [];
    const locationFallback = query.location?.trim() || 'Dhaka';

    return places.map((place) => this.normalizePlace(place, locationFallback));
  }

  /**
   * Resolves authoritative business details by Google Place ID.
   */
  public async resolveByExternalId(
    externalId: string,
    context?: ProviderContext
  ): Promise<BusinessSearchResult | null> {
    const apiKey = context?.apiKey;
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new ProviderAuthError(
        GOOGLE_PLACES_PROVIDER_KEY,
        'Google Places API key is not configured or missing for this organization.'
      );
    }

    if (!externalId || typeof externalId !== 'string' || externalId.trim().length === 0) {
      return null;
    }

    const cleanId = externalId.replace(/^google:/, '').trim();
    const endpoint = `${PLACES_BASE_URL}/places/${encodeURIComponent(cleanId)}`;

    let response: Response;
    try {
      response = await this.customFetch(endpoint, {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': apiKey.trim(),
          'X-Goog-FieldMask': DETAILS_FIELD_MASK
        },
        signal: context?.signal
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new ProviderTimeoutError(
          GOOGLE_PLACES_PROVIDER_KEY,
          'Google Places details request timed out'
        );
      }
      throw new ProviderUnavailableError(
        GOOGLE_PLACES_PROVIDER_KEY,
        `Network transport failure resolving Google Place ID: ${err.message || 'Unknown network error'}`
      );
    }

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      await this.handleHttpError(response);
    }

    let place: GooglePlaceRawItem;
    try {
      place = (await response.json()) as GooglePlaceRawItem;
    } catch {
      return null;
    }

    return this.normalizePlace(place);
  }

  /**
   * Tests a Google Places API key using a minimal, bounded 1-result query.
   * Never leaks raw Google authentication tokens or secrets.
   */
  public async testConnection(apiKey?: string): Promise<{ connected: boolean; message: string }> {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return { connected: false, message: 'API key cannot be empty' };
    }

    const endpoint = `${PLACES_BASE_URL}/places:searchText`;

    try {
      const response = await this.customFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey.trim(),
          'X-Goog-FieldMask': 'places.id,places.displayName'
        },
        body: JSON.stringify({
          textQuery: 'Dental Clinic in Dhaka',
          pageSize: 1
        })
      });

      if (response.ok) {
        return {
          connected: true,
          message: 'Google Places API (New) connected successfully.'
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          connected: false,
          message: 'Authentication or permission error: Invalid Google Places API key or Places API (New) is not enabled on this Google Cloud project.'
        };
      }

      if (response.status === 429) {
        return {
          connected: false,
          message: 'Google Places API quota or rate limit exceeded.'
        };
      }

      return {
        connected: false,
        message: `Google Places API returned HTTP ${response.status}. Please check Google Cloud Console settings and billing.`
      };
    } catch (err: any) {
      return {
        connected: false,
        message: `Failed to connect to Google Places API: ${err.message || 'Network error'}`
      };
    }
  }

  /**
   * Translates Google Places HTTP errors safely without exposing secrets.
   */
  private async handleHttpError(response: Response): Promise<never> {
    const status = response.status;
    let safeMessage = `Google Places API request failed with HTTP ${status}`;

    try {
      const errorJson: any = await response.json();
      if (errorJson?.error?.message && typeof errorJson.error.message === 'string') {
        const rawMsg = errorJson.error.message;
        // Strip any potential URL query params or secrets that Google might echo
        safeMessage = rawMsg.replace(/key=[^&\s]+/gi, 'key=REDACTED');
      }
    } catch {
      // Ignore JSON parse failure on error body
    }

    if (status === 401 || status === 403) {
      throw new ProviderAuthError(
        GOOGLE_PLACES_PROVIDER_KEY,
        `Google Places authorization failed (${status}): ${safeMessage}`
      );
    }

    if (status === 429) {
      throw new ProviderRateLimitError(
        GOOGLE_PLACES_PROVIDER_KEY,
        `Google Places quota exceeded: ${safeMessage}`
      );
    }

    if (status === 400) {
      if (
        safeMessage.toLowerCase().includes('api key') ||
        safeMessage.toLowerCase().includes('key not valid')
      ) {
        throw new ProviderAuthError(
          GOOGLE_PLACES_PROVIDER_KEY,
          `Google Places authorization failed (400): ${safeMessage}`
        );
      }
      throw new InvalidQueryError(`Google Places invalid query parameter: ${safeMessage}`);
    }

    throw new ProviderUnavailableError(
      GOOGLE_PLACES_PROVIDER_KEY,
      `Google Places service error (${status}): ${safeMessage}`
    );
  }
}
