'use server'

import { revalidatePath } from 'next/cache'
import { formatInTimeZone } from 'date-fns-tz'
import { nanoid } from 'nanoid'

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
    location: { type: string; value?: string; instructions?: string }
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
    let calIds: string[] = []
    try {
      const gcal = await serverClient.getDocument<GcalDoc>(`gcal.${data.clerkId}`)
      calIds = (gcal?.calendars ?? [])
        .filter((c) => c.conflictCheck === true)
        .map((c) => c.calendarId)
    } catch (err) {
      console.error('Failed to load gcal document; proceeding with empty busy list:', err)
    }
    if (calIds.length > 0) {
      try {
        const accessToken = await getValidAccessToken(data.clerkId)
        busy = await fetchFreeBusy({
          accessToken,
          calendarIds: calIds,
          timeMinUtc: rangeStartUtc,
          timeMaxUtc: rangeEndUtc,
        })
      } catch (err) {
        if (
          !(err instanceof GoogleConnectionMissingError) &&
          !(err instanceof GoogleConnectionRevokedError)
        ) {
          console.error('FreeBusy fetch failed; proceeding with empty busy list:', err)
        }
      }
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

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface CreateBookingInput {
  username: string
  slug: string
  startUtc: string
  inviteeName: string
  inviteeEmail: string
  inviteeNotes?: string
  inviteeTimezone: string
}

export type CreateBookingResult =
  | { ok: true; bookingToken: string }
  | { ok: false; error: 'not_found' | 'slot_taken' | 'invalid_input' | 'unknown' }

export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  try {
    const name = input.inviteeName.trim()
    const email = input.inviteeEmail.trim().toLowerCase()
    const notes = (input.inviteeNotes ?? '').slice(0, 10_000)
    if (!name || name.length > 200) return { ok: false, error: 'invalid_input' }
    if (!EMAIL_REGEX.test(email) || email.length > 320) return { ok: false, error: 'invalid_input' }
    if (!input.startUtc || Number.isNaN(Date.parse(input.startUtc))) {
      return { ok: false, error: 'invalid_input' }
    }
    if (!input.inviteeTimezone) return { ok: false, error: 'invalid_input' }

    const data = await serverClient.fetch<HostJoin | null>(HOST_QUERY, {
      username: input.username,
      slug: input.slug,
    })
    if (!data || !data.meeting || !data.availability) return { ok: false, error: 'not_found' }

    const startMs = Date.parse(input.startUtc)
    const endMs = startMs + data.meeting.duration * 60_000
    const dayMs = 86_400_000
    const rangeStart = new Date(startMs - dayMs).toISOString()
    const rangeEnd = new Date(endMs + dayMs).toISOString()

    const existing = await serverClient.fetch<BusyInterval[]>(
      `*[_type == "bookingType" && host._ref == $hostId && status == "confirmed" && startTime < $rangeEnd && endTime > $rangeStart]{ "startUtc": startTime, "endUtc": endTime }`,
      { hostId: data._id, rangeStart, rangeEnd },
    )

    let busy: BusyInterval[] = []
    let calIds: string[] = []
    try {
      const gcal = await serverClient.getDocument<GcalDoc>(`gcal.${data.clerkId}`)
      calIds = (gcal?.calendars ?? [])
        .filter((c) => c.conflictCheck === true)
        .map((c) => c.calendarId)
    } catch (err) {
      console.error('createBooking: failed to load gcal document:', err)
    }
    if (calIds.length > 0) {
      try {
        const accessToken = await getValidAccessToken(data.clerkId)
        busy = await fetchFreeBusy({
          accessToken,
          calendarIds: calIds,
          timeMinUtc: rangeStart,
          timeMaxUtc: rangeEnd,
        })
      } catch (err) {
        if (
          !(err instanceof GoogleConnectionMissingError) &&
          !(err instanceof GoogleConnectionRevokedError)
        ) {
          console.error('createBooking FreeBusy fetch failed:', err)
        }
      }
    }

    const slotInput: GenerateSlotsInput = {
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
      rangeStart: new Date(rangeStart),
      rangeEnd: new Date(rangeEnd),
    }
    const slots = generateSlots(slotInput)
    const desired = new Date(startMs).toISOString()
    if (!slots.some((s) => s.startUtc === desired)) {
      return { ok: false, error: 'slot_taken' }
    }

    const docId = `booking.${data.clerkId}.${startMs}`
    const bookingToken = nanoid(24)

    const newDoc = {
      _id: docId,
      _type: 'bookingType' as const,
      host: { _type: 'reference' as const, _ref: data._id },
      meetingType: { _type: 'reference' as const, _ref: data.meeting._id },
      bookingToken,
      meetingTitleSnapshot: data.meeting.title,
      meetingDurationSnapshot: data.meeting.duration,
      hostNameSnapshot: data.displayName,
      hostUsernameSnapshot: input.username,
      locationSnapshot: data.meeting.location,
      startTime: desired,
      endTime: new Date(endMs).toISOString(),
      inviteeTimezone: input.inviteeTimezone,
      inviteeName: name,
      inviteeEmail: email,
      ...(notes ? { inviteeNotes: notes } : {}),
      status: 'confirmed' as const,
      createdAt: new Date().toISOString(),
    }

    const stored = await serverClient.createIfNotExists(newDoc)
    if (stored.bookingToken !== bookingToken) {
      // The deterministic _id collided with an existing doc for the same slot.
      // If that doc was cancelled, the slot is genuinely free (the slot engine
      // ignores cancelled bookings) — overwrite with our new booking.
      if ((stored as { status?: string }).status === 'cancelled') {
        await serverClient.createOrReplace(newDoc)
        return { ok: true, bookingToken }
      }
      // Otherwise we lost the race to a confirmed/rescheduled booking.
      return { ok: false, error: 'slot_taken' }
    }

    return { ok: true, bookingToken }
  } catch (err) {
    console.error('createBooking failed:', err)
    return { ok: false, error: 'unknown' }
  }
}

export type CancelBookingResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'already_cancelled' | 'past_booking' | 'unknown' }

export async function cancelBooking(bookingToken: string): Promise<CancelBookingResult> {
  try {
    if (!bookingToken || bookingToken.length < 20 || bookingToken.length > 40) {
      return { ok: false, error: 'not_found' }
    }
    const doc = await serverClient.fetch<{
      _id: string
      status: string
      startTime: string
      hostUsernameSnapshot: string
      meetingTitleSnapshot: string
    } | null>(
      `*[_type == "bookingType" && bookingToken == $bookingToken][0]{
        _id, status, startTime, hostUsernameSnapshot, meetingTitleSnapshot
      }`,
      { bookingToken },
    )
    if (!doc) return { ok: false, error: 'not_found' }
    if (doc.status !== 'confirmed') return { ok: false, error: 'already_cancelled' }
    if (Date.parse(doc.startTime) < Date.now()) return { ok: false, error: 'past_booking' }

    await serverClient
      .patch(doc._id)
      .set({
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        cancellationReason: 'Cancelled by invitee',
      })
      .commit()

    revalidatePath(`/${doc.hostUsernameSnapshot}`, 'layout')
    return { ok: true }
  } catch (err) {
    console.error('cancelBooking failed:', err)
    return { ok: false, error: 'unknown' }
  }
}
