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
