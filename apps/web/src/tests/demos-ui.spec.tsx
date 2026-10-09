import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Role, DemoWebsiteStatus } from '@leadmate/shared';
import DemosPage from '../app/demos/page.js';

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
  usePathname: () => '/demos'
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    getDemos: vi.fn().mockResolvedValue({
      data: [
        {
          id: 'demo-1',
          leadId: 'lead-1',
          businessName: 'Dhanmondi Fashion Outlet',
          category: 'Retail Store',
          city: 'Dhaka',
          status: DemoWebsiteStatus.READY,
          provider: 'MOCK',
          demoUrl: 'https://demo.leadatlas.io/site/dhanmondi-fashion',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          expiresAt: null
        }
      ]
    }),
    demoWebsite: {
      regenerateDemo: vi.fn()
    },
    leads: {
      regenerateDemo: vi.fn()
    }
  }
}));


describe('StoreMate Demos Page UI', () => {
  it('1. Renders StoreMate Demos catalog header and actions', () => {
    const html = renderToStaticMarkup(<DemosPage />);
    expect(html).toContain('StoreMate Demos');
    expect(html).toContain('Instant, tailored high-conversion website demos');
    expect(html).toContain('Generate Demo for Lead');
  });

  it('2. Renders status filter options and search input', () => {
    const html = renderToStaticMarkup(<DemosPage />);
    expect(html).toContain('All Statuses');
    expect(html).toContain('Ready');
    expect(html).toContain('Generating');
    expect(html).toContain('Failed');
  });
});
