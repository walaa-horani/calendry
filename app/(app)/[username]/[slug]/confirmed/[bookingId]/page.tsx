import 'server-only'
import { notFound } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'

import { client } from '@/sanity/lib/client'
import CancelButton from './CancelButton'

interface PageProps {
  params: Promise<{ username: string; slug: string; bookingId: string }>
}

interface BookingView {
  _id: string
  status: 'confirmed' | 'cancelled' | 'rescheduled'
  startTime: string
  endTime: string
  inviteeTimezone: string
  inviteeName: string
  inviteeEmail: string
  meetingTitleSnapshot: string
  meetingDurationSnapshot: number
  hostNameSnapshot: string
  hostUsernameSnapshot: string
  locationSnapshot: { type: string; value?: string; instructions?: string }
  cancelledAt: string | null
  bookingToken: string
}

const BOOKING_QUERY = `
*[_type == "bookingType" && bookingToken == $bookingToken][0]{
  _id, status, startTime, endTime, inviteeTimezone,
  inviteeName, inviteeEmail,
  meetingTitleSnapshot, meetingDurationSnapshot,
  hostNameSnapshot, hostUsernameSnapshot, locationSnapshot,
  cancelledAt, bookingToken
}
`

export default async function ConfirmedPage({ params }: PageProps) {
  const { username, bookingId } = await params
  const data = await client.fetch<BookingView | null>(BOOKING_QUERY, { bookingToken: bookingId })
  if (!data) notFound()

  // Defense: URL-spliced username must match the snapshot.
  if (data.hostUsernameSnapshot !== username) notFound()

  const isCancelled = data.status !== 'confirmed'
  const isPast = Date.parse(data.startTime) < Date.now()
  const startLocal = formatInTimeZone(data.startTime, data.inviteeTimezone, 'EEE MMM d, yyyy · h:mm a')
  const endLocal = formatInTimeZone(data.endTime, data.inviteeTimezone, 'h:mm a')

  return (
    <main className="mx-auto max-w-md p-6">
      {isCancelled ? (
        <h1 className="text-xl font-medium text-gray-500">✕ This booking was cancelled</h1>
      ) : (
        <h1 className="text-xl font-medium text-green-700">✓ You&apos;re booked</h1>
      )}

      <div className="mt-4 rounded border border-gray-200 p-4 text-sm">
        <p className="font-medium">{data.meetingTitleSnapshot}</p>
        <p className="text-gray-600">
          {startLocal} – {endLocal} ({data.inviteeTimezone})
        </p>
        <p className="text-gray-600">
          {data.hostNameSnapshot} · {data.locationSnapshot.type}
        </p>
        <p className="mt-3 text-gray-500">For: {data.inviteeEmail}</p>
      </div>

      {!isCancelled && !isPast ? (
        <div className="mt-4">
          <CancelButton bookingToken={data.bookingToken} />
        </div>
      ) : null}

      {isPast && !isCancelled ? (
        <p className="mt-4 text-sm text-gray-500">This meeting has already taken place.</p>
      ) : null}
    </main>
  )
}
