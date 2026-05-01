# /availability — Sanity wiring (Spec 1)

**Status:** Draft for review
**Date:** 2026-05-01
**Branch:** `feat/sanity-schemas-design`
**Predecessor spec:** [2026-04-28-sanity-schemas-design.md](./2026-04-28-sanity-schemas-design.md)
**Successor (deferred):** Google Calendar OAuth integration — its own spec, not this one.

## Goal

A signed-in host visits `/availability`, sees their saved weekly working hours and advanced settings (minimum notice, buffer before, buffer after), edits them, clicks Save, and the changes persist in Sanity across reloads.

## Non-goals

- Calendar settings tab (Google Calendar connect, conflict checks, "add to calendar"). Stays as static UI. Spec 2.
- Public host page `/{username}` and booking flow. Out of scope.
- Slot generation engine. Out of scope.
- Test runner setup (Jest / Vitest). Out of scope — verification is manual.
- Timezone picker UI. The displayed timezone is read-only for v1.
- Client-side validation duplicating the schema. Server-side validation is the source of truth.

## Architecture

Server Component shell + Client form + Server Actions.

```
app/(admin)/availability/
  page.tsx                  ← server component (rewritten)
  AvailabilityEditor.tsx    ← client component (new — holds existing JSX)
  actions.ts                ← server actions (new)
  types.ts                  ← shared form-state types (new, small)
```

- `page.tsx` drops `"use client"`, becomes `async`, calls `auth()`, ensures-or-fetches the `availabilityType` doc, renders `<AvailabilityEditor initialData={...} />`.
- `AvailabilityEditor.tsx` is the existing ~310-line client component lifted from `page.tsx` — same JSX, same framer-motion animations — receiving `initialData` from props instead of `useState(defaultSchedule)`.
- `actions.ts` exports two scoped server actions (`saveSchedules`, `saveAdvanced`) plus a one-shot `bootstrapTimezoneIfDefault`. All re-run `auth()`; client tokens are never trusted.

Why this shape: matches the rest of the repo (server-side gating in `(admin)/layout.tsx`, server-side write client in `sanity/lib/serverClient.ts`), avoids exposing the Sanity write token to the browser, gives initial render real data (no flash of "9–5 Mon–Fri" before hydration), and keeps the API surface to two server actions instead of an HTTP route.

## Document shape and `_id` strategy

One `availabilityType` doc per host, with deterministic `_id = availability.${clerkId}` mirroring how `userType` is keyed.

```ts
{
  _id: `availability.${clerkId}`,
  _type: 'availabilityType',
  user: { _type: 'reference', _ref: `user.${clerkId}` },
  timezone: 'UTC',                           // overwritten on first browser-detect
  weeklySchedule: [                          // 7 entries, Sun-first to match UI
    { _key: 'sun', day: 'sun', enabled: false, intervals: [{ _key: '...', start: '09:00', end: '17:00' }] },
    { _key: 'mon', day: 'mon', enabled: true,  intervals: [{ _key: '...', start: '09:00', end: '17:00' }] },
    { _key: 'tue', day: 'tue', enabled: true,  intervals: [{ _key: '...', start: '09:00', end: '17:00' }] },
    { _key: 'wed', day: 'wed', enabled: true,  intervals: [{ _key: '...', start: '09:00', end: '17:00' }] },
    { _key: 'thu', day: 'thu', enabled: true,  intervals: [{ _key: '...', start: '09:00', end: '17:00' }] },
    { _key: 'fri', day: 'fri', enabled: true,  intervals: [{ _key: '...', start: '09:00', end: '17:00' }] },
    { _key: 'sat', day: 'sat', enabled: false, intervals: [{ _key: '...', start: '09:00', end: '17:00' }] },
  ],
  minimumNotice: 240,
  bufferBefore: 0,
  bufferAfter: 0,
}
```

Notes:
- The `weeklySchedule` validation in [availabilityType.ts](../../../sanity/schemaTypes/documents/availabilityType.ts) requires all 7 day codes but is order-agnostic, so Sun-first matches the UI.
- `_key` on each `daySchedule` is the day code itself (`'sun' | 'mon' | …`) — stable and human-readable.
- `_key` on each interval is a generated id (`crypto.randomUUID()` or similar). Existing intervals retain their key across saves so framer-motion's `layoutId` stays stable through re-renders.
- `user` reference points to `user.${clerkId}`, which the Clerk webhook guarantees exists by the time the user can sign in and reach `/availability`.
- Disabled days keep their intervals on save (round-trips cleanly when toggled back on).

