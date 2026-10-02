'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Search,
  Megaphone,
  Kanban,
  Globe,
  UserCheck,
  Settings,
  LogOut,
  Menu,
  X,
  ShieldAlert
} from 'lucide-react';
import { Permissions, type Permission } from '@leadmate/shared';
import { useAuth } from '@/lib/auth-context';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
  isPlaceholder?: boolean;
  permission?: Permission;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Leads', href: '/leads', icon: Users, isPlaceholder: true, permission: Permissions.LEADS_READ },
  { label: 'Business Search', href: '/business-search', icon: Search, permission: Permissions.LEADS_READ },
  { label: 'Campaigns', href: '/campaigns', icon: Megaphone, isPlaceholder: true, permission: Permissions.CAMPAIGNS_MANAGE },
  { label: 'CRM Pipeline', href: '/pipeline', icon: Kanban, isPlaceholder: true, permission: Permissions.LEADS_READ },
  { label: 'StoreMate Demos', href: '/demos', icon: Globe, isPlaceholder: true, permission: Permissions.DEMOS_GENERATE },
  { label: 'Team', href: '/team', icon: UserCheck, isPlaceholder: true, permission: Permissions.USERS_MANAGE },
  { label: 'Settings', href: '/settings', icon: Settings, isPlaceholder: true, permission: Permissions.USERS_MANAGE }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, hasPermission, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const visibleNavItems = navItems.filter((item) => !item.permission || hasPermission(item.permission));

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await logout();
      router.push('/login');
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-900 text-slate-100 antialiased font-sans">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-slate-800 bg-slate-950/80 backdrop-blur-sm">
        {/* Brand */}
        <div className="h-16 flex items-center px-6 border-b border-slate-800 gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/30">
            LM
          </div>
          <div>
            <div className="font-semibold text-slate-100 text-sm tracking-tight">LeadMate</div>
            <div className="text-[10px] text-indigo-400 font-medium tracking-wide uppercase">AI Sales Platform</div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <div key={item.label}>
                {item.isPlaceholder ? (
                  <div
                    className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-500 cursor-not-allowed select-none hover:bg-slate-900/50"
                    title="Module planned for future milestone"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="w-4 h-4 text-slate-600" />
                      <span>{item.label}</span>
                    </div>
                    <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                      Soon
                    </span>
                  </div>
                ) : (
                  <Link
                    href={item.href}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/20'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </div>
                  </Link>
                )}
              </div>
            );
          })}
        </nav>

        {/* User Card in Sidebar Bottom */}
        <div className="p-3 border-t border-slate-800">
          <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900/90 border border-slate-800/80">
            <div className="truncate mr-2">
              <div className="text-xs font-semibold text-slate-200 truncate">{user?.name || 'User'}</div>
              <div className="text-[10px] text-slate-400 font-mono uppercase">{user?.role || 'VIEWER'}</div>
            </div>
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="p-1.5 text-slate-400 hover:text-red-400 rounded-md hover:bg-slate-800 transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="relative flex flex-col w-72 max-w-[80vw] bg-slate-950 border-r border-slate-800 p-4">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-xs text-white">
                  LM
                </div>
                <span className="font-semibold text-sm">LeadMate</span>
              </div>
              <button onClick={() => setMobileOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 py-4 space-y-1 overflow-y-auto">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <div key={item.label} onClick={() => !item.isPlaceholder && setMobileOpen(false)}>
                    {item.isPlaceholder ? (
                      <div className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-500 cursor-not-allowed">
                        <div className="flex items-center gap-3">
                          <Icon className="w-4 h-4 text-slate-600" />
                          <span>{item.label}</span>
                        </div>
                        <span className="text-[9px] bg-slate-800 text-slate-400 px-1 py-0.5 rounded font-mono uppercase">Soon</span>
                      </div>
                    ) : (
                      <Link
                        href={item.href}
                        className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium ${
                          isActive ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <Icon className="w-4 h-4" />
                          <span>{item.label}</span>
                        </div>
                      </Link>
                    )}
                  </div>
                );
              })}
            </nav>
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 py-2 text-xs font-medium text-red-400 bg-red-950/30 rounded-lg border border-red-900/30"
            >
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 border-b border-slate-800 bg-slate-950/60 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="md:hidden p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-xs font-medium text-slate-400 hidden sm:block">
              LeadMate Default Org • <span className="text-slate-200">Asia/Dhaka</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-xs font-semibold text-slate-200">{user?.name}</div>
              <div className="text-[10px] text-slate-400">{user?.email}</div>
            </div>
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-indigo-400">
              {user?.name ? user.name[0].toUpperCase() : 'U'}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-6 md:p-8 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
