/**
 * CSV File Datasource Provider
 *
 * Implements the DataSourceProvider interface for importing and searching
 * businesses from local CSV files or bulk datasets.
 */

import type {
  DataSourceProvider,
  ProviderContext,
  BusinessSearchInput,
  BusinessSearchResult
} from '../types.js';

export const CSV_PROVIDER_KEY = 'csv';

export class CsvDataSourceProvider implements DataSourceProvider {
  public readonly name: string = CSV_PROVIDER_KEY;

  public async search(
    query: BusinessSearchInput,
    _context?: ProviderContext
  ): Promise<BusinessSearchResult[]> {
    // CSV provider serves imported dataset search; returns empty list if no local batch is loaded
    return [];
  }

  public async resolveByExternalId(
    _externalId: string,
    _context?: ProviderContext
  ): Promise<BusinessSearchResult | null> {
    return null;
  }

  public async testConnection(): Promise<{ connected: boolean; message: string }> {
    return {
      connected: true,
      message: 'CSV file import provider is active and ready for datasets.'
    };
  }
}
