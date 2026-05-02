'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { cancelBooking } from '../../actions'

export default function CancelButton({ bookingToken }: { bookingToken: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const onClick = () => {
    setError(null)
    startTransition(async () => {
      const result = await cancelBooking(bookingToken)
      if (result.ok || result.error === 'already_cancelled') {
        router.refresh()
      } else if (result.error === 'past_booking') {
        setError('Cannot cancel — meeting has already started.')
        router.refresh()
      } else if (result.error === 'not_found') {
        setError('Booking not found.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    })
  }

  return (
    <div className="text-center">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 shadow-sm transition hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? 'Cancelling…' : 'Cancel booking'}
      </button>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </div>
  )
}
