'use client'

import { useState, useTransition } from 'react'
import { acceptSession, declineSession, completeSession, cancelBooking } from './actions'

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
  sessionId, status, isPast, role, date, otherName,
}: {
  sessionId: string; status: string; isPast: boolean
  role: 'model' | 'provider'; date: string; otherName: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState('')

  // Either party can cancel a booking that has not happened yet.
  const canCancel = (status === 'pending' || status === 'accepted') && !isPast

  // Computed when the panel OPENS, not during render: Date.now() is impure and
  // a re-render could flip the line under the reader. It is only ever used to
  // show a factual note, never to block anything.
  const [shortNotice, setShortNotice] = useState(false)

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
        {/* Stylist-only. page.tsx used to gate the whole component on role;
            now that it renders for both parties so models can cancel, the gate
            has to live here — without it a model sees Accept on their own
            application and RLS refuses it at the last moment. */}
        {role === 'provider' && status === 'pending' && (
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
        {role === 'provider' && status === 'accepted' && isPast && (
          <button
            onClick={() => run(completeSession, 'Marked complete')}
            disabled={pending}
            className="inline-flex min-h-11 items-center rounded-[999px] bg-soft-pink px-4 text-sm font-bold text-rose hover:bg-rose hover:text-white disabled:opacity-50"
          >
            {pending ? 'Working…' : 'Mark complete'}
          </button>
        )}

        {/* ── CANCEL ──────────────────────────────────────────────────────
            Rendered for BOTH parties, and as plainly as Accept. This is the
            control people reach for under time pressure — sometimes the same
            pressure that would otherwise send them to the Safety control — so
            it is not hidden behind an overflow menu. See docs/safety-surface.md. */}
        {canCancel && !cancelOpen && (
          <button
            onClick={() => {
              setError(null)
              // Dates are held without a time, so this is midnight — close
              // enough to decide whether to show the note.
              const hoursAway =
                (new Date(date + 'T00:00:00').getTime() - Date.now()) / 3_600_000
              setShortNotice(hoursAway < 24)
              setCancelOpen(true)
            }}
            disabled={pending}
            className="inline-flex min-h-11 items-center rounded-[999px] border border-hairline px-4 text-sm font-bold text-muted hover:border-rose hover:text-rose disabled:opacity-50"
          >
            Cancel booking
          </button>
        )}
      </div>

      {cancelOpen && (
        <div className="mt-3 rounded-lg border border-hairline bg-input-bg p-4">
          <p className="text-sm font-bold text-warm-dark">
            Cancel your booking with {otherName}?
          </p>

          {/* ── CONSEQUENCE, NOT DISCOURAGEMENT ──────────────────────────
              Someone cancelling at short notice because they have changed
              their mind about being alone with a stranger must not meet a
              screen implying they are letting anyone down. So: what will
              happen, stated flatly. No "are you sure", no "please consider",
              no count of how little notice they are giving. */}
          <p className="mt-1 text-sm text-muted">
            {shortNotice && <>This booking is within the next 24 hours. </>}
            {otherName} will be told, and the time slot goes back on their calendar.
            This can’t be undone.
          </p>

          <label htmlFor="cancel-reason" className="mt-3 block text-sm font-bold text-warm-dark">
            Anything you’d like them to know?
          </label>
          <p className="text-xs text-muted">Optional. They’ll see this.</p>
          <textarea
            id="cancel-reason"
            value={reason}
            onChange={e => setReason(e.target.value.slice(0, 280))}
            rows={2}
            className="mt-1 w-full rounded-md border border-hairline bg-white p-2 text-sm text-warm-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => {
                setError(null)
                startTransition(async () => {
                  const res = await cancelBooking(sessionId, reason)
                  if (res.ok) { setCancelOpen(false); setDone('Cancelled') }
                  else setError(res.error)
                })
              }}
              disabled={pending}
              className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-4 text-sm font-bold text-white hover:bg-rose-dark disabled:opacity-50"
            >
              {pending ? 'Cancelling…' : 'Cancel booking'}
            </button>
            <button
              onClick={() => { setCancelOpen(false); setReason('') }}
              disabled={pending}
              className="inline-flex min-h-11 items-center rounded-[999px] px-4 text-sm font-bold text-muted hover:text-warm-dark disabled:opacity-50"
            >
              Keep it
            </button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  )
}