## Server flow

### Read path — `page.tsx`

```ts
const { userId: clerkId } = await auth()
if (!clerkId) redirect('/')

const id = `availability.${clerkId}`
let doc = await serverClient.getDocument<AvailabilityDoc>(id)
if (!doc) {
  doc = await serverClient.createIfNotExists({
    _id: id,
    _type: 'availabilityType',
    user: { _type: 'reference', _ref: `user.${clerkId}` },
    timezone: 'UTC',
    weeklySchedule: defaultSundayFirstSchedule(),
    minimumNotice: 240,
    bufferBefore: 0,
    bufferAfter: 0,
  })
}
return <AvailabilityEditor initialData={doc} />
```

`createIfNotExists` is idempotent — only writes once per user, ever. After that, the GET is a pure read.

`defaultSundayFirstSchedule()` lives server-side and is the single source of truth for new-user defaults: Mon–Fri enabled with `09:00–17:00`, Sat/Sun disabled with the same interval pre-populated.

### Write path — `actions.ts`

Two scoped server actions:

```ts
'use server'

export async function saveSchedules(input: {
  weeklySchedule: DaySchedule[]
  timezone: string
}): Promise<{ ok: true } | { ok: false; error: string }>

export async function saveAdvanced(input: {
  minimumNotice: number
  bufferBefore: number
  bufferAfter: number
}): Promise<{ ok: true } | { ok: false; error: string }>
```

Both:
1. Re-run `auth()` and resolve `id = availability.${clerkId}`. Throw if unauthenticated.
2. Run `serverClient.patch(id).set({...}).commit()`, scoped to that tab's fields.
3. Wrap the commit in `try/catch`; on failure return `{ ok: false, error: <schema validation message string> }`.
4. On success call `revalidatePath('/availability')` and return `{ ok: true }`.

### Timezone bootstrap — `actions.ts`

```ts
export async function bootstrapTimezoneIfDefault(detected: string): Promise<void>
```

