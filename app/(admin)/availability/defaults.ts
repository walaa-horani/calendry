import 'server-only'
import { randomUUID } from 'crypto'
import type { DaySchedule } from './types'

// Sun-first to match the existing UI ordering. Schema validation is order-agnostic.
const SUN_FIRST: Array<{ day: DaySchedule['day']; enabled: boolean }> = [
  { day: 'sun', enabled: false },
  { day: 'mon', enabled: true },
  { day: 'tue', enabled: true },
  { day: 'wed', enabled: true },
  { day: 'thu', enabled: true },
  { day: 'fri', enabled: true },
  { day: 'sat', enabled: false },
]

export function defaultSundayFirstSchedule(): DaySchedule[] {
  return SUN_FIRST.map(({ day, enabled }) => ({
    _key: day,
    day,
    enabled,
    intervals: [{ _key: randomUUID(), start: '09:00', end: '17:00' }],
  }))
}
