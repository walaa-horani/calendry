import 'server-only'

import { createHmac, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'

export const STATE_COOKIE = 'gcal_oauth_state'
export const STATE_COOKIE_PATH = '/api/auth/google'
export const STATE_COOKIE_MAX_AGE_S = 300

const SIGNING_KEY_BYTES = 32

function loadSigningKey(): Buffer {
  const raw = process.env.OAUTH_STATE_SIGNING_KEY
  if (!raw) throw new Error('Missing OAUTH_STATE_SIGNING_KEY env var')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== SIGNING_KEY_BYTES) {
    throw new Error(`OAUTH_STATE_SIGNING_KEY must decode to ${SIGNING_KEY_BYTES} bytes (got ${key.length})`)
  }
  return key
}

export function signNonce(nonce: string): string {
  return createHmac('sha256', loadSigningKey()).update(nonce).digest('base64url')
}

export function verifyState(nonce: string, signature: string): boolean {
  const expected = createHmac('sha256', loadSigningKey()).update(nonce).digest('base64url')
  if (expected.length !== signature.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}

export async function clearStateCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(STATE_COOKIE, '', { path: STATE_COOKIE_PATH, maxAge: 0 })
}
