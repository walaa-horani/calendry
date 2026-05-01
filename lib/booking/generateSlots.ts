import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

import type {
  DayCode,
  GenerateSlotsInput,
  Slot,
} from './types'

const WEEKDAY_FROM_NAME: Record<string, DayCode> = {
  Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun',
}

interface Window {
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

export function generateSlots(input: GenerateSlotsInput): Slot[] {
  const { schedule, meeting, rangeStart, rangeEnd } = input
  const effBufAfter = meeting.bufferAfter ?? schedule.bufferAfter
  const result: Slot[] = []

  for (const dateStr of dateStringsInTz(rangeStart, rangeEnd, schedule.timezone)) {
    const code = weekdayCodeInTz(dateStr, schedule.timezone)
    const day = schedule.weeklySchedule.find((d) => d.day === code)
    if (!day || !day.enabled || day.intervals.length === 0) continue

    const windows: Window[] = day.intervals.map((iv) => ({
      start: localToUtc(dateStr, iv.start, schedule.timezone),
      end: localToUtc(dateStr, iv.end, schedule.timezone),
    }))

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

  return result.sort((a, b) => a.startUtc.localeCompare(b.startUtc))
}
