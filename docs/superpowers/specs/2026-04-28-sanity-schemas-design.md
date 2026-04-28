# Sanity Schemas — Design Spec

**Date:** 2026-04-28
**Project:** Calendry (Calendly clone)
**Scope:** Define the four Sanity document types declared in `sanity/schemaTypes/index.ts` and their supporting custom-object types.

---

## 1. Goals & Non-Goals

### Goals
- Model the four core entities of a Calendly-style scheduling product: **host users**, **availability**, **event types**, and **bookings**.
- Support a multi-host SaaS shape: any Clerk-authenticated user becomes a host with their own public booking page at `/{username}`.
- Keep historical bookings stable: edits or deletions of a host's profile or event type must not corrupt past booking records.
- Lay a foundation that admits future features (teams, custom questions, recurring events) additively, without breaking changes.

### Non-Goals
- Team-based scheduling (round-robin, collective availability). Single-host model only.
- Custom invitee questions per event type. The booking form captures `inviteeName`, `inviteeEmail`, and a single freeform `inviteeNotes` field.
- Multiple named availability schedules per user. Each user has exactly one schedule.
- The Clerk → Sanity user-sync webhook itself, the GROQ query layer, the booking engine (slot generation, conflict detection, calendar integrations), and the public-facing UI. Each is the subject of its own spec.

---

## 2. Architecture Overview

Four document types and three custom-object types:

```
userType (host)
  └─ has one  → availabilityType   (weekly working hours)
  └─ has many → meetingType        (event types this host offers)
  └─ has many → bookingType        (bookings made with this host)

meetingType (event type, e.g. "30min Intro")
  └─ has many → bookingType

bookingType (an actual booked slot)
  ├─ ref → host (userType)
  ├─ ref → meetingType
  └─ snapshot fields preserve historical display data

custom objects:
  timeInterval { start, end }
  daySchedule  { day, enabled, intervals[] }
  location     { type, value, instructions }
```

### Linking to Clerk
Every `userType` document carries a unique `clerkId`. A Clerk webhook (out of scope for this spec) creates and updates the Sanity user document on Clerk sign-up and profile-update events.

### Stability strategy: refs plus snapshots
`bookingType` references both `userType` and `meetingType` for queryability, and also snapshots the small set of display fields needed to render a historical booking (`meetingTitleSnapshot`, `meetingDurationSnapshot`, `hostNameSnapshot`, `hostUsernameSnapshot`, `locationSnapshot`). The snapshot guarantees that renaming an event type or deleting a host record never corrupts a past booking's display.

---

## 3. File Layout

```
sanity/schemaTypes/
  index.ts                           ← edit: import + register all four document types
  documents/
    userType.ts                      ← new
    availabilityType.ts              ← new
    meetingType.ts                   ← new
    bookingType.ts                   ← new
  objects/
    timeInterval.ts                  ← new
    daySchedule.ts                   ← new
    location.ts                      ← new
```

Splitting documents and objects into separate folders keeps each schema file focused and readable.

---

## 4. Schema Definitions

### 4.1 `userType` (document)

Represents a host. Exactly one document per Clerk user, joined by `clerkId`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `clerkId` | string | yes | Unique. Hidden and read-only in Studio. The join key to Clerk. |
| `username` | slug | yes | Unique. Drives the URL `/{username}`. Lowercase, alphanumeric and dashes, 3–30 chars. Slug source is `displayName`. |
| `displayName` | string | yes | Mirrored from Clerk by webhook; editable in Studio so admins can override. |
| `email` | string | yes | Mirrored from Clerk. Read-only in Studio. Validated as email. |
| `avatarUrl` | url | no | Mirrored from Clerk's profile image. Read-only in Studio. |
| `timezone` | string | yes | IANA timezone (e.g. `America/Los_Angeles`). Defaults to `UTC`. |
| `bio` | text | no | Public booking-page bio. |
| `welcomeMessage` | string | no | Short greeting on the booking page above event types. |
| `createdAt` | datetime | yes | Set on creation. Read-only. |

**Studio preview:** title = `displayName`, subtitle = `@{username.current}`, media = `avatarUrl`.

### 4.2 `availabilityType` (document)

Models the weekly working-hours configuration. Exactly one per user; the application layer enforces this invariant on creation.

