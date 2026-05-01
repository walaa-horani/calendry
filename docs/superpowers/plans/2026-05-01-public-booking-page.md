# Public Booking Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public `/{username}/{slug}` booking page where invitees can pick a time and book — slots reflect Sanity schedule, existing bookings, and Google Calendar busy times.

**Architecture:** Pure subtractive slot engine in `lib/booking/` (no I/O, fully unit-tested). Server actions in `app/(app)/[username]/[slug]/actions.ts` orchestrate Sanity reads + Google FreeBusy API + the engine. Concurrency safety via deterministic Sanity `_id = booking.${hostClerkId}.${startEpochMs}` + `createIfNotExists`. Public confirmation route uses an unguessable `nanoid(24)` token as the cancellation credential.

**Tech Stack:** Next.js 16.2.4, React 19.2.4, TypeScript strict, Sanity (`next-sanity`), Clerk auth (admin only — public routes are unauthenticated), Tailwind v4. Adds: `date-fns`, `date-fns-tz`, `nanoid`, `vitest`.

**Spec:** `docs/superpowers/specs/2026-05-01-public-booking-page-design.md`

---

## File map

**Created:**
- `vitest.config.ts` — Vitest config (jsdom-free; pure modules only)
- `test/stubs/server-only.ts` — empty stub so Vitest can import `server-only`-marked modules
- `lib/booking/types.ts` — shared types: `Slot`, `BusyInterval`, `ScheduleInput`, `MeetingInput`, `GenerateSlotsInput`, `DayCode`
- `lib/booking/generateSlots.ts` — pure subtractive pipeline
- `lib/booking/generateSlots.test.ts` — unit tests
- `lib/booking/freeBusy.ts` — Google FreeBusy API wrapper
- `lib/booking/freeBusy.test.ts` — unit tests with mocked fetch
- `app/(app)/[username]/[slug]/page.tsx` — server shell (GROQ join, 404)
- `app/(app)/[username]/[slug]/actions.ts` — `getAvailability`, `createBooking`, `cancelBooking`
- `app/(app)/[username]/[slug]/BookingPicker.tsx` — client UI
- `app/(app)/[username]/[slug]/confirmed/[bookingId]/page.tsx` — confirmation receipt
- `app/(app)/[username]/[slug]/confirmed/[bookingId]/CancelButton.tsx` — client cancel button

**Modified:**
- `package.json` — add deps + test scripts
- `sanity/schemaTypes/documents/bookingType.ts` — add `bookingToken` field

---

## Task 1: Project setup — install deps and configure Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `test/stubs/server-only.ts`

- [ ] **Step 1: Install runtime dependencies**

Run:

```bash
npm install date-fns date-fns-tz nanoid
```

Expected: dependencies added to `package.json` `"dependencies"`. No errors.

- [ ] **Step 2: Install Vitest as dev dependency**

Run:

```bash
npm install -D vitest
```

Expected: `vitest` added to `"devDependencies"`. No errors.

- [ ] **Step 3: Create the `server-only` stub**

Create `test/stubs/server-only.ts`:

```ts
// Empty stub so Vitest can resolve `import 'server-only'`.
// In production Next masks this via package conditional exports.
export {}
```

- [ ] **Step 4: Create `vitest.config.ts`**

