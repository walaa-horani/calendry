export interface PublicCalendarRef {
  calendarId: string
  summary: string
  primary: boolean
}

export interface GoogleConnectionPublic {
  googleEmail: string
  calendars: PublicCalendarRef[]
  connectedAt: string
}
