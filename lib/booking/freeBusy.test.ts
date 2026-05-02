import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { fetchFreeBusy } from './freeBusy'

describe('fetchFreeBusy', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch')
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty array when no calendar IDs provided', async () => {
    const result = await fetchFreeBusy({
      accessToken: 'tok',
      calendarIds: [],
      timeMinUtc: '2026-05-05T00:00:00.000Z',
      timeMaxUtc: '2026-05-06T00:00:00.000Z',
    })
    expect(result).toEqual([])
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('posts to /freeBusy with the right body and parses busy intervals', async () => {
    const mockRes = new Response(
      JSON.stringify({
        calendars: {
          primary: { busy: [{ start: '2026-05-05T17:00:00Z', end: '2026-05-05T17:30:00Z' }] },
        },
      }),
      { status: 200 },
    )
    vi.mocked(globalThis.fetch).mockResolvedValue(mockRes)

    const result = await fetchFreeBusy({
      accessToken: 'tok',
      calendarIds: ['primary'],
      timeMinUtc: '2026-05-05T00:00:00.000Z',
      timeMaxUtc: '2026-05-06T00:00:00.000Z',
    })

    expect(result).toEqual([
      { startUtc: '2026-05-05T17:00:00Z', endUtc: '2026-05-05T17:30:00Z' },
    ])
    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(callArgs[0]).toBe('https://www.googleapis.com/calendar/v3/freeBusy')
    const init = callArgs[1] as RequestInit
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    const body = JSON.parse(init.body as string)
    expect(body.items).toEqual([{ id: 'primary' }])
    expect(body.timeMin).toBe('2026-05-05T00:00:00.000Z')
  })

  it('merges overlapping intervals across calendars', async () => {
    const mockRes = new Response(
      JSON.stringify({
        calendars: {
          a: { busy: [{ start: '2026-05-05T17:00:00Z', end: '2026-05-05T17:30:00Z' }] },
          b: { busy: [{ start: '2026-05-05T17:15:00Z', end: '2026-05-05T18:00:00Z' }] },
          c: { busy: [{ start: '2026-05-05T20:00:00Z', end: '2026-05-05T20:30:00Z' }] },
        },
      }),
      { status: 200 },
    )
    vi.mocked(globalThis.fetch).mockResolvedValue(mockRes)
    const result = await fetchFreeBusy({
      accessToken: 'tok',
      calendarIds: ['a', 'b', 'c'],
      timeMinUtc: '2026-05-05T00:00:00Z',
      timeMaxUtc: '2026-05-06T00:00:00Z',
    })
    expect(result).toEqual([
      { startUtc: '2026-05-05T17:00:00Z', endUtc: '2026-05-05T18:00:00Z' },
      { startUtc: '2026-05-05T20:00:00Z', endUtc: '2026-05-05T20:30:00Z' },
    ])
  })

  it('throws when Google returns non-200', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response('nope', { status: 401 }))
    await expect(
      fetchFreeBusy({
        accessToken: 'tok',
        calendarIds: ['primary'],
        timeMinUtc: '2026-05-05T00:00:00Z',
        timeMaxUtc: '2026-05-06T00:00:00Z',
      }),
    ).rejects.toThrow(/freeBusy failed: 401/)
  })
})
