export type DayCode = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'

export interface TimeInterval {
  _key: string
  start: string // 'HH:mm', 24-hour
  end: string   // 'HH:mm', 24-hour
}

export interface DaySchedule {
  _key: DayCode
  day: DayCode
  enabled: boolean
  intervals: TimeInterval[]
}

export interface AvailabilityDoc {
  _id: string
  _type: 'availabilityType'
  user: { _type: 'reference'; _ref: string }
  timezone: string
  weeklySchedule: DaySchedule[]
  minimumNotice: number
  bufferBefore: number
  bufferAfter: number
}
