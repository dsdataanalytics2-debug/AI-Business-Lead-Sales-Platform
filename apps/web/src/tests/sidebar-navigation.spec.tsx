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

describe('Sidebar Navigation & "Soon" Badge Audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. Active navigable routes render links without "Soon" badges', () => {
    mockUser = { id: 'sa-1', name: 'Super Admin', email: 'sa@test.com', role: Role.SUPER_ADMIN };
    mockHasPermission.mockReturnValue(true);

    const html = renderToStaticMarkup(<AppShell><div>Content</div></AppShell>);

    // Active pages must have clickable links
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/leads"');
    expect(html).toContain('href="/business-search"');
    expect(html).toContain('href="/team"');
  });

  it('2. Placeholder routes render "Soon" badges and are not clickable links', () => {
    mockUser = { id: 'sa-1', name: 'Super Admin', email: 'sa@test.com', role: Role.SUPER_ADMIN };
    mockHasPermission.mockReturnValue(true);

    const html = renderToStaticMarkup(<AppShell><div>Content</div></AppShell>);

    // Placeholder routes must NOT be rendered as active <a> links
    expect(html).not.toContain('href="/campaigns"');
    expect(html).not.toContain('href="/pipeline"');
    expect(html).not.toContain('href="/demos"');
    expect(html).not.toContain('href="/settings"');

    // They must display Soon badges
    expect(html).toContain('Campaigns');
    expect(html).toContain('CRM Pipeline');
    expect(html).toContain('StoreMate Demos');
    expect(html).toContain('Settings');
    expect(html).toContain('Soon');
  });

  it('3. Route safety audit: all active navigation items point to existing physical app pages', () => {
    const appDir = path.resolve(__dirname, '../app');

    const activeRoutes = [
      { href: '/dashboard', pageFile: 'dashboard/page.tsx' },
      { href: '/leads', pageFile: 'leads/page.tsx' },
      { href: '/business-search', pageFile: 'business-search/page.tsx' },
      { href: '/team', pageFile: 'team/page.tsx' }
    ];

    for (const route of activeRoutes) {
      const fullPath = path.join(appDir, route.pageFile);
      expect(fs.existsSync(fullPath)).toBe(true);
    }
  });

  it('4. Placeholder safety audit: placeholder routes do not exist as top-level pages preventing accidental 404s', () => {
    const appDir = path.resolve(__dirname, '../app');

    const placeholderRoutes = [
      'campaigns/page.tsx',
      'pipeline/page.tsx',
      'demos/page.tsx',
      'settings/page.tsx'
    ];

    for (const routeFile of placeholderRoutes) {
      const fullPath = path.join(appDir, routeFile);
      expect(fs.existsSync(fullPath)).toBe(false);
    }
  });

  it('5. RBAC enforcement: items are filtered based on user permissions', () => {
    mockUser = { id: 'rep-1', name: 'Sales Rep', email: 'rep@test.com', role: Role.SALES_EXECUTIVE };
    // Rep has LEADS_READ but not USERS_READ, USERS_MANAGE, CAMPAIGNS_MANAGE, DEMOS_GENERATE
    mockHasPermission.mockImplementation((perm: string) => perm === Permissions.LEADS_READ);

    const html = renderToStaticMarkup(<AppShell><div>Content</div></AppShell>);

    // Should see Dashboard (no perm required), Leads, Business Search, CRM Pipeline
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/leads"');
    expect(html).toContain('href="/business-search"');
    expect(html).toContain('CRM Pipeline');

    // Should NOT see Team (requires USERS_READ), Campaigns (requires CAMPAIGNS_MANAGE), Demos (requires DEMOS_GENERATE), Settings (requires USERS_MANAGE)
    expect(html).not.toContain('Team');
    expect(html).not.toContain('Campaigns');
    expect(html).not.toContain('StoreMate Demos');
    expect(html).not.toContain('Settings');
  });
});
