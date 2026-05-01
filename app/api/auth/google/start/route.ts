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
  // TODO(security): the state cookie is browser-bound but not Clerk-user-bound.
  // If the user signs out and a different Clerk user signs in within the 5-min
  // window before the callback resolves, the callback will write the connection
  // under the wrong clerkId. Mitigation: bind clerkId into the signed nonce
  // payload (sign `${nonce}.${clerkId}` and verify both match).
  cookieStore.set(STATE_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: STATE_COOKIE_PATH,
    maxAge: STATE_COOKIE_MAX_AGE_S,
  })

  redirect(buildAuthorizationUrl(nonce))
}
