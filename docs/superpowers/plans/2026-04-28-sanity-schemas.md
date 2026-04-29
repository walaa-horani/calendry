# Sanity SchemaTypes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the four Sanity document types (`userType`, `availabilityType`, `meetingType`, `bookingType`) and three custom-object types (`timeInterval`, `daySchedule`, `location`) defined in [the design spec](../specs/2026-04-28-sanity-schemas-design.md), wire them into Studio, and verify with a Studio smoke test.

**Architecture:** Strict-typed Sanity v5 schemas using `defineType` / `defineField` / `defineArrayMember` helpers. Documents under `sanity/schemaTypes/documents/`, custom objects under `sanity/schemaTypes/objects/`. `index.ts` registers all seven types. `structure.ts` groups documents in the Studio sidebar. Validation is enforced at field level (regex, ranges) and via async custom validators for cross-document uniqueness (username globally, `meetingType.slug` per host).

**Tech Stack:** `sanity@^5.22.0`, `next-sanity@^12.3.1`, Next.js 16, TypeScript 5, pnpm. Sanity API version `2026-04-27` (from `sanity/env.ts`).

**Why no unit tests:** Sanity schemas are configuration; the project has no test runner installed and adding one is out of scope. Verification is `tsc --noEmit` (compile check) plus a manual Studio smoke test that exercises every schema and validator. This is the standard approach for Sanity schema work.

---

## File Map

**New files (7):**
- `sanity/schemaTypes/objects/timeInterval.ts` — recurring local-time window (`HH:mm` strings)
- `sanity/schemaTypes/objects/daySchedule.ts` — one weekday's intervals; uses `timeInterval`
- `sanity/schemaTypes/objects/location.ts` — meeting location (zoom / meet / phone / in-person / custom URL)
- `sanity/schemaTypes/documents/userType.ts` — host profile, joined to Clerk
- `sanity/schemaTypes/documents/availabilityType.ts` — weekly schedule per user; uses `daySchedule`
- `sanity/schemaTypes/documents/meetingType.ts` — bookable event type; uses `location`; per-host slug uniqueness
- `sanity/schemaTypes/documents/bookingType.ts` — confirmed booking; refs + snapshots; uses `location`

**Modified files (2):**
- `sanity/schemaTypes/index.ts` — replace dangling identifiers with real imports
- `sanity/structure.ts` — group docs in sidebar (Hosts / Schedules / Event types / Bookings)

**Object dependency order (must be created in this order):** `timeInterval` → `daySchedule` → `location` → `userType` → `availabilityType` (refs userType) → `meetingType` (refs userType, uses location) → `bookingType` (refs userType + meetingType, uses location).

---

### Task 0: Pre-flight — verify environment

**Files:** none modified.

- [ ] **Step 1: Confirm working tree and branch**

Run: `git status --short && git rev-parse --abbrev-ref HEAD`

Expected: branch is `feat/sanity-schemas-design`. Working tree may show pre-existing modifications (`app/globals.css`, `app/page.tsx` deletion, `package.json`, `pnpm-lock.yaml`, `sanity/schemaTypes/index.ts`) and many untracked files under `app/(app)/`, `app/components/`, `components/`, `hooks/`. **Do not stage or revert these.** They predate this work.

- [ ] **Step 2: Confirm pnpm is installed and dependencies resolve**

Run: `pnpm --version`

Expected: prints a version like `9.x` or `10.x`. If the command fails, install pnpm first: `npm install -g pnpm`.

Run: `pnpm install`

Expected: completes without errors. If it warns about peer-dependency mismatches but exits 0, that is fine.

- [ ] **Step 3: Confirm the TypeScript compiler runs against the project**

Run: `pnpm exec tsc --noEmit`

