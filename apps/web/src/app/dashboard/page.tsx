'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Target,
  Globe,
  Clock,
  Search,
  Kanban,
  ShieldCheck,
  Sparkles,
  Loader2
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { AppShell } from '@/components/layout/app-shell';

export default function DashboardPage() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <div className="text-xs text-slate-400 font-mono">Verifying Session...</div>
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Welcome Banner */}
        <div className="p-6 rounded-2xl bg-gradient-to-r from-indigo-950/70 via-slate-900 to-slate-900 border border-indigo-900/40 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {user.role}
                </span>
                <span className="text-xs text-slate-400 font-bengali">স্বাগতম • Welcome</span>
              </div>
              <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">
                Hello, {user.name}
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                LeadAtlas Platform • AI-Powered Lead Discovery & Sales Automation
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 text-xs font-medium">
                <ShieldCheck className="w-4 h-4" />
                <span>Argon2id + SHA-256 Session Active</span>
              </div>
            </div>
          </div>
        </div>

        {/* Placeholder Metric Cards (M0 Visual Shell Only) */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-slate-400 tracking-wider uppercase">
              Pipeline Snapshot (Milestone M0 Shell)
            </h2>
            <span className="text-[10px] text-slate-500 font-mono">Real pipeline metrics activate in M1–M6</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-medium">Total Leads</span>
                <Users className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="text-2xl font-bold text-slate-200">0</div>
              <div className="text-[10px] text-slate-500 mt-1">Discovery engine ready (M2)</div>
            </div>

            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-medium">Qualified Leads</span>
                <Target className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold text-slate-200">0</div>
              <div className="text-[10px] text-slate-500 mt-1">Scoring profiles ready (M5)</div>
            </div>

            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-medium">Active Demos</span>
                <Globe className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-2xl font-bold text-slate-200">0</div>
              <div className="text-[10px] text-slate-500 mt-1">StoreMate Demo Lite (M7)</div>
            </div>

            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-medium">Calls / Follow-ups Due</span>
                <Clock className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold text-slate-200">0</div>
              <div className="text-[10px] text-slate-500 mt-1">Working calendar: Sun–Thu (M6)</div>
            </div>
          </div>
        </div>

        {/* Quick Action Placeholders */}
        <div className="p-6 rounded-2xl bg-slate-950/50 border border-slate-800">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-slate-200">Foundation Capabilities Active</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-4 rounded-lg bg-slate-900/80 border border-slate-800/60">
              <div className="font-semibold text-indigo-300 mb-1">RBAC & Permission Model</div>
              <p className="text-slate-400 leading-relaxed text-[11px]">
                Backend routes are strictly guarded per role (Super Admin, Admin, Sales Manager, Sales Exec, Viewer).
              </p>
            </div>

            <div className="p-4 rounded-lg bg-slate-900/80 border border-slate-800/60">
              <div className="font-semibold text-emerald-300 mb-1">Asynchronous BullMQ Queue</div>
              <p className="text-slate-400 leading-relaxed text-[11px]">
                Maintenance worker is connected to Memurai/Redis ready for background jobs and audits.
              </p>
            </div>

            <div className="p-4 rounded-lg bg-slate-900/80 border border-slate-800/60">
              <div className="font-semibold text-cyan-300 mb-1">Bangladesh-First Support</div>
              <p className="text-slate-400 leading-relaxed text-[11px]">
                UTF-8 Unicode font rendering, Asia/Dhaka timezones, and BDT currency formatting configured.
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
