'use client'

import { useState, useTransition } from 'react'
import { setFavourite } from './favourite-actions'
import { attempt } from '@/lib/attempt'

/**
 * Save a stylist. Audit item 94.
 *
 * ── IT SAYS WHAT IT DOES, WHICH THE APP'S HEART DOES NOT ──────────────────
 * Saving subscribes her to `new_availability` notifications: every time this
 * stylist posts times, `notifyModelsOfAvailability` writes her one. Mobile's
 * heart carries no such sentence, so a model tapping it cannot know she has
 * asked to be told things. This one says it in the line underneath, once saved.
 *
 * ⚠️ IT IS AN EMAIL NOW, AND THE COPY HAD TO CHANGE WITH IT. This docblock said
 * the opposite until 26 Nov 2026 — "Not 'we'll email you'. 0047 excludes
 * new_availability from email on purpose" — and 0116 overturned that. The line
 * under the button says "and email you" because she can turn that off in
 * Settings, and a promise she cannot find the switch for is the worse failure.
 *
 * ⚠️ SAVING IS NOT THE ONLY WAY SHE HEARS ANY MORE. 0116 also notifies models
 * within ten miles of a published shop, so this control is now "tell me about
 * THIS one wherever I am" rather than the only subscription there is.
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
      const res = await attempt(() => setFavourite(providerId, next), 'favourite')
      if (!res.ok) {
        setSaved(!next)     // and back, because it did not happen
        setError(res.error ?? 'That didn’t save.')
        return
      }
      setSaved(next)
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
          We’ll tell you and email you when {stylistName} posts new times. You can turn
          the emails off in Settings.
        </p>
      )}
      {error && <p role="alert" className="max-w-[16rem] text-right text-xs text-danger">{error}</p>}
    </div>
  )
}
