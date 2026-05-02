'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  Link as LinkIcon,
  MapPin,
  Phone,
  Video,
} from 'lucide-react'

import { getAvailability, createBooking } from './actions'
import type { Slot } from '@/lib/booking/types'

const LOCATION_LABELS: Record<string, string> = {
  zoom: 'Zoom',
  googleMeet: 'Google Meet',
  phone: 'Phone',
  inPerson: 'In person',
  customUrl: 'Custom URL',
}

function locationIcon(type: string) {
  switch (type) {
    case 'zoom':
    case 'googleMeet':
      return Video
    case 'phone':
      return Phone
    case 'inPerson':
      return MapPin
    case 'customUrl':
      return LinkIcon
    default:
      return Video
  }
}

function hostInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

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
  const [inviteeTz] = useState<string>(() => {
    if (typeof window === 'undefined') return hostTimezone
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || hostTimezone
    } catch {
      return hostTimezone
    }
  })
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
    const midMonth = new Date(Date.UTC(monthCursor.year, monthCursor.month - 1, 15, 12))
    const start = startOfMonthUtc(midMonth, hostTimezone)
    const end = endOfMonthUtc(midMonth, hostTimezone)
    startTransition(async () => {
      setLoadError(null)
      setSelectedDate(null)
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

  const LocIcon = locationIcon(meeting.location.type)
  const locationLabel = LOCATION_LABELS[meeting.location.type] ?? meeting.location.type
  const isFormPhase = phase === 'form' || phase === 'submitting'

  return (
    <div className="grid gap-8 md:grid-cols-[280px_1fr_240px] md:divide-x md:divide-slate-200">
      {/* Meta column */}
      <aside className="md:pr-6">
        {host.avatarUrl ? (
          <img
            src={host.avatarUrl}
            alt={host.displayName}
            className="h-16 w-16 rounded-full object-cover ring-1 ring-slate-200"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-lg font-semibold text-white">
            {hostInitials(host.displayName)}
          </div>
        )}
        <p className="mt-4 text-xs font-medium uppercase tracking-wider text-slate-500">
          {host.displayName}
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          {meeting.title}
        </h2>
        <ul className="mt-4 space-y-2 text-sm text-slate-600">
          <li className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-400" />
            {meeting.duration} min
          </li>
          <li className="flex items-center gap-2">
            <LocIcon className="h-4 w-4 text-slate-400" />
            {locationLabel}
          </li>
        </ul>
        {host.welcomeMessage ? (
          <p className="mt-4 text-sm leading-relaxed text-slate-700">{host.welcomeMessage}</p>
        ) : null}
      </aside>

      {/* Calendar column */}
      <section className="md:px-6">
        <header className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">{monthLabel}</h3>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setMonthCursor(({ year, month }) => {
                const m = month === 1 ? 12 : month - 1
                const y = month === 1 ? year - 1 : year
                return { year: y, month: m }
              })}
              className="grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setMonthCursor(({ year, month }) => {
                const m = month === 12 ? 1 : month + 1
                const y = month === 12 ? year + 1 : year
                return { year: y, month: m }
              })}
              className="grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wider text-slate-400">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d}>{d.slice(0, 1)}</div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-1">
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
                aria-label={c.dateStr}
                className={[
                  'relative aspect-square rounded-full text-sm transition-colors',
                  disabled
                    ? 'cursor-not-allowed text-slate-300'
                    : 'cursor-pointer hover:bg-blue-50',
                  selected
                    ? 'bg-blue-600 font-semibold text-white hover:bg-blue-600'
                    : has
                      ? 'bg-blue-50/40 font-semibold text-blue-700'
                      : 'text-slate-700',
                ].filter(Boolean).join(' ')}
              >
                {Number(c.dateStr.split('-')[2])}
                {has && !selected && c.inMonth ? (
                  <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-blue-600" />
                ) : null}
              </button>
            )
          })}
        </div>

        {!pending && Object.keys(slotsByDate).length === 0 && !loadError ? (
          <p className="mt-4 text-sm text-slate-500">
            Nothing available this month —{' '}
            <button
              type="button"
              className="font-medium text-blue-700 hover:underline"
              onClick={() => setMonthCursor(({ year, month }) => {
                const m = month === 12 ? 1 : month + 1
                const y = month === 12 ? year + 1 : year
                return { year: y, month: m }
              })}
            >
              try next month →
            </button>
          </p>
        ) : null}

        {pending ? <p className="mt-4 text-sm text-slate-500">Loading…</p> : null}
        {loadError ? (
          <p className="mt-4 text-sm text-red-600">Couldn&apos;t load times. Please try again.</p>
        ) : null}
      </section>

      {/* Slot list / form column */}
      <section className="md:pl-6">
        {isFormPhase ? (
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
            className="space-y-4"
          >
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <button
                type="button"
                onClick={() => { setSelectedSlot(null); setPhase('pick'); setFormError(null) }}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
              >
                <ArrowLeft className="h-3 w-3" /> change time
              </button>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {selectedSlot ? formatInTimeZone(selectedSlot.startUtc, inviteeTz, 'EEE MMM d, h:mm a') : ''}
              </p>
              <p className="text-xs text-slate-500">{inviteeTz}</p>
            </div>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-600">Name</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-600">Email</span>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-600">Notes (optional)</span>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </label>
            {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
            <button
              type="submit"
              disabled={phase === 'submitting'}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:bg-blue-300"
            >
              {phase === 'submitting' ? 'Confirming…' : 'Confirm booking'}
            </button>
          </form>
        ) : selectedDate ? (
          <>
            <h4 className="text-sm font-semibold text-slate-900">
              {(() => {
                const [y, m, d] = selectedDate.split('-').map(Number)
                return formatInTimeZone(new Date(Date.UTC(y, m - 1, d, 12)), 'UTC', 'EEEE, MMM d')
              })()}
            </h4>
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500">
              <Globe className="h-3 w-3" />
              {inviteeTz}
            </p>
            {slots.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No times available — try another date.</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {slots.map((s) => (
                  <li key={s.startUtc}>
                    <button
                      type="button"
                      onClick={() => { setSelectedSlot(s); setPhase('form') }}
                      className="w-full rounded-lg border border-blue-600 bg-white px-4 py-2.5 text-sm font-medium text-blue-700 shadow-sm transition hover:bg-blue-600 hover:text-white"
                    >
                      {formatInTimeZone(s.startUtc, inviteeTz, 'h:mm a')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="grid h-full place-items-center text-center">
            <p className="text-sm text-slate-400">
              <span className="block text-3xl">←</span>
              Pick a date
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
