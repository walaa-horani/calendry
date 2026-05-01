# Google Calendar OAuth — connection management (Spec 2)

**Status:** Draft for review
**Date:** 2026-05-01
**Branch:** new working branch (e.g. `feat/google-calendar-oauth`) off `master`
**Predecessor specs:** [2026-04-28-sanity-schemas-design.md](./2026-04-28-sanity-schemas-design.md), [2026-05-01-availability-sanity-wiring-design.md](./2026-05-01-availability-sanity-wiring-design.md)
**Successor (deferred):** Slot generation engine + booking write path will consume the connection from this spec; their own specs.

## Goal

A signed-in host can connect their Google Calendar from the Calendar settings tab on /availability, see their connected email and calendar list, refresh the list on demand, and disconnect cleanly with revocation at Google's side.

## Non-goals

- Slot generation / conflict checks against booked time. The schema stores per-calendar `conflictCheck` flags as forward-compat metadata; no UI exposes them and no code reads them in this spec.
- Writing Google Calendar events for accepted bookings. The schema stores `writeTargetCalendarId`; no code uses it.
- Multi-account support (connecting two Google accounts). One connection per host.
- Automated cron-based token refresh. Refresh is lazy on each API call.
- Test runner setup (deferred since Spec 1).
- Webhook-side revocation when a Clerk user is deleted. Local doc is deleted; Google's own 6-month inactivity policy retires the refresh token. The user-initiated Disconnect button does revoke.

## Architecture

A new connection document type plus three subsystems: an OAuth flow (two API routes), a token-cipher + refresh helper, and a Calendar settings tab UI.

```
sanity/schemaTypes/documents/googleCalendarConnectionType.ts   ← new schema
sanity/schemaTypes/index.ts                                     ← register it
sanity/structure.ts                                             ← Studio sidebar group

lib/crypto/tokenCipher.ts                                       ← AES-256-GCM versioned
lib/google/oauthClient.ts                                       ← URL builder + code exchange
lib/google/calendarApi.ts                                       ← typed Google API wrappers
lib/google/getValidAccessToken.ts                               ← lazy-refresh helper

app/api/auth/google/start/route.ts                              ← GET — set state cookie + 302 to Google
app/api/auth/google/callback/route.ts                           ← GET — validate, exchange, store

app/(admin)/availability/calendar/CalendarSettingsTab.tsx       ← client component
app/(admin)/availability/calendar/actions.ts                    ← disconnectGoogle, refreshCalendarList
app/(admin)/availability/AvailabilityEditor.tsx                 ← swap static JSX for <CalendarSettingsTab />
app/(admin)/availability/page.tsx                               ← additionally fetch the connection doc
app/api/webhooks/clerk/route.ts                                 ← user.deleted also deletes gcal doc
```

## New env vars

Beyond what was set during pre-flight (Google OAuth client ID/secret/redirect URI):

- `TOKEN_ENCRYPTION_KEY` — base64-encoded 32-byte key. Generate with `openssl rand -base64 32`. Required at startup; module throws if missing.
- `OAUTH_STATE_SIGNING_KEY` — same generation pattern, separate value. Used to HMAC the OAuth state cookie.

Both keys go in `.env.local` and on Vercel for Production / Preview / Development. Never commit them.

## Sanity schema

