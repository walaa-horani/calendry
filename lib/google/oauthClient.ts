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
