# Google Calendar OAuth Implementation Plan (Spec 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Calendar settings tab on /availability so a host can connect their Google Calendar (OAuth 2.0), see their connected email + calendar list, refresh the list on demand, and disconnect with revocation at Google's side. Tokens are encrypted at rest in a new Sanity document type.

**Architecture:** New `googleCalendarConnectionType` Sanity document with deterministic `_id = gcal.${clerkId}`. Two API routes (`/api/auth/google/start` and `/api/auth/google/callback`) handle the authorization-code flow with an HMAC-signed httpOnly state cookie. Tokens are encrypted via a versioned AES-256-GCM cipher before storage; a lazy-refresh helper (`getValidAccessToken`) is used by every Google API call. The Calendar settings tab becomes a client component fed by a connection prop the server component fetches alongside the availability doc.

**Tech Stack:** Next.js 16.2.4, React 19.2.4, `@clerk/nextjs/server`, `next-sanity`, Node `crypto` (no external crypto libs), `lucide-react`, `framer-motion`. Manual verification — no test runner (deferred since Spec 1).

**Spec:** [../specs/2026-05-01-google-calendar-oauth-design.md](../specs/2026-05-01-google-calendar-oauth-design.md)

**Branch:** `feat/google-calendar-oauth` (already created off master, spec already committed as `1102782`).

---

## Why no automated tests?

Same posture as Spec 1: no test runner is set up, and the spec defers it. Each task replaces classic "write failing test → make it pass" with **implement → verify (TS + lint, occasionally dev server) → commit.** The schema's Sanity validation rules and Google's own API responses act as the integration-test surface.

If you start adding a test runner mid-plan, you've drifted out of scope — finish the plan, propose a follow-up.

## Pre-flight (before Task 1)

These must already be true (covered during the brainstorming setup phase):

- Google Cloud project exists with OAuth consent screen configured.
- OAuth 2.0 Web client created. Authorized redirect URIs include `http://localhost:3000/api/auth/google/callback` and `https://calendry-puce.vercel.app/api/auth/google/callback`.
- Scopes added on the Data Access page: `openid`, `email`, `profile`, `calendar.readonly`, `calendar.events`.
- Google Calendar API enabled in the project.
- Test users include your own Gmail.
- Local `.env.local` has: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/auth/google/callback`.
- Vercel env vars set: same three keys, with `GOOGLE_OAUTH_REDIRECT_URI` pointing at the production callback URL on Production / Preview / Development.

**One pre-flight step to do NOW before Task 1:**

Generate two new keys and add them to `.env.local` AND Vercel:

```bash
openssl rand -base64 32   # use this output as TOKEN_ENCRYPTION_KEY
openssl rand -base64 32   # use this output as OAUTH_STATE_SIGNING_KEY
```

`.env.local` lines to add:

```
TOKEN_ENCRYPTION_KEY=<paste first key>
OAUTH_STATE_SIGNING_KEY=<paste second key>
```

Same two keys on Vercel for Production / Preview / Development. **Do not commit these values.** Verify your `.gitignore` already excludes `.env.local` (it should from project init).

If either key is missing at runtime, the server actions will throw clear errors. We test that intentionally in Task 1 verification.

---

## File Structure

**Created (in roughly this order):**

| Path | Responsibility |
|---|---|
| `lib/crypto/tokenCipher.ts` | Versioned AES-256-GCM encrypt/decrypt + key validation |
| `sanity/schemaTypes/documents/googleCalendarConnectionType.ts` | New document schema |
| `lib/google/oauthClient.ts` | Authorization URL builder + token exchange |
| `lib/google/calendarApi.ts` | Typed Google API wrappers (userInfo, calendarList, revoke) |
| `lib/google/getValidAccessToken.ts` | Lazy-refresh helper + typed errors |
| `app/api/auth/google/start/route.ts` | GET — sets state cookie, 302 to Google |
| `app/api/auth/google/callback/route.ts` | GET — validates state, exchanges code, stores connection |
| `app/(admin)/availability/calendar/actions.ts` | `disconnectGoogle`, `refreshCalendarList` server actions |
| `app/(admin)/availability/calendar/types.ts` | `GoogleConnectionPublic` type (cipher-stripped shape passed to client) |
| `app/(admin)/availability/calendar/CalendarSettingsTab.tsx` | Client component for the tab |

**Modified:**

| Path | What changes |
|---|---|
| `sanity/schemaTypes/index.ts` | Register `googleCalendarConnectionType` |
| `app/(admin)/availability/page.tsx` | Extract `ensureAvailabilityDoc` helper; additionally fetch the connection doc; pass both to `AvailabilityEditor` |
| `app/(admin)/availability/AvailabilityEditor.tsx` | Accept new optional `googleConnection` prop; replace static Calendar settings JSX with `<CalendarSettingsTab />` |
| `app/api/webhooks/clerk/route.ts` | `user.deleted` cascades to `availability.${clerkId}` and `gcal.${clerkId}` |

**Not modified:** `proxy.ts` (Clerk middleware already covers `/api/auth/google/*`), `(admin)/layout.tsx` (auth gate already in place), `userType` schema (no back-references). `sanity/structure.ts` is **not** modified — it currently uses the default `S.documentTypeListItems()` which auto-lists all registered document types, so `googleCalendarConnectionType` will appear in the Studio sidebar automatically once registered.

---

## Task 1: Token cipher

**Files:**
- Create: `lib/crypto/tokenCipher.ts`

- [ ] **Step 1: Create the cipher module**

Path: `lib/crypto/tokenCipher.ts`

```ts
import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const VERSION = 0x01
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16

function loadKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) throw new Error('Missing TOKEN_ENCRYPTION_KEY env var')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new Error(`TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`)
  }
  return key
}

export function encrypt(plaintext: string): string {
  const key = loadKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext]).toString('base64')
}

export function decrypt(payload: string): string {
  const key = loadKey()
  const buf = Buffer.from(payload, 'base64')
  if (buf.length < 1 + IV_BYTES + TAG_BYTES + 1) throw new Error('Ciphertext too short')
  const version = buf[0]
  if (version !== VERSION) throw new Error(`Unknown cipher version: ${version}`)
  const iv = buf.subarray(1, 1 + IV_BYTES)
  const tag = buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES)
  const ciphertext = buf.subarray(1 + IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Verify lint passes**

Run: `pnpm exec eslint lib/crypto/tokenCipher.ts`
Expected: clean.

- [ ] **Step 4: Sanity-check the round-trip (one-time, in a Node REPL)**

```bash
node -e "process.env.TOKEN_ENCRYPTION_KEY=require('crypto').randomBytes(32).toString('base64'); const m=require('./lib/crypto/tokenCipher.ts'); /* TS file — skip if module loader rejects it */"
```

If your Node setup can't load `.ts` directly, skip this step. The cipher will be exercised end-to-end in Task 5+ via the OAuth flow.

- [ ] **Step 5: Commit**

```bash
git add lib/crypto/tokenCipher.ts
git commit -m "feat(crypto): add versioned AES-256-GCM token cipher"
```

---

## Task 2: Sanity schema + registration

**Files:**
- Create: `sanity/schemaTypes/documents/googleCalendarConnectionType.ts`
- Modify: `sanity/schemaTypes/index.ts`

- [ ] **Step 1: Create the schema file**

Path: `sanity/schemaTypes/documents/googleCalendarConnectionType.ts`

```ts
import { defineType, defineField, defineArrayMember } from 'sanity'
import { CalendarIcon } from '@sanity/icons'

