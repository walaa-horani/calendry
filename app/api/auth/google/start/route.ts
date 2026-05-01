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
