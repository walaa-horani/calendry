import { describe, it, expect } from 'vitest'

import { generateSlots } from './generateSlots'
import type { GenerateSlotsInput } from './types'

function baseInput(): GenerateSlotsInput {
  return {
    schedule: {
      timezone: 'America/Los_Angeles',
      weeklySchedule: [
        { day: 'sun', enabled: false, intervals: [] },
        { day: 'mon', enabled: false, intervals: [] },
        { day: 'tue', enabled: true, intervals: [{ start: '09:00', end: '11:00' }] },
        { day: 'wed', enabled: false, intervals: [] },
        { day: 'thu', enabled: false, intervals: [] },
        { day: 'fri', enabled: false, intervals: [] },
        { day: 'sat', enabled: false, intervals: [] },
      ],
      minimumNotice: 0,
      bufferBefore: 0,
      bufferAfter: 0,
    },
    meeting: {
      duration: 30,
      bookingWindowDays: 60,
    },
    existingBookings: [],
    busyIntervals: [],
    now: new Date('2026-05-01T00:00:00Z'),  // far before any test slot
    rangeStart: new Date('2026-05-05T00:00:00Z'), // Tue (LA)
    rangeEnd: new Date('2026-05-05T23:59:59Z'),
  }
}

describe('generateSlots — single-day windowing', () => {
  it('produces no slots when no day is enabled', () => {
    const input = baseInput()
    input.schedule.weeklySchedule = input.schedule.weeklySchedule.map((d) => ({
      ...d,
      enabled: false,
      intervals: [],
    }))
    expect(generateSlots(input)).toEqual([])
  })

  it('slices a 9–11 LA window into four 30-min slots', () => {
    const slots = generateSlots(baseInput())
    expect(slots).toHaveLength(4)
    // 9:00 LA on 2026-05-05 = 16:00 UTC (PDT, UTC-7)
    expect(slots[0].startUtc).toBe('2026-05-05T16:00:00.000Z')
    expect(slots[0].endUtc).toBe('2026-05-05T16:30:00.000Z')
    expect(slots[3].startUtc).toBe('2026-05-05T17:30:00.000Z')
    expect(slots[3].endUtc).toBe('2026-05-05T18:00:00.000Z')
  })

  it('handles two intervals on the same day', () => {
    const input = baseInput()
    const tue = input.schedule.weeklySchedule.find((d) => d.day === 'tue')!
    tue.intervals = [
      { start: '09:00', end: '10:00' },
      { start: '13:00', end: '14:00' },
    ]
    const slots = generateSlots(input)
    expect(slots.map((s) => s.startUtc)).toEqual([
      '2026-05-05T16:00:00.000Z',
      '2026-05-05T16:30:00.000Z',
      '2026-05-05T20:00:00.000Z',
      '2026-05-05T20:30:00.000Z',
    ])
  })

  it('honors buffer-after at the end of a window', () => {
    const input = baseInput()
    input.schedule.bufferAfter = 15  // a 30-min slot ending at 11:00 needs to fit 11:15 still ≤ 11:00 — no
    const slots = generateSlots(input)
    // 9:00, 9:30, 10:00 are fine; 10:30 + 30 = 11:00 + 15min buffer = 11:15 > 11:00 → drop
    expect(slots).toHaveLength(3)
    expect(slots.at(-1)?.startUtc).toBe('2026-05-05T17:00:00.000Z')
  })
})

