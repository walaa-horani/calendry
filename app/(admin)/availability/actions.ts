'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { serverClient } from '@/sanity/lib/serverClient'
import type { DaySchedule } from './types'

const docIdFor = (clerkId: string) => `availability.${clerkId}`

type Result = { ok: true } | { ok: false; error: string }

async function requireClerkId(): Promise<string> {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthenticated')
  return userId
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return 'Unknown error'
  }
}

export async function saveSchedules(input: {
  weeklySchedule: DaySchedule[]
  timezone: string
}): Promise<Result> {
  try {
    const clerkId = await requireClerkId()
    await serverClient
      .patch(docIdFor(clerkId))
      .set({
        weeklySchedule: input.weeklySchedule,
        timezone: input.timezone,
      })
      .commit()
    revalidatePath('/availability')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) }
  }
}

export async function saveAdvanced(input: {
  minimumNotice: number
  bufferBefore: number
  bufferAfter: number
}): Promise<Result> {
  try {
    const clerkId = await requireClerkId()
    await serverClient
      .patch(docIdFor(clerkId))
      .set({
        minimumNotice: input.minimumNotice,
        bufferBefore: input.bufferBefore,
        bufferAfter: input.bufferAfter,
      })
      .commit()
    revalidatePath('/availability')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) }
  }
}

export async function bootstrapTimezoneIfDefault(detected: string): Promise<void> {
  if (!detected || detected === 'UTC') return
  try {
    const clerkId = await requireClerkId()
    const id = docIdFor(clerkId)
    // Only patch if the doc still has the placeholder timezone — keeps this idempotent.
    const current = await serverClient.fetch<string | null>(
      `*[_id == $id][0].timezone`,
      { id },
    )
    if (current === 'UTC') {
      await serverClient.patch(id).set({ timezone: detected }).commit()
      revalidatePath('/availability')
    }
  } catch {
    // Best-effort — never throw to the client.
  }
}
