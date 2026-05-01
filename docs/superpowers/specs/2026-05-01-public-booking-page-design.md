# Public Booking Page — Design (Spec 3)

**Status:** Brainstormed and approved 2026-05-01. Ready for implementation planning.
**Branch target:** new branch off `master` once Spec 2 (`feat/google-calendar-oauth`) is merged.
**Predecessor specs:** Spec 1 (`/availability` Sanity wiring, PR #9, merged), Spec 2 (Google Calendar OAuth connection, branch `feat/google-calendar-oauth`).

## Goal

Ship a public booking page at `/{username}/{slug}` where an invitee can pick a time and book a meeting. Slots reflect the host's weekly schedule (Sanity), existing confirmed bookings (Sanity), and the host's Google Calendar busy times (Google FreeBusy API). Booking creates a `bookingType` doc and redirects to a unique confirmation page that doubles as a cancellation receipt.

## Scope

### In scope (Spec 3)

- Public route `/{username}/{slug}` with the Calendly-classic two-column layout (meta · calendar · slots → form).
- Pure slot-generation engine that subtracts existing bookings, Google busy intervals, minimum-notice cutoff, and booking-window cutoff from the host's weekly schedule.
- Server actions for slot fetching, booking creation, and cancellation.
- Public confirmation route `/{username}/{slug}/confirmed/{bookingToken}` showing booking details and a Cancel button.
- Concurrency safety via deterministic Sanity `_id` per (host, slot) plus pre-write slot re-validation.
- Mobile-responsive layout (single column on small screens).

### Out of scope (deferred to later specs)

- **Spec 4 — Meetings dashboard.** Authenticated host view of all their bookings with filters, statuses, etc.
- **Spec 5 — Google Calendar event writing + email notifications.** Auto-create event on host's Google Calendar after booking; send confirmation/cancellation emails to invitee and host. Includes Zoom auto-link generation.
- **Spec 6 — Reschedule flow.** UI for invitee to reschedule (the `bookingType.rescheduledTo` schema field exists but is unused in Spec 3).
- Meeting-type CRUD UI in the admin app — for v1, the host creates meeting types directly in `/studio`. Promote to its own spec when multi-host support lands.
- `/{username}` host profile page — for v1, only `/{username}/{slug}` is reachable.
- Cancellation reason textarea — Spec 3 hardcodes `cancellationReason: 'Cancelled by invitee'`.

## Architecture overview

### Routes

All under `app/(app)/` (per the project's `(admin)`/`(app)` folder convention — public pages live in `(app)`):

```
[username]/
  [slug]/
    page.tsx                        ← server shell: fetch + render
    actions.ts                      ← server actions
    BookingPicker.tsx               ← client: calendar + slots + form
    confirmed/
      [bookingId]/
        page.tsx                    ← server: receipt + cancel
        CancelButton.tsx            ← client: calls cancelBooking
```

### Server modules

```
lib/booking/
  generateSlots.ts                  ← pure function (no I/O, no clock)
  generateSlots.test.ts             ← unit tests with hand-crafted fixtures
  freeBusy.ts                       ← Google FreeBusy API wrapper, server-only
                                      Input: access token + calendar IDs + time range
                                      Output: merged BusyInterval[] (flattened across all calendars)
  types.ts                          ← shared Slot / GenerateSlotsInput types
```

### Server actions (in `app/(app)/[username]/[slug]/actions.ts`)

- `getAvailability(username, slug, monthStartUtc, monthEndUtc, inviteeTz)` → `{ slotsByDate: Record<string, Slot[]> }`. Called by client on mount and on month change. Internally fetches existing bookings (Sanity) + busy intervals (Google FreeBusy), then runs `generateSlots` over the range.
- `createBooking(input)` → `{ ok: true; bookingToken } | { ok: false; error }`. Re-validates the slot, writes the doc with deterministic `_id`, returns the public token.
- `cancelBooking(bookingToken)` → `{ ok: true } | { ok: false; error }`. Idempotent.

### External dependencies to add

- `date-fns` + `date-fns-tz` — IANA-aware date math (zoned-time conversions, DST handling). The project currently has no date library.
- `nanoid` — unguessable booking tokens.

### Trust boundaries

Public routes have no Clerk auth. Defense in depth:

1. The route resolves only if `(username, slug)` maps to a published `meetingType` with `active: true`. Otherwise `notFound()`.
2. `createBooking` re-runs the slot engine server-side; client-supplied slot must still be available.
3. Sanity `_id = booking.${hostClerkId}.${startEpochMs}` provides atomic per-slot uniqueness via `createIfNotExists`.
4. The `bookingToken` (nanoid, 24 chars, ~143 bits entropy) is the only credential for cancellation. Acceptable because the URL is only known to the invitee (and host via Studio).

## Data model

**No new schemas.** The existing `userType`, `meetingType`, `availabilityType`, and `bookingType` schemas already cover everything Spec 3 needs. Spec 3 *adds one field* to `bookingType`:

- `bookingToken` (string, required, unique, indexed) — the public URL token. Generated server-side via `nanoid(24)`.

The Sanity `_id` for each booking is `booking.${hostClerkId}.${startEpochMs}` — internal, never exposed in URLs.

### Snapshot fields used (already in schema)

The booking creation flow populates all five snapshot fields so the confirmation page renders correctly even if the host later edits or deletes the meeting type:

- `meetingTitleSnapshot`
- `meetingDurationSnapshot`
- `hostNameSnapshot`
- `hostUsernameSnapshot`
- `locationSnapshot` (entire `location` object: `type`, `value`, `instructions`)

## Slot generation engine

### Function signature

```ts
// lib/booking/generateSlots.ts
import 'server-only'

export interface ScheduleInput {
  timezone: string                  // IANA, e.g. 'America/Los_Angeles'
  weeklySchedule: DaySchedule[]     // 7 entries, one per day
  minimumNotice: number             // base default, in minutes
  bufferBefore: number              // base default, in minutes
  bufferAfter: number               // base default, in minutes
}

export interface MeetingInput {
  duration: number                  // minutes
  bufferBefore?: number             // override (else fall back to schedule)
  bufferAfter?: number              // override
  minimumNotice?: number            // override
  maxBookingsPerDay?: number        // optional cap
  bookingWindowDays: number         // furthest into future allowed
}

export interface BusyInterval {
  startUtc: string                  // ISO
  endUtc: string                    // ISO
}

export interface GenerateSlotsInput {
  schedule: ScheduleInput
  meeting: MeetingInput
  existingBookings: BusyInterval[]  // status='confirmed' bookings for this host in range
  busyIntervals: BusyInterval[]     // pre-merged busy times from calendars with conflictCheck=true; empty if no connection
  now: Date                         // injected — never call Date.now() inside
  rangeStart: Date                  // start of date range (UTC)
  rangeEnd: Date                    // end of date range (UTC)
}

export interface Slot {
  startUtc: string                  // ISO
  endUtc: string                    // ISO
}

export function generateSlots(input: GenerateSlotsInput): Slot[]
```

### Algorithm

For each calendar date `d` in `[rangeStart, rangeEnd]` (computed in `schedule.timezone`):

1. **Build candidate windows.** Look up `weeklySchedule[weekday(d)]`. If `enabled === false` or `intervals.length === 0` → skip the date. For each interval `{start: 'HH:MM', end: 'HH:MM'}`, convert to UTC `Date` pairs using `zonedTimeToUtc(d + start, schedule.timezone)`.
2. **Apply `maxBookingsPerDay`.** If set and the number of `existingBookings` whose `startUtc` falls on date `d` (host tz) is ≥ `maxBookingsPerDay`, skip the date.
3. **Subtract existing bookings, with buffers.** For each existing booking `b`, compute its blocked interval as `[b.startUtc - effectiveBufferBefore, b.endUtc + effectiveBufferAfter]` where `effectiveBufferBefore = meeting.bufferBefore ?? schedule.bufferBefore` and likewise for after. Remove overlap from each candidate window (split a window if the busy block lies inside it).
4. **Subtract Google busy intervals.** Same overlap-removal, **no buffer math** — busy is busy. Empty array → no-op. The caller is responsible for filtering the host's `googleCalendarConnectionType.calendars` to only those with `conflictCheck === true`, querying Google FreeBusy with that filtered calendar-ID list, and passing the merged busy intervals here. The engine itself receives only the result.
5. **Subtract minimum-notice cutoff.** Compute `cutoff = now + (meeting.minimumNotice ?? schedule.minimumNotice) * 60_000`. Trim or drop windows that end at or before `cutoff`; trim windows that start before `cutoff` to start at `cutoff`.
6. **Subtract booking-window cutoff.** Compute `windowEnd = now + meeting.bookingWindowDays * 86_400_000`. Drop windows starting after `windowEnd`.
7. **Slice into discrete slots.** Walk each remaining window in `meeting.duration`-minute steps starting at `window.start`. Emit a slot `{ startUtc, endUtc: startUtc + duration }` only if `endUtc + effectiveBufferAfter ≤ window.end`. Granularity = duration (a 30-min meeting yields slots every 30 min; a 60-min meeting every 60 min).

Output is a sorted array of UTC ISO slot pairs. The engine never formats for display — formatting happens in the React component using the invitee's tz.

### Edge cases

- **DST transitions** are handled correctly by `date-fns-tz`'s `zonedTimeToUtc`. Spring-forward "missing hour" produces no slots there; fall-back "duplicate hour" produces both UTC instants.
- **Midnight-crossing intervals** (e.g. host works 22:00–02:00) are not allowed by the existing `daySchedule` schema (`timeInterval` validates start < end). Documented as a known v1 limitation.
- **Empty Google connection.** If the host has no `gcal.{clerkId}` doc OR the doc has no calendars with `conflictCheck: true`, `busyIntervals` is `[]` and step 4 is a no-op. The engine doesn't care; the action layer decides whether to call FreeBusy at all.
- **Revoked Google refresh token.** `getValidAccessToken` throws `GoogleConnectionRevokedError` (Spec 2). The action catches this, logs it, and proceeds with `busyIntervals: []` — slot list is wider than reality but no booking failure for the invitee. Host needs to reconnect (visible on `/availability` Calendar tab).

## Booking page UI

### Server shell (`app/(app)/[username]/[slug]/page.tsx`)

Single GROQ join:

```ts
*[_type == "userType" && username.current == $username][0]{
  _id, displayName, avatarUrl, bio, welcomeMessage, timezone, clerkId,
  "meeting": *[_type == "meetingType" && host._ref == ^._id && slug.current == $slug && active == true][0]{
    _id, title, description, duration, location, color,
    bufferBefore, bufferAfter, minimumNotice, maxBookingsPerDay, bookingWindowDays
  },
  "availability": *[_type == "availabilityType" && user._ref == ^._id][0]{
    timezone, weeklySchedule, minimumNotice, bufferBefore, bufferAfter
  }
}
```

If `host`, `meeting`, or `availability` is null → `notFound()`. The Google connection doc is fetched lazily inside `getAvailability` only when needed.

### Client (`BookingPicker.tsx`)

State (5 pieces):

```ts
const [monthCursor, setMonthCursor] = useState<Date>(today)
const [selectedDate, setSelectedDate] = useState<string | null>(null)
const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
const [availability, setAvailability] = useState<{ slotsByDate: Record<string, Slot[]> }>({ slotsByDate: {} })
const [phase, setPhase] = useState<'pick' | 'form' | 'submitting'>('pick')
```

On mount: detect invitee tz via `Intl.DateTimeFormat().resolvedOptions().timeZone`, call `getAvailability(...)` with the current month range. The action fetches bookings + Google FreeBusy + runs `generateSlots`, returns one month of slots indexed by date.

On month change: re-call `getAvailability` for the new range.

On date click: read `availability.slotsByDate[selectedDate]` (already in memory, no network).

On slot click: set `selectedSlot`, `phase = 'form'` — right column swaps to invitee form.

On form submit: `phase = 'submitting'`, call `createBooking`. On success, `router.push('/{username}/{slug}/confirmed/{bookingToken}')`.

### Layout

Tailwind responsive. Mobile (default) = stacked vertically: meta → calendar → slots → form. `md:` breakpoint (≥768px) = three-column flex. Left meta sticky on desktop; flows inline on mobile.

### Loading and empty states

- `getAvailability` in flight: skeleton on slot column; calendar shows previously-loaded month muted.
- Date selected but `slotsByDate[date]` empty: "No times available for this date. Try another."
- Whole month with zero bookable dates: "Nothing available this month →" with a Next button.
- Clearly disabled days in the calendar: in the past, beyond `bookingWindowDays`, or `slotsByDate[date]` is empty.

### 404 / 410 behaviour

`meeting.active === false` and "username doesn't exist" both return the same 404. Don't enumerate "this used to exist".

## Booking creation + concurrency

### Server action

```ts
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
```

### Steps

1. **Validate input.** Trim name, regex-validate email, length-cap notes (max 10 000 chars). Reject early.
2. **Re-fetch the join** (same GROQ as page shell). If host/meeting/availability missing or `active: false` → `not_found`.
3. **Re-run slot engine.** Fetch bookings + FreeBusy for `[startUtc, startUtc + duration]`, run `generateSlots`. If `startUtc` is not in result → `slot_taken`.
4. **Compute deterministic `_id`.** `_id = booking.${hostClerkId}.${startEpochMs}` (where `startEpochMs = new Date(startUtc).getTime()`).
5. **Generate `bookingToken`** = `nanoid(24)`.
6. **Build snapshots** from the join result.
7. **Compute `endTime`** = `startUtc + duration * 60_000`.
8. **Write via `createIfNotExists`.** If the resulting doc does NOT have our generated token (i.e., a competing booking won the race) → `slot_taken`. The competing booking owns the slot.
9. **Return `{ ok: true, bookingToken }`.** Client redirects.

### Concurrency strategy

Two checks:

- **Soft (step 3)** — slot engine re-validation catches anything that changed since the page loaded. Catches ~99% of races.
- **Hard (step 8)** — deterministic `_id` + `createIfNotExists` is atomic at the Sanity level. Catches the microsecond window between step 3 passing and step 8 committing.

### What we don't do (deliberately, in Spec 3)

- No email confirmation (Spec 5).
- No event written to host's Google Calendar (Spec 5).
- No webhook / Slack / SMS.
- No rate limiting on `createBooking` — the per-slot uniqueness already prevents abuse against the same slot. Cross-slot abuse can be mitigated at the edge layer later.

## Confirmation page + cancellation

### Route

`app/(app)/[username]/[slug]/confirmed/[bookingId]/page.tsx`. The `[bookingId]` segment is the **`bookingToken`** field, not the Sanity `_id`.

### Server fetch

```ts
*[_type == "bookingType" && bookingToken == $token][0]{
  _id, status, startTime, endTime, inviteeTimezone,
  meetingTitleSnapshot, meetingDurationSnapshot,
  hostNameSnapshot, hostUsernameSnapshot, locationSnapshot,
  inviteeName, inviteeEmail, cancelledAt
}
```

If null → `notFound()`. If `hostUsernameSnapshot` doesn't match URL `[username]` or the snapshot's meeting slug doesn't match URL `[slug]` → `notFound()` (defensive: prevents URL splicing).

### Page content

```
✓ You're booked

Tue May 5, 2026 · 3:30 PM – 4:00 PM (Asia/Istanbul)
Walaa Horani · 30 Min Intro · Zoom

For: walaa@example.com

[Cancel booking]
```

If `status === 'cancelled'`: replace ✓ with a gray "✕ This booking was cancelled" header and hide the cancel button. Otherwise render as above.

If `startTime < now`: show "This meeting has already taken place" and hide the cancel button.

### Cancellation flow

`CancelButton.tsx` (client) calls `cancelBooking(bookingToken)`:

1. Look up doc by token. If not found → `not_found`.
2. If `status !== 'confirmed'` → `already_cancelled` (idempotent — page just re-renders cancelled state).
3. If `startTime < now` → `past_booking`.
4. Patch: `status = 'cancelled'`, `cancelledAt = now.toISOString()`, `cancellationReason = 'Cancelled by invitee'`.
5. `revalidatePath('/{username}/{slug}/confirmed/{bookingToken}')`.
6. Return `{ ok: true }`.

### Security model (recap)

The `bookingToken` (nanoid 24 chars, ~143 bits entropy) is the only credential for cancellation. Acceptable because:

- Without email yet, only the invitee who just booked has the URL (host sees it in Studio).
- When email lands in Spec 5, the link is sent to the invitee's verified email.
- Token entropy is far above brute-force range.

## Errors and edge cases

| Scenario | Handling |
|----------|----------|
| Invitee picks a slot, host disables the meeting before submit | `createBooking` returns `not_found`; client shows "This event is no longer available" |
| Invitee picks a slot, another invitee books it first | `createBooking` returns `slot_taken`; client shows "Sorry, that slot was just taken — please pick another" and re-fetches availability |
| Host's Google refresh token revoked | `getValidAccessToken` throws; action logs and proceeds with `busyIntervals: []`. Slot list may be wider than reality. Host sees "revoked" banner on `/availability` Calendar tab and reconnects |
| Host has no Google connection | `busyIntervals: []`, no error, slot list reflects only Sanity bookings + schedule |
| Invitee's browser tz can't be detected | Fall back to `host.timezone` (rare; modern browsers always return one) |
| `username` exists but `slug` doesn't | `notFound()` |
| `slug` exists but `meeting.active === false` | Same `notFound()` (no enumeration leak) |
| Cancellation of a booking that already happened | `cancelBooking` returns `past_booking`; UI shows "Cannot cancel — meeting has already started" |
| Network failure during `createBooking` | Client shows generic error toast; user retries; deterministic `_id` makes retry safe (idempotent on success) |

## Testing strategy

### Unit tests

- `generateSlots.test.ts` — extensive, covering every step of the pipeline:
  - Empty schedule, single interval, multiple intervals
  - Buffer override behavior (meeting > schedule)
  - Existing booking exact match, overlap, before/after
  - Google busy overlap
  - DST forward and backward transitions
  - Minimum-notice cutoff at boundary
  - `maxBookingsPerDay` reached
  - Booking-window cutoff
  - Granularity = duration (30 min, 60 min, 15 min)
- `freeBusy.test.ts` — mocks `fetch`; verifies request shape and result parsing.

### Integration / smoke tests

Manual e2e checklist (since we have no test framework yet):

1. Visit `/{username}/{slug}` for a real published meeting type → calendar renders with bookable days highlighted.
2. Click a date → time slots load.
3. Click a time → form appears.
4. Submit form → redirected to `/confirmed/{token}` with correct details.
5. Click Cancel → page re-renders as cancelled.
6. Reload the cancelled page → still shows cancelled state.
7. Try to book the same slot in a second tab while the first is filling the form → second submission gets `slot_taken`.
8. Add a Google Calendar event during a slot, refresh the page → that slot disappears.
9. Disable the meeting type in Studio, refresh the page → 404.

## Out of scope (explicit)

To prevent scope creep, these are explicitly **not** in Spec 3 and have no half-built artifacts left in this branch:

- Email notifications (Spec 5)
- Event writing to host's Google Calendar (Spec 5)
- Zoom / Google Meet auto-link generation (Spec 5)
- Reschedule UI (Spec 6)
- Cancellation reason input
- Host notification of cancellation
- Public `/{username}` profile page
- Meeting-type CRUD UI
- Meetings dashboard for the host (Spec 4)
- Multi-host or org-level routing
- Custom branded confirmation pages
- Analytics / tracking of booking funnel

## Open questions

None — all resolved during brainstorm:

- **Scope:** Option B (booking + Google FreeBusy read).
- **Meeting type creation:** Studio-only.
- **Routes:** `/{username}/{slug}` only, no `/{username}` profile page.
- **Layout:** Calendly classic two-column.
- **Post-booking flow:** Confirmation route + cancel button.
- **Slot granularity:** equal to meeting duration.
- **Concurrency:** soft (re-validation) + hard (deterministic `_id` + `createIfNotExists`).
- **Token format:** `nanoid(24)` — ~143 bits entropy.
- **Date library:** `date-fns` + `date-fns-tz`.