describe('generateSlots — multi-day range', () => {
  it('produces slots across multiple eligible weekdays', () => {
    const input = baseInput()
    const ws = input.schedule.weeklySchedule
    ws.find((d) => d.day === 'tue')!.intervals = [{ start: '09:00', end: '10:00' }]
    ws.find((d) => d.day === 'wed')!.enabled = true
    ws.find((d) => d.day === 'wed')!.intervals = [{ start: '14:00', end: '15:00' }]
    input.rangeStart = new Date('2026-05-05T00:00:00Z')  // Tue
    input.rangeEnd = new Date('2026-05-06T23:59:59Z')    // Wed
    const slots = generateSlots(input)
    expect(slots).toHaveLength(4)  // 2 on Tue + 2 on Wed
    expect(slots[0].startUtc).toMatch(/^2026-05-05T16:/) // Tue 9 LA
    expect(slots[2].startUtc).toMatch(/^2026-05-06T21:/) // Wed 14 LA
  })

  it('skips disabled days inside a multi-day range', () => {
    const input = baseInput()
    input.rangeStart = new Date('2026-05-04T00:00:00Z')  // Mon (disabled)
    input.rangeEnd = new Date('2026-05-06T23:59:59Z')    // Wed (disabled)
    const slots = generateSlots(input)
    expect(slots).toHaveLength(4)  // only Tue
    for (const s of slots) expect(s.startUtc.startsWith('2026-05-05')).toBe(true)
  })
})

describe('generateSlots — minimum-notice cutoff', () => {
  it('drops slots that start before now + minimumNotice', () => {
    const input = baseInput()
    input.now = new Date('2026-05-05T16:30:00Z')      // 9:30 LA
    input.schedule.minimumNotice = 60                  // 1h cutoff
    // Cutoff = 17:30 UTC. Window 16:00-18:00 trimmed to [17:30, 18:00] = 30 min.
    // Only one 30-min slot fits (17:30 → 18:00).
    const slots = generateSlots(input)
    expect(slots).toHaveLength(1)
    expect(slots[0].startUtc).toBe('2026-05-05T17:30:00.000Z')
  })

  it('respects meeting-level minimumNotice override', () => {
    const input = baseInput()
    input.now = new Date('2026-05-05T15:00:00Z')      // 8:00 LA — before any slot
    input.schedule.minimumNotice = 240                 // would have cut everything
    input.meeting.minimumNotice = 0                    // override: no notice
    const slots = generateSlots(input)
    expect(slots).toHaveLength(4)  // all four 30-min slots
  })
})

describe('generateSlots — booking-window cutoff', () => {
  it('drops slots beyond bookingWindowDays', () => {
    const input = baseInput()
    input.now = new Date('2026-05-05T00:00:00Z')
    input.meeting.bookingWindowDays = 0  // no future allowed
    input.rangeStart = new Date('2026-05-05T00:00:00Z')
    input.rangeEnd = new Date('2026-05-12T23:59:59Z')  // Tue + next Tue
    const slots = generateSlots(input)
    // bookingWindowDays = 0 means windowEnd = now exactly. Today's slots run later than now → all dropped.
    expect(slots).toHaveLength(0)
  })

  it('keeps slots inside bookingWindowDays', () => {
    const input = baseInput()
    input.now = new Date('2026-05-05T00:00:00Z')
    input.meeting.bookingWindowDays = 8  // 8 days = next Tue is OK
    input.rangeStart = new Date('2026-05-05T00:00:00Z')
    input.rangeEnd = new Date('2026-05-12T23:59:59Z')
    const slots = generateSlots(input)
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.some((s) => s.startUtc.startsWith('2026-05-12'))).toBe(true)
  })
})

