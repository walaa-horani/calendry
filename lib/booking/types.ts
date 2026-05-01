export type DayCode = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'

export interface TimeIntervalInput {
  start: string // 'HH:mm'
  end: string   // 'HH:mm'
}

export interface DayScheduleInput {
  day: DayCode
  enabled: boolean
  intervals: TimeIntervalInput[]
}

export interface ScheduleInput {
  timezone: string                 // IANA, e.g. 'America/Los_Angeles'
  weeklySchedule: DayScheduleInput[]
  minimumNotice: number            // minutes (base default)
  bufferBefore: number             // minutes (base default)
  bufferAfter: number              // minutes (base default)
}

export interface MeetingInput {
  duration: number                 // minutes
  bufferBefore?: number            // override
  bufferAfter?: number             // override
  minimumNotice?: number           // override
  maxBookingsPerDay?: number       // optional cap
  bookingWindowDays: number        // furthest into future
}

export interface BusyInterval {
  startUtc: string                 // ISO
  endUtc: string                   // ISO
}

export interface GenerateSlotsInput {
  schedule: ScheduleInput
  meeting: MeetingInput
  existingBookings: BusyInterval[]
  busyIntervals: BusyInterval[]
  now: Date
  rangeStart: Date
  rangeEnd: Date
}

export interface Slot {
  startUtc: string                 // ISO
  endUtc: string                   // ISO
}
