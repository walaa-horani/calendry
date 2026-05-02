'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Copy, Check, ExternalLink } from 'lucide-react'

interface MeetingType {
  _id: string
  title: string
  description: string | null
  duration: number
  location: { type: string; value?: string; instructions?: string }
  color: string
  active: boolean
  slug: { current: string }
}

const LOCATION_LABELS: Record<string, string> = {
  zoom: 'Zoom',
  googleMeet: 'Google Meet',
  phone: 'Phone',
  inPerson: 'In person',
  customUrl: 'Custom URL',
}

export default function EventTypesList({
  username,
  meetings,
}: {
  username: string
  meetings: MeetingType[]
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleCopy = async (slug: string, id: string) => {
    const url = `${window.location.origin}/${username}/${slug}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000)
    } catch {
      // navigator.clipboard requires HTTPS or localhost; ignore failures silently
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">Event types</h1>
      <p className="mt-2 text-sm text-gray-600">
        Share these with invitees so they can book time with you. Manage in{' '}
        <Link href="/studio" className="text-blue-700 hover:underline">
          Studio
        </Link>
        .
      </p>

      {meetings.length === 0 ? (
        <p className="mt-8 text-sm text-gray-500">
          No event types yet. Create one in{' '}
          <Link href="/studio" className="text-blue-700 hover:underline">
            Studio
          </Link>
          .
        </p>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {meetings.map((m) => {
            const url = `/${username}/${m.slug.current}`
            const isCopied = copiedId === m._id
            return (
              <article
                key={m._id}
                className={
                  'rounded-lg border p-4 ' +
                  (m.active
                    ? 'border-gray-200 bg-white'
                    : 'border-gray-200 bg-gray-50 opacity-70')
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-medium">{m.title}</h2>
                    <p className="mt-0.5 text-sm text-gray-600">
                      {m.duration} min ·{' '}
                      {LOCATION_LABELS[m.location.type] ?? m.location.type}
                      {!m.active ? ' · inactive' : ''}
                    </p>
                  </div>
                </div>

                {m.description ? (
                  <p className="mt-2 text-sm text-gray-700">{m.description}</p>
                ) : null}

                <div className="mt-4 flex items-center gap-2">
                  <Link
                    href={url}
                    target="_blank"
                    className="inline-flex items-center gap-1 rounded border border-blue-600 px-3 py-1 text-sm text-blue-700 hover:bg-blue-600 hover:text-white"
                  >
                    Open booking page <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleCopy(m.slug.current, m._id)}
                    className="inline-flex items-center gap-1 rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    {isCopied ? (
                      <>
                        <Check className="h-3.5 w-3.5" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" /> Copy link
                      </>
                    )}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}