describe('generateSlots — existing bookings subtraction', () => {
  it('removes a slot that exactly matches an existing booking', () => {
    const input = baseInput()
    input.existingBookings = [
      { startUtc: '2026-05-05T16:30:00.000Z', endUtc: '2026-05-05T17:00:00.000Z' }, // 9:30 LA
    ]
    const slots = generateSlots(input)
    expect(slots.map((s) => s.startUtc)).toEqual([
      '2026-05-05T16:00:00.000Z',
      '2026-05-05T17:00:00.000Z',
      '2026-05-05T17:30:00.000Z',
    ])
  })

  it('applies bufferBefore and bufferAfter when subtracting bookings', () => {
    const input = baseInput()
    input.schedule.bufferBefore = 15
    input.schedule.bufferAfter = 15
    input.existingBookings = [
      { startUtc: '2026-05-05T17:00:00.000Z', endUtc: '2026-05-05T17:30:00.000Z' }, // 10:00 LA
    ]
    // Block = [16:45, 17:45]. Window 16–18.
    // 9:00 (16:00) → ends 16:30, OK. 9:30 (16:30) → ends 17:00, but trim cuts windows: [16:00,16:45] & [17:45,18:00].
    // From [16:00,16:45]: 16:00→16:30 OK; 16:30→17:00 NOT (17:00 > 16:45) → drop.
    // From [17:45,18:00]: nothing fits 30 min.
    const slots = generateSlots(input)
    expect(slots.map((s) => s.startUtc)).toEqual(['2026-05-05T16:00:00.000Z'])
  })

  it('respects meeting-level buffer overrides', () => {
    const input = baseInput()
    input.schedule.bufferBefore = 60  // huge default
    input.meeting.bufferBefore = 0    // overridden to nothing
    input.meeting.bufferAfter = 0
    input.existingBookings = [
      { startUtc: '2026-05-05T17:00:00.000Z', endUtc: '2026-05-05T17:30:00.000Z' },
    ]
    const slots = generateSlots(input)
    // Block stays [17:00,17:30] (no buffers). Same as exact-match case.
    expect(slots).toHaveLength(3)
  })
})

describe('generateSlots — maxBookingsPerDay', () => {
  it('skips a date that has already reached its cap', () => {
    const input = baseInput()
    input.meeting.maxBookingsPerDay = 1
    input.existingBookings = [
      { startUtc: '2026-05-05T16:00:00.000Z', endUtc: '2026-05-05T16:30:00.000Z' }, // 9:00 LA
    ]
    const slots = generateSlots(input)
    expect(slots).toEqual([])
  })

  it('does not skip when other dates are below the cap', () => {
    const input = baseInput()
    input.meeting.maxBookingsPerDay = 1
    input.existingBookings = [
      { startUtc: '2026-05-05T16:00:00.000Z', endUtc: '2026-05-05T16:30:00.000Z' },
    ]
    const ws = input.schedule.weeklySchedule
    ws.find((d) => d.day === 'wed')!.enabled = true
    ws.find((d) => d.day === 'wed')!.intervals = [{ start: '09:00', end: '10:00' }]
    input.rangeStart = new Date('2026-05-05T00:00:00Z')
    input.rangeEnd = new Date('2026-05-06T23:59:59Z')
    const slots = generateSlots(input)
    expect(slots).toHaveLength(2)  // only Wed produces; Tue is capped
    for (const s of slots) expect(s.startUtc.startsWith('2026-05-06')).toBe(true)
  })
})

describe('generateSlots — Google busy subtraction', () => {
  it('removes a slot that overlaps a Google busy interval (no buffer math)', () => {
    const input = baseInput()
    input.schedule.bufferBefore = 60
    input.schedule.bufferAfter = 60   // big buffers — these should NOT apply to busy
    input.busyIntervals = [
      { startUtc: '2026-05-05T17:00:00.000Z', endUtc: '2026-05-05T17:30:00.000Z' }, // 10:00 LA
    ]
    const slots = generateSlots(input)
    // Window 9–11 LA = 16:00–18:00 UTC. Subtract [17:00,17:30] → [16:00,17:00] & [17:30,18:00].
    // [16:00,17:00] yields 16:00, 16:30. [17:30,18:00] yields 17:30. Buffer-after 60 cuts: 16:00 OK (16:30+60=17:30 ≤ 17:00? no 17:30 > 17:00) → DROP. Wait.
    // With effBufAfter=60: a slot ends at 16:30, +60min = 17:30 > window.end of 17:00 → drop.
    // So actually window [16:00,17:00] with bufferAfter 60: NO slots fit.
    // Window [17:30,18:00]: 17:30+30=18:00, +60=19:00 > 18:00 → drop.
    expect(slots).toEqual([])
  })

  it('handles busy with no buffers when meeting overrides bufferAfter to 0', () => {
    const input = baseInput()
    input.schedule.bufferAfter = 60
    input.meeting.bufferAfter = 0
    input.busyIntervals = [
      { startUtc: '2026-05-05T17:00:00.000Z', endUtc: '2026-05-05T17:30:00.000Z' },
    ]
    const slots = generateSlots(input)
    expect(slots.map((s) => s.startUtc)).toEqual([
      '2026-05-05T16:00:00.000Z',
      '2026-05-05T16:30:00.000Z',
      '2026-05-05T17:30:00.000Z',
    ])
  })
})