export const googleCalendarConnectionType = defineType({
  name: 'googleCalendarConnectionType',
  title: 'Google Calendar connection',
  type: 'document',
  icon: CalendarIcon,
  fields: [
    defineField({
      name: 'user',
      type: 'reference',
      to: [{ type: 'userType' }],
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'clerkId',
      type: 'string',
      description: "Mirror of the host's Clerk user ID. Read-only.",
      readOnly: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'googleEmail',
      type: 'string',
      description: 'The Google account that was authorized.',
      validation: (rule) => rule.required().email(),
    }),
    defineField({
      name: 'refreshTokenCipher',
      type: 'string',
      description: 'AES-256-GCM encrypted refresh token. Never plaintext.',
      readOnly: true,
      hidden: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'accessTokenCipher',
      type: 'string',
      description: 'AES-256-GCM encrypted access token. Never plaintext.',
      readOnly: true,
      hidden: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'accessTokenExpiresAt',
      type: 'datetime',
      description: 'When the cached access token expires.',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'scopes',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      description: 'Scopes Google actually granted (may be subset of requested).',
      validation: (rule) => rule.required().min(1),
    }),
    defineField({
      name: 'calendars',
      type: 'array',
      description: 'Cached calendar list from Google. Refreshed on demand.',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'calendarRef',
          fields: [
            defineField({ name: 'calendarId', type: 'string', validation: (r) => r.required() }),
            defineField({ name: 'summary', type: 'string', validation: (r) => r.required() }),
            defineField({ name: 'primary', type: 'boolean', initialValue: false }),
            defineField({
              name: 'conflictCheck',
              type: 'boolean',
              initialValue: true,
              description: 'Reserved for future use (slot generator spec).',
            }),
          ],
          preview: {
            select: { title: 'summary', primary: 'primary' },
            prepare: ({ title, primary }) => ({
              title: title ?? 'Unnamed calendar',
              subtitle: primary ? 'Primary' : undefined,
            }),
          },
        }),
      ],
    }),
    defineField({
      name: 'writeTargetCalendarId',
      type: 'string',
      description: 'Calendar where booking events will be written. Reserved for future spec.',
    }),
    defineField({
      name: 'connectedAt',
      type: 'datetime',
      readOnly: true,
      validation: (rule) => rule.required(),
    }),
  ],
  preview: {
    select: { email: 'googleEmail', userName: 'user.displayName' },
    prepare: ({ email, userName }) => ({
      title: userName ? `${userName} → Google` : email ?? 'Google connection',
      subtitle: email,
    }),
  },
})
```

- [ ] **Step 2: Register the type in `sanity/schemaTypes/index.ts`**

Current file:

```ts
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
    // Objects
    timeInterval,
    daySchedule,
    location,
  ],
}
```

Add the import and include in the `types` array. Final state:

```ts
import { type SchemaTypeDefinition } from 'sanity'
import { userType } from './documents/userType'
import { availabilityType } from './documents/availabilityType'
import { meetingType } from './documents/meetingType'
import { bookingType } from './documents/bookingType'
import { googleCalendarConnectionType } from './documents/googleCalendarConnectionType'

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
    googleCalendarConnectionType,
    // Objects
    timeInterval,
    daySchedule,
    location,
  ],
}
```

- [ ] **Step 3: Verify TS + lint**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint sanity/`
Expected: clean.

- [ ] **Step 4: Verify Studio renders the new type**

Run: `pnpm dev`
Open: `http://localhost:3000/studio` (signed in)
Expected: a new "Google Calendar connection" item appears in the Studio sidebar (alongside Host, Schedule, Event type, Booking). No documents exist yet — the list is empty.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add sanity/schemaTypes/documents/googleCalendarConnectionType.ts sanity/schemaTypes/index.ts
git commit -m "feat(sanity): add googleCalendarConnectionType document schema"
```

---

## Task 3: Google OAuth client + Calendar API wrappers

**Files:**
- Create: `lib/google/oauthClient.ts`
- Create: `lib/google/calendarApi.ts`

- [ ] **Step 1: Create the OAuth client module**

Path: `lib/google/oauthClient.ts`

```ts
import 'server-only'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
] as const

export const REQUIRED_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
] as const

function envOrThrow(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`Missing ${key} env var`)
  return v
}

export function buildAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: envOrThrow('GOOGLE_OAUTH_CLIENT_ID'),
    redirect_uri: envOrThrow('GOOGLE_OAUTH_REDIRECT_URI'),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

export interface TokenExchangeResult {
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string
  id_token?: string
  token_type: string
}

export async function exchangeCodeForTokens(code: string): Promise<TokenExchangeResult> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: envOrThrow('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: envOrThrow('GOOGLE_OAUTH_CLIENT_SECRET'),
      redirect_uri: envOrThrow('GOOGLE_OAUTH_REDIRECT_URI'),
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '<unreadable>')
    throw new Error(`Google token exchange failed: ${res.status} ${body}`)
  }
  return (await res.json()) as TokenExchangeResult
}

export interface RefreshTokenResult {
  access_token: string
  expires_in: number
  scope: string
  token_type: string
}

export async function refreshAccessToken(refreshToken: string): Promise<RefreshTokenResult> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: envOrThrow('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: envOrThrow('GOOGLE_OAUTH_CLIENT_SECRET'),
    }),
  })
  if (res.status === 400 || res.status === 401) {
    throw new GoogleConnectionRevokedError()
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '<unreadable>')
    throw new Error(`Google token refresh failed: ${res.status} ${body}`)
  }
  return (await res.json()) as RefreshTokenResult
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  // Best-effort; callers should swallow errors.
  await fetch(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
}

