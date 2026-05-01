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