| Field | Type | Required | Notes |
|---|---|---|---|
| `user` | reference → userType | yes | The owner. |
| `timezone` | string | yes | IANA timezone in which the schedule's local times are interpreted. Defaults to the user's timezone. |
| `weeklySchedule` | array of `daySchedule` | yes | Exactly seven entries, one per weekday. Validated for completeness and no duplicate days. |
| `minimumNotice` | number | yes | Minutes of lead time required before a booking can start. Default `240` (4 hours). Per-event-type override available. |
| `bufferBefore` | number | yes | Minutes of buffer before each booking. Default `0`. Per-event-type override available. |
| `bufferAfter` | number | yes | Minutes of buffer after each booking. Default `0`. Per-event-type override available. |

**Studio preview:** title = `{user.displayName}'s availability`, subtitle = `{timezone}`.

### 4.3 `meetingType` (document)

A bookable event type. A host owns many; each appears at `/{username}/{slug}`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `host` | reference → userType | yes | The owner. |
| `title` | string | yes | e.g. "30 Min Intro Call". |
| `slug` | slug | yes | Unique **per host**. Lowercase, alphanumeric, dashes. Slug source is `title`. |
| `description` | text | no | Shown on the booking page. |
| `duration` | number | yes | Minutes. Free integer (1–480) to allow uncommon durations. |
| `location` | object → `location` | yes | See 4.6. |
| `color` | string (enum) | yes | One of: `blue`, `green`, `purple`, `pink`, `orange`, `red`, `gray`. Default `blue`. |
| `active` | boolean | yes | When false, hidden from the public booking page. Existing bookings remain readable. Default `true`. |
| `bufferBefore` | number | no | Override (minutes). Falls back to `availabilityType.bufferBefore` when null. |
| `bufferAfter` | number | no | Override. Falls back to `availabilityType.bufferAfter`. |
| `minimumNotice` | number | no | Override. Falls back to `availabilityType.minimumNotice`. |
| `maxBookingsPerDay` | number | no | Cap. Null means unlimited. |
| `bookingWindowDays` | number | yes | How many days into the future are bookable. Default `60`. |
| `createdAt` | datetime | yes | Set on creation. Read-only. |

**Slug uniqueness per host** is enforced by an async custom validator that runs a GROQ check for collisions among the same host's other `meetingType` documents.

**Studio preview:** title = `title`, subtitle = `{duration}min · {host.displayName}`, media derived from `color`.

### 4.4 `bookingType` (document)

A confirmed booking made by an anonymous invitee.

**References (relational backbone):**

| Field | Type | Required | Notes |
|---|---|---|---|
| `host` | reference → userType | yes | |
| `meetingType` | reference → meetingType | yes | |

**Snapshots (frozen at booking time, never updated):**

| Field | Type | Required | Notes |
|---|---|---|---|
| `meetingTitleSnapshot` | string | yes | Copy of `meetingType.title`. |
| `meetingDurationSnapshot` | number | yes | Copy of `meetingType.duration`. |
| `hostNameSnapshot` | string | yes | Copy of `userType.displayName`. |
| `hostUsernameSnapshot` | string | yes | Copy of `userType.username.current`. |
| `locationSnapshot` | object → `location` | yes | Copy of the resolved `location`, including any meeting URL generated at booking time. |

The `Snapshot` suffix marks each field visually in Studio as a frozen historical copy.

**Time:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `startTime` | datetime | yes | UTC. |
| `endTime` | datetime | yes | UTC. Equals `startTime + meetingDurationSnapshot`. Stored (not derived) for query performance. |
| `inviteeTimezone` | string | yes | The timezone the invitee was viewing in. Used in confirmation emails. |

**Invitee (anonymous, no Clerk account):**

| Field | Type | Required | Notes |
|---|---|---|---|
| `inviteeName` | string | yes | |
| `inviteeEmail` | string | yes | Validated as email. |
| `inviteeNotes` | text | no | Optional "anything we should know?" message. |

**Lifecycle:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `status` | string (enum) | yes | `confirmed` \| `cancelled` \| `rescheduled`. Default `confirmed`. |
| `cancellationReason` | text | conditional | Required when `status = cancelled`. |
| `rescheduledTo` | reference → bookingType | conditional | Required when `status = rescheduled`. Points at the replacement booking. |
| `createdAt` | datetime | yes | Set on creation. Read-only. |
| `cancelledAt` | datetime | conditional | Set when `status` flips to `cancelled`. |

**Reschedule semantics.** Rescheduling creates a new `bookingType` document and updates the original's `status` to `rescheduled` with `rescheduledTo` pointing at the new document. This preserves an audit chain and keeps reporting accurate.

**Studio preview:** title = `{inviteeName} → {hostNameSnapshot}`, subtitle = `{meetingTitleSnapshot} · {startTime}`.