Expected: succeeds with no errors **OR** errors **only** in files that are pre-existing (e.g., `sanity/schemaTypes/index.ts` complaining about `userType is not defined` — that's the file we are about to fix; ignore it for now).

If errors appear in *other* files (e.g., `components/ui/sidebar.tsx`), capture them and report — they may indicate a broken dependency install. Do not proceed until the only outstanding error is the expected `index.ts` one.

- [ ] **Step 4: Confirm the Sanity Studio route exists**

Run: `cat app/studio/\[\[...tool\]\]/page.tsx`

Expected: a one-liner that re-exports the Studio component (`NextStudio` from `next-sanity/studio`). Do not modify it.

- [ ] **Step 5: Read the spec end-to-end**

Read [`docs/superpowers/specs/2026-04-28-sanity-schemas-design.md`](../specs/2026-04-28-sanity-schemas-design.md) once before starting Task 1. This plan inlines the relevant decisions but the spec is the source of truth.

- [ ] **Step 6: Commit nothing — pre-flight is read-only**

No commit for this task.

---

### Task 1: Create `timeInterval` custom object

**Files:**
- Create: `sanity/schemaTypes/objects/timeInterval.ts`

A reusable object representing one bookable window within a day, e.g. `09:00–12:00`. Used inside `daySchedule.intervals`.

- [ ] **Step 1: Create the file with full content**

Create `sanity/schemaTypes/objects/timeInterval.ts`:

```typescript
import { defineType, defineField } from 'sanity'

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/

export const timeInterval = defineType({
  name: 'timeInterval',
  title: 'Time interval',
  type: 'object',
  fields: [
    defineField({
      name: 'start',
      title: 'Start (HH:mm)',
      type: 'string',
      validation: (rule) =>
        rule
          .required()
          .regex(TIME_REGEX, { name: 'HH:mm' })
          .error('Use HH:mm 24-hour format, e.g. 09:00'),
    }),
    defineField({
      name: 'end',
      title: 'End (HH:mm)',
      type: 'string',
      validation: (rule) =>
        rule
          .required()
          .regex(TIME_REGEX, { name: 'HH:mm' })
          .custom((end, context) => {
            const parent = context.parent as { start?: string } | undefined
            const start = parent?.start
            if (!start || !end) return true
            return end > start || 'End time must be after start time'
          }),
    }),
  ],
  preview: {
    select: { start: 'start', end: 'end' },
    prepare: ({ start, end }) => ({
      title: `${start ?? '??:??'} – ${end ?? '??:??'}`,
    }),
  },
})
```

- [ ] **Step 2: Verify it compiles in isolation**

Run: `pnpm exec tsc --noEmit`

Expected: same expected outcome as Task 0 Step 3 — only the `index.ts` "name not defined" error, nothing new.

If a new error appears in `objects/timeInterval.ts`, fix it before continuing. Common mistake: forgetting to `import { defineType, defineField } from 'sanity'`.

- [ ] **Step 3: Commit**

```bash
git add sanity/schemaTypes/objects/timeInterval.ts
git commit -m "feat(sanity): add timeInterval object schema"
```

---

### Task 2: Create `daySchedule` custom object

**Files:**
- Create: `sanity/schemaTypes/objects/daySchedule.ts`

One weekday's availability — a day enum, an enabled toggle, and an array of `timeInterval` items. Validates that intervals are sorted ascending and non-overlapping when the day is enabled.

- [ ] **Step 1: Create the file with full content**

Create `sanity/schemaTypes/objects/daySchedule.ts`:

```typescript
import { defineType, defineField, defineArrayMember } from 'sanity'

const DAYS = [
  { title: 'Monday', value: 'mon' },
  { title: 'Tuesday', value: 'tue' },
  { title: 'Wednesday', value: 'wed' },
  { title: 'Thursday', value: 'thu' },
  { title: 'Friday', value: 'fri' },
  { title: 'Saturday', value: 'sat' },
  { title: 'Sunday', value: 'sun' },
] as const

export const daySchedule = defineType({
  name: 'daySchedule',
  title: 'Day schedule',
  type: 'object',
  fields: [
    defineField({
      name: 'day',
      type: 'string',
      options: { list: [...DAYS], layout: 'dropdown' },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'enabled',
      type: 'boolean',
      initialValue: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'intervals',
      type: 'array',
      of: [defineArrayMember({ type: 'timeInterval' })],
      validation: (rule) =>
        rule.custom((intervals, context) => {
          const parent = context.parent as { enabled?: boolean } | undefined
          const list = (intervals as Array<{ start?: string; end?: string }> | undefined) ?? []
          if (parent?.enabled && list.length === 0) {
            return 'Add at least one interval when this day is enabled'
          }
          for (let i = 1; i < list.length; i++) {
            const prev = list[i - 1]
            const curr = list[i]
            if (!prev?.start || !prev?.end || !curr?.start) continue
            if (prev.end > curr.start) {
              return 'Intervals must be sorted ascending and non-overlapping'
            }
          }
          return true
        }),
    }),
  ],
  preview: {
    select: { day: 'day', enabled: 'enabled', intervals: 'intervals' },
    prepare: ({ day, enabled, intervals }) => {
      const count = (intervals as unknown[] | undefined)?.length ?? 0
      const dayLabel = DAYS.find((d) => d.value === day)?.title ?? 'Unset'
      return {
        title: dayLabel,
        subtitle: enabled ? `${count} interval(s)` : 'Disabled',
      }
    },
  },
})
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`

Expected: only the `index.ts` "name not defined" error. No new errors in `daySchedule.ts`.

- [ ] **Step 3: Commit**

```bash
git add sanity/schemaTypes/objects/daySchedule.ts
git commit -m "feat(sanity): add daySchedule object schema"
```

---

### Task 3: Create `location` custom object

**Files:**
- Create: `sanity/schemaTypes/objects/location.ts`

Reused by `meetingType.location` and `bookingType.locationSnapshot`. The `value` field is conditionally required based on `type`.

- [ ] **Step 1: Create the file with full content**

Create `sanity/schemaTypes/objects/location.ts`:

```typescript
import { defineType, defineField } from 'sanity'

const LOCATION_TYPES = [
  { title: 'Zoom', value: 'zoom' },
  { title: 'Google Meet', value: 'googleMeet' },
  { title: 'Phone', value: 'phone' },
  { title: 'In-person', value: 'inPerson' },
  { title: 'Custom URL', value: 'customUrl' },
] as const

const VALUE_REQUIRED_TYPES = new Set(['phone', 'inPerson', 'customUrl'])

export const location = defineType({
  name: 'location',
  title: 'Location',
  type: 'object',
  fields: [
    defineField({
      name: 'type',
      type: 'string',
      options: { list: [...LOCATION_TYPES], layout: 'radio' },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'value',
      type: 'string',
      description:
        'Required for Phone (number), In-person (address), and Custom URL. Leave empty for Zoom and Google Meet — the URL is generated at booking time.',
      validation: (rule) =>
        rule.custom((value, context) => {
          const parent = context.parent as { type?: string } | undefined
          const type = parent?.type
          if (type && VALUE_REQUIRED_TYPES.has(type) && !value) {
            return 'Required for this location type'
          }
          return true
        }),
    }),
    defineField({
      name: 'instructions',
      type: 'text',
      rows: 3,
    }),
  ],
  preview: {
    select: { type: 'type', value: 'value' },
    prepare: ({ type, value }) => {
      const label = LOCATION_TYPES.find((t) => t.value === type)?.title ?? 'Unset'
      return { title: label, subtitle: value || undefined }
    },
  },
})
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`

Expected: only the `index.ts` "name not defined" error.

- [ ] **Step 3: Commit**

```bash
git add sanity/schemaTypes/objects/location.ts
git commit -m "feat(sanity): add location object schema"
```

---

### Task 4: Create `userType` document

**Files:**
- Create: `sanity/schemaTypes/documents/userType.ts`

The host profile, joined to Clerk via `clerkId`. Username is a slug, globally unique. `email` and `avatarUrl` are read-only because a Clerk webhook owns them.

- [ ] **Step 1: Create the file with full content**

Create `sanity/schemaTypes/documents/userType.ts`:

```typescript
import { defineType, defineField } from 'sanity'
import { UserIcon } from '@sanity/icons'

const USERNAME_REGEX = /^[a-z0-9-]{3,30}$/

function slugifyUsername(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 30)
}

export const userType = defineType({
  name: 'userType',
  title: 'Host',
  type: 'document',
  icon: UserIcon,
  fields: [
    defineField({
      name: 'clerkId',
      type: 'string',
      description: 'Clerk user ID. Managed by webhook; do not edit.',
      readOnly: true,
      hidden: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'username',
      type: 'slug',
      description: 'Drives the public booking URL: /{username}',
      options: {
        source: 'displayName',
        maxLength: 30,
        slugify: slugifyUsername,
      },
      validation: (rule) =>
        rule.required().custom(async (slug, context) => {
          const current = slug?.current
          if (!current) return 'Required'
          if (!USERNAME_REGEX.test(current)) {
            return 'Must be 3–30 chars: lowercase letters, numbers, dashes only'
          }
          const client = context.getClient({ apiVersion: '2026-04-27' })
          const id = context.document?._id?.replace(/^drafts\./, '')
          const count = await client.fetch<number>(
            `count(*[_type == "userType" && username.current == $slug && !(_id in [$id, "drafts." + $id])])`,
            { slug: current, id: id ?? '' }
          )
          return count === 0 || 'Username is already taken'
        }),
    }),
    defineField({
      name: 'displayName',
      type: 'string',
      description: 'Mirrored from Clerk; editable here for admin overrides.',
      validation: (rule) => rule.required().min(1).max(100),
    }),
    defineField({
      name: 'email',
      type: 'string',
      description: 'Mirrored from Clerk. Read-only.',
      readOnly: true,
      validation: (rule) => rule.required().email(),
    }),
    defineField({
      name: 'avatarUrl',
      type: 'url',
      description: 'Mirrored from Clerk profile image. Read-only.',
      readOnly: true,
    }),
    defineField({
      name: 'timezone',
      type: 'string',
      description: 'IANA timezone, e.g. America/Los_Angeles.',
      initialValue: 'UTC',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'bio',
      type: 'text',
      rows: 4,
    }),
    defineField({
      name: 'welcomeMessage',
      type: 'string',
    }),
    defineField({
      name: 'createdAt',
      type: 'datetime',
      readOnly: true,
      initialValue: () => new Date().toISOString(),
      validation: (rule) => rule.required(),
    }),
  ],
  preview: {
    select: { title: 'displayName', subtitle: 'username.current' },
    prepare: ({ title, subtitle }) => ({
      title: title ?? 'Unnamed host',
      subtitle: subtitle ? `@${subtitle}` : undefined,
    }),
  },
})
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`

Expected: still only the `index.ts` "name not defined" errors. No new errors in `userType.ts`.

- [ ] **Step 3: Commit**

```bash
git add sanity/schemaTypes/documents/userType.ts
git commit -m "feat(sanity): add userType document schema"
```

---

### Task 5: Create `availabilityType` document

**Files:**
- Create: `sanity/schemaTypes/documents/availabilityType.ts`

Weekly schedule for one user. Validates that `weeklySchedule` contains exactly seven distinct days. The "one schedule per user" invariant is **not** enforced here (that's an application-layer concern; see spec section 7).

- [ ] **Step 1: Create the file with full content**

Create `sanity/schemaTypes/documents/availabilityType.ts`:

```typescript
import { defineType, defineField, defineArrayMember } from 'sanity'
import { ClockIcon } from '@sanity/icons'

const REQUIRED_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

export const availabilityType = defineType({
  name: 'availabilityType',
  title: 'Schedule',
  type: 'document',
  icon: ClockIcon,
  fields: [
    defineField({
      name: 'user',
      type: 'reference',
      to: [{ type: 'userType' }],
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'timezone',
      type: 'string',
      description: 'IANA timezone in which the local times below are interpreted.',
      initialValue: 'UTC',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'weeklySchedule',
      type: 'array',
      of: [defineArrayMember({ type: 'daySchedule' })],
      validation: (rule) =>
        rule.required().custom((days) => {
          const list = (days as Array<{ day?: string }> | undefined) ?? []
          if (list.length !== 7) return 'Must contain exactly 7 day entries (one per weekday)'
          const seen = new Set<string>()
          for (const d of list) {
            if (!d.day) return 'Each day entry must specify a day'
            if (seen.has(d.day)) return `Duplicate day: ${d.day}`
            seen.add(d.day)
          }
          for (const required of REQUIRED_DAYS) {
            if (!seen.has(required)) return `Missing day: ${required}`
          }
          return true
        }),
    }),
    defineField({
      name: 'minimumNotice',
      title: 'Minimum notice (minutes)',
      type: 'number',
      initialValue: 240,
      validation: (rule) => rule.required().integer().min(0),
    }),
    defineField({
      name: 'bufferBefore',
      title: 'Buffer before (minutes)',
      type: 'number',
      initialValue: 0,
      validation: (rule) => rule.required().integer().min(0),
    }),
    defineField({
      name: 'bufferAfter',
      title: 'Buffer after (minutes)',
      type: 'number',
      initialValue: 0,
      validation: (rule) => rule.required().integer().min(0),
    }),
  ],
  preview: {
    select: { userName: 'user.displayName', timezone: 'timezone' },
    prepare: ({ userName, timezone }) => ({
      title: userName ? `${userName}'s availability` : 'Schedule (no user)',
      subtitle: timezone ?? undefined,
    }),
  },
})
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add sanity/schemaTypes/documents/availabilityType.ts
git commit -m "feat(sanity): add availabilityType document schema"
```

---

### Task 6: Create `meetingType` document

**Files:**
- Create: `sanity/schemaTypes/documents/meetingType.ts`

Bookable event type. The `slug` async validator enforces uniqueness **per host** (two hosts may both have `/30min`).

- [ ] **Step 1: Create the file with full content**

Create `sanity/schemaTypes/documents/meetingType.ts`:

```typescript
import { defineType, defineField } from 'sanity'
import { TagIcon } from '@sanity/icons'

