'use client';

import React, { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Calendar, Check, RefreshCw, Unlink } from 'lucide-react';

import { disconnectGoogle, refreshCalendarList } from './actions';
import type { GoogleConnectionPublic, PublicCalendarRef } from './types';

interface BannerInfo {
  tone: 'green' | 'red' | 'slate';
  message: string;
}

function bannerForParam(connected: string | null, reason: string | null): BannerInfo | null {
  if (!connected) return null;
  if (connected === 'ok') return { tone: 'green', message: 'Google Calendar connected.' };
  if (connected === 'cancelled') return { tone: 'slate', message: 'Connection cancelled.' };
  if (connected === 'error') {
    if (reason === 'state') return { tone: 'red', message: 'Connection failed (security check). Please try again.' };
    if (reason === 'oauth') return { tone: 'red', message: 'Google reported an authorization error. Please try again.' };
    if (reason === 'exchange') return { tone: 'red', message: "Couldn't reach Google. Please try again." };
    if (reason === 'fetch') return { tone: 'red', message: "Connected, but couldn't fetch your calendar list. Please try refreshing." };
    if (reason === 'scopes') return { tone: 'red', message: "Required calendar permissions weren't granted." };
    if (reason === 'storage') return { tone: 'red', message: 'Saved your Google access but couldn’t store it. Please retry.' };
    return { tone: 'red', message: 'Connection failed. Please try again.' };
  }
  return null;
}

const TONE_STYLES: Record<BannerInfo['tone'], string> = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  slate: 'bg-slate-50 text-slate-700 border-slate-200',
};

export default function CalendarSettingsTab({ connection }: { connection: GoogleConnectionPublic | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialBanner = bannerForParam(searchParams.get('connected'), searchParams.get('reason'));
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [revokedBanner, setRevokedBanner] = useState<string | null>(null);

  const [calendars, setCalendars] = useState<PublicCalendarRef[]>(connection?.calendars ?? []);
  const [disconnectPending, startDisconnectTransition] = useTransition();
  const [refreshPending, startRefreshTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  const onDisconnect = () => {
    setActionError(null);
    setRevokedBanner(null);
    startDisconnectTransition(async () => {
      const result = await disconnectGoogle();
      if (result.ok) {
        router.refresh();
      } else {
        setActionError(result.error);
      }
    });
  };

  const onRefresh = () => {
    setActionError(null);
    setRevokedBanner(null);
    startRefreshTransition(async () => {
      const result = await refreshCalendarList();
      if (result.ok) {
        setCalendars(result.calendars);
        router.refresh();
      } else if (result.error === 'revoked') {
        setRevokedBanner('Your Google connection was revoked. Please reconnect.');
        router.refresh();
      } else if (result.error === 'missing') {
        setRevokedBanner('Your Google connection is no longer on file. Please reconnect.');
        router.refresh();
      } else {
        setActionError("Couldn't refresh your calendar list. Please try again.");
      }
    });
  };

  const showBanner = initialBanner && !bannerDismissed;

  return (
    <>
      <div className="px-6 sm:px-10 py-8 border-b border-gray-100 bg-white/60">
        <h2 className="text-2xl font-bold text-[#0B3558] tracking-tight">Connected Calendars</h2>
      </div>

      <div className="p-6 sm:px-10 sm:py-8">
        {showBanner && (
          <div className={`mb-6 flex items-start justify-between gap-3 px-4 py-3 rounded-xl border ${TONE_STYLES[initialBanner.tone]}`}>
            <span className="text-sm font-medium">{initialBanner.message}</span>
            <button
              onClick={() => setBannerDismissed(true)}
              className="text-current opacity-60 hover:opacity-100 text-sm font-bold leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {revokedBanner && (
          <div className={`mb-6 flex items-start justify-between gap-3 px-4 py-3 rounded-xl border ${TONE_STYLES.red}`}>
            <span className="text-sm font-medium">{revokedBanner}</span>
            <button
              onClick={() => setRevokedBanner(null)}
              className="text-current opacity-60 hover:opacity-100 text-sm font-bold leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {!connection ? (
          <div className="flex flex-col items-start gap-4 max-w-xl">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                <Calendar className="w-6 h-6 text-slate-600" />
              </div>
              <div>
                <h3 className="font-bold text-[#0B3558] text-lg">No calendar connected</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Connect your Google Calendar to (eventually) prevent double bookings and add events to your calendar automatically.
                </p>
              </div>
            </div>
            <a
              href="/api/auth/google/start"
              className="bg-[#1A73E8] hover:bg-[#155DB1] text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200 text-sm shadow-md hover:shadow-lg flex items-center justify-center gap-2"
            >
              <Calendar className="w-4 h-4" />
              Connect Google Calendar
            </a>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-4 p-5 border border-gray-200 rounded-2xl bg-white shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                  <Calendar className="w-6 h-6 text-slate-600" />
                </div>
                <div>
                  <h3 className="font-bold text-[#0B3558] text-lg">{connection.googleEmail}</h3>
                  <p className="text-sm text-slate-500 font-medium mt-0.5">
                    Connected on {new Date(connection.connectedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <button
                onClick={onDisconnect}
                disabled={disconnectPending}
                className="bg-white hover:bg-red-50 disabled:bg-slate-50 disabled:cursor-not-allowed text-red-600 border border-red-200 px-4 py-2 rounded-xl font-semibold transition-all duration-200 text-sm flex items-center justify-center gap-2"
              >
                {disconnectPending ? (
                  <span className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Unlink className="w-4 h-4" />
                )}
                {disconnectPending ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>

            <div className="flex items-center justify-between">
              <h3 className="font-bold text-[#0B3558] text-lg">Your calendars</h3>
              <button
                onClick={onRefresh}
                disabled={refreshPending}
                className="text-[#1A73E8] hover:bg-blue-50 disabled:opacity-50 px-3 py-1.5 rounded-lg font-semibold text-sm flex items-center gap-2"
              >
                {refreshPending ? (
                  <span className="w-4 h-4 border-2 border-[#1A73E8] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Refresh list
              </button>
            </div>

            <ul className="flex flex-col gap-2">
              {calendars.map((cal) => (
                <li
                  key={cal.calendarId}
                  className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-xl"
                >
                  <Check className="w-4 h-4 text-slate-400" />
                  <span className="font-semibold text-[#0B3558]">{cal.summary}</span>
                  {cal.primary && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="text-xs font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full"
                    >
                      Primary
                    </motion.span>
                  )}
                </li>
              ))}
            </ul>

            <p className="text-sm text-slate-500 italic">
              These calendars will be available for conflict checks and event creation in a future update.
            </p>

            {actionError && (
              <p className="text-sm font-medium text-red-600 bg-red-50 px-3 py-2 rounded-lg">{actionError}</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