Create `vitest.config.ts` at the repo root:

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      'server-only': path.resolve(__dirname, 'test/stubs/server-only.ts'),
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    include: ['lib/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 5: Add test scripts to `package.json`**

Edit `package.json` `"scripts"` to include:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 6: Verify `npm test` runs cleanly with no test files**

Run:

```bash
npm test
```

Expected: `No test files found, exiting with code 1` — that's fine for now. If the command itself errors with a config or import problem, fix it before proceeding.

Workaround for the clean-exit signal: run with the `--passWithNoTests` flag once to confirm the harness loads:

```bash
npx vitest run --passWithNoTests
```

Expected: Vitest prints `No test files found` and exits with code 0.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts test/stubs/server-only.ts
git commit -m "chore(booking): add date-fns, nanoid, vitest"
```

---

## Task 2: Add `bookingToken` field to `bookingType` schema

**Files:**
- Modify: `sanity/schemaTypes/documents/bookingType.ts`

- [ ] **Step 1: Add the field after `meetingType` reference, in the `refs` group**

Edit `sanity/schemaTypes/documents/bookingType.ts`. Locate the `meetingType` `defineField` block (around line 30-36) and immediately after it, add:

```ts
    defineField({
      name: 'bookingToken',
      type: 'string',
      description: 'Unguessable public token used in the confirmation URL. Set server-side at booking time.',
      group: 'refs',
      readOnly: true,
      validation: (rule) => rule.required().min(20).max(40),
    }),
```

- [ ] **Step 2: Verify Studio compiles**

Run:

```bash
npm run dev
```

Open `http://localhost:3000/studio` and navigate to **Booking** in the sidebar. Open an existing booking (or create one). Expected: a read-only `Booking token` field appears under the References group. No console errors.

If there are no bookings yet, just confirm Studio loads without an error overlay — schema deploy happens implicitly on dev start.

Stop the dev server (Ctrl+C) when done.

- [ ] **Step 3: Commit**

```bash
git add sanity/schemaTypes/documents/bookingType.ts
git commit -m "feat(schema): add bookingToken to bookingType"
```

---

## Task 3: Slot engine — types and single-day windowing

**Files:**
- Create: `lib/booking/types.ts`
- Create: `lib/booking/generateSlots.ts`
- Create: `lib/booking/generateSlots.test.ts`

- [ ] **Step 1: Create `lib/booking/types.ts`**

```ts
export type DayCode = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'

export interface TimeIntervalInput {
  start: string // 'HH:mm'
  end: string   // 'HH:mm'
}

export interface DayScheduleInput {
  day: DayCode
  enabled: boolean
  intervals: TimeIntervalInput[]
}

export interface ScheduleInput {
  timezone: string                 // IANA, e.g. 'America/Los_Angeles'
  weeklySchedule: DayScheduleInput[]
  minimumNotice: number            // minutes (base default)
  bufferBefore: number             // minutes (base default)
  bufferAfter: number              // minutes (base default)
}

export interface MeetingInput {
  duration: number                 // minutes
  bufferBefore?: number            // override
  bufferAfter?: number             // override
  minimumNotice?: number           // override
  maxBookingsPerDay?: number       // optional cap
  bookingWindowDays: number        // furthest into future
}

export interface BusyInterval {
  startUtc: string                 // ISO
  endUtc: string                   // ISO
}

export interface GenerateSlotsInput {
  schedule: ScheduleInput
  meeting: MeetingInput
  existingBookings: BusyInterval[]
  busyIntervals: BusyInterval[]
  now: Date
  rangeStart: Date
  rangeEnd: Date
}

export interface Slot {
  startUtc: string                 // ISO
  endUtc: string                   // ISO
}
```

- [ ] **Step 2: Create `lib/booking/generateSlots.ts` skeleton**

```ts
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
```

- [ ] **Step 3: Create `lib/booking/generateSlots.test.ts` with a single failing test**

```ts
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
```

- [ ] **Step 4: Run the tests — verify they pass**

```bash
npm test
```

Expected: 4 tests pass under `lib/booking/generateSlots.test.ts`. If any fail, fix the engine code, not the tests.

- [ ] **Step 5: Commit**

```bash
git add lib/booking/types.ts lib/booking/generateSlots.ts lib/booking/generateSlots.test.ts
git commit -m "feat(booking): slot engine types and single-day windowing"
```

---

## Task 4: Slot engine — multi-day range, minimum-notice cutoff, booking-window cutoff

**Files:**
- Modify: `lib/booking/generateSlots.ts`
- Modify: `lib/booking/generateSlots.test.ts`

- [ ] **Step 1: Add failing tests for multi-day, minimum-notice, and booking-window**

Append to `lib/booking/generateSlots.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests — verify the new ones fail**

```bash
npm test
```

Expected: the new tests fail (engine doesn't yet apply notice/window cutoffs). The 4 original Task 3 tests still pass.

- [ ] **Step 3: Update `lib/booking/generateSlots.ts` to add cutoffs and helpers**

Replace the body of `generateSlots` with the full version below (also adds the helper `subtractInterval`, `trimBefore`, `trimAfter` for future tasks):

```ts
function subtractInterval(windows: Window[], cutStart: Date, cutEnd: Date): Window[] {
  const out: Window[] = []
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

function trimBefore(windows: Window[], cutoff: Date): Window[] {
  const out: Window[] = []
  for (const w of windows) {
    if (w.end <= cutoff) continue
    if (w.start < cutoff) out.push({ start: cutoff, end: w.end })
    else out.push(w)
  }
  return out
}

function trimAfter(windows: Window[], cutoff: Date): Window[] {
  const out: Window[] = []
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

    let windows: Window[] = day.intervals.map((iv) => ({
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

  return result.sort((a, b) => a.startUtc.localeCompare(b.startUtc))
}
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
npm test
```

Expected: all generateSlots tests pass (Task 3 + 5 new Task 4 tests = 9 total).

- [ ] **Step 5: Commit**

```bash
git add lib/booking/generateSlots.ts lib/booking/generateSlots.test.ts
git commit -m "feat(booking): slot engine multi-day, notice and window cutoffs"
```

---

## Task 5: Slot engine — subtract existing bookings (with buffers) and `maxBookingsPerDay`

**Files:**
- Modify: `lib/booking/generateSlots.ts`
- Modify: `lib/booking/generateSlots.test.ts`

- [ ] **Step 1: Add failing tests for booking subtraction and per-day cap**

Append to `lib/booking/generateSlots.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests — verify new ones fail**

```bash
npm test
```

Expected: 5 new tests fail.

- [ ] **Step 3: Update `lib/booking/generateSlots.ts` to apply bookings + max-per-day**

In the `generateSlots` function, replace the inner per-date loop with:

```ts
  const effBufBefore = meeting.bufferBefore ?? schedule.bufferBefore
  const effBufAfter = meeting.bufferAfter ?? schedule.bufferAfter
  const effMinNotice = meeting.minimumNotice ?? schedule.minimumNotice
  const noticeCutoff = new Date(now.getTime() + effMinNotice * 60_000)
  const windowEnd = new Date(now.getTime() + meeting.bookingWindowDays * 86_400_000)

  const result: Slot[] = []

  for (const dateStr of dateStringsInTz(rangeStart, rangeEnd, schedule.timezone)) {
    const code = weekdayCodeInTz(dateStr, schedule.timezone)
    const day = schedule.weeklySchedule.find((d) => d.day === code)
    if (!day || !day.enabled || day.intervals.length === 0) continue

    if (meeting.maxBookingsPerDay !== undefined) {
      const onThisDate = input.existingBookings.filter(
        (b) => formatInTimeZone(new Date(b.startUtc), schedule.timezone, 'yyyy-MM-dd') === dateStr,
      ).length
      if (onThisDate >= meeting.maxBookingsPerDay) continue
    }

    let windows: Window[] = day.intervals.map((iv) => ({
      start: localToUtc(dateStr, iv.start, schedule.timezone),
      end: localToUtc(dateStr, iv.end, schedule.timezone),
    }))

    for (const b of input.existingBookings) {
      const blockStart = new Date(new Date(b.startUtc).getTime() - effBufBefore * 60_000)
      const blockEnd = new Date(new Date(b.endUtc).getTime() + effBufAfter * 60_000)
      windows = subtractInterval(windows, blockStart, blockEnd)
    }

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
```

(The destructuring at the top of `generateSlots` should now read `const { schedule, meeting, now, rangeStart, rangeEnd } = input` — keep `input` available so the inner loop can reach `input.existingBookings`.)

- [ ] **Step 4: Run tests — verify all pass**

```bash
npm test
```

Expected: 14 generateSlots tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/booking/generateSlots.ts lib/booking/generateSlots.test.ts
git commit -m "feat(booking): slot engine subtract bookings (buffers) and max-per-day"
```

---

## Task 6: Slot engine — subtract Google busy intervals + DST verification

**Files:**
- Modify: `lib/booking/generateSlots.ts`
- Modify: `lib/booking/generateSlots.test.ts`

- [ ] **Step 1: Add failing tests for Google busy and DST**

Append to `lib/booking/generateSlots.test.ts`:

```ts
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
```

- [ ] **Step 2: Run — verify the new tests fail**

```bash
npm test
```

Expected: new tests fail (engine doesn't yet subtract `busyIntervals`).

- [ ] **Step 3: Add Google-busy subtraction**

In `lib/booking/generateSlots.ts`, inside the per-date loop right after the `existingBookings` subtraction loop, add:

```ts
    for (const b of input.busyIntervals) {
      windows = subtractInterval(windows, new Date(b.startUtc), new Date(b.endUtc))
    }
```

The order is: subtract bookings (with buffers) → subtract busy (no buffers) → trim notice → trim window → slice.

- [ ] **Step 4: Run tests — verify all pass**

```bash
npm test
```

Expected: all generateSlots tests pass (~20 total). If a DST test fails on the fall-back disambiguation expectation, inspect the actual output and verify it's still a valid disambiguation (date-fns-tz documents ambiguous-time behavior); update the expected array to match the documented behavior of the installed version, then commit.

- [ ] **Step 5: Commit**

```bash
git add lib/booking/generateSlots.ts lib/booking/generateSlots.test.ts
git commit -m "feat(booking): slot engine subtract Google busy plus DST and granularity tests"
```

---

## Task 7: Google FreeBusy API wrapper

**Files:**
- Create: `lib/booking/freeBusy.ts`
- Create: `lib/booking/freeBusy.test.ts`

- [ ] **Step 1: Create the wrapper**

`lib/booking/freeBusy.ts`:

```ts
import 'server-only'

import type { BusyInterval } from './types'

const FREE_BUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy'

interface FreeBusyResponse {
  calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }>
}

export interface FreeBusyInput {
  accessToken: string
  calendarIds: string[]   // already filtered to conflictCheck=true
  timeMinUtc: string      // ISO
  timeMaxUtc: string      // ISO
}

export async function fetchFreeBusy(input: FreeBusyInput): Promise<BusyInterval[]> {
  if (input.calendarIds.length === 0) return []
  const body = {
    timeMin: input.timeMinUtc,
    timeMax: input.timeMaxUtc,
    items: input.calendarIds.map((id) => ({ id })),
  }
  const res = await fetch(FREE_BUSY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Google freeBusy failed: ${res.status}`)
  const json = (await res.json()) as FreeBusyResponse
  const merged: BusyInterval[] = []
  for (const cal of Object.values(json.calendars ?? {})) {
    for (const b of cal.busy ?? []) {
      merged.push({ startUtc: b.start, endUtc: b.end })
    }
  }
  // Merge overlapping intervals
  merged.sort((a, b) => a.startUtc.localeCompare(b.startUtc))
  const out: BusyInterval[] = []
  for (const cur of merged) {
    const last = out[out.length - 1]
    if (last && cur.startUtc <= last.endUtc) {
      if (cur.endUtc > last.endUtc) last.endUtc = cur.endUtc
    } else {
      out.push({ ...cur })
    }
  }
  return out
}
```

- [ ] **Step 2: Create test file with mocked fetch**

`lib/booking/freeBusy.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { fetchFreeBusy } from './freeBusy'

describe('fetchFreeBusy', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch')
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty array when no calendar IDs provided', async () => {
    const result = await fetchFreeBusy({
      accessToken: 'tok',
      calendarIds: [],
      timeMinUtc: '2026-05-05T00:00:00.000Z',
      timeMaxUtc: '2026-05-06T00:00:00.000Z',
    })
    expect(result).toEqual([])
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('posts to /freeBusy with the right body and parses busy intervals', async () => {
    const mockRes = new Response(
      JSON.stringify({
        calendars: {
          primary: { busy: [{ start: '2026-05-05T17:00:00Z', end: '2026-05-05T17:30:00Z' }] },
        },
      }),
      { status: 200 },
    )
    vi.mocked(globalThis.fetch).mockResolvedValue(mockRes)

    const result = await fetchFreeBusy({
      accessToken: 'tok',
      calendarIds: ['primary'],
      timeMinUtc: '2026-05-05T00:00:00.000Z',
      timeMaxUtc: '2026-05-06T00:00:00.000Z',
    })

    expect(result).toEqual([
      { startUtc: '2026-05-05T17:00:00Z', endUtc: '2026-05-05T17:30:00Z' },
    ])
    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(callArgs[0]).toBe('https://www.googleapis.com/calendar/v3/freeBusy')
    const init = callArgs[1] as RequestInit
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    const body = JSON.parse(init.body as string)
    expect(body.items).toEqual([{ id: 'primary' }])
    expect(body.timeMin).toBe('2026-05-05T00:00:00.000Z')
  })

  it('merges overlapping intervals across calendars', async () => {
    const mockRes = new Response(
      JSON.stringify({
        calendars: {
          a: { busy: [{ start: '2026-05-05T17:00:00Z', end: '2026-05-05T17:30:00Z' }] },
          b: { busy: [{ start: '2026-05-05T17:15:00Z', end: '2026-05-05T18:00:00Z' }] },
          c: { busy: [{ start: '2026-05-05T20:00:00Z', end: '2026-05-05T20:30:00Z' }] },
        },
      }),
      { status: 200 },
    )
    vi.mocked(globalThis.fetch).mockResolvedValue(mockRes)
    const result = await fetchFreeBusy({
      accessToken: 'tok',
      calendarIds: ['a', 'b', 'c'],
      timeMinUtc: '2026-05-05T00:00:00Z',
      timeMaxUtc: '2026-05-06T00:00:00Z',
    })
    expect(result).toEqual([
      { startUtc: '2026-05-05T17:00:00Z', endUtc: '2026-05-05T18:00:00Z' },
      { startUtc: '2026-05-05T20:00:00Z', endUtc: '2026-05-05T20:30:00Z' },
    ])
  })

  it('throws when Google returns non-200', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response('nope', { status: 401 }))
    await expect(
      fetchFreeBusy({
        accessToken: 'tok',
        calendarIds: ['primary'],
        timeMinUtc: '2026-05-05T00:00:00Z',
        timeMaxUtc: '2026-05-06T00:00:00Z',
      }),
    ).rejects.toThrow(/freeBusy failed: 401/)
  })
})
```

- [ ] **Step 3: Run tests — all pass**

```bash
npm test
```

Expected: 4 freeBusy tests pass; existing generateSlots tests still pass.

- [ ] **Step 4: Commit**

```bash
git add lib/booking/freeBusy.ts lib/booking/freeBusy.test.ts
git commit -m "feat(booking): Google FreeBusy API wrapper"
```

---

## Task 8: Public booking page — server shell with GROQ join and 404 routing

**Files:**
- Create: `app/(app)/[username]/[slug]/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
import 'server-only'
import { notFound } from 'next/navigation'

import { serverClient } from '@/sanity/lib/serverClient'

interface PageProps {
  params: Promise<{ username: string; slug: string }>
}

interface JoinResult {
  _id: string
  clerkId: string
  displayName: string
  avatarUrl: string | null
  bio: string | null
  welcomeMessage: string | null
  timezone: string
  meeting: {
    _id: string
    title: string
    description: string | null
    duration: number
    location: { type: string; value?: string; instructions?: string }
    color: string
    bufferBefore: number | null
    bufferAfter: number | null
    minimumNotice: number | null
    maxBookingsPerDay: number | null
    bookingWindowDays: number
  } | null
  availability: {
    timezone: string
    weeklySchedule: Array<{
      day: string
      enabled: boolean
      intervals: Array<{ start: string; end: string }>
    }>
    minimumNotice: number
    bufferBefore: number
    bufferAfter: number
  } | null
}

const HOST_QUERY = `
*[_type == "userType" && username.current == $username][0]{
  _id, clerkId, displayName, avatarUrl, bio, welcomeMessage, timezone,
  "meeting": *[_type == "meetingType" && host._ref == ^._id && slug.current == $slug && active == true][0]{
    _id, title, description, duration, location, color,
    bufferBefore, bufferAfter, minimumNotice, maxBookingsPerDay, bookingWindowDays
  },
  "availability": *[_type == "availabilityType" && user._ref == ^._id][0]{
    timezone, weeklySchedule, minimumNotice, bufferBefore, bufferAfter
  }
}
`

export default async function PublicBookingPage({ params }: PageProps) {
  const { username, slug } = await params
  const data = await serverClient.fetch<JoinResult | null>(HOST_QUERY, { username, slug })
  if (!data || !data.meeting || !data.availability) notFound()

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">{data.meeting.title}</h1>
      <p className="text-sm text-gray-600">
        {data.displayName} · {data.meeting.duration} min
      </p>
    </main>
  )
}
```

- [ ] **Step 2: Manual smoke — boot the dev server**

```bash
npm run dev
```

In your browser, visit `http://localhost:3000/<your-username>/<your-meeting-slug>`. Use a real `userType.username.current` and `meetingType.slug.current` from your Studio.

Expected: page renders the meeting title and host name. No server console errors.

- [ ] **Step 3: Manual smoke — 404 paths**

In the same dev server, visit:

- `http://localhost:3000/totally-fake-user-name/anything` → expect Next.js 404 page.
- `http://localhost:3000/<your-username>/totally-fake-slug` → expect 404.
- (Optional) Toggle `active: false` on the meeting in Studio, refresh the URL → expect 404. Toggle back to `true` afterwards.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/\[username\]/\[slug\]/page.tsx
git commit -m "feat(booking): public route shell with GROQ join and 404 routing"
```

---

## Task 9: `getAvailability` server action + `BookingPicker` (calendar + slots, no form yet)

**Files:**
- Create: `app/(app)/[username]/[slug]/actions.ts`
- Create: `app/(app)/[username]/[slug]/BookingPicker.tsx`
- Modify: `app/(app)/[username]/[slug]/page.tsx`

- [ ] **Step 1: Create `actions.ts` with `getAvailability`**

```ts
'use server'

import { formatInTimeZone } from 'date-fns-tz'

import { serverClient } from '@/sanity/lib/serverClient'
import { generateSlots } from '@/lib/booking/generateSlots'
import { fetchFreeBusy } from '@/lib/booking/freeBusy'
import {
  GoogleConnectionMissingError,
  GoogleConnectionRevokedError,
  getValidAccessToken,
} from '@/lib/google/getValidAccessToken'
import type {
  BusyInterval,
  DayCode,
  GenerateSlotsInput,
  Slot,
} from '@/lib/booking/types'

const HOST_QUERY = `
*[_type == "userType" && username.current == $username][0]{
  _id, clerkId, displayName, timezone,
  "meeting": *[_type == "meetingType" && host._ref == ^._id && slug.current == $slug && active == true][0]{
    _id, title, duration, location,
    bufferBefore, bufferAfter, minimumNotice, maxBookingsPerDay, bookingWindowDays
  },
  "availability": *[_type == "availabilityType" && user._ref == ^._id][0]{
    timezone, weeklySchedule, minimumNotice, bufferBefore, bufferAfter
  }
}
`

interface HostJoin {
  _id: string
  clerkId: string
  displayName: string
  timezone: string
  meeting: {
    _id: string
    title: string
    duration: number
    bufferBefore: number | null
    bufferAfter: number | null
    minimumNotice: number | null
    maxBookingsPerDay: number | null
    bookingWindowDays: number
  } | null
  availability: {
    timezone: string
    weeklySchedule: Array<{ day: DayCode; enabled: boolean; intervals: Array<{ start: string; end: string }> }>
    minimumNotice: number
    bufferBefore: number
    bufferAfter: number
  } | null
}

interface GcalDoc {
  calendars?: Array<{ calendarId: string; conflictCheck?: boolean }>
}

export interface AvailabilityResult {
  ok: true
  slotsByDate: Record<string, Slot[]>
}

export interface AvailabilityError {
  ok: false
  error: 'not_found' | 'unknown'
}

export async function getAvailability(
  username: string,
  slug: string,
  rangeStartUtc: string,
  rangeEndUtc: string,
): Promise<AvailabilityResult | AvailabilityError> {
  try {
    const data = await serverClient.fetch<HostJoin | null>(HOST_QUERY, { username, slug })
    if (!data || !data.meeting || !data.availability) return { ok: false, error: 'not_found' }

    const rangeStart = new Date(rangeStartUtc)
    const rangeEnd = new Date(rangeEndUtc)

    const existing = await serverClient.fetch<BusyInterval[]>(
      `*[_type == "bookingType" && host._ref == $hostId && status == "confirmed" && startTime < $rangeEnd && endTime > $rangeStart]{ "startUtc": startTime, "endUtc": endTime }`,
      { hostId: data._id, rangeStart: rangeStartUtc, rangeEnd: rangeEndUtc },
    )

    let busy: BusyInterval[] = []
    try {
      const gcal = await serverClient.getDocument<GcalDoc>(`gcal.${data.clerkId}`)
      const calIds = (gcal?.calendars ?? [])
        .filter((c) => c.conflictCheck === true)
        .map((c) => c.calendarId)
      if (calIds.length > 0) {
        const accessToken = await getValidAccessToken(data.clerkId)
        busy = await fetchFreeBusy({
          accessToken,
          calendarIds: calIds,
          timeMinUtc: rangeStartUtc,
          timeMaxUtc: rangeEndUtc,
        })
      }
    } catch (err) {
      if (
        !(err instanceof GoogleConnectionMissingError) &&
        !(err instanceof GoogleConnectionRevokedError)
      ) {
        console.error('FreeBusy fetch failed; proceeding with empty busy list:', err)
      }
      busy = []
    }

    const input: GenerateSlotsInput = {
      schedule: {
        timezone: data.availability.timezone,
        weeklySchedule: data.availability.weeklySchedule,
        minimumNotice: data.availability.minimumNotice,
        bufferBefore: data.availability.bufferBefore,
        bufferAfter: data.availability.bufferAfter,
      },
      meeting: {
        duration: data.meeting.duration,
        bufferBefore: data.meeting.bufferBefore ?? undefined,
        bufferAfter: data.meeting.bufferAfter ?? undefined,
        minimumNotice: data.meeting.minimumNotice ?? undefined,
        maxBookingsPerDay: data.meeting.maxBookingsPerDay ?? undefined,
        bookingWindowDays: data.meeting.bookingWindowDays,
      },
      existingBookings: existing,
      busyIntervals: busy,
      now: new Date(),
      rangeStart,
      rangeEnd,
    }

    const slots = generateSlots(input)
    const slotsByDate: Record<string, Slot[]> = {}
    for (const s of slots) {
      const key = formatInTimeZone(new Date(s.startUtc), data.availability.timezone, 'yyyy-MM-dd')
      if (!slotsByDate[key]) slotsByDate[key] = []
      slotsByDate[key].push(s)
    }
    return { ok: true, slotsByDate }
  } catch (err) {
    console.error('getAvailability failed:', err)
    return { ok: false, error: 'unknown' }
  }
}
```

- [ ] **Step 2: Create `BookingPicker.tsx` (calendar + slot list only, no form)**

```tsx
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
        {loadError ? <p className="mt-3 text-sm text-red-600">Couldn't load times. Please try again.</p> : null}
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
```

- [ ] **Step 3: Wire `BookingPicker` into `page.tsx`**

Replace the body of the default export in `app/(app)/[username]/[slug]/page.tsx` with:

```tsx
  return (
    <main className="mx-auto max-w-5xl p-6">
      <BookingPicker
        username={username}
        slug={slug}
        meeting={{
          title: data.meeting.title,
          duration: data.meeting.duration,
          location: data.meeting.location,
        }}
        host={{
          displayName: data.displayName,
          avatarUrl: data.avatarUrl,
          welcomeMessage: data.welcomeMessage,
        }}
        hostTimezone={data.availability.timezone}
      />
    </main>
  )
```

Add the import at the top of the file:

```tsx
import BookingPicker from './BookingPicker'
```

- [ ] **Step 4: Manual smoke**

Run:

```bash
npm run dev
```

Visit `http://localhost:3000/<your-username>/<your-meeting-slug>`.

Expected:
- Calendar renders for the current month
- Days with availability are blue; disabled days are gray
- Clicking a date populates the right column with time slots in your local browser timezone
- "← prev" / "next →" navigates months and re-fetches

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/\[username\]/\[slug\]/actions.ts app/\(app\)/\[username\]/\[slug\]/BookingPicker.tsx app/\(app\)/\[username\]/\[slug\]/page.tsx
git commit -m "feat(booking): availability action and date+slot picker"
```

---

## Task 10: `createBooking` server action + invitee form in `BookingPicker`

**Files:**
- Modify: `app/(app)/[username]/[slug]/actions.ts`
- Modify: `app/(app)/[username]/[slug]/BookingPicker.tsx`

- [ ] **Step 1: Add `createBooking` to `actions.ts`**

First, add this import at the top of `app/(app)/[username]/[slug]/actions.ts` (under the existing imports):

```ts
import { nanoid } from 'nanoid'
```

Then append the rest below the existing `getAvailability` export:

```ts
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface CreateBookingInput {
  username: string
  slug: string
  startUtc: string
  inviteeName: string
  inviteeEmail: string
  inviteeNotes?: string
  inviteeTimezone: string
}

export type CreateBookingResult =
  | { ok: true; bookingToken: string }
  | { ok: false; error: 'not_found' | 'slot_taken' | 'invalid_input' | 'unknown' }

export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  try {
    const name = input.inviteeName.trim()
    const email = input.inviteeEmail.trim().toLowerCase()
    const notes = (input.inviteeNotes ?? '').slice(0, 10_000)
    if (!name || name.length > 200) return { ok: false, error: 'invalid_input' }
    if (!EMAIL_REGEX.test(email) || email.length > 320) return { ok: false, error: 'invalid_input' }
    if (!input.startUtc || Number.isNaN(Date.parse(input.startUtc))) {
      return { ok: false, error: 'invalid_input' }
    }
    if (!input.inviteeTimezone) return { ok: false, error: 'invalid_input' }

    const data = await serverClient.fetch<HostJoin | null>(HOST_QUERY, {
      username: input.username,
      slug: input.slug,
    })
    if (!data || !data.meeting || !data.availability) return { ok: false, error: 'not_found' }

    const startMs = Date.parse(input.startUtc)
    const endMs = startMs + data.meeting.duration * 60_000
    const dayMs = 86_400_000
    const rangeStart = new Date(startMs - dayMs).toISOString()
    const rangeEnd = new Date(endMs + dayMs).toISOString()

    const existing = await serverClient.fetch<BusyInterval[]>(
      `*[_type == "bookingType" && host._ref == $hostId && status == "confirmed" && startTime < $rangeEnd && endTime > $rangeStart]{ "startUtc": startTime, "endUtc": endTime }`,
      { hostId: data._id, rangeStart, rangeEnd },
    )

    let busy: BusyInterval[] = []
    try {
      const gcal = await serverClient.getDocument<GcalDoc>(`gcal.${data.clerkId}`)
      const calIds = (gcal?.calendars ?? [])
        .filter((c) => c.conflictCheck === true)
        .map((c) => c.calendarId)
      if (calIds.length > 0) {
        const accessToken = await getValidAccessToken(data.clerkId)
        busy = await fetchFreeBusy({
          accessToken,
          calendarIds: calIds,
          timeMinUtc: rangeStart,
          timeMaxUtc: rangeEnd,
        })
      }
    } catch (err) {
      if (
        !(err instanceof GoogleConnectionMissingError) &&
        !(err instanceof GoogleConnectionRevokedError)
      ) {
        console.error('createBooking FreeBusy fetch failed:', err)
      }
      busy = []
    }

    const slotInput: GenerateSlotsInput = {
      schedule: {
        timezone: data.availability.timezone,
        weeklySchedule: data.availability.weeklySchedule,
        minimumNotice: data.availability.minimumNotice,
        bufferBefore: data.availability.bufferBefore,
        bufferAfter: data.availability.bufferAfter,
      },
      meeting: {
        duration: data.meeting.duration,
        bufferBefore: data.meeting.bufferBefore ?? undefined,
        bufferAfter: data.meeting.bufferAfter ?? undefined,
        minimumNotice: data.meeting.minimumNotice ?? undefined,
        maxBookingsPerDay: data.meeting.maxBookingsPerDay ?? undefined,
        bookingWindowDays: data.meeting.bookingWindowDays,
      },
      existingBookings: existing,
      busyIntervals: busy,
      now: new Date(),
      rangeStart: new Date(rangeStart),
      rangeEnd: new Date(rangeEnd),
    }
    const slots = generateSlots(slotInput)
    const desired = new Date(startMs).toISOString()
    if (!slots.some((s) => s.startUtc === desired)) {
      return { ok: false, error: 'slot_taken' }
    }

    const docId = `booking.${data.clerkId}.${startMs}`
    const bookingToken = nanoid(24)

    const newDoc = {
      _id: docId,
      _type: 'bookingType' as const,
      host: { _type: 'reference' as const, _ref: data._id },
      meetingType: { _type: 'reference' as const, _ref: data.meeting._id },
      bookingToken,
      meetingTitleSnapshot: data.meeting.title,
      meetingDurationSnapshot: data.meeting.duration,
      hostNameSnapshot: data.displayName,
      hostUsernameSnapshot: input.username,
      locationSnapshot: data.meeting.location,
      startTime: desired,
      endTime: new Date(endMs).toISOString(),
      inviteeTimezone: input.inviteeTimezone,
      inviteeName: name,
      inviteeEmail: email,
      ...(notes ? { inviteeNotes: notes } : {}),
      status: 'confirmed' as const,
      createdAt: new Date().toISOString(),
    }

    const stored = await serverClient.createIfNotExists(newDoc)
    if (stored.bookingToken !== bookingToken) {
      return { ok: false, error: 'slot_taken' }
    }

    return { ok: true, bookingToken }
  } catch (err) {
    console.error('createBooking failed:', err)
    return { ok: false, error: 'unknown' }
  }
}
```

Note: `actions.ts` needs `data.meeting.location` typed; widen `HostJoin.meeting` to include `location: { type: string; value?: string; instructions?: string }`. Update the type at the top of the file.

- [ ] **Step 2: Add `meeting.location` to `HostJoin` and the GROQ projection**

In `actions.ts`, update `HOST_QUERY`'s meeting projection:

```ts
"meeting": *[_type == "meetingType" && host._ref == ^._id && slug.current == $slug && active == true][0]{
  _id, title, duration, location,
  bufferBefore, bufferAfter, minimumNotice, maxBookingsPerDay, bookingWindowDays
}
```

Update `HostJoin.meeting` to include:

```ts
location: { type: string; value?: string; instructions?: string }
```

- [ ] **Step 3: Add invitee form + submit handler in `BookingPicker.tsx`**

Make the following changes to `BookingPicker.tsx`:

3a. Add new imports / types:

```tsx
import { useRouter } from 'next/navigation'
import { createBooking } from './actions'
```

3b. Add new state inside the component (above the calendar JSX):

```tsx
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [phase, setPhase] = useState<'pick' | 'form' | 'submitting'>('pick')
  const [formError, setFormError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const router = useRouter()
```

3c. Replace the slot `<button>` `onClick={...}` (currently empty) so it stores the slot and switches phases:

```tsx
<button
  type="button"
  onClick={() => { setSelectedSlot(s); setPhase('form') }}
  className="w-full rounded border border-blue-600 px-3 py-2 text-sm text-blue-700 hover:bg-blue-600 hover:text-white"
>
  {formatInTimeZone(s.startUtc, inviteeTz, 'h:mm a')}
</button>
```

3d. Add a form panel that replaces the slot list when `phase === 'form' || phase === 'submitting'`. Conditionally render:

```tsx
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
          // refetch this month
          const start = startOfMonthUtc(monthCursor, hostTimezone)
          const end = endOfMonthUtc(monthCursor, hostTimezone)
          const refresh = await getAvailability(username, slug, start.toISOString(), end.toISOString())
          if (refresh.ok) setSlotsByDate(refresh.slotsByDate)
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
      })()
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
) : (
  /* existing slot list block goes inside the else branch */
)}
```

Place the existing "selectedDate ? slot list : 'pick a date'" block inside the `: ( ... )` branch above. The form replaces the slot list when in form/submitting phase.

- [ ] **Step 4: Manual smoke — happy path**

```bash
npm run dev
```

Visit `http://localhost:3000/<your-username>/<your-meeting-slug>`. Pick a date, pick a slot, fill the form (use your own email), click Confirm.

Expected: page navigates to `/{username}/{slug}/confirmed/<24-char-token>` (which 404s for now — that's fine; Task 11 builds it). Open Studio → Bookings → confirm the new doc exists with the right snapshot fields and a populated `bookingToken`.

- [ ] **Step 5: Manual smoke — concurrency**

In Studio, manually create a second booking with the **same** `_id` you just generated (or simulate by quickly opening two browser tabs and confirming both with the same slot — the second submit must show "Sorry, that time was just booked" error and refetch).

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/\[username\]/\[slug\]/actions.ts app/\(app\)/\[username\]/\[slug\]/BookingPicker.tsx
git commit -m "feat(booking): createBooking action and invitee form"
```

---

## Task 11: Confirmation page + cancel button + `cancelBooking` action

**Files:**
- Modify: `app/(app)/[username]/[slug]/actions.ts`
- Create: `app/(app)/[username]/[slug]/confirmed/[bookingId]/page.tsx`
- Create: `app/(app)/[username]/[slug]/confirmed/[bookingId]/CancelButton.tsx`

- [ ] **Step 1: Add `cancelBooking` to `actions.ts`**

Append (no new imports needed — `cancelBooking` doesn't revalidate; `router.refresh()` from the client triggers re-fetch of the confirmation page's server component):

```ts
export type CancelBookingResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'already_cancelled' | 'past_booking' | 'unknown' }

export async function cancelBooking(bookingToken: string): Promise<CancelBookingResult> {
  try {
    if (!bookingToken || bookingToken.length < 20 || bookingToken.length > 40) {
      return { ok: false, error: 'not_found' }
    }
    const doc = await serverClient.fetch<{
      _id: string
      status: string
      startTime: string
      hostUsernameSnapshot: string
      meetingTitleSnapshot: string
    } | null>(
      `*[_type == "bookingType" && bookingToken == $token][0]{
        _id, status, startTime, hostUsernameSnapshot, meetingTitleSnapshot
      }`,
      { token: bookingToken },
    )
    if (!doc) return { ok: false, error: 'not_found' }
    if (doc.status !== 'confirmed') return { ok: false, error: 'already_cancelled' }
    if (Date.parse(doc.startTime) < Date.now()) return { ok: false, error: 'past_booking' }

    await serverClient
      .patch(doc._id)
      .set({
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        cancellationReason: 'Cancelled by invitee',
      })
      .commit()

    return { ok: true }
  } catch (err) {
    console.error('cancelBooking failed:', err)
    return { ok: false, error: 'unknown' }
  }
}
```

- [ ] **Step 2: Create the confirmation page**

`app/(app)/[username]/[slug]/confirmed/[bookingId]/page.tsx`:

```tsx
import 'server-only'
import { notFound } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'

import { serverClient } from '@/sanity/lib/serverClient'
import CancelButton from './CancelButton'

interface PageProps {
  params: Promise<{ username: string; slug: string; bookingId: string }>
}

interface BookingView {
  _id: string
  status: 'confirmed' | 'cancelled' | 'rescheduled'
  startTime: string
  endTime: string
  inviteeTimezone: string
  inviteeName: string
  inviteeEmail: string
  meetingTitleSnapshot: string
  meetingDurationSnapshot: number
  hostNameSnapshot: string
  hostUsernameSnapshot: string
  locationSnapshot: { type: string; value?: string; instructions?: string }
  cancelledAt: string | null
  bookingToken: string
}

const BOOKING_QUERY = `
*[_type == "bookingType" && bookingToken == $token][0]{
  _id, status, startTime, endTime, inviteeTimezone,
  inviteeName, inviteeEmail,
  meetingTitleSnapshot, meetingDurationSnapshot,
  hostNameSnapshot, hostUsernameSnapshot, locationSnapshot,
  cancelledAt, bookingToken
}
`

export default async function ConfirmedPage({ params }: PageProps) {
  const { username, bookingId } = await params
  const data = await serverClient.fetch<BookingView | null>(BOOKING_QUERY, { token: bookingId })
  if (!data) notFound()

  // Defense: URL-spliced username must match the snapshot.
  if (data.hostUsernameSnapshot !== username) notFound()

  const isCancelled = data.status !== 'confirmed'
  const isPast = Date.parse(data.startTime) < Date.now()
  const startLocal = formatInTimeZone(data.startTime, data.inviteeTimezone, 'EEE MMM d, yyyy · h:mm a')
  const endLocal = formatInTimeZone(data.endTime, data.inviteeTimezone, 'h:mm a')

  return (
    <main className="mx-auto max-w-md p-6">
      {isCancelled ? (
        <h1 className="text-xl font-medium text-gray-500">✕ This booking was cancelled</h1>
      ) : (
        <h1 className="text-xl font-medium text-green-700">✓ You're booked</h1>
      )}

      <div className="mt-4 rounded border border-gray-200 p-4 text-sm">
        <p className="font-medium">{data.meetingTitleSnapshot}</p>
        <p className="text-gray-600">
          {startLocal} – {endLocal} ({data.inviteeTimezone})
        </p>
        <p className="text-gray-600">
          {data.hostNameSnapshot} · {data.locationSnapshot.type}
        </p>
        <p className="mt-3 text-gray-500">For: {data.inviteeEmail}</p>
      </div>

      {!isCancelled && !isPast ? (
        <div className="mt-4">
          <CancelButton bookingToken={data.bookingToken} />
        </div>
      ) : null}

      {isPast && !isCancelled ? (
        <p className="mt-4 text-sm text-gray-500">This meeting has already taken place.</p>
      ) : null}
    </main>
  )
}
```

- [ ] **Step 3: Create the cancel button**

`app/(app)/[username]/[slug]/confirmed/[bookingId]/CancelButton.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { cancelBooking } from '../../actions'

export default function CancelButton({ bookingToken }: { bookingToken: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const onClick = () => {
    setError(null)
    startTransition(async () => {
      const result = await cancelBooking(bookingToken)
      if (result.ok || result.error === 'already_cancelled') {
        router.refresh()
      } else if (result.error === 'past_booking') {
        setError('Cannot cancel — meeting has already started.')
      } else if (result.error === 'not_found') {
        setError('Booking not found.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    })
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? 'Cancelling…' : 'Cancel booking'}
      </button>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </div>
  )
}
```

- [ ] **Step 4: Manual smoke — confirmation + cancellation**

```bash
npm run dev
```

1. Take the booking token URL from Task 10 (or make a new booking) → visit `/{username}/{slug}/confirmed/<token>`.
   Expected: receipt renders with the right invitee name, email, and time in invitee tz.
2. Click "Cancel booking".
   Expected: page re-renders showing "✕ This booking was cancelled" and the Cancel button is gone.
3. Reload the cancelled page.
   Expected: still shows cancelled state.
4. Click cancel a second time before the page reloads (race) — should be safe (already-cancelled is treated as success in the UI).
5. Confirm in Studio → Bookings: status is `cancelled`, `cancelledAt` populated, `cancellationReason` is "Cancelled by invitee".

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/\[username\]/\[slug\]/actions.ts app/\(app\)/\[username\]/\[slug\]/confirmed/\[bookingId\]/page.tsx app/\(app\)/\[username\]/\[slug\]/confirmed/\[bookingId\]/CancelButton.tsx
git commit -m "feat(booking): confirmation page and cancellation"
```

---

## Task 12: Polish — empty/loading states, mobile responsive, end-to-end smoke, build check

**Files:**
- Modify: `app/(app)/[username]/[slug]/BookingPicker.tsx`
- (No new files)

- [ ] **Step 1: Add a "Nothing available this month" empty-state for the calendar column**

In `BookingPicker.tsx`, immediately after the calendar `<div className="mt-1 grid grid-cols-7 gap-1"> ... </div>` block, add:

```tsx
        {!pending && Object.keys(slotsByDate).length === 0 && !loadError ? (
          <p className="mt-3 text-sm text-gray-500">
            Nothing available this month — try{' '}
            <button
              type="button"
              className="text-blue-700 hover:underline"
              onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))}
            >
              next month →
            </button>
          </p>
        ) : null}
```

- [ ] **Step 2: Verify mobile layout**

The grid `md:grid-cols-[260px_1fr_220px]` already collapses to a single column on screens < 768px (Tailwind v4 default). Open dev tools → toggle device toolbar → set width to 375px → confirm meta, calendar, slots/form stack vertically.

```bash
npm run dev
```

Spot-check the booking flow on mobile width. Stop the server.

- [ ] **Step 3: Run the unit-test suite once more**

```bash
npm test
```

Expected: all generateSlots and freeBusy tests pass.

- [ ] **Step 4: Run the production build to catch type errors**

```bash
npm run build
```

Expected: build succeeds. If TypeScript reports errors, fix them and rerun.

- [ ] **Step 5: End-to-end smoke checklist**

Run `npm run dev`, then walk through every item:

1. Visit `/<your-username>/<your-meeting-slug>` → page loads, calendar renders.
2. Click a date → time slots appear in your local tz.
3. Click a slot → form appears, "← change time" returns to slots.
4. Submit form with your own email → redirected to `/confirmed/<token>`.
5. Confirmation page shows correct details. Click Cancel → re-renders cancelled.
6. Reload cancelled page → still cancelled.
7. Open the booking page in two tabs, fill the same slot in both, submit Tab 1 then Tab 2 → Tab 2 shows "Sorry, that time was just booked" and refreshes the slot list.
8. In Google Calendar, add a real event during a free slot, refresh the booking page → that slot disappears.
9. In Studio, toggle the meeting type to `active: false`, refresh `/{username}/{slug}` → 404. Toggle back.
10. Visit `/<your-username>/<garbage-slug>` and `/<garbage>/<anything>` → both 404.

Stop the dev server.

- [ ] **Step 6: Commit polish**

```bash
git add app/\(app\)/\[username\]/\[slug\]/BookingPicker.tsx
git commit -m "feat(booking): empty-state and mobile polish"
```

- [ ] **Step 7: Push and open PR**

```bash
git push -u origin feat/public-booking
gh pr create --title "feat(booking): public booking page (Spec 3)" --body "$(cat <<'EOF'
## Summary
- Public `/{username}/{slug}` booking page: calendar + slots + invitee form
- Pure subtractive slot engine (Sanity schedule − bookings − Google FreeBusy − notice/window cutoffs)
- Booking creation with deterministic Sanity `_id` + `createIfNotExists` for concurrency safety
- Confirmation page at `/{username}/{slug}/confirmed/{bookingToken}` with cancel button

Spec: docs/superpowers/specs/2026-05-01-public-booking-page-design.md

## Test plan
- [ ] `npm test` — unit tests for `generateSlots` and `freeBusy`
- [ ] `npm run build` — production build clean
- [ ] Manual e2e: book, confirm, cancel, race two tabs, conflict with real Google event
- [ ] 404 for invalid username / slug / inactive meeting

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed in stdout.

---

## Summary

12 tasks, ~70 commits' worth of work across 13 new files and 2 modified files. The slot engine is the riskiest part and is fully unit-tested. The booking creation flow uses a deterministic Sanity `_id` plus `createIfNotExists` to make concurrent submissions safe. Public routes never call Clerk auth; `bookingToken` (nanoid 24, ~143 bits) is the cancellation credential.