const COLOR_OPTIONS = [
  { title: 'Blue', value: 'blue' },
  { title: 'Green', value: 'green' },
  { title: 'Purple', value: 'purple' },
  { title: 'Pink', value: 'pink' },
  { title: 'Orange', value: 'orange' },
  { title: 'Red', value: 'red' },
  { title: 'Gray', value: 'gray' },
] as const

const SLUG_REGEX = /^[a-z0-9-]+$/

function slugifyTitle(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 60)
}

export const meetingType = defineType({
  name: 'meetingType',
  title: 'Event type',
  type: 'document',
  icon: TagIcon,
  fields: [
    defineField({
      name: 'host',
      type: 'reference',
      to: [{ type: 'userType' }],
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'title',
      type: 'string',
      validation: (rule) => rule.required().min(1).max(100),
    }),
    defineField({
      name: 'slug',
      type: 'slug',
      description: 'Drives the public URL: /{username}/{slug}. Unique per host.',
      options: { source: 'title', maxLength: 60, slugify: slugifyTitle },
      validation: (rule) =>
        rule.required().custom(async (slug, context) => {
          const current = slug?.current
          if (!current) return 'Required'
          if (!SLUG_REGEX.test(current)) {
            return 'Lowercase letters, numbers, and dashes only'
          }
          const doc = context.document as { host?: { _ref?: string } } | undefined
          const hostRef = doc?.host?._ref
          if (!hostRef) return true // Host required validator will catch this elsewhere
          const client = context.getClient({ apiVersion: '2026-04-27' })
          const id = context.document?._id?.replace(/^drafts\./, '')
          const count = await client.fetch<number>(
            `count(*[_type == "meetingType" && host._ref == $hostRef && slug.current == $slug && !(_id in [$id, "drafts." + $id])])`,
            { hostRef, slug: current, id: id ?? '' }
          )
          return count === 0 || 'You already have an event type with this slug'
        }),
    }),
    defineField({ name: 'description', type: 'text', rows: 4 }),
    defineField({
      name: 'duration',
      title: 'Duration (minutes)',
      type: 'number',
      initialValue: 30,
      validation: (rule) => rule.required().integer().min(1).max(480),
    }),
    defineField({
      name: 'location',
      type: 'location',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'color',
      type: 'string',
      options: { list: [...COLOR_OPTIONS], layout: 'radio' },
      initialValue: 'blue',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'active',
      type: 'boolean',
      description: 'When false, hidden from the public booking page.',
      initialValue: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'bufferBefore',
      title: 'Buffer before override (minutes)',
      description: 'If unset, uses the user\'s default from availabilityType.',
      type: 'number',
      validation: (rule) => rule.integer().min(0),
    }),
    defineField({
      name: 'bufferAfter',
      title: 'Buffer after override (minutes)',
      description: 'If unset, uses the user\'s default from availabilityType.',
      type: 'number',
      validation: (rule) => rule.integer().min(0),
    }),
    defineField({
      name: 'minimumNotice',
      title: 'Minimum notice override (minutes)',
      description: 'If unset, uses the user\'s default from availabilityType.',
      type: 'number',
      validation: (rule) => rule.integer().min(0),
    }),
    defineField({
      name: 'maxBookingsPerDay',
      type: 'number',
      description: 'Cap on bookings per day for this event type. Empty = unlimited.',
      validation: (rule) => rule.integer().min(1),
    }),
    defineField({
      name: 'bookingWindowDays',
      type: 'number',
      description: 'How far into the future bookings are allowed.',
      initialValue: 60,
      validation: (rule) => rule.required().integer().min(1).max(365),
    }),
    defineField({
      name: 'createdAt',
      type: 'datetime',
      readOnly: true,
      initialValue: () => new Date().toISOString(),
      validation: (rule) => rule.required(),
    }),
  ],
  preview: {
    select: { title: 'title', duration: 'duration', hostName: 'host.displayName' },
    prepare: ({ title, duration, hostName }) => ({
      title: title ?? 'Untitled event type',
      subtitle: `${duration ?? 0} min${hostName ? ` · ${hostName}` : ''}`,
    }),
  },
})
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add sanity/schemaTypes/documents/meetingType.ts
git commit -m "feat(sanity): add meetingType document schema"
```

---

### Task 7: Create `bookingType` document

**Files:**
- Create: `sanity/schemaTypes/documents/bookingType.ts`

A confirmed booking. Refs both host and meetingType for queryability; snapshot fields preserve historical display data per spec section 4.4. Field groups segment the Studio form into tabs.

- [ ] **Step 1: Create the file with full content**

Create `sanity/schemaTypes/documents/bookingType.ts`:

```typescript
import { defineType, defineField } from 'sanity'
import { CalendarIcon } from '@sanity/icons'