```ts
// sanity/schemaTypes/documents/googleCalendarConnectionType.ts
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
      readOnly: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'googleEmail',
      type: 'string',
      validation: (rule) => rule.required().email(),
    }),
    defineField({
      name: 'refreshTokenCipher',
      type: 'string',
      readOnly: true,
      hidden: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'accessTokenCipher',
      type: 'string',
      readOnly: true,
      hidden: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'accessTokenExpiresAt',
      type: 'datetime',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'scopes',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      validation: (rule) => rule.required().min(1),
    }),
    defineField({
      name: 'calendars',
      type: 'array',
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
      description: 'Reserved for future use (booking write spec).',
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

`_id = gcal.${clerkId}`. Mirrors `user.${clerkId}` and `availability.${clerkId}`.

## Token cipher

`lib/crypto/tokenCipher.ts` — AES-256-GCM with a single-byte version prefix.

- On-disk format: `<version 0x01><iv 12B><authTag 16B><ciphertext>`, base64-encoded into a single string.
- API: `encrypt(plaintext: string): string` and `decrypt(ciphertext: string): string`. Both server-only (`import 'server-only'` at top).
- `loadKey()` reads `TOKEN_ENCRYPTION_KEY` and validates it decodes to exactly 32 bytes; throws a descriptive error otherwise.
- `decrypt` rejects unknown version bytes — gives us a forward-compatible upgrade path if we ever need to rotate keys (introduce `0x02`, decrypt continues to handle `0x01`).

## OAuth flow

### `GET /api/auth/google/start`

1. `auth()` → `clerkId`. Redirect to `/` if missing.
2. Generate 32-byte nonce; HMAC-SHA256 it with `OAUTH_STATE_SIGNING_KEY`.
3. Set httpOnly cookie `gcal_oauth_state = <nonce>.<signature>`, `path=/api/auth/google`, `sameSite=lax`, `secure` in prod, `maxAge=300`.
4. Build Google authorization URL with: `client_id`, `redirect_uri`, `response_type=code`, `scope=openid email profile https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events`, `access_type=offline`, `prompt=consent`, `state=<nonce>`, `include_granted_scopes=true`.
5. 302 to Google.

### `GET /api/auth/google/callback`

1. `auth()` → `clerkId`. Redirect to `/` if missing.
2. If `?error=access_denied`: clear cookie, 302 to `/availability?connected=cancelled`.
3. Read `?code` and `?state`. Read cookie `gcal_oauth_state`, split into `nonce.signature`.
4. Verify: cookie present, HMAC of `nonce` matches `signature`, `state === nonce`. On any failure: clear cookie, 302 to `/availability?connected=error&reason=state`.
5. Clear the cookie.
6. Exchange code for tokens via `POST https://oauth2.googleapis.com/token` (form-encoded). On non-2xx: 302 to `?connected=error&reason=exchange`.
7. Verify granted `scope` string contains both `calendar.readonly` and `calendar.events`. If not: 302 to `?connected=error&reason=scopes`.
8. `GET https://www.googleapis.com/oauth2/v2/userinfo` → `email`.
9. `GET https://www.googleapis.com/calendar/v3/users/me/calendarList` → array of `{ id, summary, primary }`.
10. Encrypt both tokens via `tokenCipher.encrypt`.
11. `serverClient.createOrReplace({ _id: \`gcal.${clerkId}\`, _type: 'googleCalendarConnectionType', user: { _ref: \`user.${clerkId}\` }, clerkId, googleEmail, refreshTokenCipher, accessTokenCipher, accessTokenExpiresAt: <now + expires_in>, scopes: <scope.split(' ')>, calendars: <mapped from calendarList, conflictCheck: true>, writeTargetCalendarId: <primary calendar id>, connectedAt: <now> })`. On Sanity error: 302 to `?connected=error&reason=storage`.
12. `revalidatePath('/availability')`. 302 to `?connected=ok`.

### `?connected=` query parameter banner

The Calendar settings tab reads `useSearchParams().get('connected')` and renders a small banner at the top of its content area. Six values, mapped to messages:

| Value | Color | Message |
|---|---|---|
| `ok` | green | Google Calendar connected. |
| `cancelled` | slate | Connection cancelled. |
| `error&reason=state` | red | Connection failed (security check). Please try again. |
| `error&reason=exchange` | red | Couldn't reach Google. Please try again. |
| `error&reason=scopes` | red | Required calendar permissions weren't granted. |
| `error&reason=storage` | red | Saved your Google access but couldn't store it. Please retry. |

Banner has a `×` to dismiss; dismissed state lives in client state, not the URL.

## Refresh helper

`lib/google/getValidAccessToken.ts`:

```ts
export async function getValidAccessToken(clerkId: string): Promise<string>
export class GoogleConnectionRevokedError extends Error
export class GoogleConnectionMissingError extends Error
```

Behavior: load `gcal.${clerkId}`; if missing throw `GoogleConnectionMissingError`. If `accessTokenExpiresAt - now > 60s`, decrypt and return the access token. Otherwise decrypt the refresh token, POST to Google's token endpoint with `grant_type=refresh_token`. On 400/401 throw `GoogleConnectionRevokedError`. On other non-2xx throw a generic error. On success encrypt the new access token, patch `accessTokenCipher` + `accessTokenExpiresAt`, return the plaintext access token.

The refresh token is treated as immutable for the life of the connection — we don't update it even if Google returns one in the refresh response. New refresh token only on re-consent.

## UI

### Disconnected state

A simple call-to-action with a `<a href="/api/auth/google/start">` styled as a primary button. Helper text explains what gets connected and notes that conflict checks and event creation will be available "in a future update."

