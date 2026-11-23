'use client'

import { useState, useTransition } from 'react'
import { setDiscoverable } from '../models/actions'

/**
 * Whether stylists can find her and invite her. Migration 0113.
 *
 * ── ⚠️ IT SAYS WHAT IS EXPOSED AND TO WHOM, NOT "discoverable" ───────────
 * A toggle labelled with the column name tells a member nothing. She is
 * deciding whether strangers can see her photo and her physical attributes
 * and write to her, so the label names exactly that: who sees it (stylists
 * with a published shop, near her), what they see, and what they can do (one
 * invite each, ever).
 *
 * ⚠️ AND IT SAYS WHAT STAYS TRUE WHEN IT IS OFF. Turning this off is not
 * leaving Cavy: she can still browse, still apply, still book. A safety
 * control that reads as "switch off the app" gets left on by people who
 * wanted it off.
 *
 * ⚠️ DEFAULT IS ON, FOR EVERY EXISTING ACCOUNT, WITHOUT ANYONE BEING ASKED.
 * That was decided with the feature (0113's header argues it), and it is the
 * reason this section is worded as an opt-OUT and placed where it can be
 * found rather than buried.
 */
export function DiscoverableSection({ enabled }: { enabled: boolean }) {
  const [on, setOn] = useState(enabled)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const change = (next: boolean) => {
    setError(null)
    setOn(next)                       // optimistic, like the email switch above
    start(async () => {
      const res = await setDiscoverable(next)
      if (!res.ok) { setOn(!next); setError(res.error) }
    })
  }

  return (
    <div>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={e => change(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-rose"
        />
        <span>
          <span className="block text-sm font-bold text-warm-dark">
            Let stylists near me invite me
          </span>
          <span className="mt-0.5 block text-sm text-muted">
            Stylists with a published shop can see your first name, your photo, roughly how far
            away you are, and what you’ve filled in about your hair, skin and nails — and send you
            one invitation each, ever. They never see your email address, your surname or your
            address.
          </span>
        </span>
      </label>

      <p className="mt-3 text-xs text-muted">
        {/* The two things she is most likely to get wrong about what the
            switch does, said plainly rather than left to be discovered. */}
        Turning this off doesn’t change anything else: you can still browse stylists, apply for
        treatments and message anyone you’ve booked with. Invitations you’ve already been sent
        stay on your Invites page, and you can decline them there.
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}
    </div>
  )
}