const STATUS_OPTIONS = [
  { title: 'Confirmed', value: 'confirmed' },
  { title: 'Cancelled', value: 'cancelled' },
  { title: 'Rescheduled', value: 'rescheduled' },
] as const

export const bookingType = defineType({
  name: 'bookingType',
  title: 'Booking',
  type: 'document',
  icon: CalendarIcon,
  groups: [
    { name: 'refs', title: 'References', default: true },
    { name: 'snapshot', title: 'Snapshot' },
    { name: 'time', title: 'Time' },
    { name: 'invitee', title: 'Invitee' },
    { name: 'lifecycle', title: 'Lifecycle' },
  ],
  fields: [
    defineField({
      name: 'host',
      type: 'reference',
      to: [{ type: 'userType' }],
      group: 'refs',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'meetingType',
      type: 'reference',
      to: [{ type: 'meetingType' }],
      group: 'refs',
      validation: (rule) => rule.required(),
    }),

    defineField({
      name: 'meetingTitleSnapshot',
      type: 'string',
      description: 'Frozen at booking time. Do not edit.',
      group: 'snapshot',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'meetingDurationSnapshot',
      title: 'Meeting duration snapshot (minutes)',
      type: 'number',
      group: 'snapshot',
      validation: (rule) => rule.required().integer().min(1),
    }),
    defineField({
      name: 'hostNameSnapshot',
      type: 'string',
      group: 'snapshot',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'hostUsernameSnapshot',
      type: 'string',
      group: 'snapshot',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'locationSnapshot',
      type: 'location',
      group: 'snapshot',
      validation: (rule) => rule.required(),
    }),

    defineField({
      name: 'startTime',
      type: 'datetime',
      group: 'time',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'endTime',
      type: 'datetime',
      description: 'Must equal startTime + meetingDurationSnapshot.',
      group: 'time',
      validation: (rule) =>
        rule.required().custom((end, context) => {
          const doc = context.document as
            | { startTime?: string; meetingDurationSnapshot?: number }
            | undefined
          const start = doc?.startTime
          const duration = doc?.meetingDurationSnapshot
          if (!end || !start || typeof duration !== 'number') return true
          const expected = new Date(new Date(start).getTime() + duration * 60_000).toISOString()
          return expected === end || `End time must equal startTime + ${duration} minutes`
        }),
    }),
    defineField({
      name: 'inviteeTimezone',
      type: 'string',
      description: 'IANA timezone the invitee booked in. Used for confirmation emails.',
      group: 'time',
      validation: (rule) => rule.required(),
    }),

    defineField({
      name: 'inviteeName',
      type: 'string',
      group: 'invitee',
      validation: (rule) => rule.required().min(1),
    }),
    defineField({
      name: 'inviteeEmail',
      type: 'string',
      group: 'invitee',
      validation: (rule) => rule.required().email(),
    }),
    defineField({
      name: 'inviteeNotes',
      type: 'text',
      rows: 3,
      group: 'invitee',
    }),

    defineField({
      name: 'status',
      type: 'string',
      options: { list: [...STATUS_OPTIONS], layout: 'radio' },
      initialValue: 'confirmed',
      group: 'lifecycle',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'cancellationReason',
      type: 'text',
      group: 'lifecycle',
      hidden: ({ parent }) => parent?.status !== 'cancelled',
      validation: (rule) =>
        rule.custom((value, context) => {
          const status = (context.document as { status?: string } | undefined)?.status
          if (status === 'cancelled' && !value) {
            return 'Required when status is cancelled'
          }
          return true
        }),
    }),
    defineField({
      name: 'rescheduledTo',
      type: 'reference',
      to: [{ type: 'bookingType' }],
      group: 'lifecycle',
      hidden: ({ parent }) => parent?.status !== 'rescheduled',
      validation: (rule) =>
        rule.custom((value, context) => {
          const status = (context.document as { status?: string } | undefined)?.status
          if (status === 'rescheduled' && !value) {
            return 'Required when status is rescheduled'
          }
          return true
        }),
    }),
    defineField({
      name: 'cancelledAt',
      type: 'datetime',
      group: 'lifecycle',
      hidden: ({ parent }) => parent?.status !== 'cancelled',
    }),
    defineField({
      name: 'createdAt',
      type: 'datetime',
      readOnly: true,
      group: 'lifecycle',
      initialValue: () => new Date().toISOString(),
      validation: (rule) => rule.required(),
    }),
  ],
  preview: {
    select: {
      invitee: 'inviteeName',
      host: 'hostNameSnapshot',
      meeting: 'meetingTitleSnapshot',
      startTime: 'startTime',
      status: 'status',
    },
    prepare: ({ invitee, host, meeting, startTime, status }) => ({
      title: `${invitee ?? '?'} → ${host ?? '?'}`,
      subtitle: [meeting, startTime, status].filter(Boolean).join(' · '),
    }),
  },
  orderings: [
    {
      title: 'Start time (newest first)',
      name: 'startTimeDesc',
      by: [{ field: 'startTime', direction: 'desc' }],
    },
    {
      title: 'Created (newest first)',
      name: 'createdAtDesc',
      by: [{ field: 'createdAt', direction: 'desc' }],
    },
  ],
})
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add sanity/schemaTypes/documents/bookingType.ts
git commit -m "feat(sanity): add bookingType document schema"
```

---

### Task 8: Wire all types into `index.ts`

**Files:**
- Modify: `sanity/schemaTypes/index.ts`

Replace the dangling identifier list with real imports. Add the three custom-object types alongside the four document types.

- [ ] **Step 1: Replace the file content**

Replace the entirety of `sanity/schemaTypes/index.ts` with:

```typescript
import { type SchemaTypeDefinition } from 'sanity'