### Connected state

- Header row: Google icon, `googleEmail`, `Connected on <date>`, Disconnect button (right-aligned).
- Divider.
- "Your calendars" subheader + Refresh list button (right-aligned).
- Read-only list of `calendars`, each row showing `summary` with a "Primary" badge if `primary`.
- Footer note: "These calendars will be available for conflict checks and event creation in a future update."

### Behavior

- Disconnect button: `useTransition`, calls `disconnectGoogle()` server action. Pending state: spinner + "Disconnecting…". Success: `router.refresh()`. Error: red inline banner.
- Refresh list button: `useTransition`, calls `refreshCalendarList()` server action. Pending: spinner. Success: list updates via `router.refresh()`. On `error: 'revoked'`: top-of-tab red banner "Your Google connection was revoked. Please reconnect." — the action has already deleted the doc, so the next render shows disconnected state. On `error: 'missing'`: same banner, slightly different copy.
- No confirmation dialog on Disconnect — reversible operation.

### Page wiring

`page.tsx` now does:

```ts
const [availabilityDoc, googleConnection] = await Promise.all([
  ensureAvailabilityDoc(clerkId),
  serverClient.getDocument<GoogleConnectionDoc>(`gcal.${clerkId}`),
])
return <AvailabilityEditor initialData={availabilityDoc} googleConnection={googleConnection ?? null} />
```

The existing `availabilityType` ensure-or-fetch logic from Spec 1's `page.tsx` is extracted verbatim into `ensureAvailabilityDoc(clerkId)` (same module or a colocated helper) — no behavior change, just a refactor so `page.tsx` can `await Promise.all` over the two fetches cleanly. `AvailabilityEditor` accepts a new optional `googleConnection: GoogleConnectionPublic | null` prop and forwards it to `<CalendarSettingsTab />`. The `Public` type strips ciphers and expiry — only `googleEmail`, `calendars`, `connectedAt` reach the client.

## Server actions

`app/(admin)/availability/calendar/actions.ts`:

```ts
'use server'

export async function disconnectGoogle(): Promise<{ ok: true } | { ok: false; error: string }>
export async function refreshCalendarList(): Promise<
  { ok: true; calendars: CalendarRef[] } |
  { ok: false; error: 'revoked' | 'missing' | 'unknown' }
>
```

`disconnectGoogle`:
1. `auth()` → `clerkId`.
2. Load doc to decrypt `refreshTokenCipher`.
3. `await revokeRefreshToken(refreshToken)` — best-effort, swallow errors.
4. `await serverClient.delete(\`gcal.${clerkId}\`)`.
5. `revalidatePath('/availability')`. Return `{ ok: true }`.

`refreshCalendarList`:
1. `auth()` → `clerkId`.
2. Try `getValidAccessToken(clerkId)`. Catch `GoogleConnectionRevokedError` → delete the doc, return `{ ok: false, error: 'revoked' }`. Catch `GoogleConnectionMissingError` → return `{ ok: false, error: 'missing' }`.
3. `fetchCalendarListWithToken(token)`.
4. Patch the doc's `calendars` field.
5. `revalidatePath('/availability')`. Return `{ ok: true, calendars }`.

## Webhook integration

Extend the `user.deleted` case in `app/api/webhooks/clerk/route.ts`:

```ts
case 'user.deleted':
  if (evt.data.id) {
    const clerkId = evt.data.id
    await Promise.allSettled([
      serverClient.delete(`user.${clerkId}`),
      serverClient.delete(`availability.${clerkId}`),
      serverClient.delete(`gcal.${clerkId}`),
    ])
  }
  return Response.json({ ok: true })
```

`Promise.allSettled` so a missing dependent doc doesn't block the user delete. Refresh-token revocation at Google is intentionally not done here — the user-initiated Disconnect path covers it; auto-revocation on Clerk delete adds complexity for marginal benefit.

## Studio

`sanity/structure.ts` gets a new "Google connections" group alongside the existing Host / Schedule / Event type / Booking groups.

## Verification plan

Manual end-to-end. No automated tests in this spec.

**Pre-flight (once):** `TOKEN_ENCRYPTION_KEY` and `OAUTH_STATE_SIGNING_KEY` set locally and on Vercel; Google OAuth client redirect URIs match for local and prod.

