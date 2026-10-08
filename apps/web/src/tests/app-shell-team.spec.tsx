import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
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

describe('M7 Step 3: AppShell Team Navigation Visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Team navigation link for SUPER_ADMIN with USERS_READ permission', () => {
    mockUser = { id: 'sa-1', name: 'Super Admin', email: 'sa@test.com', role: Role.SUPER_ADMIN };
    mockHasPermission.mockImplementation((perm: string) => perm === Permissions.USERS_READ);

    const html = renderToStaticMarkup(<AppShell><div>Content</div></AppShell>);

    expect(html).toContain('href="/team"');
    expect(html).toContain('Team');
  });

  it('renders Team navigation link for ADMIN with USERS_READ permission', () => {
    mockUser = { id: 'adm-1', name: 'Admin User', email: 'admin@test.com', role: Role.ADMIN };
    mockHasPermission.mockImplementation((perm: string) => perm === Permissions.USERS_READ);

    const html = renderToStaticMarkup(<AppShell><div>Content</div></AppShell>);

    expect(html).toContain('href="/team"');
    expect(html).toContain('Team');
  });

  it('renders Team navigation link for SALES_MANAGER with USERS_READ permission', () => {
    mockUser = { id: 'sm-1', name: 'Sales Manager', email: 'sm@test.com', role: Role.SALES_MANAGER };
    mockHasPermission.mockImplementation((perm: string) => perm === Permissions.USERS_READ);

    const html = renderToStaticMarkup(<AppShell><div>Content</div></AppShell>);

    expect(html).toContain('href="/team"');
    expect(html).toContain('Team');
  });

  it('hides Team navigation link for SALES_EXECUTIVE lacking USERS_READ permission', () => {
    mockUser = { id: 'se-1', name: 'Sales Exec', email: 'se@test.com', role: Role.SALES_EXECUTIVE };
    mockHasPermission.mockReturnValue(false);

    const html = renderToStaticMarkup(<AppShell><div>Content</div></AppShell>);

    expect(html).not.toContain('href="/team"');
  });

  it('hides Team navigation link for VIEWER lacking USERS_READ permission', () => {
    mockUser = { id: 'v-1', name: 'Viewer User', email: 'viewer@test.com', role: Role.VIEWER };
    mockHasPermission.mockReturnValue(false);

    const html = renderToStaticMarkup(<AppShell><div>Content</div></AppShell>);

    expect(html).not.toContain('href="/team"');
  });
});
