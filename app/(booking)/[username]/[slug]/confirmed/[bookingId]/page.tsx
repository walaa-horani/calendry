import 'server-only'
import { notFound } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import {
  Calendar,
  CheckCircle2,
  Clock,
  Globe,
  Link as LinkIcon,
  Mail,
  MapPin,
  Phone,
  RotateCcw,
  Video,
  XCircle,
} from 'lucide-react'

import { serverClient } from '@/sanity/lib/serverClient'
import CancelButton from './CancelButton'

const LOCATION_LABELS: Record<string, string> = {
  zoom: 'Zoom',
  googleMeet: 'Google Meet',
  phone: 'Phone',
  inPerson: 'In person',
  customUrl: 'Custom URL',
}

function locationIcon(type: string) {
  switch (type) {
    case 'zoom':
    case 'googleMeet':
      return Video
    case 'phone':
      return Phone
    case 'inPerson':
      return MapPin
    case 'customUrl':
      return LinkIcon
    default:
      return Video
  }
}

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
  const data = await serverClient.fetch<BookingView | null>(BOOKING_QUERY, { bookingToken: bookingId })
  if (!data) notFound()

  // Note: the [slug] segment is intentionally not verified. The bookingToken
  // (~143 bits entropy) is the security primitive; the username check is
  // defense in depth against URL bookmarks/typos. Adding a slug check would
  // require adding meetingSlugSnapshot to bookingType and is deferred.
  // Defense: URL-spliced username must match the snapshot.
  if (data.hostUsernameSnapshot !== username) notFound()

  const isCancelled = data.status === 'cancelled'
  const isRescheduled = data.status === 'rescheduled'
  // Server component: a single per-request "now" snapshot is the right
  // semantics here. The lint rule fires generically on Date primitives.
  // eslint-disable-next-line react-hooks/purity
  const isPast = Date.parse(data.startTime) < Date.now()
  const startLocal = formatInTimeZone(data.startTime, data.inviteeTimezone, 'EEE MMM d, yyyy · h:mm a')
  const endLocal = formatInTimeZone(data.endTime, data.inviteeTimezone, 'h:mm a')

  const LocIcon = locationIcon(data.locationSnapshot.type)
  const locationLabel = LOCATION_LABELS[data.locationSnapshot.type] ?? data.locationSnapshot.type

  return (
    <main className="mx-auto max-w-md px-4 py-10 sm:py-16">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col items-center text-center">
          {isCancelled ? (
            <>
              <div className="grid h-12 w-12 place-items-center rounded-full bg-slate-100">
                <XCircle className="h-7 w-7 text-slate-500" />
              </div>
              <h1 className="mt-4 text-xl font-semibold text-slate-900">Booking cancelled</h1>
              <p className="mt-1 text-sm text-slate-500">This time slot has been freed up.</p>
            </>
          ) : isRescheduled ? (
            <>
              <div className="grid h-12 w-12 place-items-center rounded-full bg-slate-100">
                <RotateCcw className="h-7 w-7 text-slate-500" />
              </div>
              <h1 className="mt-4 text-xl font-semibold text-slate-900">Booking rescheduled</h1>
            </>
          ) : (
            <>
              <div className="grid h-12 w-12 place-items-center rounded-full bg-green-100">
                <CheckCircle2 className="h-7 w-7 text-green-700" />
              </div>
              <h1 className="mt-4 text-xl font-semibold text-slate-900">You&apos;re booked</h1>
              <p className="mt-1 text-sm text-slate-500">A calendar entry should arrive shortly.</p>
            </>
          )}
        </div>

        <div className="mt-6 space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
          <p className="text-base font-semibold text-slate-900">{data.meetingTitleSnapshot}</p>
          <div className="space-y-2 text-slate-600">
            <p className="flex items-start gap-2">
              <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <span>{startLocal} – {endLocal}</span>
            </p>
            <p className="flex items-center gap-2">
              <Globe className="h-4 w-4 shrink-0 text-slate-400" />
              {data.inviteeTimezone}
            </p>
            <p className="flex items-center gap-2">
              <Clock className="h-4 w-4 shrink-0 text-slate-400" />
              {data.meetingDurationSnapshot} min with {data.hostNameSnapshot}
            </p>
            <p className="flex items-center gap-2">
              <LocIcon className="h-4 w-4 shrink-0 text-slate-400" />
              {locationLabel}
            </p>
            <p className="flex items-center gap-2">
              <Mail className="h-4 w-4 shrink-0 text-slate-400" />
              {data.inviteeEmail}
            </p>
          </div>
        </div>

        {!isCancelled && !isRescheduled && !isPast ? (
          <div className="mt-6 border-t border-slate-200 pt-6">
            <CancelButton bookingToken={data.bookingToken} />
          </div>
        ) : null}

        {isPast && !isCancelled && !isRescheduled ? (
          <p className="mt-6 border-t border-slate-200 pt-6 text-center text-sm text-slate-500">
            This meeting has already taken place.
          </p>
        ) : null}
      </div>
    </main>
  )
}
