'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { saveTreatments, type BlockedTreatment } from './actions'

/**
 * Which treatments this shop offers.
 *
 * Separate save from the details form on purpose. They fail for different
 * reasons — a removal can be refused because a booking still points at it,
 * which has nothing to do with your bio — and one combined button would have to
 * report "saved, except the bit that wasn't".
 */
export function TreatmentPicker({
  all, initial,
}: {
  all: string[]
  initial: string[]
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set(initial))
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<BlockedTreatment[]>([])
  const [savedSomething, setSavedSomething] = useState(false)

  const toggle = (cat: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat); else next.add(cat)
      return next
    })
  }

  const dirty =
    selected.size !== initial.length || initial.some(c => !selected.has(c))

  const save = () => {
    setMsg(null); setError(null); setBlocked([]); setSavedSomething(false)
    start(async () => {
      const res = await saveTreatments([...selected])
      if (!res.ok) { setError(res.error); return }
      // A treatment held by a live booking is not something pressing save
      // again will fix, so it gets its own panel naming the booking rather
      // than a red line that reads like a failure to retry.
      if (res.blocked.length > 0) {
        setBlocked(res.blocked)
        // Did anything ACTUALLY save? Toggling one treatment that then gets
        // refused is a complete no-op, and "Everything saved, except…" reads as
        // success at a glance with the failure buried underneath. True, and
        // still the wrong impression.
        setSavedSomething(res.added + res.removed > 0)
        // Put the refused chips BACK ON. They were never removed, and leaving
        // them off would have the page state a thing about this shop that is
        // not true — until a reload silently corrects it, which reads as the
        // page having changed its mind. The panel explains why they are on.
        //
        // Filtered against `all`: a blocked entry whose category was null
        // arrives as the placeholder "That treatment", and adding that would
        // put a value in the set with no chip able to show it — the exact
        // invisible-selection bug categoryKey exists to prevent.
        setSelected(prev => new Set([
          ...prev,
          ...res.blocked.map(b => b.category).filter(c => all.includes(c)),
        ]))
      } else {
        setMsg('Saved.')
      }
      router.refresh()
    })
  }

  return (
    <section className="rounded-lg border border-hairline bg-white p-5 shadow-soft">
      <h2 className="font-display text-xl text-warm-dark">What you offer</h2>
      <p className="mt-1 text-sm text-muted">
        Models filter by these, so pick everything you actually do — and nothing you don’t.
      </p>

      {all.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          We couldn’t load the treatment list. This is a problem at our end — try reloading.
        </p>
      ) : (
        <>
          <fieldset className="mt-4">
            <legend className="sr-only">Treatments you offer</legend>
            <div className="flex flex-wrap gap-2">
              {all.map(cat => {
                const on = selected.has(cat)
                return (
                  <button
                    key={cat}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(cat)}
                    className={`inline-flex min-h-11 items-center rounded-[999px] px-4 text-sm font-bold transition-colors ${
                      on ? 'bg-rose text-white' : 'bg-input-bg text-muted hover:bg-soft-pink'
                    }`}
                  >
                    {cat}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={save}
              disabled={pending || !dirty || selected.size === 0}
              className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white hover:bg-rose-dark disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Save treatments'}
            </button>
            {selected.size === 0 && (
              <span className="text-sm text-muted">Pick at least one.</span>
            )}
          </div>

          <p className="mt-3 text-xs text-muted">
            Adding a treatment doesn’t put it in your diary. Choose which ones a slot is for on{' '}
            <Link href="/availability" className="font-bold text-rose hover:underline">your availability</Link>.
          </p>
        </>
      )}

      {msg && <p role="status" className="mt-3 text-sm font-bold text-rose">{msg}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}

      {blocked.length > 0 && (
        <div role="status" className="mt-3 rounded-md border border-hairline bg-input-bg p-3">
          <p className="text-sm font-bold text-warm-dark">
            {savedSomething
              ? <>Everything saved{blocked.length === 1
                  ? `, except taking ${blocked[0].category} off`
                  : ', except removing some treatments'}</>
              : blocked.length === 1
                ? `${blocked[0].category} couldn’t be taken off`
                : 'Those treatments couldn’t be taken off'}
          </p>
          <ul className="mt-1 space-y-1">
            {blocked.map(b => (
              <li key={b.category} className="text-sm text-muted">{b.detail}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
