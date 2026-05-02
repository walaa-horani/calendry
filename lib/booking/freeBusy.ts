import 'server-only'

import type { BusyInterval } from './types'

const FREE_BUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy'

interface FreeBusyResponse {
  calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }>
}

export interface FreeBusyInput {
  accessToken: string
  calendarIds: string[]   // already filtered to conflictCheck=true
  timeMinUtc: string      // ISO
  timeMaxUtc: string      // ISO
}

export async function fetchFreeBusy(input: FreeBusyInput): Promise<BusyInterval[]> {
  if (input.calendarIds.length === 0) return []
  const body = {
    timeMin: input.timeMinUtc,
    timeMax: input.timeMaxUtc,
    items: input.calendarIds.map((id) => ({ id })),
  }
  const res = await fetch(FREE_BUSY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Google freeBusy failed: ${res.status}`)
  const json = (await res.json()) as FreeBusyResponse
  const merged: BusyInterval[] = []
  for (const [calId, cal] of Object.entries(json.calendars ?? {})) {
    if (cal.errors?.length) {
      console.warn(`freeBusy: calendar ${calId} returned errors`, cal.errors)
    }
    for (const b of cal.busy ?? []) {
      merged.push({ startUtc: b.start, endUtc: b.end })
    }
  }
  // Merge overlapping intervals
  merged.sort((a, b) => (a.startUtc < b.startUtc ? -1 : a.startUtc > b.startUtc ? 1 : 0))
  const out: BusyInterval[] = []
  for (const cur of merged) {
    const last = out[out.length - 1]
    if (last && cur.startUtc <= last.endUtc) {
      if (cur.endUtc > last.endUtc) last.endUtc = cur.endUtc
    } else {
      out.push({ ...cur })
    }
  }
  return out
}
