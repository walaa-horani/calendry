import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

import { serverClient } from '@/sanity/lib/serverClient'
import AvailabilityEditor from './AvailabilityEditor'
import { defaultSundayFirstSchedule } from './defaults'
import type { AvailabilityDoc } from './types'
import type { GoogleConnectionPublic } from './calendar/types'

interface ConnectionDocFromSanity {
  googleEmail: string
  calendars?: Array<{ calendarId: string; summary: string; primary?: boolean }>
  connectedAt: string
}

async function ensureAvailabilityDoc(clerkId: string): Promise<AvailabilityDoc> {
  const id = `availability.${clerkId}`
  const existing = await serverClient.getDocument<AvailabilityDoc>(id)
  if (existing) return existing
  return serverClient.createIfNotExists({
    _id: id,
    _type: 'availabilityType',
    user: { _type: 'reference', _ref: `user.${clerkId}` },
    timezone: 'UTC',
    weeklySchedule: defaultSundayFirstSchedule(),
    minimumNotice: 240,
    bufferBefore: 0,
    bufferAfter: 0,
  })
}

async function fetchGoogleConnection(clerkId: string): Promise<GoogleConnectionPublic | null> {
  const doc = await serverClient.getDocument<ConnectionDocFromSanity>(`gcal.${clerkId}`)
  if (!doc) return null
  return {
    googleEmail: doc.googleEmail,
    connectedAt: doc.connectedAt,
    calendars: (doc.calendars ?? []).map((c) => ({
      calendarId: c.calendarId,
      summary: c.summary,
      primary: c.primary === true,
    })),
  }
}

export default async function AvailabilityPage() {
  const { userId: clerkId } = await auth()
  if (!clerkId) redirect('/')

  const [availabilityDoc, googleConnection] = await Promise.all([
    ensureAvailabilityDoc(clerkId),
    fetchGoogleConnection(clerkId),
  ])

  return <AvailabilityEditor initialData={availabilityDoc} googleConnection={googleConnection} />
}
