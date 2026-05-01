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
  if (buf.length < 1 + IV_BYTES + TAG_BYTES) throw new Error('Ciphertext too short')
  const version = buf[0]
  if (version !== VERSION) throw new Error(`Unknown cipher version: ${version}`)
  const iv = buf.subarray(1, 1 + IV_BYTES)
  const tag = buf.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES)
  const ciphertext = buf.subarray(1 + IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
