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