import { userType } from './documents/userType'
import { availabilityType } from './documents/availabilityType'
import { meetingType } from './documents/meetingType'
import { bookingType } from './documents/bookingType'

import { timeInterval } from './objects/timeInterval'
import { daySchedule } from './objects/daySchedule'
import { location } from './objects/location'

export const schema: { types: SchemaTypeDefinition[] } = {
  types: [
    // Documents
    userType,
    availabilityType,
    meetingType,
    bookingType,
    // Objects (referenced by documents)
    timeInterval,
    daySchedule,
    location,
  ],
}
```

- [ ] **Step 2: Type-check — this should now pass cleanly**

Run: `pnpm exec tsc --noEmit`

Expected: **zero errors**. The "name not defined" errors that have been present since Task 0 are now resolved.

If errors remain, re-read the file and verify every import path matches the files created in Tasks 1–7 exactly (including filename casing).

- [ ] **Step 3: Commit**

```bash
git add sanity/schemaTypes/index.ts
git commit -m "feat(sanity): register schemaTypes in index"
```

---

### Task 9: Group documents in Studio sidebar via `structure.ts`

**Files:**
- Modify: `sanity/structure.ts`

Replace the default flat document list with a custom sidebar that names each section and sets a sensible default ordering per type.

- [ ] **Step 1: Replace the file content**

Replace the entirety of `sanity/structure.ts` with:

```typescript
import type { StructureResolver } from 'sanity/structure'
import { UserIcon, ClockIcon, TagIcon, CalendarIcon } from '@sanity/icons'