export class GoogleConnectionRevokedError extends Error {
  constructor() {
    super('Google connection revoked or invalid')
    this.name = 'GoogleConnectionRevokedError'
  }
}
```

- [ ] **Step 2: Create the Calendar API wrappers**

Path: `lib/google/calendarApi.ts`

```ts
import 'server-only'

const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const CALENDAR_LIST_URL = 'https://www.googleapis.com/calendar/v3/users/me/calendarList'

export interface UserInfo {
  email: string
  sub: string
}

export interface CalendarRef {
  calendarId: string
  summary: string
  primary: boolean
}

export async function fetchUserInfoWithToken(accessToken: string): Promise<UserInfo> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Google userinfo failed: ${res.status}`)
  const json = (await res.json()) as { email: string; id: string }
  return { email: json.email, sub: json.id }
}

interface CalendarListEntry {
  id: string
  summary: string
  primary?: boolean
}

interface CalendarListResponse {
  items?: CalendarListEntry[]
}

export async function fetchCalendarListWithToken(accessToken: string): Promise<CalendarRef[]> {
  const res = await fetch(CALENDAR_LIST_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Google calendarList failed: ${res.status}`)
  const json = (await res.json()) as CalendarListResponse
  return (json.items ?? []).map((item) => ({
    calendarId: item.id,
    summary: item.summary,
    primary: item.primary === true,
  }))
}
```

- [ ] **Step 3: Verify TS + lint**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint lib/google/`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add lib/google/oauthClient.ts lib/google/calendarApi.ts
git commit -m "feat(google): add OAuth client and Calendar API wrappers"
```

---

## Task 4: `getValidAccessToken` helper

**Files:**
- Create: `lib/google/getValidAccessToken.ts`

- [ ] **Step 1: Create the helper**

Path: `lib/google/getValidAccessToken.ts`

```ts
import 'server-only'

import { serverClient } from '@/sanity/lib/serverClient'
import { encrypt, decrypt } from '@/lib/crypto/tokenCipher'
import { GoogleConnectionRevokedError, refreshAccessToken } from './oauthClient'

export class GoogleConnectionMissingError extends Error {
  constructor() {
    super('No Google connection on file')
    this.name = 'GoogleConnectionMissingError'
  }
}

export { GoogleConnectionRevokedError }

const REFRESH_LEEWAY_MS = 60_000

interface ConnectionDoc {
  _id: string
  refreshTokenCipher: string
  accessTokenCipher: string
  accessTokenExpiresAt: string
}

export async function getValidAccessToken(clerkId: string): Promise<string> {
  const id = `gcal.${clerkId}`
  const doc = await serverClient.getDocument<ConnectionDoc>(id)
  if (!doc) throw new GoogleConnectionMissingError()

  const expiresAt = new Date(doc.accessTokenExpiresAt).getTime()
  if (expiresAt - Date.now() > REFRESH_LEEWAY_MS) {
    return decrypt(doc.accessTokenCipher)
  }

  const refreshToken = decrypt(doc.refreshTokenCipher)
  const refreshed = await refreshAccessToken(refreshToken)

  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
  await serverClient
    .patch(id)
    .set({
      accessTokenCipher: encrypt(refreshed.access_token),
      accessTokenExpiresAt: newExpiresAt,
    })
    .commit()

  return refreshed.access_token
}
```

> Note: `GoogleConnectionRevokedError` is thrown by `refreshAccessToken` (defined in Task 3) on Google's `400`/`401` responses, which propagates up to callers of `getValidAccessToken` unchanged.

- [ ] **Step 2: Verify TS + lint**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint lib/google/getValidAccessToken.ts`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/google/getValidAccessToken.ts
git commit -m "feat(google): add lazy access-token refresh helper"
```

---

## Task 5: OAuth `/start` route

**Files:**
- Create: `app/api/auth/google/start/route.ts`

- [ ] **Step 1: Create the route**

Path: `app/api/auth/google/start/route.ts`

```ts
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createHmac, randomBytes } from 'crypto'

import { buildAuthorizationUrl } from '@/lib/google/oauthClient'

const STATE_COOKIE = 'gcal_oauth_state'
const STATE_COOKIE_PATH = '/api/auth/google'
const STATE_COOKIE_MAX_AGE_S = 300

function loadSigningKey(): Buffer {
  const raw = process.env.OAUTH_STATE_SIGNING_KEY
  if (!raw) throw new Error('Missing OAUTH_STATE_SIGNING_KEY env var')
  return Buffer.from(raw, 'base64')
}

function signNonce(nonce: string): string {
  return createHmac('sha256', loadSigningKey()).update(nonce).digest('base64url')
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) redirect('/')

  const nonce = randomBytes(32).toString('base64url')
  const signature = signNonce(nonce)
  const cookieValue = `${nonce}.${signature}`

  const cookieStore = await cookies()
  cookieStore.set(STATE_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: STATE_COOKIE_PATH,
    maxAge: STATE_COOKIE_MAX_AGE_S,
  })

  redirect(buildAuthorizationUrl(nonce))
}
```

- [ ] **Step 2: Verify TS + lint**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint "app/api/auth/google/start/route.ts"`
Expected: clean.

- [ ] **Step 3: Smoke-test the route**

Run: `pnpm dev`
Open `http://localhost:3000/api/auth/google/start` while signed in.
Expected: browser redirects to `accounts.google.com/o/oauth2/v2/auth?...`. **Stop at the consent screen — don't click Allow yet.** The callback route doesn't exist.
DevTools → Application → Cookies → `localhost:3000`: confirm `gcal_oauth_state` cookie is set on path `/api/auth/google`, httpOnly, sameSite=Lax, expires in ~5 min.

If signed out: navigates to `/`. Expected.

Close the consent tab without authorizing. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/api/auth/google/start/route.ts
git commit -m "feat(auth): add Google OAuth start route with HMAC-signed state cookie"
```

---

## Task 6: OAuth `/callback` route

**Files:**
- Create: `app/api/auth/google/callback/route.ts`

- [ ] **Step 1: Create the callback route**

Path: `app/api/auth/google/callback/route.ts`

```ts
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createHmac, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

import { serverClient } from '@/sanity/lib/serverClient'
import { encrypt } from '@/lib/crypto/tokenCipher'
import {
  exchangeCodeForTokens,
  REQUIRED_CALENDAR_SCOPES,
} from '@/lib/google/oauthClient'
import {
  fetchUserInfoWithToken,
  fetchCalendarListWithToken,
} from '@/lib/google/calendarApi'

const STATE_COOKIE = 'gcal_oauth_state'
const STATE_COOKIE_PATH = '/api/auth/google'