### 4.5 `daySchedule` and `timeInterval` (custom objects)

`daySchedule` represents one weekday's availability:

| Field | Type | Required | Notes |
|---|---|---|---|
| `day` | string (enum) | yes | One of `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`. |
| `enabled` | boolean | yes | Whether the day accepts bookings. |
| `intervals` | array of `timeInterval` | yes | Empty when disabled; one or more when enabled. Validated as non-overlapping and chronologically sorted. |

`timeInterval` represents a contiguous bookable window within a day:

| Field | Type | Required | Notes |
|---|---|---|---|
| `start` | string | yes | `HH:mm` 24-hour format. Regex-validated. |
| `end` | string | yes | `HH:mm`. Must be greater than `start`. |

**Why `HH:mm` strings, not datetimes:** these are recurring local times of day, not absolute moments. Combining the string with `availabilityType.timezone` lets the booking engine resolve real UTC slots per calendar day.

### 4.6 `location` (custom object)

Reused by `meetingType.location` and `bookingType.locationSnapshot`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | string (enum) | yes | `zoom` \| `googleMeet` \| `phone` \| `inPerson` \| `customUrl`. |
| `value` | string | conditional | Empty for `zoom` and `googleMeet` (URL is generated at booking and stored on the booking's `locationSnapshot`). For `phone`, the dial-in number. For `inPerson`, the address. For `customUrl`, the URL. |
| `instructions` | text | no | Extra info for the invitee, e.g. "Use the link 5 minutes before the call." |

---

## 5. Studio Configuration

`sanity/structure.ts` is updated to group documents in the Studio sidebar:

```
Content
├── Hosts             (userType, ordered by createdAt desc)
├── Schedules         (availabilityType, ordered by user.displayName)
├── Event Types       (meetingType, ordered by createdAt desc)
└── Bookings          (bookingType, ordered by startTime desc)
```

Each document type defines a `preview` block as specified in section 4.

---

## 6. Validation Rules (summary)

- **Required fields** as marked in section 4.
- **`userType.username`** matches `^[a-z0-9-]{3,30}$` and is globally unique.
- **`userType.email`** passes Sanity's email validator.
- **`meetingType.slug`** matches `^[a-z0-9-]+$` and is unique per host (async GROQ validator).
- **`meetingType.duration`** is between 1 and 480 minutes.
- **`meetingType.bookingWindowDays`** is between 1 and 365.
- **`availabilityType.weeklySchedule`** contains exactly seven entries, one per `day` value, with no duplicates.
- **`timeInterval.start` and `.end`** match `^([01]\d|2[0-3]):[0-5]\d$`. `end` is strictly greater than `start`.
- **`daySchedule.intervals`** are non-overlapping and sorted ascending by `start`.
- **`bookingType.endTime`** equals `startTime + meetingDurationSnapshot`.
- **`bookingType.cancellationReason`** is required when `status = cancelled`.
- **`bookingType.rescheduledTo`** is required when `status = rescheduled`.
- **`location.value`** is required when `type` is `phone`, `inPerson`, or `customUrl`. May be empty when `type` is `zoom` or `googleMeet` (the URL is generated at booking time).

---

## 7. Implementation Notes & Open Questions

- **Sanity version.** The project uses `sanity@^5.22.0` and `next-sanity@^12.3.1`. The implementation plan should consult `mcp__Sanity__list_sanity_rules` and `mcp__Sanity__search_docs` for current schema-builder syntax before writing code; APIs may have shifted since training data.
- **Next.js 16.** Per `AGENTS.md`, this project's Next.js conventions diverge from older versions. Anywhere the schemas connect to data fetching (server components, route handlers), the implementation plan must reference `node_modules/next/dist/docs/` rather than relying on prior knowledge.
- **Webhook-driven user sync.** The userType's `displayName`, `email`, and `avatarUrl` are read-only in Studio because a Clerk webhook owns them. Building that webhook is out of scope here, but the schemas must accommodate it (writeable via API token, locked from Studio editing).
- **Soft constraints enforced at the application layer.** "One `availabilityType` per user" and "snapshots are frozen after creation" cannot be expressed in Sanity's schema validators alone. The booking and availability action handlers must enforce these.

---

## 8. Out of Scope for This Spec

- Clerk → Sanity user-sync webhook
- GROQ query layer and TypeScript types generation
- The booking engine (slot generation, conflict detection, max-per-day enforcement, Zoom/Meet URL generation, calendar integrations)
- Email and notification flows
- The public booking page UI, the host's event-types management UI, and the bookings dashboard
