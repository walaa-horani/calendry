import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

import { serverClient } from '@/sanity/lib/serverClient'
import AvailabilityEditor from './AvailabilityEditor'
import { defaultSundayFirstSchedule } from './defaults'
import type { AvailabilityDoc } from './types'

export default async function AvailabilityPage() {
  const { userId: clerkId } = await auth()
  if (!clerkId) redirect('/')

  const id = `availability.${clerkId}`
  let doc = await serverClient.getDocument<AvailabilityDoc>(id) as AvailabilityDoc | undefined
  if (!doc) {
    doc = (await serverClient.createIfNotExists({
      _id: id,
      _type: 'availabilityType',
      user: { _type: 'reference', _ref: `user.${clerkId}` },
      timezone: 'UTC',
      weeklySchedule: defaultSundayFirstSchedule(),
      minimumNotice: 240,
      bufferBefore: 0,
      bufferAfter: 0,
    })) as AvailabilityDoc
  }

  return <AvailabilityEditor initialData={doc} />
}
