'use client';

import React from 'react';
import { Send, MessageSquare, Mail, Inbox } from 'lucide-react';
import { OutreachChannel, type DashboardOutreachResponse } from '@leadmate/shared';
import { formatPercentage } from '@/lib/dashboard/dashboard-display';

interface OutreachPerformanceCardProps {
  outreach: DashboardOutreachResponse;
  isLoading?: boolean;
}

export function OutreachPerformanceCard({ outreach, isLoading = false }: OutreachPerformanceCardProps) {
  const { totals, channels } = outreach;

  return (
    <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 shadow-sm space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
            <Send className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Outreach Channel Performance</h3>
            <p className="text-[11px] text-slate-400">
              Delivery outcomes across channels for period send cohort
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-400">Total Sent</span>
          <div className="text-lg font-bold text-white">
            {isLoading ? '...' : totals.sent}
          </div>
        </div>
      </div>

      {totals.sent === 0 ? (
        <div className="py-8 flex flex-col items-center justify-center text-center">
          <Inbox className="w-8 h-8 text-slate-600 mb-2" />
          <p className="text-xs text-slate-400">No outreach was sent in this period.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-lg bg-slate-950/70 border border-slate-800 text-xs">
            <div>
              <span className="text-slate-400 text-[11px]">Delivered</span>
              <p className="text-base font-semibold text-emerald-400">{totals.delivered}</p>
            </div>
            <div>
              <span className="text-slate-400 text-[11px]">Failed</span>
              <p className="text-base font-semibold text-rose-400">{totals.failed}</p>
            </div>
            <div>
              <span className="text-slate-400 text-[11px]">Awaiting Delivery</span>
              <p className="text-base font-semibold text-amber-300">{totals.awaitingDelivery}</p>
            </div>
            <div>
              <span className="text-slate-400 text-[11px]">Resolved Success Rate</span>
              <p className="text-base font-semibold text-purple-300">
                {formatPercentage(totals.resolvedDeliverySuccessRate)}
              </p>
            </div>
          </div>

          {/* Channel Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {channels.map((ch) => {
              const isWhatsApp = ch.channel === OutreachChannel.WHATSAPP;
              return (
                <div
                  key={ch.channel}
                  className="p-3.5 rounded-lg bg-slate-950 border border-slate-800/80 space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className={`p-1.5 rounded-md ${
                          isWhatsApp
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-blue-500/10 text-blue-400'
                        }`}
                      >
                        {isWhatsApp ? (
                          <MessageSquare className="w-4 h-4" />
                        ) : (
                          <Mail className="w-4 h-4" />
                        )}
                      </div>
                      <span className="text-xs font-semibold text-white">
                        {isWhatsApp ? 'WhatsApp' : 'Email'}
                      </span>
                    </div>
                    <span className="text-xs font-bold text-white">
                      {ch.sent} <span className="text-[11px] font-normal text-slate-400">sent</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5 text-center pt-1 border-t border-slate-800/60">
                    <div>
                      <span className="text-[10px] text-slate-400">Delivered</span>
                      <p className="text-xs font-semibold text-emerald-400">{ch.delivered}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400">Failed</span>
                      <p className="text-xs font-semibold text-rose-400">{ch.failed}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400">Awaiting</span>
                      <p className="text-xs font-semibold text-amber-300">{ch.awaitingDelivery}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400">Rate</span>
                      <p className="text-xs font-semibold text-purple-300">
                        {formatPercentage(ch.resolvedDeliverySuccessRate)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
