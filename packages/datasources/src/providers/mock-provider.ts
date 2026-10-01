/**
 * Deterministic Mock Datasource Provider
 *
 * Implements the DataSourceProvider interface using purely local, deterministic fixtures.
 *
 * GUARANTEES:
 * - ZERO network calls, ZERO external dependencies, ZERO database access.
 * - 100% deterministic search results and ordering.
 * - Deeply cloned (immutable) return objects.
 * - Authoritative server-side resolution via resolveByExternalId().
 */

import { normalizeBengaliDigits } from '@leadmate/core';
import type {
  DataSourceProvider,
  ProviderContext,
  BusinessSearchInput,
  BusinessSearchResult
} from '../types.js';
import {
  MOCK_PROVIDER_NAME,
  MOCK_BUSINESS_FIXTURES
} from '../fixtures/mock-businesses.js';

export class MockDataSourceProvider implements DataSourceProvider {
  public readonly name: string = MOCK_PROVIDER_NAME;

  /**
   * Deeply clones a BusinessSearchResult object to preserve fixture immutability.
   */
  private cloneResult(item: BusinessSearchResult): BusinessSearchResult {
    return {
      ...item,
      contacts: item.contacts.map((c) => ({ ...c }))
    };
  }

  /**
   * Normalizes a search string (lowercasing, trimming, Bengali digits converted).
   */
  private normalizeSearchTerm(term: string): string {
    if (!term || typeof term !== 'string') return '';
    const ascii = normalizeBengaliDigits(term.trim());
    return ascii.toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Checks if a target field matches a location query, handling city variations (e.g., Chittagong/Chattogram).
   */
  private matchesLocation(fixture: BusinessSearchResult, locationQuery: string): boolean {
    const locNorm = this.normalizeSearchTerm(locationQuery);
    if (!locNorm || locNorm === 'all' || locNorm === 'bangladesh' || locNorm === 'bd') {
      return true;
    }

    const cityNorm = this.normalizeSearchTerm(fixture.city || '');
    const localityNorm = this.normalizeSearchTerm(fixture.locality || '');
    const addressNorm = this.normalizeSearchTerm(fixture.address || '');
    const regionNorm = this.normalizeSearchTerm(fixture.region || '');

    // Common city aliases in Bangladesh
    const isChittagongQuery = locNorm.includes('chittagong') || locNorm.includes('chattogram');
    const isChittagongFixture = cityNorm.includes('chattogram') || cityNorm.includes('chittagong');
    if (isChittagongQuery && isChittagongFixture) {
      return true;
    }

    return (
      cityNorm.includes(locNorm) ||
      localityNorm.includes(locNorm) ||
      addressNorm.includes(locNorm) ||
      regionNorm.includes(locNorm)
    );
  }

  /**
   * Searches deterministic mock business fixtures.
   */
  public async search(
    query: BusinessSearchInput,
    _context?: ProviderContext
  ): Promise<BusinessSearchResult[]> {
    const qNorm = this.normalizeSearchTerm(query.q);
    const categoryQueryNorm = query.category ? this.normalizeSearchTerm(query.category) : null;
    const locationQuery = query.location;

    // Filter and score matches
    const scoredResults: Array<{ fixture: BusinessSearchResult; score: number }> = [];

    for (const fixture of MOCK_BUSINESS_FIXTURES) {
      // 1. Location match check
      if (!this.matchesLocation(fixture, locationQuery)) {
        continue;
      }

      // 2. Explicit Category filter match check
      if (categoryQueryNorm) {
        const fixtureCatNorm = this.normalizeSearchTerm(fixture.category);
        if (!fixtureCatNorm.includes(categoryQueryNorm)) {
          continue;
        }
      }

      // 3. Search query (q) match & relevance scoring
      const nameNorm = this.normalizeSearchTerm(fixture.name);
      const catNorm = this.normalizeSearchTerm(fixture.category);
      const descNorm = this.normalizeSearchTerm(fixture.description || '');
      const localityNorm = this.normalizeSearchTerm(fixture.locality || '');
      const cityNorm = this.normalizeSearchTerm(fixture.city || '');

      let score = 0;
      let matched = false;

      if (nameNorm === qNorm) {
        score += 100;
        matched = true;
      } else if (nameNorm.includes(qNorm)) {
        score += 50;
        matched = true;
      }

      if (catNorm.includes(qNorm)) {
        score += 30;
        matched = true;
      }

      if (localityNorm.includes(qNorm) || cityNorm.includes(qNorm)) {
        score += 15;
        matched = true;
      }

      if (descNorm.includes(qNorm)) {
        score += 10;
        matched = true;
      }

      if (fixture.externalId.toLowerCase().includes(qNorm)) {
        score += 5;
        matched = true;
      }

      if (matched) {
        scoredResults.push({ fixture, score });
      }
    }

    // 4. Deterministic Sort: Highest score first, then tie-breaker on stable externalId
    scoredResults.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.fixture.externalId.localeCompare(b.fixture.externalId);
    });

    // 5. Apply limit
    const limit = Math.min(query.limit ?? 20, 50);
    const paginated = scoredResults.slice(0, limit);

    // 6. Return deeply cloned results to guarantee immutability
    return paginated.map((item) => this.cloneResult(item.fixture));
  }

  /**
   * Resolves the authoritative business fixture by its exact external ID.
   *
   * EXACTNESS POLICY:
   * Uses strict exact string equality. Does not trim, lowercase, or fuzzy match external IDs.
   */
  public async resolveByExternalId(
    externalId: string,
    _context?: ProviderContext
  ): Promise<BusinessSearchResult | null> {
    if (!externalId || typeof externalId !== 'string') {
      return null;
    }

    const found = MOCK_BUSINESS_FIXTURES.find((f) => f.externalId === externalId);

    if (!found) {
      return null;
    }

    return this.cloneResult(found);
  }
}
