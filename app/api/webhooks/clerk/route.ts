import { verifyWebhook } from '@clerk/nextjs/webhooks'
import type { WebhookEvent } from '@clerk/nextjs/webhooks'
import type { UserJSON } from '@clerk/backend'
import type { NextRequest } from 'next/server'

import { serverClient } from '@/sanity/lib/serverClient'

export async function POST(req: NextRequest) {
  let evt: WebhookEvent
  try {
    evt = await verifyWebhook(req)
  } catch (err) {
    console.error('Clerk webhook signature verification failed:', err)
    return new Response('Invalid signature', { status: 400 })
  }

  try {
    switch (evt.type) {
      case 'user.created':
        await syncUser(evt.data, { isCreate: true })
        return Response.json({ ok: true })

      case 'user.updated':
        await syncUser(evt.data, { isCreate: false })
        return Response.json({ ok: true })

      case 'user.deleted':
        if (evt.data.id) {
          const id = evt.data.id
          const results = await Promise.allSettled([
            serverClient.delete(`user.${id}`),
            serverClient.delete(`availability.${id}`),
            serverClient.delete(`gcal.${id}`),
          ])
          for (const r of results) {
            if (r.status === 'rejected') {
              const err = r.reason
              if (err?.statusCode !== 404 && !/document.*not found/i.test(String(err))) {
                console.error(`Sanity delete failed for user ${id}:`, err)
              }
            }
          }
        }
        return Response.json({ ok: true })

      default:
        return Response.json({ ignored: evt.type })
    }
  } catch (err) {
    console.error(`Failed to sync ${evt.type} to Sanity:`, err)
    return new Response('Sync failed', { status: 500 })
  }
}

const docIdFor = (clerkId: string) => `user.${clerkId}`

async function syncUser(u: UserJSON, opts: { isCreate: boolean }) {
  const email =
    u.email_addresses.find((e) => e.id === u.primary_email_address_id)
      ?.email_address ?? u.email_addresses[0]?.email_address

  if (!email) throw new Error(`Clerk user ${u.id} has no email address`)

  const displayName =
    [u.first_name, u.last_name].filter(Boolean).join(' ').trim() ||
    u.username ||
    email.split('@')[0]

  const avatarUrl = u.image_url || undefined
  const _id = docIdFor(u.id)

  if (opts.isCreate) {
    const username = await pickUniqueUsername(u.username, email, u.id)
    await serverClient.createIfNotExists({
      _id,
      _type: 'userType',
      clerkId: u.id,
      displayName,
      email,
      avatarUrl,
      username: { _type: 'slug', current: username },
      timezone: 'UTC',
      createdAt: new Date().toISOString(),
    })
    return
  }

  // Update path: never touch username (drives the public URL).
  await serverClient
    .patch(_id)
    .set({ displayName, email, avatarUrl: avatarUrl ?? null })
    .commit()
    .catch(async (err) => {
      // Studio user got deleted, or events arrived out of order — recreate.
      if (err?.statusCode === 404 || /document.*not found/i.test(String(err))) {
        const username = await pickUniqueUsername(u.username, email, u.id)
        await serverClient.createIfNotExists({
          _id,
          _type: 'userType',
          clerkId: u.id,
          displayName,
          email,
          avatarUrl,
          username: { _type: 'slug', current: username },
          timezone: 'UTC',
          createdAt: new Date().toISOString(),
        })
        return
      }
      throw err
    })
}

const USERNAME_REGEX = /^[a-z0-9-]{3,30}$/

function slugify(input: string, max = 26): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
}

async function pickUniqueUsername(
  clerkUsername: string | null,
  email: string,
  clerkId: string,
): Promise<string> {
  const seed = clerkUsername || email.split('@')[0] || 'user'
  const base = slugify(seed) || 'user'
  const tail = clerkId.slice(-4).toLowerCase().replace(/[^a-z0-9]/g, '')

  const candidates = [base, `${base}-${tail}`]
  for (const c of candidates) {
    if (!USERNAME_REGEX.test(c)) continue
    const taken = await serverClient.fetch<number>(
      `count(*[_type == "userType" && username.current == $u])`,
      { u: c },
    )
    if (taken === 0) return c
  }

  return `user-${clerkId.slice(-8).toLowerCase()}`
}
