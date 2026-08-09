'use client'

import { useState, useTransition } from 'react'
import { acceptSession, declineSession, completeSession } from './actions'

/**
 * Accept / decline / mark-complete for the stylist.
 *
 * A refusal has to be VISIBLE. The server action returns a result rather than
 * throwing, and anything other than success is shown here — the failure mode
 * being guarded against is a booking that silently didn't move while the
 * stylist believes it did.
 *
 * Decline asks for confirmation. It is the only one of the three that cannot
 * be undone from this screen.
 */
export function SessionActions({
  sessionId, status, isPast,
}: { sessionId: string; status: string; isPast: boolean }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const run = (fn: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>, label: string) => {
    setError(null)
    startTransition(async () => {
      const res = await fn(sessionId)
      if (res.ok) setDone(label)
      else setError(res.error)
    })
  }

  if (done) return <p className="text-sm font-bold text-rose">{done}</p>

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {status === 'pending' && (
          <>
            <button
              onClick={() => run(acceptSession, 'Accepted')}
              disabled={pending}
              className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-4 text-sm font-bold text-white hover:bg-rose-dark disabled:opacity-50"
            >
              {pending ? 'Working…' : 'Accept'}
            </button>
            <button
              onClick={() => {
                if (confirm('Decline this application? The model will be told it wasn’t confirmed.')) {
                  run(declineSession, 'Declined')
                }
              }}
              disabled={pending}
              className="inline-flex min-h-11 items-center rounded-[999px] bg-input-bg px-4 text-sm font-bold text-muted hover:text-warm-dark disabled:opacity-50"
            >
              Decline
            </button>
          </>
        )}

        {/* Only offered once the day has passed — marking a future booking
            complete is always a mistake. */}
        {status === 'accepted' && isPast && (
          <button
            onClick={() => run(completeSession, 'Marked complete')}
            disabled={pending}
            className="inline-flex min-h-11 items-center rounded-[999px] bg-soft-pink px-4 text-sm font-bold text-rose hover:bg-rose hover:text-white disabled:opacity-50"
          >
            {pending ? 'Working…' : 'Mark complete'}
          </button>
        )}
      </div>

      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  )
}
