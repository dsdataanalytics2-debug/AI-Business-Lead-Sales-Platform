import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import { Permissions, Role } from '@leadmate/shared';
import { AppShell } from '../components/layout/app-shell.js';

let mockHasPermission = vi.fn();
let mockUser: any = { id: 'u1', name: 'Test User', email: 'test@company.com', role: Role.SUPER_ADMIN };

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: mockUser,
    hasPermission: mockHasPermission,
    logout: vi.fn(),
    isLoading: false,
    isAuthenticated: true
  })
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/dashboard'
}));

describe('Sidebar Navigation & Fast-Track Route Completion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. All 8 navigable routes render genuine links without "Soon" badges for super admin', () => {
    mockUser = { id: 'sa-1', name: 'Super Admin', email: 'sa@test.com', role: Role.SUPER_ADMIN };
    mockHasPermission.mockReturnValue(true);

    const html = renderToStaticMarkup(<AppShell><div>Content</div></AppShell>);

    // All 8 routes must have clickable links
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/leads"');
    expect(html).toContain('href="/business-search"');
    expect(html).toContain('href="/campaigns"');
    expect(html).toContain('href="/pipeline"');
    expect(html).toContain('href="/demos"');
    expect(html).toContain('href="/team"');
    expect(html).toContain('href="/settings"');

    // No "Soon" badge anywhere in navigation
    expect(html).not.toContain('Soon');
  });

  it('2. Route safety audit: all 8 navigation items point to existing physical app pages', () => {
    const appDir = path.resolve(__dirname, '../app');

    const activeRoutes = [
      { href: '/dashboard', pageFile: 'dashboard/page.tsx' },
      { href: '/leads', pageFile: 'leads/page.tsx' },
      { href: '/business-search', pageFile: 'business-search/page.tsx' },
      { href: '/campaigns', pageFile: 'campaigns/page.tsx' },
      { href: '/pipeline', pageFile: 'pipeline/page.tsx' },
      { href: '/demos', pageFile: 'demos/page.tsx' },
      { href: '/team', pageFile: 'team/page.tsx' },
      { href: '/settings', pageFile: 'settings/page.tsx' }
    ];

    for (const route of activeRoutes) {
      const fullPath = path.join(appDir, route.pageFile);
      expect(fs.existsSync(fullPath)).toBe(true);
    }
  });

  it('3. RBAC enforcement: items are strictly filtered based on user permissions', () => {
    mockUser = { id: 'rep-1', name: 'Sales Rep', email: 'rep@test.com', role: Role.SALES_EXECUTIVE };
    // Rep has LEADS_READ but not USERS_READ, USERS_MANAGE, CAMPAIGNS_MANAGE, DEMOS_GENERATE
    mockHasPermission.mockImplementation((perm: string) => perm === Permissions.LEADS_READ);

    const html = renderToStaticMarkup(<AppShell><div>Content</div></AppShell>);

    // Should see Dashboard (no perm required), Leads, Business Search, CRM Pipeline
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/leads"');
    expect(html).toContain('href="/business-search"');
    expect(html).toContain('href="/pipeline"');

    // Should NOT see Team (requires USERS_READ), Campaigns (requires CAMPAIGNS_MANAGE), Demos (requires DEMOS_GENERATE), Settings (requires USERS_MANAGE)
    expect(html).not.toContain('href="/team"');
    expect(html).not.toContain('href="/campaigns"');
    expect(html).not.toContain('href="/demos"');
    expect(html).not.toContain('href="/settings"');
  });
});
