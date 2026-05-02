import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

import { serverClient } from '@/sanity/lib/serverClient'
import EventTypesList from './EventTypesList'

interface UserDoc {
  _id: string
  username: { current: string } | null
}

interface MeetingTypeDoc {
  _id: string
  title: string
  description: string | null
  duration: number
  location: { type: string; value?: string; instructions?: string }
  color: string
  active: boolean
  slug: { current: string }
}

export default async function SchedulingPage() {
  const { userId: clerkId } = await auth()
  if (!clerkId) redirect('/')

  const user = await serverClient.fetch<UserDoc | null>(
    `*[_type == "userType" && clerkId == $clerkId][0]{ _id, username }`,
    { clerkId },
  )

  const username = user?.username?.current ?? null

  if (!user || !username) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-2xl font-semibold">Event types</h1>
        <p className="mt-4 text-sm text-gray-600">
          Set your username in{' '}
          <Link href="/studio" className="text-blue-700 hover:underline">
            Studio
          </Link>{' '}
          before sharing booking links.
        </p>
      </main>
    )
  }

  const meetings = await serverClient.fetch<MeetingTypeDoc[]>(
    `*[_type == "meetingType" && host._ref == $hostId] | order(active desc, title asc){
      _id, title, description, duration, location, color, active, slug
    }`,
    { hostId: user._id },
  )

  return <EventTypesList username={username} meetings={meetings} />
}
