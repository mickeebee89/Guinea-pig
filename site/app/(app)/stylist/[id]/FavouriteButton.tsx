'use client'

import { useState, useTransition } from 'react'
import { setFavourite } from './favourite-actions'

/**
 * Save a stylist. Audit item 94.
 *
 * ── IT SAYS WHAT IT DOES, WHICH THE APP'S HEART DOES NOT ──────────────────
 * Saving subscribes her to `new_availability` notifications: every time this
 * stylist posts times, `notifyFavourites` writes her one. Mobile's heart
 * carries no such sentence, so a model tapping it cannot know she has asked to
 * be told things. This one says it in the line underneath, once saved.
 *
 * ⚠️ Not "we'll email you". 0047 excludes new_availability from email on
 * purpose — it is a mass send, one per favouriter, every time.
 *
 * ── AND IT FAILS OUT LOUD ─────────────────────────────────────────────────
 * Mobile's toggle sets the state and fires the write with no error handling at
 * all (provider/[id].tsx:307-314), so a failed insert leaves a filled heart
 * over a row that does not exist — she believes she will be told about new
 * times and never hears. This is optimistic too, because a control that waits
 * on the network feels broken, but it goes back and says so.
 */
export function FavouriteButton({
  providerId, stylistName, initial,
}: {
  providerId: string
  stylistName: string
  initial: boolean
}) {
  const [saved, setSaved] = useState(initial)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const toggle = () => {
    const next = !saved
    setError(null)
    setSaved(next)          // optimistic
    start(async () => {
      const res = await setFavourite(providerId, next)
      if (!res.ok) {
        setSaved(!next)     // and back, because it did not happen
        setError(res.error)
        return
      }
      setSaved(res.saved)
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={toggle}
        disabled={pending}
        aria-pressed={saved}
        className={`inline-flex min-h-11 items-center gap-2 rounded-[999px] px-4 text-sm font-bold disabled:opacity-60 ${
          saved
            ? 'bg-soft-pink text-rose'
            : 'bg-input-bg text-muted hover:bg-soft-pink hover:text-rose'
        }`}
      >
        <span aria-hidden="true">{saved ? '♥' : '♡'}</span>
        {saved ? 'Saved' : 'Save'}
        <span className="sr-only">
          {saved ? `${stylistName} is saved. Press to remove.` : `Save ${stylistName}`}
        </span>
      </button>

      {saved && !error && (
        <p className="max-w-[16rem] text-right text-xs text-muted">
          We’ll tell you when {stylistName} posts new times.
        </p>
      )}
      {error && <p role="alert" className="max-w-[16rem] text-right text-xs text-danger">{error}</p>}
    </div>
  )
}
