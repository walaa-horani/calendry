import 'server-only'

const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const CALENDAR_LIST_URL = 'https://www.googleapis.com/calendar/v3/users/me/calendarList'

export interface UserInfo {
  email: string
  sub: string
}

export interface CalendarRef {
  calendarId: string
  summary: string
  primary: boolean
}

export async function fetchUserInfoWithToken(accessToken: string): Promise<UserInfo> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Google userinfo failed: ${res.status}`)
  const json = (await res.json()) as { email: string; id: string }
  return { email: json.email, sub: json.id }
}

interface CalendarListEntry {
  id: string
  summary: string
  primary?: boolean
}

interface CalendarListResponse {
  items?: CalendarListEntry[]
}

export async function fetchCalendarListWithToken(accessToken: string): Promise<CalendarRef[]> {
  const res = await fetch(CALENDAR_LIST_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Google calendarList failed: ${res.status}`)
  const json = (await res.json()) as CalendarListResponse
  return (json.items ?? []).map((item) => ({
    calendarId: item.id,
    summary: item.summary,
    primary: item.primary === true,
  }))
}