function loadSigningKey(): Buffer {
  const raw = process.env.OAUTH_STATE_SIGNING_KEY
  if (!raw) throw new Error('Missing OAUTH_STATE_SIGNING_KEY env var')
  return Buffer.from(raw, 'base64')
}

function verifyState(nonce: string, signature: string): boolean {
  const expected = createHmac('sha256', loadSigningKey()).update(nonce).digest('base64url')
  if (expected.length !== signature.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}

async function clearStateCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(STATE_COOKIE, '', { path: STATE_COOKIE_PATH, maxAge: 0 })
}

export async function GET(req: NextRequest) {
  const { userId: clerkId } = await auth()
  if (!clerkId) redirect('/')

  const url = new URL(req.url)
  const error = url.searchParams.get('error')
  if (error === 'access_denied') {
    await clearStateCookie()
    redirect('/availability?connected=cancelled')
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  const cookieStore = await cookies()
  const cookie = cookieStore.get(STATE_COOKIE)?.value

  // Always clear the cookie regardless of outcome.
  const failState = async () => {
    await clearStateCookie()
    redirect('/availability?connected=error&reason=state')
  }

  if (!cookie || !code || !state) {
    await failState()
  }

  const dotIdx = cookie!.indexOf('.')
  if (dotIdx <= 0) await failState()
  const nonce = cookie!.slice(0, dotIdx)
  const signature = cookie!.slice(dotIdx + 1)
  if (state !== nonce || !verifyState(nonce, signature)) {
    await failState()
  }

  await clearStateCookie()

  let tokens
  try {
    tokens = await exchangeCodeForTokens(code!)
  } catch (err) {
    console.error('Google token exchange failed:', err)
    redirect('/availability?connected=error&reason=exchange')
  }

  const grantedScopes = tokens.scope.split(' ')
  const allRequired = REQUIRED_CALENDAR_SCOPES.every((s) => grantedScopes.includes(s))
  if (!allRequired) {
    redirect('/availability?connected=error&reason=scopes')
  }

  let userInfo
  let calendars
  try {
    userInfo = await fetchUserInfoWithToken(tokens.access_token)
    calendars = await fetchCalendarListWithToken(tokens.access_token)
  } catch (err) {
    console.error('Google user/calendar fetch failed:', err)
    redirect('/availability?connected=error&reason=exchange')
  }

  const primaryCalendar = calendars.find((c) => c.primary)
  const id = `gcal.${clerkId}`
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  try {
    await serverClient.createOrReplace({
      _id: id,
      _type: 'googleCalendarConnectionType',
      user: { _type: 'reference', _ref: `user.${clerkId}` },
      clerkId,
      googleEmail: userInfo.email,
      refreshTokenCipher: encrypt(tokens.refresh_token),
      accessTokenCipher: encrypt(tokens.access_token),
      accessTokenExpiresAt: expiresAt,
      scopes: grantedScopes,
      calendars: calendars.map((c) => ({
        _key: c.calendarId,
        ...c,
        conflictCheck: true,
      })),
      writeTargetCalendarId: primaryCalendar?.calendarId,
      connectedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Sanity write of googleCalendarConnection failed:', err)
    redirect('/availability?connected=error&reason=storage')
  }

  revalidatePath('/availability')
  redirect('/availability?connected=ok')
}
```

> Notes:
> - The callback uses Next 16's `redirect()` from `next/navigation` inside a route handler, which throws a special non-error to short-circuit the response. Don't wrap `redirect(...)` calls in try/catch — they need to bubble.
> - The `_key` on each `calendarRef` is the `calendarId`, which is unique per Google account by definition. Stable, deterministic, no UUID needed.
> - `failState` is an async helper but `redirect` doesn't return — the `await failState()` call pattern looks unusual. The non-null assertions on `cookie!` after the `await failState()` calls are safe because `redirect` throws.

- [ ] **Step 2: Verify TS + lint**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint "app/api/auth/google/callback/route.ts"`
Expected: clean. If lint complains about the non-null assertions, that's expected — leave them; they're correct because `redirect` throws.

- [ ] **Step 3: End-to-end smoke test**

Run: `pnpm dev`

In an incognito window:
1. Sign in.
2. Navigate to `http://localhost:3000/api/auth/google/start`.
3. Complete Google's consent screen → click Allow.
4. Browser should land on `http://localhost:3000/availability?connected=ok` (the page may render before the Calendar settings tab is wired — that's Task 9. The redirect URL is what we're verifying here.)
5. Open Sanity Studio (`/studio`). Navigate to **Google Calendar connection**. Confirm a doc with `_id = gcal.<your-clerkId>` exists with:
   - `googleEmail` = your Gmail
   - `refreshTokenCipher` and `accessTokenCipher` are hidden in Studio (the schema's `hidden: true` does this). If you temporarily edit the schema to show them, they should be base64 strings starting with `AQ` (the `0x01` version byte).
   - `scopes` includes both `calendar.readonly` and `calendar.events`.
   - `calendars` is non-empty with at least one entry where `primary: true`.

If step 4 redirected to an `error` URL, read the `reason` and check the dev server logs for the corresponding error.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/api/auth/google/callback/route.ts
git commit -m "feat(auth): add Google OAuth callback route with state verification and token storage"
```

---

## Task 7: Calendar settings tab server actions + types

**Files:**
- Create: `app/(admin)/availability/calendar/types.ts`
- Create: `app/(admin)/availability/calendar/actions.ts`

- [ ] **Step 1: Create the types file**

Path: `app/(admin)/availability/calendar/types.ts`

```ts
export interface PublicCalendarRef {
  calendarId: string
  summary: string
  primary: boolean
}

export interface GoogleConnectionPublic {
  googleEmail: string
  calendars: PublicCalendarRef[]
  connectedAt: string
}
```

This is the cipher-stripped shape passed from the server component to the client. It contains nothing secret.

- [ ] **Step 2: Create the actions file**

Path: `app/(admin)/availability/calendar/actions.ts`

```ts
'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { serverClient } from '@/sanity/lib/serverClient'
import { decrypt } from '@/lib/crypto/tokenCipher'
import {
  GoogleConnectionRevokedError,
  revokeRefreshToken,
} from '@/lib/google/oauthClient'
import {
  GoogleConnectionMissingError,
  getValidAccessToken,
} from '@/lib/google/getValidAccessToken'
import { fetchCalendarListWithToken } from '@/lib/google/calendarApi'
import type { PublicCalendarRef } from './types'

const docIdFor = (clerkId: string) => `gcal.${clerkId}`

async function requireClerkId(): Promise<string> {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthenticated')
  return userId
}

export async function disconnectGoogle(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const clerkId = await requireClerkId()
    const id = docIdFor(clerkId)
    const doc = await serverClient.getDocument<{ refreshTokenCipher?: string }>(id)

    if (doc?.refreshTokenCipher) {
      try {
        const refreshToken = decrypt(doc.refreshTokenCipher)
        await revokeRefreshToken(refreshToken)
      } catch (err) {
        // Best-effort revocation. Log but don't block the local delete.
        console.warn('Google revocation failed (continuing with local delete):', err)
      }
    }

    await serverClient.delete(id)
    revalidatePath('/availability')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function refreshCalendarList(): Promise<
  | { ok: true; calendars: PublicCalendarRef[] }
  | { ok: false; error: 'revoked' | 'missing' | 'unknown' }
> {
  try {
    const clerkId = await requireClerkId()
    let accessToken: string
    try {
      accessToken = await getValidAccessToken(clerkId)
    } catch (err) {
      if (err instanceof GoogleConnectionRevokedError) {
        // Refresh token rejected by Google — connection is dead. Hard delete locally.
        await serverClient.delete(docIdFor(clerkId)).catch(() => {})
        revalidatePath('/availability')
        return { ok: false, error: 'revoked' }
      }
      if (err instanceof GoogleConnectionMissingError) {
        return { ok: false, error: 'missing' }
      }
      throw err
    }

    const fresh = await fetchCalendarListWithToken(accessToken)
    const calendars: PublicCalendarRef[] = fresh.map((c) => ({
      calendarId: c.calendarId,
      summary: c.summary,
      primary: c.primary,
    }))

    await serverClient
      .patch(docIdFor(clerkId))
      .set({
        calendars: fresh.map((c) => ({
          _key: c.calendarId,
          ...c,
          conflictCheck: true,
        })),
      })
      .commit()

    revalidatePath('/availability')
    return { ok: true, calendars }
  } catch (err) {
    console.error('refreshCalendarList unexpected error:', err)
    return { ok: false, error: 'unknown' }
  }
}
```

> Notes:
> - `disconnectGoogle` patches the doc shape only with the public fields a refresh would change — `_key`, `calendarId`, `summary`, `primary`, `conflictCheck`. We deliberately preserve `conflictCheck: true` defaults on every refresh to keep the data shape consistent. If a future spec wires per-calendar conflict-check toggles, this default will be replaced by reading existing flags from the doc and merging.
> - `await serverClient.delete(...).catch(() => {})` — the delete is best-effort because the doc may already be gone (rare race).

- [ ] **Step 3: Verify TS + lint**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint "app/(admin)/availability/calendar/"`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/availability/calendar/types.ts" "app/(admin)/availability/calendar/actions.ts"
git commit -m "feat(availability): add calendar settings server actions"
```

---

## Task 8: page.tsx + AvailabilityEditor + CalendarSettingsTab (combined)

**Files:**
- Modify: `app/(admin)/availability/page.tsx`
- Modify: `app/(admin)/availability/AvailabilityEditor.tsx`
- Create: `app/(admin)/availability/calendar/CalendarSettingsTab.tsx`

This is the largest task — it wires the new prop end-to-end. **Single commit** at the end because the page is broken if you ship any subset (e.g. AvailabilityEditor expecting a `googleConnection` prop that page.tsx doesn't pass).

- [ ] **Step 1: Replace `app/(admin)/availability/page.tsx`**

Current state (already on disk):

```tsx
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

import { serverClient } from '@/sanity/lib/serverClient'
import AvailabilityEditor from './AvailabilityEditor'
import { defaultSundayFirstSchedule } from './defaults'
import type { AvailabilityDoc } from './types'

export default async function AvailabilityPage() {
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
}
```

Replace with:

```tsx
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

import { serverClient } from '@/sanity/lib/serverClient'
import AvailabilityEditor from './AvailabilityEditor'
import { defaultSundayFirstSchedule } from './defaults'
import type { AvailabilityDoc } from './types'
import type { GoogleConnectionPublic } from './calendar/types'

interface ConnectionDocFromSanity {
  googleEmail: string
  calendars?: Array<{ calendarId: string; summary: string; primary?: boolean }>
  connectedAt: string
}

async function ensureAvailabilityDoc(clerkId: string): Promise<AvailabilityDoc> {
  const id = `availability.${clerkId}`
  const existing = await serverClient.getDocument<AvailabilityDoc>(id)
  if (existing) return existing
  return serverClient.createIfNotExists({
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

async function fetchGoogleConnection(clerkId: string): Promise<GoogleConnectionPublic | null> {
  const doc = await serverClient.getDocument<ConnectionDocFromSanity>(`gcal.${clerkId}`)
  if (!doc) return null
  return {
    googleEmail: doc.googleEmail,
    connectedAt: doc.connectedAt,
    calendars: (doc.calendars ?? []).map((c) => ({
      calendarId: c.calendarId,
      summary: c.summary,
      primary: c.primary === true,
    })),
  }
}

export default async function AvailabilityPage() {
  const { userId: clerkId } = await auth()
  if (!clerkId) redirect('/')

  const [availabilityDoc, googleConnection] = await Promise.all([
    ensureAvailabilityDoc(clerkId),
    fetchGoogleConnection(clerkId),
  ])

  return <AvailabilityEditor initialData={availabilityDoc} googleConnection={googleConnection} />
}
```

> Note: the `AvailabilityEditor` import doesn't yet have the `googleConnection` prop in its type — TypeScript will error here until Step 2 adds it. That's expected for a combined-commit task.

- [ ] **Step 2: Modify `app/(admin)/availability/AvailabilityEditor.tsx`**

Two changes:

**(a)** Update the prop signature.

Find:

```tsx
export default function AvailabilityEditor({ initialData }: { initialData: AvailabilityDoc }) {
```

Replace with:

```tsx
export default function AvailabilityEditor({
  initialData,
  googleConnection,
}: {
  initialData: AvailabilityDoc
  googleConnection: GoogleConnectionPublic | null
}) {
```

And add the import near the existing types import:

```tsx
import type { GoogleConnectionPublic } from './calendar/types';
```

**(b)** Replace the entire static `Calendar settings` tab block with the new component. Find this block (lines around the `activeTab === 'Calendar settings'` block — the verbatim copy of the old static UI):

```tsx
{activeTab === 'Calendar settings' && (
  <motion.div key="calendar-settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
    {/* UNCHANGED — copied verbatim from the old page.tsx */}
    {/* ... lots of static UI ... */}
  </motion.div>
)}
```

Replace with:

```tsx
{activeTab === 'Calendar settings' && (
  <motion.div key="calendar-settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
    <CalendarSettingsTab connection={googleConnection} />
  </motion.div>
)}
```

And add the import near the other component-relative imports:

```tsx
import CalendarSettingsTab from './calendar/CalendarSettingsTab';
```

The `Calendar` icon import from `lucide-react` (currently used inside the static block we're replacing) may become unused after this edit. If lint flags it as unused, remove it from the import list:

```tsx
import { Plus, Trash2, Globe, Check } from 'lucide-react';
```

(Drop `Calendar` from the import list.)

- [ ] **Step 3: Create `CalendarSettingsTab.tsx`**

Path: `app/(admin)/availability/calendar/CalendarSettingsTab.tsx`

```tsx
'use client';

import React, { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Calendar, Check, RefreshCw, Unlink } from 'lucide-react';

import { disconnectGoogle, refreshCalendarList } from './actions';
import type { GoogleConnectionPublic, PublicCalendarRef } from './types';

interface BannerInfo {
  tone: 'green' | 'red' | 'slate';
  message: string;
}

function bannerForParam(connected: string | null, reason: string | null): BannerInfo | null {
  if (!connected) return null;
  if (connected === 'ok') return { tone: 'green', message: 'Google Calendar connected.' };
  if (connected === 'cancelled') return { tone: 'slate', message: 'Connection cancelled.' };
  if (connected === 'error') {
    if (reason === 'state') return { tone: 'red', message: 'Connection failed (security check). Please try again.' };
    if (reason === 'exchange') return { tone: 'red', message: "Couldn't reach Google. Please try again." };
    if (reason === 'scopes') return { tone: 'red', message: "Required calendar permissions weren't granted." };
    if (reason === 'storage') return { tone: 'red', message: 'Saved your Google access but couldn’t store it. Please retry.' };
    return { tone: 'red', message: 'Connection failed. Please try again.' };
  }
  return null;
}

const TONE_STYLES: Record<BannerInfo['tone'], string> = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  slate: 'bg-slate-50 text-slate-700 border-slate-200',
};

export default function CalendarSettingsTab({ connection }: { connection: GoogleConnectionPublic | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialBanner = bannerForParam(searchParams.get('connected'), searchParams.get('reason'));
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [revokedBanner, setRevokedBanner] = useState<string | null>(null);

  const [calendars, setCalendars] = useState<PublicCalendarRef[]>(connection?.calendars ?? []);
  const [disconnectPending, startDisconnectTransition] = useTransition();
  const [refreshPending, startRefreshTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  const onDisconnect = () => {
    setActionError(null);
    setRevokedBanner(null);
    startDisconnectTransition(async () => {
      const result = await disconnectGoogle();
      if (result.ok) {
        router.refresh();
      } else {
        setActionError(result.error);
      }
    });
  };

  const onRefresh = () => {
    setActionError(null);
    setRevokedBanner(null);
    startRefreshTransition(async () => {
      const result = await refreshCalendarList();
      if (result.ok) {
        setCalendars(result.calendars);
        router.refresh();
      } else if (result.error === 'revoked') {
        setRevokedBanner('Your Google connection was revoked. Please reconnect.');
        router.refresh();
      } else if (result.error === 'missing') {
        setRevokedBanner('Your Google connection is no longer on file. Please reconnect.');
        router.refresh();
      } else {
        setActionError("Couldn't refresh your calendar list. Please try again.");
      }
    });
  };

  const showBanner = initialBanner && !bannerDismissed;

  return (
    <>
      <div className="px-6 sm:px-10 py-8 border-b border-gray-100 bg-white/60">
        <h2 className="text-2xl font-bold text-[#0B3558] tracking-tight">Connected Calendars</h2>
      </div>

      <div className="p-6 sm:px-10 sm:py-8">
        {showBanner && (
          <div className={`mb-6 flex items-start justify-between gap-3 px-4 py-3 rounded-xl border ${TONE_STYLES[initialBanner.tone]}`}>
            <span className="text-sm font-medium">{initialBanner.message}</span>
            <button
              onClick={() => setBannerDismissed(true)}
              className="text-current opacity-60 hover:opacity-100 text-sm font-bold leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {revokedBanner && (
          <div className={`mb-6 flex items-start justify-between gap-3 px-4 py-3 rounded-xl border ${TONE_STYLES.red}`}>
            <span className="text-sm font-medium">{revokedBanner}</span>
            <button
              onClick={() => setRevokedBanner(null)}
              className="text-current opacity-60 hover:opacity-100 text-sm font-bold leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {!connection ? (
          <div className="flex flex-col items-start gap-4 max-w-xl">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                <Calendar className="w-6 h-6 text-slate-600" />
              </div>
              <div>
                <h3 className="font-bold text-[#0B3558] text-lg">No calendar connected</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Connect your Google Calendar to (eventually) prevent double bookings and add events to your calendar automatically.
                </p>
              </div>
            </div>
            <a
              href="/api/auth/google/start"
              className="bg-[#1A73E8] hover:bg-[#155DB1] text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200 text-sm shadow-md hover:shadow-lg flex items-center justify-center gap-2"
            >
              <Calendar className="w-4 h-4" />
              Connect Google Calendar
            </a>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-4 p-5 border border-gray-200 rounded-2xl bg-white shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                  <Calendar className="w-6 h-6 text-slate-600" />
                </div>
                <div>
                  <h3 className="font-bold text-[#0B3558] text-lg">{connection.googleEmail}</h3>
                  <p className="text-sm text-slate-500 font-medium mt-0.5">
                    Connected on {new Date(connection.connectedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <button
                onClick={onDisconnect}
                disabled={disconnectPending}
                className="bg-white hover:bg-red-50 disabled:bg-slate-50 disabled:cursor-not-allowed text-red-600 border border-red-200 px-4 py-2 rounded-xl font-semibold transition-all duration-200 text-sm flex items-center justify-center gap-2"
              >
                {disconnectPending ? (
                  <span className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Unlink className="w-4 h-4" />
                )}
                {disconnectPending ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>

            <div className="flex items-center justify-between">
              <h3 className="font-bold text-[#0B3558] text-lg">Your calendars</h3>
              <button
                onClick={onRefresh}
                disabled={refreshPending}
                className="text-[#1A73E8] hover:bg-blue-50 disabled:opacity-50 px-3 py-1.5 rounded-lg font-semibold text-sm flex items-center gap-2"
              >
                {refreshPending ? (
                  <span className="w-4 h-4 border-2 border-[#1A73E8] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Refresh list
              </button>
            </div>

            <ul className="flex flex-col gap-2">
              {calendars.map((cal) => (
                <li
                  key={cal.calendarId}
                  className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-xl"
                >
                  <Check className="w-4 h-4 text-slate-400" />
                  <span className="font-semibold text-[#0B3558]">{cal.summary}</span>
                  {cal.primary && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="text-xs font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full"
                    >
                      Primary
                    </motion.span>
                  )}
                </li>
              ))}
            </ul>

            <p className="text-sm text-slate-500 italic">
              These calendars will be available for conflict checks and event creation in a future update.
            </p>

            {actionError && (
              <p className="text-sm font-medium text-red-600 bg-red-50 px-3 py-2 rounded-lg">{actionError}</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
```

> Notes:
> - Uses `useRouter().refresh()` after every successful action so the server component re-fetches the connection doc and the page state stays consistent.
> - `useSearchParams()` requires the component to be a client component (which it is — `'use client'` at the top). For Next 16 pages with searchParams, this is the idiomatic pattern.
> - The `motion` import from `framer-motion` is used only for the "Primary" badge entry animation — kept lightweight.
> - `RefreshCw` and `Unlink` icons are from `lucide-react` and exist in the v1.11+ icon set we're already using.

- [ ] **Step 4: Verify TS + lint**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint "app/(admin)/availability/"`
Expected: clean.

If `pnpm exec eslint` reports `Calendar` as unused in `AvailabilityEditor.tsx`, you missed the import-list edit in Step 2 — go back and remove `Calendar` from the lucide-react import.

- [ ] **Step 5: End-to-end smoke test**

Run: `pnpm dev`
Open: `http://localhost:3000/availability` (signed in)
- Tab into Calendar settings.
- If you completed Task 6's smoke test and the connection still exists in Sanity Studio: you should see the **connected state** with your email + calendar list. The `?connected=ok` banner from earlier may still be in the URL — dismiss it with the ×.
- Otherwise: you should see the **disconnected state** with the Connect Google Calendar button.

Click Connect (if disconnected) → complete consent at Google → back at `/availability?connected=ok` showing the green banner + connected state.

Click **Refresh list** → spinner spins for ~500ms → list re-renders (likely identical content).

Click **Disconnect** → spinner appears → page rerenders to disconnected state with the Connect button. In Sanity Studio confirm the doc is gone.

Click Connect again → consent flows again (because of `prompt=consent`) → connected state again.

Stop the dev server.

- [ ] **Step 6: Commit (single commit for all three files)**

```bash
git add "app/(admin)/availability/page.tsx" "app/(admin)/availability/AvailabilityEditor.tsx" "app/(admin)/availability/calendar/CalendarSettingsTab.tsx"
git commit -m "feat(availability): wire Calendar settings tab to Google connection"
```

---

## Task 9: Extend Clerk webhook for cascading deletes

**Files:**
- Modify: `app/api/webhooks/clerk/route.ts`

- [ ] **Step 1: Update the `user.deleted` case**

Path: `app/api/webhooks/clerk/route.ts`

Find this block:

```ts
case 'user.deleted':
  if (evt.data.id) {
    await serverClient.delete(docIdFor(evt.data.id))
  }
  return Response.json({ ok: true })
```

Replace with:

```ts
case 'user.deleted':
  if (evt.data.id) {
    const id = evt.data.id
    await Promise.allSettled([
      serverClient.delete(`user.${id}`),
      serverClient.delete(`availability.${id}`),
      serverClient.delete(`gcal.${id}`),
    ])
  }
  return Response.json({ ok: true })
```

> Note: `Promise.allSettled` (not `Promise.all`) so a missing dependent doc (e.g. user signed up but never visited /availability) doesn't block the user delete. The existing `docIdFor(clerkId)` helper at the bottom of the file (`= \`user.${clerkId}\``) is now redundant — leave it; it's used by the `syncUser` helper above.

- [ ] **Step 2: Verify TS + lint**

Run: `pnpm exec tsc --noEmit && pnpm exec eslint "app/api/webhooks/clerk/route.ts"`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/api/webhooks/clerk/route.ts
git commit -m "feat(webhooks): cascade user.deleted to availability and gcal docs"
```

---

## Task 10: Final end-to-end verification + PR

**Files:** None (manual verification only).

Walk through the spec's full verification checklist on the dev server. If anything fails, fix it and add a follow-up task; do not skip.

- [ ] **Step 1: Pre-flight key check**

Confirm `TOKEN_ENCRYPTION_KEY` and `OAUTH_STATE_SIGNING_KEY` are set in `.env.local` AND on Vercel (Production / Preview / Development). Run:

```bash
node -e "console.log('TOKEN_ENCRYPTION_KEY length:', Buffer.from(process.env.TOKEN_ENCRYPTION_KEY||'','base64').length, 'OAUTH_STATE_SIGNING_KEY length:', Buffer.from(process.env.OAUTH_STATE_SIGNING_KEY||'','base64').length)" 2>&1
```

(Run this from a shell that has loaded `.env.local`. If not, just spot-check the keys are present — both should base64-decode to 32 bytes.)

- [ ] **Step 2: First connect — golden path**

Run `pnpm dev`. In an incognito window, sign in. Calendar settings tab → Connect → complete consent → return to `/availability?connected=ok` with green banner. Connected state shows your email + calendar list with primary tagged.

In Studio: doc with `_id = gcal.<clerkId>` exists. `refreshTokenCipher`/`accessTokenCipher` are hidden. `scopes` contains both Calendar scopes. `calendars` non-empty.

- [ ] **Step 3: Refresh calendar list**

Click Refresh list → success → list re-renders. (Token still valid — uses non-refresh path of `getValidAccessToken`.)

- [ ] **Step 4: Token refresh path exercised**

In Studio, edit your `gcal.<clerkId>` doc. Set `accessTokenExpiresAt` to a past timestamp (e.g. yesterday). Save.

Reload `/availability`. Click Refresh list → spinner → list refreshes successfully → reload Studio doc and confirm `accessTokenExpiresAt` is now ~1 hour in the future.

- [ ] **Step 5: Disconnect — golden path**

Click Disconnect → spinner → disconnected state. Studio: doc gone. Google Account → Security → Third-party apps with account access: Calendry no longer listed (or shows "Access removed"). This proves revocation hit Google.

- [ ] **Step 6: Reconnect after disconnect**

Click Connect again → consent screen reappears (`prompt=consent` ensures this) → Allow → fresh doc with new `connectedAt`.

- [ ] **Step 7: Cancellation at consent screen**

Click Connect → at Google's screen click Cancel/Deny → returns to `/availability?connected=cancelled` with slate banner. No doc created.

- [ ] **Step 8: CSRF protection**

Click Connect. Before reaching Google, open DevTools → Application → Cookies → `localhost:3000`. Find `gcal_oauth_state`, edit its value to garbage. Complete consent at Google → callback redirects to `?connected=error&reason=state` with red banner. No tokens stored.

- [ ] **Step 9: Revocation simulation**

Connect normally. Then in Google Account → Security → Third-party access, manually revoke Calendry.

In the app, click Refresh list. Expected: red banner "Your Google connection was revoked. Please reconnect." Studio: the `gcal.<clerkId>` doc is auto-deleted.

- [ ] **Step 10: Cross-user isolation**

Sign in as a second test user. Connect their Google. Sign back in as user 1 — connection unchanged. Two separate `gcal.<clerkId>` docs in Studio.

- [ ] **Step 11: Webhook cleanup — Clerk user delete**

Delete a test user from Clerk's dashboard. Confirm in Studio that all three docs (`user.<clerkId>`, `availability.<clerkId>`, `gcal.<clerkId>`) are gone within ~5 seconds.

- [ ] **Step 12: Build + deploy parity**

Run: `pnpm build`
Expected: clean.

- [ ] **Step 13: Update memory**

Update `C:\Users\Walaa\.claude\projects\c--dev-calendry\memory\project_calendry_state.md`:
- Mark Spec 2 (Google Calendar OAuth — connection management) as DONE.
- List the new env vars (`TOKEN_ENCRYPTION_KEY`, `OAUTH_STATE_SIGNING_KEY`).
- Note that the next initiative is the slot generation engine (Spec 3).

- [ ] **Step 14: Open PR**

```bash
git push -u origin feat/google-calendar-oauth
gh pr create --title "feat(availability): wire Calendar settings tab to Google Calendar OAuth (Spec 2)" --body "$(cat <<'EOF'
## Summary
- New `googleCalendarConnectionType` Sanity document (deterministic `_id = gcal.${clerkId}`)
- Versioned AES-256-GCM token cipher (`lib/crypto/tokenCipher.ts`)
- OAuth flow: `/api/auth/google/start` + `/api/auth/google/callback` with HMAC-signed state cookie
- Lazy-refresh helper `getValidAccessToken` with typed `GoogleConnectionRevokedError` / `GoogleConnectionMissingError`
- Calendar settings tab UI: Connect / Disconnect / read-only calendar list / Refresh list
- Best-effort revocation at Google on disconnect; cascading delete from Clerk webhook on user.deleted

## What's NOT in this PR (deferred to later specs)
- Per-calendar conflict-check toggles (no consumer yet)
- Write-target calendar dropdown (no consumer yet)
- Slot generation / freebusy queries (Spec 3)
- Booking flow / event creation (Spec 4)

## Required env vars
- `TOKEN_ENCRYPTION_KEY` (base64-encoded 32 bytes — `openssl rand -base64 32`)
- `OAUTH_STATE_SIGNING_KEY` (same generation pattern, separate value)
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` (already configured)

All on Vercel for Production / Preview / Development.

## Test plan
- [x] First connect → golden path
- [x] Refresh calendar list (token valid)
- [x] Refresh exercises token-refresh path (manually expired token)
- [x] Disconnect revokes at Google
- [x] Reconnect after disconnect
- [x] Cancellation at consent screen
- [x] CSRF: tampered state cookie rejected
- [x] Revocation: refresh list shows revoked banner, doc auto-deleted
- [x] Cross-user isolation
- [x] Webhook cascades user.deleted to availability + gcal
- [x] `pnpm build` clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Implemented in |
|---|---|
| Token cipher (versioned AES-256-GCM) | Task 1 |
| `googleCalendarConnectionType` schema | Task 2 |
| Schema registration + Studio sidebar | Task 2 (auto-listed via default `S.documentTypeListItems()`) |
| OAuth client (URL builder, code exchange, refresh, revoke) | Task 3 |
| Calendar API wrappers (userInfo, calendarList) | Task 3 |
| `getValidAccessToken` helper + typed errors | Task 4 |
| `/api/auth/google/start` route | Task 5 |
| `/api/auth/google/callback` route + 6-way error handling | Task 6 |
| `disconnectGoogle` + `refreshCalendarList` server actions | Task 7 |
| `GoogleConnectionPublic` cipher-stripped client type | Task 7 |
| `ensureAvailabilityDoc` extraction + `fetchGoogleConnection` | Task 8 |
| `CalendarSettingsTab` (disconnected / connected states + banner + refresh / disconnect) | Task 8 |
| AvailabilityEditor wiring with new prop | Task 8 |
| Clerk webhook cascading deletes | Task 9 |
| Verification plan (13 manual checks) | Task 10 |

**Placeholder scan:** No "TBD", "TODO", "implement later", or vague-error-handling notes. Each task contains complete code blocks. Type names are consistent across tasks (`GoogleConnectionPublic`, `PublicCalendarRef`, `GoogleConnectionRevokedError`, `GoogleConnectionMissingError`).

**Type consistency check:**
- `GoogleConnectionPublic` defined in Task 7 → consumed in Task 8 (page.tsx, AvailabilityEditor, CalendarSettingsTab). ✓
- `PublicCalendarRef` defined in Task 7 → consumed in Task 8 (CalendarSettingsTab). ✓
- `GoogleConnectionRevokedError` exported from Task 3 (oauthClient.ts) → re-exported from Task 4 (getValidAccessToken.ts) → caught in Task 7 (actions.ts). ✓
- `GoogleConnectionMissingError` defined in Task 4 → caught in Task 7. ✓
- `TokenExchangeResult` / `RefreshTokenResult` from Task 3 → consumed in Tasks 4 and 6. ✓
- `_id` namespace `gcal.${clerkId}` consistent across Tasks 4, 6, 7, 8, 9. ✓
- Cookie name `gcal_oauth_state` consistent across Tasks 5 and 6. ✓

**Spec-deviation summary:** The spec mentions a `sanity/structure.ts` change to add a "Google connections" group. The current `structure.ts` uses the default `S.documentTypeListItems()` which auto-lists every registered document — so the new connection type appears in the sidebar automatically without modifying `structure.ts`. The plan therefore omits this file from "Modified" and notes the deviation in the file-structure section above.

**Scope check:** Single bounded plan. Each task produces a working, reviewable change. Tasks 3+4 stand independent of each other, and Task 8 explicitly bundles three files because the page would otherwise break between commits (same pattern as Spec 1's Tasks 3+4).

**Bite-sized check:** Most tasks are 4–6 steps. Task 6 (callback route) and Task 8 (combined UI) are the largest at ~6 steps each — both genuinely require the bundled scope. No task hides multiple unrelated changes.

No gaps found.