Patches only the `timezone` field, and only if the doc currently has `timezone === 'UTC'`. Idempotent — subsequent visits skip it (the editor's `useEffect` checks the local timezone state before calling).

## Client editor behavior — `AvailabilityEditor.tsx`

The existing JSX from `page.tsx` is lifted wholesale. Behavioral changes:

**State init from props.**
```ts
const [weeklySchedule, setWeeklySchedule] = useState(initialData.weeklySchedule)
const [timezone, setTimezone] = useState(initialData.timezone)
const [minimumNotice, setMinimumNotice] = useState(initialData.minimumNotice)
const [bufferBefore, setBufferBefore] = useState(initialData.bufferBefore)
const [bufferAfter, setBufferAfter] = useState(initialData.bufferAfter)
```

The hardcoded `defaultSchedule` constant in `page.tsx` is removed. Defaults live only in `defaultSundayFirstSchedule()` server-side.

**Per-tab dirty tracking.** Two refs (`schedulesSnapshotRef`, `advancedSnapshotRef`) hold the last-saved values. `isSchedulesDirty` / `isAdvancedDirty` are derived via deep-equal against those refs. Save buttons are disabled when not dirty.

**Save buttons.**
- Pending: button disabled, `Check` icon swapped for a small spinner, label stays "Save changes."
- Success: small inline "Saved" pill next to the button, auto-dismisses after ~2s; snapshot ref updated; button returns to disabled-because-not-dirty.
- Error: error string rendered in red below the button; form stays dirty for retry.

No optimistic updates, no toast library — local state is enough. No "you have unsaved changes" navigation guard for v1.

**Trash button on last interval.** Hidden when `dayItem.intervals.length === 1`. Adding intervals via `+` is unchanged.

**Disabled-day intervals.** Persisted on save as the user left them. No stripping.

**Timezone display.** The static `<span>Pacific Time - US & Canada</span>` becomes `{timezone}` (read-only label).

**Timezone bootstrap.**
```tsx
useEffect(() => {
  if (timezone !== 'UTC') return
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (!detected || detected === 'UTC') return
  bootstrapTimezoneIfDefault(detected).then(() => setTimezone(detected))
}, [])
```
Fires at most once per user, ever.

**Calendar settings tab.** Untouched. Static UI. Out of scope.

**Advanced tab.** Three `<select>`s instead of the current two:
- Minimum Notice — values `240 / 720 / 1440 / 2880` (labels: 4h / 12h / 24h / 48h).
- Buffer before — values `0 / 15 / 30 / 60` (labels: 0min / 15min / 30min / 1h).
- Buffer after  — values `0 / 15 / 30 / 60`.

## Data validation

Server-side via the existing schema. No client-side duplication.

The schema already enforces:
- HH:mm 24-hour format on `start` and `end` ([timeInterval.ts](../../../sanity/schemaTypes/objects/timeInterval.ts)).
- `end > start` per interval.
- Ascending non-overlapping intervals per day ([daySchedule.ts](../../../sanity/schemaTypes/objects/daySchedule.ts)).
- At least one interval when a day is `enabled` ([daySchedule.ts](../../../sanity/schemaTypes/objects/daySchedule.ts)).
- All 7 day codes present, no duplicates ([availabilityType.ts](../../../sanity/schemaTypes/documents/availabilityType.ts)).
- Non-negative integer minimumNotice / bufferBefore / bufferAfter.

The browser's `<input type="time">` already enforces HH:mm. The "hide trash on last interval" rule prevents reaching the "enabled day with 0 intervals" invalid state. So in practice the only schema rejection a real user could hit is overlapping/out-of-order intervals if they manually pick bad times — those errors surface inline below the Save button.

## Verification plan

Manual end-to-end on dev server and Vercel preview. No automated tests in this spec.

1. **First visit as a brand-new user**
   - Sign up via Clerk → land on `/availability` → page renders with Mon–Fri 9–17 enabled, Sat/Sun off, timezone label flips from "UTC" to detected zone within ~1s.
   - Sanity Studio → exactly one new `availabilityType` doc exists with `_id = availability.${clerkId}`.

2. **Schedule round-trip**
   - Toggle Wednesday off → Save → reload → Wednesday still off, intervals preserved.
   - Add a second interval to Tuesday (09:00–12:00 + 13:00–17:00) → Save → reload → both intervals in order.

3. **Advanced settings round-trip**
   - Advanced tab → set Minimum Notice = 24h, Buffer before = 15, Buffer after = 30 → Save → reload → values still selected.

4. **Validation surfacing**
   - The "enabled day with 0 intervals" path is unreachable (trash hidden on last interval).
   - If schema rejects anything (e.g., manually overlapping intervals), error string renders in red below the active tab's Save button.

5. **Per-tab save isolation**
   - Edit Schedules without saving → switch to Advanced → edit Advanced → save Advanced → reload → Schedules edits gone (never saved), Advanced edits persisted.

6. **Auth gate**
   - Signed out → visit `/availability` → redirected to `/` (already enforced by `(admin)/layout.tsx`).

7. **Idempotency**
   - Hard-refresh 5×; still exactly one `availabilityType` doc in Sanity.

## Risks and mitigations

- **Side effect on a GET (`createIfNotExists` from page.tsx).** Mitigated because `createIfNotExists` is itself idempotent — only the very first GET per user writes; subsequent GETs are pure reads.
- **Stale snapshot after revalidate.** `revalidatePath('/availability')` invalidates the server-side cache. The client retains its own state during the session — that's intentional; reloads pull fresh server data.
- **Framer-motion key churn on save.** Mitigated by stable `_key`s — day keys are day codes, interval keys are preserved across edits and only generated for newly added intervals.
- **Timezone bootstrap fires for users in a UTC zone.** The `detected === 'UTC'` short-circuit avoids a no-op write. Users genuinely in UTC keep `'UTC'`, which is correct.

## Out-of-scope follow-ups (separate specs)

- **Spec 2 — Google Calendar OAuth + Calendar settings tab wiring.** OAuth flow, token storage, calendar list / busy-time fetch, write-target selection, conflict integration. Tracked separately.
- Timezone picker dropdown.
- Profile editor for `userType.timezone` / `displayName` / `bio` / `welcomeMessage`.
- Asymmetric vs. symmetric buffer UX iteration (we matched schema 1:1; product can refine later).
- Automated test setup.
