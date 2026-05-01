import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'

import { buildAuthorizationUrl } from '@/lib/google/oauthClient'
import {
  STATE_COOKIE,
  STATE_COOKIE_PATH,
  STATE_COOKIE_MAX_AGE_S,
  signNonce,
} from '@/lib/google/oauthState'

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