describe('generateSlots — DST transitions', () => {
  it('produces correct UTC slots across spring-forward (US, March)', () => {
    // 2026 spring-forward in LA: Sun March 8, 02:00 → 03:00 local
    const input = baseInput()
    input.now = new Date('2026-03-08T00:00:00Z')
    input.meeting.bookingWindowDays = 2
    input.schedule.weeklySchedule = input.schedule.weeklySchedule.map((d) => ({
      ...d, enabled: d.day === 'sun', intervals: d.day === 'sun' ? [{ start: '01:00', end: '04:00' }] : [],
    }))
    input.rangeStart = new Date('2026-03-08T00:00:00Z')
    input.rangeEnd = new Date('2026-03-08T23:59:59Z')
    const slots = generateSlots(input)
    // 01:00 PST = 09:00 UTC; 02:00 doesn't exist locally; 03:00 PDT = 10:00 UTC; 03:30 PDT = 10:30 UTC
    // Slots 01:00, 01:30, then JUMP to 03:00, 03:30. In UTC: 09:00, 09:30, 10:00, 10:30.
    expect(slots.map((s) => s.startUtc)).toEqual([
      '2026-03-08T09:00:00.000Z',
      '2026-03-08T09:30:00.000Z',
      '2026-03-08T10:00:00.000Z',
      '2026-03-08T10:30:00.000Z',
    ])
  })

  it('produces correct UTC slots across fall-back (US, November)', () => {
    // 2026 fall-back in LA: Sun November 1, 02:00 → 01:00 local
    const input = baseInput()
    input.now = new Date('2026-11-01T00:00:00Z')
    input.meeting.bookingWindowDays = 2
    input.schedule.weeklySchedule = input.schedule.weeklySchedule.map((d) => ({
      ...d, enabled: d.day === 'sun', intervals: d.day === 'sun' ? [{ start: '00:00', end: '03:00' }] : [],
    }))
    input.rangeStart = new Date('2026-11-01T00:00:00Z')
    input.rangeEnd = new Date('2026-11-01T23:59:59Z')
    const slots = generateSlots(input)
    // We slice in UTC, not local time. 00:00 local PDT → 07:00 UTC; 03:00 local PST → 11:00 UTC.
    // UTC window [07:00, 11:00] = 4 hours = 8 slots of 30 min.
    // The fall-back duplicate hour (01:00–02:00 local) is naturally represented by both UTC
    // instants 08:00 and 09:00 — exactly what the spec promises.
    expect(slots.map((s) => s.startUtc)).toEqual([
      '2026-11-01T07:00:00.000Z',
      '2026-11-01T07:30:00.000Z',
      '2026-11-01T08:00:00.000Z',
      '2026-11-01T08:30:00.000Z',
      '2026-11-01T09:00:00.000Z',
      '2026-11-01T09:30:00.000Z',
      '2026-11-01T10:00:00.000Z',
      '2026-11-01T10:30:00.000Z',
    ])
  })
})

describe('generateSlots — granularity follows duration', () => {
  it('60-min meeting yields slots every 60 min', () => {
    const input = baseInput()
    input.meeting.duration = 60
    const slots = generateSlots(input)
    expect(slots).toHaveLength(2)
    expect(slots[0].startUtc).toBe('2026-05-05T16:00:00.000Z')
    expect(slots[1].startUtc).toBe('2026-05-05T17:00:00.000Z')
  })

  it('15-min meeting yields slots every 15 min', () => {
    const input = baseInput()
    input.meeting.duration = 15
    const slots = generateSlots(input)
    expect(slots).toHaveLength(8)
  })
})
