'use client';

import React from 'react';
import { Send, MessageSquare, Mail, Inbox, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { OutreachChannel, type DashboardOutreachResponse } from '@leadmate/shared';
import { formatPercentage } from '@/lib/dashboard/dashboard-display';

interface OutreachPerformanceCardProps {
  outreach: DashboardOutreachResponse;
  isLoading?: boolean;
}

function getDeliveryProportions(sent: number, delivered: number, awaiting: number, failed: number) {
  if (sent <= 0) {
    return { deliveredPct: 0, awaitingPct: 0, failedPct: 0 };
  }
  const deliveredPct = Math.round((delivered / sent) * 1000) / 10;
  const awaitingPct = Math.round((awaiting / sent) * 1000) / 10;
  const failedPct = Math.max(0, Math.round((failed / sent) * 1000) / 10);
  return { deliveredPct, awaitingPct, failedPct };
}

export function OutreachPerformanceCard({ outreach, isLoading = false }: OutreachPerformanceCardProps) {
  const { totals, channels } = outreach;

  // Guarantee both channels are rendered even if absent from period data
  const normalizedChannels = [OutreachChannel.WHATSAPP, OutreachChannel.EMAIL].map((channelType) => {
    const existing = channels.find((c) => c.channel === channelType);
    return (
      existing || {
        channel: channelType,
        sent: 0,
        delivered: 0,
        failed: 0,
        awaitingDelivery: 0,
        resolvedDeliverySuccessRate: 0
      }
    );
  });

  const overallProportions = getDeliveryProportions(
    totals.sent,
    totals.delivered,
    totals.awaitingDelivery,
    totals.failed
  );

  return (
    <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 shadow-sm space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <div className="space-y-4">
          <div className="py-6 flex flex-col items-center justify-center text-center rounded-lg bg-slate-950/40 border border-slate-800/60">
            <Inbox className="w-8 h-8 text-slate-600 mb-2" />
            <p className="text-xs text-slate-400">No outreach was sent in this period.</p>
          </div>

          {/* Zeroed Channel Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {normalizedChannels.map((ch) => {
              const isWhatsApp = ch.channel === OutreachChannel.WHATSAPP;
              return (
                <div
                  key={ch.channel}
                  className="p-4 rounded-lg bg-slate-950 border border-slate-800/80 space-y-3"
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
                    <span className="text-xs font-medium text-slate-400">0 sent</span>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-center pt-2 border-t border-slate-800/60 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 block">Delivered</span>
                      <span className="font-semibold text-emerald-400">0</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">Failed</span>
                      <span className="font-semibold text-rose-400">0</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">Awaiting</span>
                      <span className="font-semibold text-amber-300">0</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">Resolved Success Rate</span>
                      <span className="font-semibold text-purple-300">0.0%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Overall Summary Strip */}
          <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <span className="text-slate-400 text-[11px] block">Delivered</span>
                  <span className="text-base font-semibold text-emerald-400">{totals.delivered}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <div>
                  <span className="text-slate-400 text-[11px] block">Failed</span>
                  <span className="text-base font-semibold text-rose-400">{totals.failed}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-300 shrink-0" />
                <div>
                  <span className="text-slate-400 text-[11px] block">Awaiting Delivery</span>
                  <span className="text-base font-semibold text-amber-300">{totals.awaitingDelivery}</span>
                </div>
              </div>

              <div>
                <span className="text-slate-400 text-[11px] block">Resolved Delivery Success Rate</span>
                <span className="text-base font-semibold text-purple-300">
                  {formatPercentage(totals.resolvedDeliverySuccessRate)}
                </span>
              </div>
            </div>

            {/* Overall Segmented Visual Meter */}
            <div className="space-y-1.5 pt-1">
              <div
                className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden flex"
                role="progressbar"
                aria-valuenow={totals.resolvedDeliverySuccessRate}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Overall delivery: ${totals.delivered} delivered (${overallProportions.deliveredPct}%), ${totals.awaitingDelivery} awaiting (${overallProportions.awaitingPct}%), ${totals.failed} failed (${overallProportions.failedPct}%)`}
              >
                <div
                  style={{ width: `${overallProportions.deliveredPct}%` }}
                  className="bg-emerald-500 h-full transition-all duration-300"
                  title={`Delivered: ${totals.delivered}`}
                />
                <div
                  style={{ width: `${overallProportions.awaitingPct}%` }}
                  className="bg-amber-400 h-full transition-all duration-300"
                  title={`Awaiting: ${totals.awaitingDelivery}`}
                />
                <div
                  style={{ width: `${overallProportions.failedPct}%` }}
                  className="bg-rose-500 h-full transition-all duration-300"
                  title={`Failed: ${totals.failed}`}
                />
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-400 px-0.5">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                  Delivered ({overallProportions.deliveredPct}%)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                  Awaiting In-Flight ({overallProportions.awaitingPct}%)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
                  Failed ({overallProportions.failedPct}%)
                </span>
              </div>
            </div>
          </div>

          {/* Per-Channel Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {normalizedChannels.map((ch) => {
              const isWhatsApp = ch.channel === OutreachChannel.WHATSAPP;
              const chProportions = getDeliveryProportions(
                ch.sent,
                ch.delivered,
                ch.awaitingDelivery,
                ch.failed
              );

              return (
                <div
                  key={ch.channel}
                  className="p-4 rounded-lg bg-slate-950 border border-slate-800/80 space-y-3"
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

                  {/* Channel Metrics Grid */}
                  <div className="grid grid-cols-4 gap-1.5 text-center pt-1 border-t border-slate-800/60">
                    <div>
                      <span className="text-[10px] text-slate-400 block">Delivered</span>
                      <p className="text-xs font-semibold text-emerald-400">{ch.delivered}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">Failed</span>
                      <p className="text-xs font-semibold text-rose-400">{ch.failed}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">Awaiting</span>
                      <p className="text-xs font-semibold text-amber-300">{ch.awaitingDelivery}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block">Resolved Success</span>
                      <p className="text-xs font-semibold text-purple-300">
                        {formatPercentage(ch.resolvedDeliverySuccessRate)}
                      </p>
                    </div>
                  </div>

                  {/* Channel Progress Meter */}
                  {ch.sent > 0 ? (
                    <div
                      className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden flex"
                      role="progressbar"
                      aria-valuenow={ch.resolvedDeliverySuccessRate}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${isWhatsApp ? 'WhatsApp' : 'Email'} delivery breakdown: ${ch.delivered} delivered, ${ch.awaitingDelivery} awaiting, ${ch.failed} failed`}
                    >
                      <div
                        style={{ width: `${chProportions.deliveredPct}%` }}
                        className="bg-emerald-500 h-full"
                      />
                      <div
                        style={{ width: `${chProportions.awaitingPct}%` }}
                        className="bg-amber-400 h-full"
                      />
                      <div
                        style={{ width: `${chProportions.failedPct}%` }}
                        className="bg-rose-500 h-full"
                      />
                    </div>
                  ) : (
                    <div className="w-full h-1.5 rounded-full bg-slate-800/40" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
