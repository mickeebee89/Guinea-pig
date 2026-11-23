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
 * Which of the two answers this slot carries: 'free', 'paid', or null for
 * "she has not said".
 *
 * ⚠️ DERIVED FROM pricePence FOR A SLOT LOADED FROM THE DATABASE, and from
 * `priceMode` once she has touched the control. The loaded case is what makes
 * the 67 old null-priced rows open as UNANSWERED rather than as "Free" —
 * which is the whole reason lib/price.ts keeps null and 0 apart.
 */
function answer(s: Slot): 'free' | 'paid' | null {
  if (s.priceMode) return s.priceMode
  if (s.pricePence === 0) return 'free'
  if (s.pricePence != null) return 'paid'
  return null
}

/** A slot a model could not read a price off. Booked rows are exempt. */
function priceMissing(s: Slot): boolean {
  return !s.isBooked && s.pricePence == null
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
  /**
   * Unbooked slots with no price. 23 Nov 2026.
   *
   * ⚠️ IT GATES THE BUTTON, NOT JUST THE SUBMIT, because a missing price is
   * the SAME class of problem as a missing treatment one line up — a slot a
   * model cannot read — and this file already answers that by disabling Save
   * and saying why. Two different mechanisms for one kind of fault is how a
   * stylist learns that some problems stop her and some do not.
   */
  const unpriced = slots.filter(priceMissing).length
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
    // ⚠️ REQUIRED SINCE 23 Nov 2026. The server refuses this too, which is
    // what makes it true; catching it here is what makes it bearable — the
    // message names the slot, and nothing is sent.
    const noPrice = slots.findIndex(priceMissing)
    if (noPrice !== -1) {
      setError(
        `The ${slots[noPrice].startTime} slot needs a price. Pick Free if you’re not charging `
        + `for it — models see “Free”, which is a real answer. A blank isn’t.`,
      )
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

            {/* ── What this slot costs ────────────────────────
                ⚠⚠ REQUIRED SINCE 23 Nov 2026, AND THIS USED TO SAY THE OPPOSITE.
                It read "Empty is a real answer, not a missing one: it means the
                price is still settled in the chat." That was true of the
                mechanism and false about what it did to a model: 67 of 78 slots
                carried no price, ALL 8 open ones were blank, and she picked a
                time, saw nothing, and had to raise money herself with someone
                she had never met.

                ⚠️ SO "FREE" IS A BUTTON, NOT AN EMPTY BOX. Requiring a number
                would read as "you must charge", which is the opposite of what
                this platform is for — most of these treatments ARE free. £0 was
                always a valid value and already rendered as "Free"; the only
                change is that a stylist now SAYS it instead of leaving a blank
                a model has to interpret.

                ⚠️ AND THE TWO STATES STAY APART. lib/price.ts keeps null and 0
                distinct on purpose. Defaulting this control to Free would
                publish a promise on behalf of someone who has not decided —
                exactly what that file exists to prevent — so a new slot opens
                with NEITHER chosen and cannot be saved until one is. */}
            {!s.isBooked && (
              <fieldset className="mt-2">
                <legend className="text-xs text-muted">What you’ll ask for this slot</legend>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={answer(s) === 'free'}
                    onClick={() => update(i, { priceMode: 'free', pricePence: 0, priceInput: undefined })}
                    className={`min-h-11 rounded-[999px] px-3 py-1 text-xs font-bold ${
                      answer(s) === 'free' ? 'bg-rose text-white' : 'bg-input-bg text-muted'
                    }`}
                  >
                    Free
                  </button>
                  <button
                    type="button"
                    aria-pressed={answer(s) === 'paid'}
                    onClick={() => update(i, {
                      priceMode: 'paid',
                      // ⚠️ £0 IS CLEARED ON THE WAY IN. Switching from Free to a
                      // price and leaving "0" in the box would save as Free
                      // again while reading as a price she had set.
                      pricePence: s.pricePence === 0 ? null : s.pricePence,
                      priceInput: undefined,
                    })}
                    className={`min-h-11 rounded-[999px] px-3 py-1 text-xs font-bold ${
                      answer(s) === 'paid' ? 'bg-rose text-white' : 'bg-input-bg text-muted'
                    }`}
                  >
                    A price
                  </button>

                  {answer(s) === 'paid' && (
                    <>
                      <span className="text-sm text-muted" aria-hidden="true">£</span>
                      <input
                        id={`price-${i}`}
                        type="text"
                        inputMode="decimal"
                        value={s.priceInput ?? penceToPounds(s.pricePence)}
                        placeholder="—"
                        aria-label={`Price for the ${s.startTime} slot, in pounds`}
                        aria-describedby={`price-help-${i}`}
                        aria-invalid={priceProblem(s) || priceMissing(s) ? true : undefined}
                        onChange={e => {
                          // The typed text lives ON THE SLOT, not in state keyed
                          // by row number: removing a slot shifts every index
                          // below it, and a price that slides onto the wrong slot
                          // is worse than no price at all. It also keeps "12." on
                          // screen on its way to "12.50", which deriving the
                          // value from pence cannot.
                          const v = e.target.value
                          const parsed = poundsToPence(v)
                          update(i, parsed.ok
                            ? { priceInput: v, pricePence: parsed.pence }
                            : { priceInput: v })
                        }}
                        className="min-h-11 w-24 rounded-md border border-hairline px-2 text-sm"
                      />
                    </>
                  )}
                </div>
                <p
                  id={`price-help-${i}`}
                  className={`mt-1 text-xs ${
                    priceProblem(s) || priceMissing(s) ? 'text-danger' : 'text-muted'
                  }`}
                >
                  {priceProblem(s)
                    ?? (answer(s) === null
                      ? 'Pick one. Free is a real answer — a blank one isn’t, and a model can’t tell them apart.'
                      : answer(s) === 'free'
                        ? 'Shown to models as “Free”.'
                        : s.pricePence == null
                          ? 'Type what you’ll ask, or pick Free.'
                          : 'Shown to models before they apply. You still agree the final amount in the chat.')}
                </p>
              </fieldset>
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

            {/* ── What this slot is for ─────────────────────────────────
                0103. `active_treatments` above says WHICH treatments are on
                offer; this says what she actually wants, in her own words —
                "colour correction, I need someone with box dye to lift" is the
                difference between a model applying and scrolling past.

                ⚠️ 280 IS ENFORCED IN THE DATABASE TOO (availability_note_len).
                maxLength here is a convenience for the person typing; it is not
                a constraint, and this text is rendered to other members. The
                count below uses the same char_length the check does, so she is
                never refused by a limit she was not shown reaching. */}
            {!s.isBooked ? (
              <div className="mt-2">
                <label className="text-xs text-muted" htmlFor={`note-${i}`}>
                  What’s this slot for?
                </label>
                <textarea
                  id={`note-${i}`}
                  rows={2}
                  maxLength={280}
                  value={s.note ?? ''}
                  onChange={e => update(i, { note: e.target.value })}
                  className="mt-1 w-full rounded-md border border-hairline px-2 py-1.5 text-sm"
                />
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs text-muted">
                    Optional. Models see this before they apply.
                  </p>
                  {/* Only once it is close enough to matter: a counter on an
                      empty box is noise, and one that appears at 240 is the
                      first warning she needs. */}
                  {(s.note?.length ?? 0) > 240 && (
                    <p className={`text-xs font-bold ${
                      (s.note?.length ?? 0) >= 280 ? 'text-danger' : 'text-muted'
                    }`}>
                      {s.note?.length ?? 0} / 280
                    </p>
                  )}
                </div>
              </div>
            ) : (
              /* ⚠️ SHOWN, NOT HIDDEN — and this differs from the price and the
                 treatment picker above, which disappear entirely on a booked
                 slot. Hiding a note she already wrote would mean she could not
                 read what she had told the model who booked it, which is the
                 one moment it matters most. Read-only, not invisible. */
              s.note?.trim() && (
                <div className="mt-2">
                  <p className="text-xs text-muted">What this slot is for</p>
                  <p className="mt-1 whitespace-pre-wrap rounded-md bg-input-bg px-2 py-1.5 text-sm text-warm-dark">
                    {s.note}
                  </p>
                </div>
              )
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

      {/* ⚠️ A SEPARATE SENTENCE, NOT MERGED WITH THE ONE ABOVE. They are
          different jobs with different fixes, and a combined "2 slots need
          attention" would make her hunt for which. */}
      {unpriced > 0 && (
        <p className="mt-2 text-sm font-bold text-warm-dark">
          {unpriced === 1
            ? 'One slot has no price yet.'
            : `${unpriced} slots have no price yet.`}{' '}
          Pick Free or set an amount for each. Free is a real answer — a blank one isn’t, and a
          model can’t tell them apart.
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
          disabled={pending || incomplete > 0 || unpriced > 0}
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
