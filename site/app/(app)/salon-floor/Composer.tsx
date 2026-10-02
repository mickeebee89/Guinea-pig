'use client'

import { useState, useTransition } from 'react'
import { postToFloor } from './actions'
import { FLOOR_MAX } from './constants'

/**
 * The compose box, pinned to the bottom like a timeline's.
 *
 * ⚠️ IT SAYS WHO WILL SEE IT, WHERE SOMEBODY IS ABOUT TO TYPE. The Salon Floor
 * is one audience: every member sees every post, stylists and models alike, and
 * the only limit on reach is that it goes in 48 hours. Somebody posting "after
 * a cut this week" should not have to discover afterwards that stylists are not
 * the only readers. Decided with Micky, 2 Oct 2026.
 */
export function Composer({ isProvider }: { isProvider: boolean }) {
  const [body, setBody] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [held, setHeld] = useState(false)

  const left = FLOOR_MAX - body.length

  function send() {
    setError(null)
    setHeld(false)
    startTransition(async () => {
      const res = await postToFloor(body)
      if (!res.ok) { setError(res.error); return }
      // ⚠️ A POST CAN LAND IN REVIEW, AND SILENCE LOOKS BROKEN. A phone number
      // or a banned word holds it at 'pending' (0072), where the author can see
      // it and nobody else can.
      //
      // This asks the SERVER what happened rather than re-testing the body here.
      // A client-side copy of the digit rule would be a second implementation
      // free to drift from the one in the database.
      setHeld(res.held)
      setBody('')
    })
  }

  return (
    <div className="sticky bottom-0 border-t border-hairline bg-white/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto max-w-2xl">
        {held && (
          <p className="mb-2 rounded-lg bg-input-bg px-3 py-2 text-xs text-muted">
            Posted — we’re having a quick look at it first. You’ll see it on the
            floor once it’s through, and only you can see it until then.
          </p>
        )}
        <label htmlFor="floor-body" className="sr-only">
          Post to the Salon Floor
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="floor-body"
            value={body}
            onChange={e => setBody(e.target.value.slice(0, FLOOR_MAX))}
            rows={2}
            placeholder={isProvider
              ? 'Two spaces free Thursday, doing balayage…'
              : 'After a cut this week, happy to try something new…'}
            className="min-h-11 w-full resize-none rounded-md border border-hairline p-3 text-sm"
          />
          <button
            onClick={send}
            disabled={pending || !body.trim()}
            className="inline-flex min-h-11 shrink-0 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white disabled:opacity-50"
          >
            {pending ? 'Posting…' : 'Post'}
          </button>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <p className="text-xs text-muted">
            Everyone on Cavy sees this — stylists and models — and it goes in 48 hours.
          </p>
          <span className={`text-xs ${left < 20 ? 'text-rose' : 'text-muted'}`}>{left}</span>
        </div>
        {error && <p role="alert" className="mt-1 text-sm text-danger">{error}</p>}
      </div>
    </div>
  )
}
