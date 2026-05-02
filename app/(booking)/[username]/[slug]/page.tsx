import 'server-only'
import { notFound } from 'next/navigation'

import { serverClient } from '@/sanity/lib/serverClient'
import BookingPicker from './BookingPicker'

interface PageProps {
  params: Promise<{ username: string; slug: string }>
}

export interface JoinResult {
  _id: string
  clerkId: string
  displayName: string
  avatarUrl: string | null
  bio: string | null
  welcomeMessage: string | null
  timezone: string
  meeting: {
    _id: string
    title: string
    description: string | null
    duration: number
    location: { type: string; value?: string; instructions?: string }
    color: string
    bufferBefore: number | null
    bufferAfter: number | null
    minimumNotice: number | null
    maxBookingsPerDay: number | null
    bookingWindowDays: number
  } | null
  availability: {
    timezone: string
    weeklySchedule: Array<{
      day: string
      enabled: boolean
      intervals: Array<{ start: string; end: string }>
    }>
    minimumNotice: number
    bufferBefore: number
    bufferAfter: number
  } | null
}

const HOST_QUERY = `
*[_type == "userType" && username.current == $username][0]{
  _id, clerkId, displayName, avatarUrl, bio, welcomeMessage, timezone,
  "meeting": *[_type == "meetingType" && host._ref == ^._id && slug.current == $slug && active == true][0]{
    _id, title, description, duration, location, color,
    bufferBefore, bufferAfter, minimumNotice, maxBookingsPerDay, bookingWindowDays
  },
  "availability": *[_type == "availabilityType" && user._ref == ^._id][0]{
    timezone, weeklySchedule, minimumNotice, bufferBefore, bufferAfter
  }
}
`

export default async function PublicBookingPage({ params }: PageProps) {
  const { username, slug } = await params
  const data = await serverClient.fetch<JoinResult | null>(HOST_QUERY, { username, slug })
  if (!data || !data.meeting || !data.availability) notFound()

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:py-16">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <BookingPicker
          username={username}
          slug={slug}
          meeting={{
            title: data.meeting.title,
            duration: data.meeting.duration,
            location: data.meeting.location,
          }}
          host={{
            displayName: data.displayName,
            avatarUrl: data.avatarUrl,
            welcomeMessage: data.welcomeMessage,
          }}
          hostTimezone={data.availability.timezone}
        />
      </div>
    </main>
  )
}