export const structure: StructureResolver = (S) =>
  S.list()
    .title('Content')
    .items([
      S.listItem()
        .title('Hosts')
        .icon(UserIcon)
        .child(
          S.documentTypeList('userType')
            .title('Hosts')
            .defaultOrdering([{ field: 'createdAt', direction: 'desc' }]),
        ),
      S.listItem()
        .title('Schedules')
        .icon(ClockIcon)
        .child(
          S.documentTypeList('availabilityType')
            .title('Schedules')
            .defaultOrdering([{ field: 'user.displayName', direction: 'asc' }]),
        ),
      S.listItem()
        .title('Event types')
        .icon(TagIcon)
        .child(
          S.documentTypeList('meetingType')
            .title('Event types')
            .defaultOrdering([{ field: 'createdAt', direction: 'desc' }]),
        ),
      S.listItem()
        .title('Bookings')
        .icon(CalendarIcon)
        .child(
          S.documentTypeList('bookingType')
            .title('Bookings')
            .defaultOrdering([{ field: 'startTime', direction: 'desc' }]),
        ),
    ])
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add sanity/structure.ts
git commit -m "feat(sanity): group documents in Studio sidebar"
```

---

### Task 10: Verification — Studio smoke test

This task does not change code. It verifies the schemas work end-to-end in the live Studio. **Do not skip it** — `tsc` only catches type errors; runtime schema errors (e.g., a typo in a `to: [{ type: '...' }]` reference) only surface in the browser.

**Files:** none modified.

- [ ] **Step 1: Confirm `.env.local` has Sanity credentials**

Run: `cat .env.local 2>/dev/null | grep -E 'NEXT_PUBLIC_SANITY_(PROJECT_ID|DATASET)' || echo 'MISSING'`

Expected: prints `NEXT_PUBLIC_SANITY_PROJECT_ID=...` and `NEXT_PUBLIC_SANITY_DATASET=...`.

If it prints `MISSING`, stop and ask the user for the project ID and dataset name. Do not invent values — `sanity/env.ts` will throw at runtime with `Missing environment variable` and the Studio won't load.

- [ ] **Step 2: Start the dev server**

Run: `pnpm dev`

(Run in a separate terminal or background. The user may already have it running; if so, skip this step.)

Expected: starts on `http://localhost:3000`. Watch for compile errors in the terminal — there should be none.

