import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
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
import {
  STATE_COOKIE,
  clearStateCookie,
  verifyState,
} from '@/lib/google/oauthState'

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
