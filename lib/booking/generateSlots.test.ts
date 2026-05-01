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
