'use client'

import { useState, useTransition } from 'react'
import { postStatus, clearStatus } from './status-actions'

const MAX = 280

/**
 * "What's on" — a stylist's 48-hour update.
 *
 * ── ON THE DASHBOARD, NOT IN /shop ────────────────────────────────────────
 * Editing a shop is something you do once and revisit rarely; posting "two
 * spaces free Thursday" is frequent. Putting it behind an edit screen makes the
 * cheap thing expensive, which is the mistake that made the Safety control
 * unfindable (docs/safety-surface.md). One entry point, deliberately — a second
 * is a second thing to keep in step.
 *
 * ── IT SHOWS WHAT THE DATABASE DECIDED, NOT WHAT IT EXPECTS ───────────────
 * The screening trigger (0032) can hold a post for review, and this reads the
 * result back rather than assuming publication. A composer that clears and says
 * "posted!" while the row sits pending is the failure the whole moderation
 * sequence exists to remove.
 */
export function StatusComposer({
  providerId, current,
}: {
  providerId: string
  current: {
    id: string
    body: string
    expiresAt: string
    moderationStatus: 'pending' | 'approved' | 'rejected'
    reviewNote: string | null
  } | null
}) {
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const res = await postStatus(providerId, body)
      if (res.ok) setBody('')
      else setError(res.error)
    })
  }

  const clear = () => {
    setError(null)
    startTransition(async () => {
      const res = await clearStatus(providerId)
      if (!res.ok) setError(res.error)
    })
  }

  return (
    <div>
      {current && (
        <div className="mb-4 rounded-lg border border-hairline bg-input-bg p-4">
          {/* Rendered as text. Links were stripped at write time by trigger, and
              nothing here parses the body. */}
          <p className="whitespace-pre-line text-sm text-warm-dark">{current.body}</p>

          {current.moderationStatus === 'approved' && (
            <p className="mt-2 text-xs font-bold text-rose">
              Live now · disappears automatically after 48 hours
            </p>
          )}

          {/* HELD, not lost. The stylist can see it, which is the whole reason
              0031's read policy ignores moderation_status for the author. */}
          {current.moderationStatus === 'pending' && (
            <p className="mt-2 text-xs font-bold text-muted">
              Waiting on a quick review before it goes out. It isn’t visible to
              anyone yet — we’ll let you know either way.
            </p>
          )}

          {current.moderationStatus === 'rejected' && (
            <div className="mt-2">
              <p className="text-xs font-bold text-danger">This one wasn’t published.</p>
              {/* The admin's note, when they left one. It deliberately never
                  names the term that tripped the screen. */}
              {current.reviewNote && (
                <p className="mt-1 text-xs text-muted">{current.reviewNote}</p>
              )}
              <p className="mt-1 text-xs text-muted">You can write a different one below.</p>
            </div>
          )}

          <button
            onClick={clear}
            disabled={pending}
            className="mt-3 min-h-11 text-sm font-bold text-muted hover:text-rose disabled:opacity-50"
          >
            {current.moderationStatus === 'approved' ? 'Take it down' : 'Clear it'}
          </button>
        </div>
      )}

      <label htmlFor="status-body" className="block text-sm font-bold text-warm-dark">
        {current ? 'Post a new one' : 'What’s on?'}
      </label>
      <p className="text-xs text-muted">
        Models near you see this for 48 hours. Links are removed automatically.
      </p>

      <textarea
        id="status-body"
        value={body}
        onChange={e => setBody(e.target.value.slice(0, MAX))}
        rows={2}
        placeholder="Two spaces free Thursday afternoon"
        className="mt-2 w-full rounded-md border border-hairline bg-white p-2 text-sm text-warm-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
        disabled={pending}
      />

      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={pending || !body.trim()}
          className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-4 text-sm font-bold text-white hover:bg-rose-dark disabled:opacity-50"
        >
          {pending ? 'Posting…' : 'Post update'}
        </button>
        <span className="text-xs text-muted">{body.length}/{MAX}</span>
      </div>

      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  )
}
