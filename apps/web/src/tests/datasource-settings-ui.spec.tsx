import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Role } from '@leadmate/shared';
import DataSourcesSettingsPage from '../app/settings/data-sources/page.js';

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Admin', role: Role.ADMIN },
    hasPermission: () => true,
    logout: vi.fn(),
    isLoading: false,
    isAuthenticated: true
  })
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/settings/data-sources'
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    getDataSources: vi.fn().mockResolvedValue({
      activeProvider: 'AUTO',
      dataSources: [
        {
          id: 'mock',
          provider: 'mock',
          name: 'mock',
          displayName: 'Mock Provider (Standard)',
          description: 'Deterministic fixtures',
          status: 'CONNECTED',
          isActive: false,
          isEnabled: true,
          isConfigured: true,
          costType: 'FREE',
          requiresCredential: false,
          credentialMasked: null
        },
        {
          id: 'csv',
          provider: 'csv',
          name: 'csv',
          displayName: 'CSV File Provider',
          description: 'CSV files',
          status: 'CONNECTED',
          isActive: false,
          isEnabled: true,
          isConfigured: true,
          costType: 'FREE',
          requiresCredential: false,
          credentialMasked: null
        },
        {
          id: 'openstreetmap',
          provider: 'openstreetmap',
          name: 'openstreetmap',
          displayName: 'OpenStreetMap (Overpass)',
          description: 'OSM Overpass API',
          status: 'CONNECTED',
          isActive: true,
          isEnabled: true,
          isConfigured: true,
          costType: 'FREE',
          requiresCredential: false,
          credentialMasked: null
        },
        {
          id: 'google-places',
          provider: 'google-places',
          name: 'google-places',
          displayName: 'Google Places API (New)',
          description: 'Google Places',
          status: 'NOT_CONFIGURED',
          isActive: false,
          isEnabled: true,
          isConfigured: false,
          costType: 'PAID',
          requiresCredential: true,
          credentialMasked: null
        }
      ]
    }),
    testGooglePlaces: vi.fn(),
    testProvider: vi.fn(),
    configureGooglePlaces: vi.fn(),
    setActiveProvider: vi.fn(),
    toggleProviderEnabled: vi.fn()
  }
}));

describe('Data Sources Settings Page UI', () => {
  it('1. Renders Data Sources header and AES-256-GCM encryption guarantee', () => {
    const html = renderToStaticMarkup(<DataSourcesSettingsPage />);
    expect(html).toContain('Data Sources &amp; Credentials');
    expect(html).toContain('AES-256-GCM Server-Side Encryption Guarantee');
  });

  it('2. Renders all 4 provider cards: Mock, CSV, OpenStreetMap, Google Places', () => {
    const html = renderToStaticMarkup(<DataSourcesSettingsPage />);
    expect(html).toContain('Mock Provider (Standard)');
    expect(html).toContain('CSV File Provider');
    expect(html).toContain('OpenStreetMap (Overpass)');
    expect(html).toContain('Google Places API (New)');
  });

  it('3. Renders Configure Key and Test Connection actions', () => {
    const html = renderToStaticMarkup(<DataSourcesSettingsPage />);
    expect(html).toContain('Test Connection');
    expect(html).toContain('Configure Key');
  });
});