- [ ] **Step 3: Open the Studio in the browser**

Visit: `http://localhost:3000/studio`

Expected: the Sanity Studio loads. The left sidebar shows four items: **Hosts**, **Schedules**, **Event types**, **Bookings** — each with its icon. **No** error overlay or red banner.

If the Studio shows a schema validation error, read it carefully. The most common cause is an unknown `type:` reference (a typo in a `defineArrayMember` or a `reference.to`). Fix the offending file, save, and the Studio will hot-reload.

- [ ] **Step 4: Smoke-test each schema by creating a document**

Create one document of each type, in this order. After saving each, the Studio should show no validation errors and the document should appear in the type's list.

  1. **Host** — `clerkId` is hidden + read-only + required, so the Studio form alone cannot create a valid userType. To smoke-test, **temporarily** loosen the `clerkId` field in `sanity/schemaTypes/documents/userType.ts`: change `readOnly: true` to `readOnly: false` and `hidden: true` to `hidden: false`. Save the file (Studio hot-reloads). Then in Studio click *Hosts* → *Create new*. Fill `clerkId = "user_test_001"`, `displayName = "Test Host"`, `email = "test@example.com"`. Click the *Generate* button next to `username` to slugify from `displayName`. Leave `timezone = "UTC"`. Save. **Expected:** no validation errors; the doc appears under *Hosts*. **Now revert** the two field-config changes in `userType.ts` (back to `readOnly: true`, `hidden: true`) — the data already saved is unaffected.

  2. **Schedule** — click *Schedules* → *Create new*. Set `user` reference to the Test Host. Add seven `daySchedule` entries (Mon–Sun); enable Mon–Fri with one interval `09:00–17:00` each, disable Sat & Sun. Leave `minimumNotice = 240`, buffers `0`. Save. **Expected:** the validator passes; if you remove a day or duplicate one, the validator should produce a clear error.

  3. **Event type** — click *Event types* → *Create new*. Set `host = Test Host`, `title = "30 Min Intro"`, slug auto-fills to `30-min-intro`. `duration = 30`. Set `location.type = zoom`, leave `value` empty. `color = blue`. Save. **Expected:** no errors. Try saving a second event type with the same slug under the same host — **expected:** the validator rejects with "You already have an event type with this slug". Try with a different host — **expected:** allowed.

  4. **Booking** — click *Bookings* → *Create new*. Fill all snapshots manually (this is just a smoke test; in production these come from the booking flow): `meetingTitleSnapshot = "30 Min Intro"`, `meetingDurationSnapshot = 30`, `hostNameSnapshot = "Test Host"`, `hostUsernameSnapshot = "test-host"`, `locationSnapshot = { type: zoom }`. Set `startTime` to any near-future ISO datetime. Set `endTime` to **start + 30 minutes**. `inviteeTimezone = "UTC"`, `inviteeName = "Alice"`, `inviteeEmail = "alice@example.com"`. `status = confirmed`. Save. **Expected:** no errors. Now change `endTime` to start + 31 minutes — **expected:** the validator rejects with "End time must equal startTime + 30 minutes".

- [ ] **Step 5: Confirm no schema files were modified during the smoke test**

Run: `git status --short`

Expected: no modifications to `sanity/schemaTypes/**` or `sanity/structure.ts`. If you temporarily un-hid `clerkId` in step 4.1, you must have already reverted it.

If the working tree shows un-reverted schema changes, revert them with `git checkout -- sanity/schemaTypes/documents/userType.ts` (or whichever file).

- [ ] **Step 6: Final commit (if anything was learned and fixed during smoke test)**

If the smoke test surfaced bugs and you fixed them, commit:

```bash
git add sanity/
git commit -m "fix(sanity): address issues found during studio smoke test"
```

If the smoke test passed clean, no commit is needed.

- [ ] **Step 7: Push the branch**

```bash
git push
```

Expected: pushes commits from Tasks 1–9 (and 10 if a fix was needed) to `origin/feat/sanity-schemas-design`.

---

## Done

After Task 10, the four document types and three custom-object types from the spec are implemented, registered, and verified in the live Studio. Out-of-scope items (Clerk webhook, GROQ query layer, booking engine, public UI) remain for future specs.
