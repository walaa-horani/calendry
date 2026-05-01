import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

import type {
  DayCode,
  GenerateSlotsInput,
  Slot,
} from './types'

const WEEKDAY_FROM_NAME: Record<string, DayCode> = {
  Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun',
}

interface TimeWindow {
  start: Date
  end: Date
}

function dateStringsInTz(rangeStart: Date, rangeEnd: Date, timezone: string): string[] {
  const startStr = formatInTimeZone(rangeStart, timezone, 'yyyy-MM-dd')
  const endStr = formatInTimeZone(rangeEnd, timezone, 'yyyy-MM-dd')
  const out: string[] = []
  let [y, m, d] = startStr.split('-').map(Number)
  while (true) {
    const cur = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    out.push(cur)
    if (cur === endStr) break
    const next = new Date(Date.UTC(y, m - 1, d + 1))
    y = next.getUTCFullYear()
    m = next.getUTCMonth() + 1
    d = next.getUTCDate()
    if (out.length > 400) throw new Error('dateStringsInTz: range too large')
  }
  return out
}

function weekdayCodeInTz(dateStr: string, timezone: string): DayCode {
  // Use noon to avoid DST edge ambiguity
  const utcAtNoon = fromZonedTime(`${dateStr}T12:00:00`, timezone)
  const name = formatInTimeZone(utcAtNoon, timezone, 'EEE') // 'Mon'
  return WEEKDAY_FROM_NAME[name]
}

function localToUtc(dateStr: string, hhmm: string, timezone: string): Date {
  return fromZonedTime(`${dateStr}T${hhmm}:00`, timezone)
}

function subtractInterval(windows: TimeWindow[], cutStart: Date, cutEnd: Date): TimeWindow[] {
  const out: TimeWindow[] = []
  for (const w of windows) {
    if (cutEnd <= w.start || cutStart >= w.end) {
      out.push(w)
      continue
    }
    if (cutStart > w.start) out.push({ start: w.start, end: cutStart })
    if (cutEnd < w.end) out.push({ start: cutEnd, end: w.end })
  }
  return out
}

function trimBefore(windows: TimeWindow[], cutoff: Date): TimeWindow[] {
  const out: TimeWindow[] = []
  for (const w of windows) {
    if (w.end <= cutoff) continue
    if (w.start < cutoff) out.push({ start: cutoff, end: w.end })
    else out.push(w)
  }
  return out
}

function trimAfter(windows: TimeWindow[], cutoff: Date): TimeWindow[] {
  const out: TimeWindow[] = []
  for (const w of windows) {
    if (w.start >= cutoff) continue
    if (w.end > cutoff) out.push({ start: w.start, end: cutoff })
    else out.push(w)
  }
  return out
}

export function generateSlots(input: GenerateSlotsInput): Slot[] {
  const { schedule, meeting, now, rangeStart, rangeEnd } = input
  const effBufAfter = meeting.bufferAfter ?? schedule.bufferAfter
  const effMinNotice = meeting.minimumNotice ?? schedule.minimumNotice
  const noticeCutoff = new Date(now.getTime() + effMinNotice * 60_000)
  const windowEnd = new Date(now.getTime() + meeting.bookingWindowDays * 86_400_000)

  const result: Slot[] = []

  for (const dateStr of dateStringsInTz(rangeStart, rangeEnd, schedule.timezone)) {
    const code = weekdayCodeInTz(dateStr, schedule.timezone)
    const day = schedule.weeklySchedule.find((d) => d.day === code)
    if (!day || !day.enabled || day.intervals.length === 0) continue

    let windows: TimeWindow[] = day.intervals.map((iv) => ({
      start: localToUtc(dateStr, iv.start, schedule.timezone),
      end: localToUtc(dateStr, iv.end, schedule.timezone),
    }))

    windows = trimBefore(windows, noticeCutoff)
    windows = trimAfter(windows, windowEnd)

    for (const w of windows) {
      let cursor = w.start.getTime()
      while (true) {
        const slotStart = cursor
        const slotEnd = slotStart + meeting.duration * 60_000
        if (slotEnd + effBufAfter * 60_000 > w.end.getTime()) break
        result.push({
          startUtc: new Date(slotStart).toISOString(),
          endUtc: new Date(slotEnd).toISOString(),
        })
        cursor += meeting.duration * 60_000
      }
    }
  }

  return result.sort((a, b) => (a.startUtc < b.startUtc ? -1 : a.startUtc > b.startUtc ? 1 : 0))
}
