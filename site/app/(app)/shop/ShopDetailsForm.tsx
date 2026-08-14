'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveShopDetails } from './actions'

const LIMITS = { name: 80, bio: 500, location: 120 } as const

/**
 * Name, area and bio.
 *
 * The counters are only shown once you are near the limit. A permanent "0/500"
 * under an empty box reads as a target to hit, and a bio written to fill a
 * counter is worse than a short honest one.
 */
export function ShopDetailsForm({
  initial,
}: {
  initial: { name: string; bio: string; locationText: string }
}) {
  const router = useRouter()
  const [name, setName] = useState(initial.name)
  const [bio, setBio] = useState(initial.bio)
  const [locationText, setLocationText] = useState(initial.locationText)
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dirty =
    name !== initial.name || bio !== initial.bio || locationText !== initial.locationText

  const save = () => {
    setMsg(null); setError(null)
    start(async () => {
      const res = await saveShopDetails({ name, bio, locationText })
      if (!res.ok) { setError(res.error); return }
      setMsg('Saved.')
      router.refresh()
    })
  }

  return (
    <section className="rounded-lg border border-hairline bg-white p-5 shadow-soft">
      <h2 className="font-display text-xl text-warm-dark">Your shop</h2>
      <p className="mt-1 text-sm text-muted">
        This is what a model sees before they decide whether to apply.
      </p>

      <div className="mt-4 space-y-4">
        <Field
          id="shop-name" label="Name" value={name} onChange={setName}
          max={LIMITS.name} placeholder="Your stylist or salon name"
          hint="However you want to be known — your own name or your salon's."
        />

        <Field
          id="shop-location" label="Area" value={locationText} onChange={setLocationText}
          max={LIMITS.location} placeholder="e.g. Bromley, Kent"
          hint="The town or area you work in. Models search on this, so write it the way someone nearby would."
        />

        <div>
          <label htmlFor="shop-bio" className="block text-sm font-bold text-warm-dark">
            About you <span className="font-normal text-muted">(optional)</span>
          </label>
          <p className="mt-0.5 text-xs text-muted">
            What you do, what you’re training in, what your space is like. A few honest lines
            beat a paragraph of adjectives.
          </p>
          <textarea
            id="shop-bio"
            value={bio}
            onChange={e => setBio(e.target.value.slice(0, LIMITS.bio))}
            rows={5}
            maxLength={LIMITS.bio}
            placeholder="Tell models about yourself, what you specialise in, and where you work…"
            className="mt-1.5 w-full rounded-md border border-hairline bg-input-bg px-3 py-2 text-sm text-warm-dark placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose"
          />
          <Counter length={bio.length} max={LIMITS.bio} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={pending || !dirty}
          className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white hover:bg-rose-dark disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save shop details'}
        </button>
        {!dirty && !msg && <span className="text-sm text-muted">Nothing to save yet.</span>}
      </div>

      {msg && <p role="status" className="mt-3 text-sm font-bold text-rose">{msg}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </section>
  )
}

function Field({
  id, label, value, onChange, max, placeholder, hint,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void
  max: number; placeholder: string; hint: string
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-bold text-warm-dark">{label}</label>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
      <input
        id={id}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value.slice(0, max))}
        maxLength={max}
        placeholder={placeholder}
        className="mt-1.5 min-h-11 w-full rounded-md border border-hairline bg-input-bg px-3 text-sm text-warm-dark placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose"
      />
      <Counter length={value.length} max={max} />
    </div>
  )
}

/** Silent until it matters — from 80% of the limit onwards. */
function Counter({ length, max }: { length: number; max: number }) {
  if (length < max * 0.8) return null
  return (
    <p className={`mt-1 text-xs ${length >= max ? 'text-danger' : 'text-muted'}`}>
      {length} / {max}{length >= max && ' — that’s the limit'}
    </p>
  )
}
