'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { COMMENT_MAX, RATING_LABELS, type SubRatingKey } from '@/lib/queries/review'
import { BOOKINGS_PATH } from '@/lib/routes'
import { leaveReview } from './actions'

/**
 * The review form. Mobile's fields (leave-review.tsx), on the web: an overall
 * rating (required), optional category ratings, tags and a comment.
 *
 * Choosing an overall rating pre-fills the category ratings that haven't been
 * touched, as mobile does (setOverall, :262-275), so a quick review is one
 * click and a careful one can still differ by category.
 *
 * Stars are radio buttons underneath, so the rating works with a keyboard and
 * is announced properly by a screen reader.
 */
export function ReviewForm({
  sessionId, revieweeName, reviewingStylist, subRatings, tags,
}: {
  sessionId: string
  revieweeName: string
  reviewingStylist: boolean
  subRatings: { key: SubRatingKey; label: string }[]
  tags: string[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [overall, setOverall] = useState(0)
  const [subs, setSubs] = useState<Partial<Record<SubRatingKey, number>>>({})
  const [touched, setTouched] = useState<Set<SubRatingKey>>(new Set())
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const pickOverall = (n: number) => {
    setOverall(n)
    setSubs(prev => {
      const next = { ...prev }
      for (const s of subRatings) if (!touched.has(s.key)) next[s.key] = n
      return next
    })
  }
  const pickSub = (key: SubRatingKey, n: number) => {
    setSubs(prev => ({ ...prev, [key]: n }))
    setTouched(prev => new Set(prev).add(key))
  }
  const toggleTag = (t: string) =>
    setChosen(prev => { const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n })

  const submit = () => {
    setError(null)
    start(async () => {
      const res = await leaveReview(sessionId, { overall, subRatings: subs, tags: [...chosen], comment })
      if (!res.ok) { setError(res.error); return }
      setDone(true)
      router.refresh()
    })
  }

  if (done) {
    return (
      <section role="status" className="rounded-lg border border-hairline bg-white p-5 shadow-soft">
        <h2 className="font-display text-xl text-warm-dark">Review posted</h2>
        <p className="mt-1 text-sm text-muted">
          {reviewingStylist
            ? 'Thank you. It helps other models choose a stylist.'
            : 'Thank you. It helps other stylists know what to expect.'}
        </p>
        <p className="mt-3">
          <Link href={BOOKINGS_PATH} className="text-sm font-bold text-rose hover:underline">Back to bookings →</Link>
        </p>
      </section>
    )
  }

  return (
    <form
      onSubmit={e => { e.preventDefault(); if (overall > 0) submit() }}
      className="space-y-6 rounded-lg border border-hairline bg-white p-5 shadow-soft"
    >
      <fieldset>
        <legend className="font-display text-xl text-warm-dark">How was it overall?</legend>
        <Stars name="overall" value={overall} onChange={pickOverall} size="lg" label={`Overall rating for ${revieweeName}`} />
        <p className="mt-1 text-sm text-muted" aria-live="polite">
          {overall > 0 ? RATING_LABELS[overall] : 'Choose from one to five stars.'}
        </p>
      </fieldset>

      {overall > 0 && subRatings.length > 0 && (
        <fieldset>
          <legend className="text-sm font-bold text-warm-dark">
            {subRatings.length > 1 ? 'By category' : 'And'} <span className="font-normal text-muted">(optional)</span>
          </legend>
          <div className="mt-2 space-y-2">
            {subRatings.map(s => (
              <div key={s.key} className="flex flex-wrap items-center justify-between gap-2">
                <span id={`sub-${s.key}`} className="text-sm text-warm-dark">{s.label}</span>
                <Stars name={s.key} value={subs[s.key] ?? 0} onChange={n => pickSub(s.key, n)} label={s.label} />
              </div>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset>
        <legend className="text-sm font-bold text-warm-dark">
          What stood out? <span className="font-normal text-muted">(optional)</span>
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {tags.map(t => {
            const on = chosen.has(t)
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => toggleTag(t)}
                className={`min-h-11 rounded-[999px] px-4 text-sm font-bold ${on ? 'bg-rose text-white' : 'bg-input-bg text-warm-dark hover:bg-soft-pink'}`}
              >
                {t}
              </button>
            )
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor="review-comment" className="block text-sm font-bold text-warm-dark">
          Anything else? <span className="font-normal text-muted">(optional)</span>
        </label>
        <p className="mt-0.5 text-xs text-muted">
          Other members will see this. Keep it about the appointment.
        </p>
        <textarea
          id="review-comment"
          value={comment}
          onChange={e => setComment(e.target.value)}
          maxLength={COMMENT_MAX}
          rows={4}
          className="mt-1.5 w-full rounded-md border border-hairline bg-input-bg px-3 py-2 text-sm text-warm-dark focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose"
        />
        {comment.length > COMMENT_MAX - 100 && (
          <p className="mt-1 text-xs text-muted">{comment.length} / {COMMENT_MAX}</p>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      <button
        type="submit"
        disabled={overall === 0 || pending}
        className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-6 text-sm font-bold text-white disabled:opacity-50"
      >
        {pending ? 'Posting…' : 'Post review'}
      </button>
    </form>
  )
}

/** Five stars as a radio group. */
function Stars({
  name, value, onChange, label, size = 'md',
}: {
  name: string
  value: number
  onChange: (n: number) => void
  label: string
  size?: 'md' | 'lg'
}) {
  const px = size === 'lg' ? 'text-3xl' : 'text-xl'
  return (
    // The radios are visually hidden, so the focus ring goes on the group.
    <div
      role="radiogroup"
      aria-label={label}
      className="mt-2 flex w-fit gap-1 rounded-md focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-rose"
    >
      {[1, 2, 3, 4, 5].map(n => (
        <label key={n} className={`cursor-pointer ${px} leading-none ${n <= value ? 'text-rose' : 'text-hairline'}`}>
          <input
            type="radio"
            name={name}
            value={n}
            checked={value === n}
            onChange={() => onChange(n)}
            className="sr-only"
          />
          <span aria-hidden="true">★</span>
          <span className="sr-only">{n} star{n === 1 ? '' : 's'}</span>
        </label>
      ))}
    </div>
  )
}
