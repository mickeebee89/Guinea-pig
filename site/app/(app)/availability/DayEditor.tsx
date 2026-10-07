'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveAvailability } from './actions'
import type { Slot } from '@/lib/availability'
import { penceToPounds, poundsToPence } from '@/lib/price'

/**
 * The price box's complaint, or null. Derived from the text on the slot rather
 * than held in state, so it cannot get out of step with what is shown.
 */
function priceProblem(s: Slot): string | null {
  if (s.priceInput === undefined) return null
  const parsed = poundsToPence(s.priceInput)
  return parsed.ok ? null : parsed.error
}

/**
 * Edit one day's slots.
 *
 * A booked slot is shown but not editable or removable — the server refuses to
 * delete it anyway, and offering a control that silently does nothing is worse
 * than not offering it. If the server does keep one back, `skippedBooked` says
 * so explicitly rather than letting the list quietly disagree with what was
 * asked for.
 */
export function DayEditor({
  date, initial, treatments,
}: {
  date: string
  initial: Slot[]
  treatments: { id: string; label: string }[]
}) {
  const router = useRouter()
  const [slots, setSlots] = useState<Slot[]>(initial)
  const [pending, start] = useTransition()

  /** Unbooked slots with nothing a model could book. Item 196 part 2. */
  const incomplete = slots.filter(s2 => !s2.isBooked && s2.treatmentIds.length === 0).length
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const update = (i: number, patch: Partial<Slot>) =>
    setSlots(prev => prev.map((s, n) => (n === i ? { ...s, ...patch } : s)))

  const add = () =>
    setSlots(prev => [...prev, { startTime: '09:00', endTime: '10:00', treatmentIds: [] }])

  const remove = (i: number) => setSlots(prev => prev.filter((_, n) => n !== i))

  const save = () => {
    setMsg(null); setError(null)
    // A half-typed price must not save as whatever was valid last. The box
    // keeps the text, so the only way to catch this is to ask before saving.
    const badPrice = slots.findIndex(s => priceProblem(s) !== null)
    if (badPrice !== -1) {
      setError(`Check the price on the ${slots[badPrice].startTime} slot — ${priceProblem(slots[badPrice])}`)
      return
    }
    start(async () => {
      const res = await saveAvailability(date, slots)
      if (!res.ok) { setError(res.error); return }
      setMsg(
        res.skippedBooked > 0
          ? `Saved. ${res.skippedBooked} slot${res.skippedBooked === 1 ? '' : 's'} kept because someone has booked ${res.skippedBooked === 1 ? 'it' : 'them'}.`
          : 'Saved.',
      )
      router.refresh()
    })
  }

  return (
    <div className="rounded-lg border border-hairline bg-white p-5">
      <h2 className="mb-4 font-display text-lg text-warm-dark">
        {new Date(date + 'T00:00:00').toLocaleDateString('en-GB', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        })}
      </h2>

      {slots.length === 0 && (
        <p className="text-sm text-muted">No slots on this day yet.</p>
      )}

      <ul className="space-y-3">
        {slots.map((s, i) => (
          <li key={s.dbId ?? `new-${i}`} className="rounded-md border border-hairline p-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`start-${i}`}>Start time</label>
              <input
                id={`start-${i}`} type="time" value={s.startTime} disabled={s.isBooked}
                onChange={e => update(i, { startTime: e.target.value })}
                className="min-h-11 rounded-md border border-hairline px-2 text-sm disabled:bg-input-bg disabled:text-muted"
              />
              <span className="text-muted" aria-hidden="true">–</span>
              <label className="sr-only" htmlFor={`end-${i}`}>End time</label>
              <input
                id={`end-${i}`} type="time" value={s.endTime} disabled={s.isBooked}
                onChange={e => update(i, { endTime: e.target.value })}
                className="min-h-11 rounded-md border border-hairline px-2 text-sm disabled:bg-input-bg disabled:text-muted"
              />
              {s.isBooked ? (
                <span className="rounded-[999px] bg-soft-pink px-2.5 py-0.5 text-xs font-bold text-rose">
                  Booked
                </span>
              ) : (
                <button
                  onClick={() => remove(i)}
                  className="ml-auto text-sm font-bold text-danger hover:underline"
                >
                  Remove
                </button>
              )}
            </div>

            {/* ── What this slot costs ───────────────────────────────────
                Empty is a real answer, not a missing one: it means the price
                is still settled in the chat, which is how every booking has
                worked until now. So no placeholder that reads like a default,
                and no "0" pre-filled — 0 means free, and saying "free" for
                someone who simply has not decided is not ours to do. */}
            {!s.isBooked && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="text-xs text-muted" htmlFor={`price-${i}`}>
                  What you’ll ask for this slot
                </label>
                <span className="text-sm text-muted" aria-hidden="true">£</span>
                <input
                  id={`price-${i}`}
                  type="text"
                  inputMode="decimal"
                  value={s.priceInput ?? penceToPounds(s.pricePence)}
                  placeholder="—"
                  aria-describedby={`price-help-${i}`}
                  aria-invalid={priceProblem(s) ? true : undefined}
                  onChange={e => {
                    // The typed text lives ON THE SLOT, not in state keyed by
                    // row number: removing a slot shifts every index below it,
                    // and a price that slides onto the wrong slot is worse than
                    // no price at all. It also keeps "12." on screen on its way
                    // to "12.50", which deriving the value from pence cannot.
                    const v = e.target.value
                    const parsed = poundsToPence(v)
                    update(i, parsed.ok ? { priceInput: v, pricePence: parsed.pence } : { priceInput: v })
                  }}
                  className="min-h-11 w-24 rounded-md border border-hairline px-2 text-sm"
                />
                <span id={`price-help-${i}`} className={`text-xs ${priceProblem(s) ? 'text-danger' : 'text-muted'}`}>
                  {priceProblem(s)
                    ?? (s.pricePence === 0
                      ? 'Shown to models as “Free”.'
                      : s.pricePence == null
                        ? 'Leave empty to agree it in the chat, as now.'
                        : 'Shown to models before they apply. You still agree the final amount in the chat.')}
                </span>
              </div>
            )}

            {treatments.length > 0 && !s.isBooked && (
              <fieldset className="mt-2">
                <legend className="text-xs text-muted">Treatments offered in this slot</legend>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {treatments.map(t => {
                    const on = s.treatmentIds.includes(t.id)
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => update(i, {
                          treatmentIds: on
                            ? s.treatmentIds.filter(x => x !== t.id)
                            : [...s.treatmentIds, t.id],
                        })}
                        className={`rounded-[999px] px-3 py-1 text-xs font-bold ${
                          on ? 'bg-rose text-white' : 'bg-input-bg text-muted'
                        }`}
                      >
                        {t.label}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            )}

            {/*
              ⚠⚠ THE AUTHORITATIVE PLACE SHE IS TOLD. Item 196 part 3.

              A slot with no treatment is skipped by the model-facing loader
              (part 1) — so without this she keeps a diary she believes is live
              and nobody ever applies. That silence is item 183's shape, and the
              page she created the slot on is where it has to be broken.

              ⚠️ IT NAMES THE CAUSE AND THE REMEDY IN HER TERMS. Not "no
              active_treatments", not "filtered out" — what is wrong and what to
              do, in the words she would use.

              ⚠️ AND THE TWO CAUSES GET DIFFERENT SENTENCES, because one of them
              cannot be acted on here. With treatments in her shop the fix is a
              tap above; with NONE the picker does not render at all (see the
              condition above), so telling her to pick one would point at an
              empty space. That second case cannot reach a model today —
              publishing needs a categorised treatment — but she can still fill a
              diary that can never be booked, and the surface that would explain
              it is the one she is on.

              A booked slot is exempt: it already has a model, so nothing about
              being offered applies to it.
            */}
            {!s.isBooked && s.treatmentIds.length === 0 && (
              treatments.length > 0 ? (
                <p className="mt-2 text-xs font-bold text-warm-dark">
                  No treatment selected — models can’t book this slot. Pick at least one above.
                </p>
              ) : (
                <p className="mt-2 text-xs font-bold text-warm-dark">
                  Models can’t book this slot until your shop lists a treatment.{' '}
                  <Link href="/shop" className="text-rose hover:underline">Add one to your shop</Link>, then
                  choose it here.
                </p>
              )
            )}
          </li>
        ))}
      </ul>

      {/*
        ⚠⚠ SAVE IS BLOCKED WHILE A SLOT HAS NO TREATMENT. Item 196 part 2.

        Part 3 tells her; this stops NEW ones being made. Both are needed: a
        form gate does not clean up history, and a warning alone does not stop
        tomorrow's slot being created the same way.

        ⚠️ A BLOCK AND NOT A WARNING, because a treatment-less slot is not a
        lesser version of a slot — it is one the marketplace cannot sell, and
        saving it produces exactly the row item 196 exists to stop. That is
        different from the bio rule (item 183), which is advisory because an
        empty bio still leaves a bookable shop.

        ⚠️ IT HAS A ROUTE OUT IN BOTH DIRECTIONS, which is what makes a block
        fair rather than a trap: fix the slot by tapping a treatment, or Remove
        it. And for a stylist whose shop lists NO treatments, the per-slot
        sentence above links to /shop, because telling her to pick from an
        empty list would be a gate with no door.

        Booked slots are exempt — they already have a model, and their picker is
        not rendered, so she could not satisfy the rule for them if it applied.
      */}
      {incomplete > 0 && (
        <p className="mt-4 text-sm font-bold text-warm-dark">
          {incomplete === 1
            ? 'One slot has no treatment yet.'
            : `${incomplete} slots have no treatment yet.`}{' '}
          Choose one for each, or remove them, and you can save.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={add}
          className="inline-flex min-h-11 items-center rounded-[999px] bg-input-bg px-4 text-sm font-bold text-warm-dark hover:bg-soft-pink"
        >
          Add a slot
        </button>
        <button
          onClick={save}
          disabled={pending || incomplete > 0}
          className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white hover:bg-rose-dark disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save this day'}
        </button>
      </div>

      {msg && <p role="status" className="mt-3 text-sm font-bold text-rose">{msg}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  )
}