1. **First connect — golden path.** Sign in → Calendar settings tab → Connect → consent screen → Allow → returns to `?connected=ok` with green banner. Connected state shows email + calendar list with primary tagged.
2. **Studio inspection.** `gcal.<clerkId>` doc exists. `refreshTokenCipher` and `accessTokenCipher` are hidden in Studio; if peeked at, they're base64 noise (not raw Google tokens). `scopes` contains both Calendar scopes.
3. **Refresh calendar list.** Click Refresh → spinner → list refreshes successfully (uses still-valid token path).
4. **Token refresh exercised.** In Studio, manually set `accessTokenExpiresAt` to a past timestamp. Reload page, click Refresh → success → `accessTokenExpiresAt` is now ~1 hour future.
5. **Disconnect — golden path.** Click Disconnect → page returns to disconnected state. Studio: doc gone. Google Account → Security → Third-party apps: Calendry no longer listed (proves revocation hit Google).
6. **Reconnect after disconnect.** Click Connect → consent screen reappears (`prompt=consent`) → Allow → fresh doc with new `connectedAt`.
7. **Cancellation at consent screen.** Click Connect → at Google, click Cancel → `?connected=cancelled` with slate banner. No doc.
8. **CSRF protection.** Click Connect, hand-edit `gcal_oauth_state` cookie in DevTools to garbage, complete consent → callback redirects to `?connected=error&reason=state`. No tokens stored.
9. **Scope downgrade simulation (optional).** Temporarily remove `calendar.events` from the OAuth client's scope list, click Connect, Allow → callback redirects to `?connected=error&reason=scopes`. No doc. Restore scope after.
10. **Revocation simulation.** Connect normally. In Google Account → Security → Third-party access, manually revoke. Click Refresh list → red banner: "Your Google connection was revoked. Please reconnect." Doc auto-deleted.
11. **Cross-user isolation.** Sign in as a second user, connect their Google. Switch back to user 1 — their connection unchanged. Two separate `gcal.<clerkId>` docs.
12. **Webhook cleanup.** Delete a test user from Clerk's dashboard. Studio: all three docs (`user.<clerkId>`, `availability.<clerkId>`, `gcal.<clerkId>`) gone.
13. **Build + deploy parity.** `pnpm build` locally clean. After PR merge, repeat tests 1, 2, 5 against the production URL.

## Risks and mitigations

- **Sanity dataset leak exposes refresh tokens.** Mitigated by AES-256-GCM at-rest encryption with a server-only key. The cipher's auth tag means tampered ciphertext is rejected. Worst case if the encryption key ALSO leaks: every connected user's refresh token is exposed. Mitigation: keep `TOKEN_ENCRYPTION_KEY` in Vercel envs only, never log it, never commit it.
- **Studio user could in principle reveal the cipher fields.** The `hidden: true` flag is admin-side cosmetic only — a determined Studio user could edit the schema or read via the Vision tool. This is the same trust boundary as for any other Sanity admin. We accept it; Studio access is gated by Clerk admin status.
- **State-cookie CSRF.** Tight cookie scope (`path=/api/auth/google`), `sameSite=lax`, HMAC signature, single-use (cleared on every callback regardless of outcome).
- **`prompt=consent` shows the consent screen on every reconnect.** Intended. Without it Google may decline to issue a new refresh_token, leaving us with stale credentials after disconnect.
- **Refresh token expires from non-use after 6 months.** Mitigated by lazy refresh: any user activity refreshes, and prolonged non-use means we'd see a `revoked` error on next attempt and gracefully prompt reconnect.
- **Race condition: two browser tabs trigger refresh simultaneously.** First request wins, second gets a stale `accessTokenExpiresAt` and refreshes again — wasteful but correct. Acceptable for v1.

## Out-of-scope follow-ups

- **Spec 3 — slot generation engine.** Will read `googleCalendarConnection.calendars` (filtering by `conflictCheck`) and call Google's freebusy API via `getValidAccessToken`.
- **Spec 4 — public booking page + event write.** Will use `writeTargetCalendarId` + Google Calendar Events API to insert events on accepted bookings.
- Conflict-check toggles + write-target dropdown UI on the Calendar settings tab — added when a consumer exists.
- Multi-account support (more than one connected Google account per host).
- The `useTabSave` hook + tab-component split deferred from Spec 1 — still no third save flow on /availability (this spec adds imperative connect/disconnect, not a save flow), so still defer.
- Background cron-based token refresh.
- Revoke at Google on Clerk user delete (currently relies on 6-month inactivity).
