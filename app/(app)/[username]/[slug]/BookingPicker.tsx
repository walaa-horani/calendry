'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

import { getAvailability, createBooking } from './actions'
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
  return fromZonedTime(`${ymd}-01T00:00:00`, tz)
}

function endOfMonthUtc(d: Date, tz: string): Date {
  const ymd = formatInTimeZone(d, tz, 'yyyy-MM')
  const [y, m] = ymd.split('-').map(Number)
  // Last day of the month in calendar arithmetic. JS Date(year, month, 0)
  // returns the last day of the previous month; passing the next month gives
  // us the last day of the current month.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const dd = String(lastDay).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  return fromZonedTime(`${y}-${mm}-${dd}T23:59:59.999`, tz)
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
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [phase, setPhase] = useState<'pick' | 'form' | 'submitting'>('pick')
  const [formError, setFormError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const router = useRouter()
  const [monthCursor, setMonthCursor] = useState<{ year: number; month: number }>(() => {
    const now = new Date()
    // Use the host tz's idea of "current month" so the picker opens on a sensible page.
    const [y, m] = (
      typeof Intl !== 'undefined'
        ? formatInTimeZone(now, hostTimezone, 'yyyy-MM')
        : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    ).split('-').map(Number)
    return { year: y, month: m }
  })
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
    const midMonth = new Date(Date.UTC(monthCursor.year, monthCursor.month - 1, 15, 12))
    const start = startOfMonthUtc(midMonth, hostTimezone)
    const end = endOfMonthUtc(midMonth, hostTimezone)
    startTransition(async () => {
      const result = await getAvailability(username, slug, start.toISOString(), end.toISOString())
      if (result.ok) setSlotsByDate(result.slotsByDate)
      else setLoadError(result.error)
    })
  }, [monthCursor.year, monthCursor.month, username, slug, hostTimezone])

  const cells = useMemo(() => {
    const midMonth = new Date(Date.UTC(monthCursor.year, monthCursor.month - 1, 15, 12))
    return calendarGrid(midMonth, hostTimezone)
  }, [monthCursor.year, monthCursor.month, hostTimezone])
  const monthLabel = (() => {
    const midMonth = new Date(Date.UTC(monthCursor.year, monthCursor.month - 1, 15, 12))
    return formatInTimeZone(midMonth, hostTimezone, 'MMMM yyyy')
  })()
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
            onClick={() => setMonthCursor(({ year, month }) => {
              const m = month === 1 ? 12 : month - 1
              const y = month === 1 ? year - 1 : year
              return { year: y, month: m }
            })}
            className="px-2 py-1 text-sm hover:underline"
          >
            ← prev
          </button>
          <h3 className="text-base font-medium">{monthLabel}</h3>
          <button
            type="button"
            onClick={() => setMonthCursor(({ year, month }) => {
              const m = month === 12 ? 1 : month + 1
              const y = month === 12 ? year + 1 : year
              return { year: y, month: m }
            })}
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
        {phase === 'form' || phase === 'submitting' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!selectedSlot) return
              setFormError(null)
              setPhase('submitting')
              ;(async () => {
                const result = await createBooking({
                  username,
                  slug,
                  startUtc: selectedSlot.startUtc,
                  inviteeName: name,
                  inviteeEmail: email,
                  inviteeNotes: notes || undefined,
                  inviteeTimezone: inviteeTz,
                })
                if (result.ok) {
                  router.push(`/${username}/${slug}/confirmed/${result.bookingToken}`)
                } else if (result.error === 'slot_taken') {
                  setFormError('Sorry, that time was just booked. Pick another.')
                  setPhase('pick')
                  setSelectedSlot(null)
                  setSelectedDate(null)
                  // refetch this month
                  const midMonth = new Date(Date.UTC(monthCursor.year, monthCursor.month - 1, 15, 12))
                  const start = startOfMonthUtc(midMonth, hostTimezone)
                  const end = endOfMonthUtc(midMonth, hostTimezone)
                  const refresh = await getAvailability(username, slug, start.toISOString(), end.toISOString())
                  if (refresh.ok) setSlotsByDate(refresh.slotsByDate)
                  else setLoadError(refresh.error)
                } else if (result.error === 'not_found') {
                  setFormError('This event is no longer available.')
                  setPhase('pick')
                } else if (result.error === 'invalid_input') {
                  setFormError('Please double-check your name and email.')
                  setPhase('form')
                } else {
                  setFormError('Something went wrong. Please try again.')
                  setPhase('form')
                }
              })().catch((err) => {
                console.error('createBooking unexpected throw:', err)
                setFormError('Something went wrong. Please try again.')
                setPhase('form')
              })
            }}
            className="space-y-3"
          >
            <div>
              <p className="text-sm text-gray-600">
                {selectedSlot ? formatInTimeZone(selectedSlot.startUtc, inviteeTz, 'EEE MMM d, h:mm a') : ''}
              </p>
              <button
                type="button"
                onClick={() => { setSelectedSlot(null); setPhase('pick'); setFormError(null) }}
                className="text-xs text-blue-700 hover:underline"
              >
                ← change time
              </button>
            </div>
            <label className="block">
              <span className="text-sm font-medium">Name</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Email</span>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Notes (optional)</span>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </label>
            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
            <button
              type="submit"
              disabled={phase === 'submitting'}
              className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:bg-blue-300"
            >
              {phase === 'submitting' ? 'Confirming…' : 'Confirm booking'}
            </button>
          </form>
        ) : selectedDate ? (
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
                      onClick={() => { setSelectedSlot(s); setPhase('form') }}
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
