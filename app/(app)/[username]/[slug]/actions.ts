'use server'

import { formatInTimeZone } from 'date-fns-tz'

import { serverClient } from '@/sanity/lib/serverClient'
import { generateSlots } from '@/lib/booking/generateSlots'
import { fetchFreeBusy } from '@/lib/booking/freeBusy'
import {
  GoogleConnectionMissingError,
  GoogleConnectionRevokedError,
  getValidAccessToken,
} from '@/lib/google/getValidAccessToken'
import type {
  BusyInterval,
  DayCode,
  GenerateSlotsInput,
  Slot,
} from '@/lib/booking/types'

const HOST_QUERY = `
*[_type == "userType" && username.current == $username][0]{
  _id, clerkId, displayName, timezone,
  "meeting": *[_type == "meetingType" && host._ref == ^._id && slug.current == $slug && active == true][0]{
    _id, title, duration, location,
    bufferBefore, bufferAfter, minimumNotice, maxBookingsPerDay, bookingWindowDays
  },
  "availability": *[_type == "availabilityType" && user._ref == ^._id][0]{
    timezone, weeklySchedule, minimumNotice, bufferBefore, bufferAfter
  }
}
`

interface HostJoin {
  _id: string
  clerkId: string
  displayName: string
  timezone: string
  meeting: {
    _id: string
    title: string
    duration: number
    bufferBefore: number | null
    bufferAfter: number | null
    minimumNotice: number | null
    maxBookingsPerDay: number | null
    bookingWindowDays: number
  } | null
  availability: {
    timezone: string
    weeklySchedule: Array<{ day: DayCode; enabled: boolean; intervals: Array<{ start: string; end: string }> }>
    minimumNotice: number
    bufferBefore: number
    bufferAfter: number
  } | null
}

interface GcalDoc {
  calendars?: Array<{ calendarId: string; conflictCheck?: boolean }>
}

export interface AvailabilityResult {
  ok: true
  slotsByDate: Record<string, Slot[]>
}

export interface AvailabilityError {
  ok: false
  error: 'not_found' | 'unknown'
}

export async function getAvailability(
  username: string,
  slug: string,
  rangeStartUtc: string,
  rangeEndUtc: string,
): Promise<AvailabilityResult | AvailabilityError> {
  try {
    const data = await serverClient.fetch<HostJoin | null>(HOST_QUERY, { username, slug })
    if (!data || !data.meeting || !data.availability) return { ok: false, error: 'not_found' }

    const rangeStart = new Date(rangeStartUtc)
    const rangeEnd = new Date(rangeEndUtc)

    const existing = await serverClient.fetch<BusyInterval[]>(
      `*[_type == "bookingType" && host._ref == $hostId && status == "confirmed" && startTime < $rangeEnd && endTime > $rangeStart]{ "startUtc": startTime, "endUtc": endTime }`,
      { hostId: data._id, rangeStart: rangeStartUtc, rangeEnd: rangeEndUtc },
    )

    let busy: BusyInterval[] = []
    try {
      const gcal = await serverClient.getDocument<GcalDoc>(`gcal.${data.clerkId}`)
      const calIds = (gcal?.calendars ?? [])
        .filter((c) => c.conflictCheck === true)
        .map((c) => c.calendarId)
      if (calIds.length > 0) {
        const accessToken = await getValidAccessToken(data.clerkId)
        busy = await fetchFreeBusy({
          accessToken,
          calendarIds: calIds,
          timeMinUtc: rangeStartUtc,
          timeMaxUtc: rangeEndUtc,
        })
      }
    } catch (err) {
      if (
        !(err instanceof GoogleConnectionMissingError) &&
        !(err instanceof GoogleConnectionRevokedError)
      ) {
        console.error('FreeBusy fetch failed; proceeding with empty busy list:', err)
      }
      busy = []
    }

    const input: GenerateSlotsInput = {
      schedule: {
        timezone: data.availability.timezone,
        weeklySchedule: data.availability.weeklySchedule,
        minimumNotice: data.availability.minimumNotice,
        bufferBefore: data.availability.bufferBefore,
        bufferAfter: data.availability.bufferAfter,
      },
      meeting: {
        duration: data.meeting.duration,
        bufferBefore: data.meeting.bufferBefore ?? undefined,
        bufferAfter: data.meeting.bufferAfter ?? undefined,
        minimumNotice: data.meeting.minimumNotice ?? undefined,
        maxBookingsPerDay: data.meeting.maxBookingsPerDay ?? undefined,
        bookingWindowDays: data.meeting.bookingWindowDays,
      },
      existingBookings: existing,
      busyIntervals: busy,
      now: new Date(),
      rangeStart,
      rangeEnd,
    }

    const slots = generateSlots(input)
    const slotsByDate: Record<string, Slot[]> = {}
    for (const s of slots) {
      const key = formatInTimeZone(new Date(s.startUtc), data.availability.timezone, 'yyyy-MM-dd')
      if (!slotsByDate[key]) slotsByDate[key] = []
      slotsByDate[key].push(s)
    }
    return { ok: true, slotsByDate }
  } catch (err) {
    console.error('getAvailability failed:', err)
    return { ok: false, error: 'unknown' }
  }
}
