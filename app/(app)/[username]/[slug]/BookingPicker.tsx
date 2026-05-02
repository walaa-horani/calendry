'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { formatInTimeZone } from 'date-fns-tz'

import { getAvailability } from './actions'
import type { Slot } from '@/lib/booking/types'

interface MeetingSummary {
  title: string
  duration: number
  location: { type: string; value?: string; instructions?: string }
}

interface HostSummary {
  displayName: string
  avatarUrl: string | null
  welcomeMessage: string | null
}

export interface BookingPickerProps {
  username: string
  slug: string
  meeting: MeetingSummary
  host: HostSummary
  hostTimezone: string
}

function startOfMonthUtc(d: Date, tz: string): Date {
  const ymd = formatInTimeZone(d, tz, 'yyyy-MM')
  return new Date(`${ymd}-01T00:00:00Z`)
}

function endOfMonthUtc(d: Date, tz: string): Date {
  const ymd = formatInTimeZone(d, tz, 'yyyy-MM')
  const [y, m] = ymd.split('-').map(Number)
  const next = new Date(Date.UTC(y, m, 1))   // first day of next month UTC
  return new Date(next.getTime() - 1)
}

function calendarGrid(monthCursor: Date, tz: string): Array<{ dateStr: string; inMonth: boolean }> {
  const ymd = formatInTimeZone(monthCursor, tz, 'yyyy-MM')
  const [y, m] = ymd.split('-').map(Number)
  // Start grid on Sunday before the first of the month
  const firstOfMonth = new Date(Date.UTC(y, m - 1, 1))
  const dow = firstOfMonth.getUTCDay() // 0=Sun
  const gridStart = new Date(Date.UTC(y, m - 1, 1 - dow))
  const cells: Array<{ dateStr: string; inMonth: boolean }> = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getTime() + i * 86_400_000)
    const ds = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    cells.push({ dateStr: ds, inMonth: d.getUTCMonth() === m - 1 })
  }
  return cells
}

export default function BookingPicker({ username, slug, meeting, host, hostTimezone }: BookingPickerProps) {
  const [inviteeTz, setInviteeTz] = useState<string>(hostTimezone)
  const [monthCursor, setMonthCursor] = useState<Date>(() => new Date())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [slotsByDate, setSlotsByDate] = useState<Record<string, Slot[]>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (tz) setInviteeTz(tz)
    } catch {
      // keep host fallback
    }
  }, [])

  useEffect(() => {
    setLoadError(null)
    setSelectedDate(null)
    const start = startOfMonthUtc(monthCursor, hostTimezone)
    const end = endOfMonthUtc(monthCursor, hostTimezone)
    startTransition(async () => {
      const result = await getAvailability(username, slug, start.toISOString(), end.toISOString())
      if (result.ok) setSlotsByDate(result.slotsByDate)
      else setLoadError(result.error)
    })
  }, [monthCursor, username, slug, hostTimezone])

  const cells = useMemo(() => calendarGrid(monthCursor, hostTimezone), [monthCursor, hostTimezone])
  const monthLabel = formatInTimeZone(monthCursor, hostTimezone, 'MMMM yyyy')
  const slots = selectedDate ? (slotsByDate[selectedDate] ?? []) : []

  return (
    <div className="grid gap-6 md:grid-cols-[260px_1fr_220px]">
      <aside>
        {host.avatarUrl ? (
          <img src={host.avatarUrl} alt="" className="h-12 w-12 rounded-full" />
        ) : (
          <div className="h-12 w-12 rounded-full bg-gray-200" />
        )}
        <h2 className="mt-3 text-lg font-semibold">{host.displayName}</h2>
        <p className="text-sm font-medium">{meeting.title}</p>
        <p className="text-sm text-gray-600">{meeting.duration} min · {meeting.location.type}</p>
        {host.welcomeMessage ? <p className="mt-3 text-sm text-gray-700">{host.welcomeMessage}</p> : null}
      </aside>

      <section>
        <header className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))}
            className="px-2 py-1 text-sm hover:underline"
          >
            ← prev
          </button>
          <h3 className="text-base font-medium">{monthLabel}</h3>
          <button
            type="button"
            onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))}
            className="px-2 py-1 text-sm hover:underline"
          >
            next →
          </button>
        </header>

        <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs text-gray-500">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i}>{d}</div>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((c) => {
            const has = (slotsByDate[c.dateStr]?.length ?? 0) > 0
            const disabled = !c.inMonth || !has
            const selected = c.dateStr === selectedDate
            return (
              <button
                key={c.dateStr}
                type="button"
                disabled={disabled}
                onClick={() => setSelectedDate(c.dateStr)}
                className={[
                  'aspect-square rounded text-sm',
                  disabled ? 'cursor-not-allowed text-gray-300' : 'hover:bg-blue-50',
                  selected ? 'bg-blue-600 text-white hover:bg-blue-600' : '',
                  has && !selected ? 'font-medium text-blue-700' : '',
                ].filter(Boolean).join(' ')}
              >
                {Number(c.dateStr.split('-')[2])}
              </button>
            )
          })}
        </div>

        {pending ? <p className="mt-3 text-sm text-gray-500">Loading…</p> : null}
        {loadError ? <p className="mt-3 text-sm text-red-600">Couldn&apos;t load times. Please try again.</p> : null}
      </section>

      <section>
        {selectedDate ? (
          <>
            <h4 className="text-sm font-medium">
              {(() => {
                const [y, m, d] = selectedDate.split('-').map(Number)
                return formatInTimeZone(new Date(Date.UTC(y, m - 1, d, 12)), 'UTC', 'EEE MMM d')
              })()}
            </h4>
            <p className="text-xs text-gray-500">{inviteeTz}</p>
            {slots.length === 0 ? (
              <p className="mt-3 text-sm text-gray-600">No times available — try another date.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {slots.map((s) => (
                  <li key={s.startUtc}>
                    <button
                      type="button"
                      className="w-full rounded border border-blue-600 px-3 py-2 text-sm text-blue-700 hover:bg-blue-600 hover:text-white"
                    >
                      {formatInTimeZone(s.startUtc, inviteeTz, 'h:mm a')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-500">Pick a date →</p>
        )}
      </section>
    </div>
  )
}
