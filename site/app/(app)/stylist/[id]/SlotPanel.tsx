import Link from 'next/link'
import { formatPrice } from '@/lib/price'
import { fmtSlotDate, fmtSlotTime } from '@/lib/slots'
import { bookable, bookableDates, treatmentLabel } from '@/lib/queries/slots'
import type { LoadedSlot, LoadedTreatment } from '@/lib/queries/slots'

/**
 * One day's bookable slots, beside the calendar on a stylist's profile.
 * Audit item 186.
 *
 * ── ⚠️⚠️ THIS IS A SERVER COMPONENT, AND THAT IS A REQUIREMENT ───────────
 * When an application loses a slot race, `actions.ts` returns
 * `{ code: 'slot_taken', refresh: true }` and `ApplyWizard` calls
 * `router.refresh()`. **That re-runs server components and nothing else.** Hold
 * this panel's slots in client state and a refresh will not clear the slot that
 * has just gone — she would be looking at a list the server has already
 * corrected.
 *
 * So the panel takes its day from the URL and its slots from props, and holds no
 * state at all. Micky, 7 Oct 2026: *"treat it as part of the design, not a
 * detail."*
 *
 * ── ⚠️ WHY APPLY IS PER-ROW RATHER THAN SELECT-THEN-APPLY ───────────────
 * The agreed behaviour was "the model picks a slot, then clicks Apply". A
 * selected-slot highlight needs state, and state here means either a client
 * component — which breaks the refresh above — or a SECOND url parameter and a
 * round trip to set it, for no gain. **Each row carries its own Apply, so
 * picking and applying are one gesture.** The chosen slot is then visible where
 * it matters, on the wizard's own step 3, which restates the date, time and
 * price it was entered with.
 *
 * ── ⚠️ THE PAYWALL IS NOT HERE, AND MUST NOT MOVE HERE ──────────────────
 * Apply links into `/stylist/[id]/apply`, which gates on `!ctx.subscribed` at
 * apply/page.tsx:77. **A model reaches this panel, and its prices, without
 * paying** — what £4.99 buys is the right to apply, so she must be able to see
 * what she would be applying for before deciding. Everything on this page is
 * free to look at by design.
 *
 * ── WHAT IS NOT SHOWN, AND WHY A BLANK WAS NOT AN OPTION ────────────────
 * Only `blockedBy === null` slots are listed. A slot with no treatment (item
 * 196) is not rendered at all: the three things a row says are time, treatment
 * and price, and a row with one of them blank is the dead end a model used to
 * meet at the wizard's treatment step, moved earlier rather than removed.
 */
export function SlotPanel({
  providerId,
  stylistName,
  date,
  slots,
  treatments,
}: {
  providerId: string
  stylistName: string
  /** The day the URL selected. */
  date: string
  /** Every future slot for this stylist — the panel does its own filtering. */
  slots: LoadedSlot[]
  treatments: LoadedTreatment[]
}) {
  const byId = new Map(treatments.map(t => [t.id, t]))
  const forDay = bookable(slots).filter(s => s.date === date)

  // The next day that has something, for the empty case. Derived from the same
  // array the calendar marks from, so it cannot point at a day that opens empty.
  const nextDate = bookableDates(slots).find(d => d > date) ?? null

  return (
    <section
      aria-label={`Slots on ${fmtSlotDate(date)}`}
      className="rounded-lg border border-hairline bg-white p-5 shadow-card"
    >
      <h3 className="font-display text-lg text-warm-dark">{fmtSlotDate(date)}</h3>

      {forDay.length === 0 ? (
        <>
          <p className="mt-2 text-sm text-muted">Nothing free on this day.</p>
          {nextDate ? (
            <Link
              href={`/stylist/${providerId}?date=${nextDate}`}
              className="mt-3 inline-flex min-h-11 items-center text-sm font-bold text-rose hover:underline"
            >
              Next free day is {fmtSlotDate(nextDate)} →
            </Link>
          ) : (
            <p className="mt-2 text-sm text-muted">
              {stylistName} has nothing else free in the next couple of months.
            </p>
          )}
        </>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {forDay.map(s => {
              const price = formatPrice(s.pricePence)
              const names = s.treatmentIds
                .map(id => byId.get(id))
                .filter((t): t is LoadedTreatment => !!t)
                .map(treatmentLabel)
              return (
                <li
                  key={s.id}
                  className="rounded-md border border-hairline px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-bold text-warm-dark">
                      {fmtSlotTime(s.startTime)} – {fmtSlotTime(s.endTime)}
                    </span>
                    {/* ⚠️ A NULL PRICE IS A REAL STATE, NOT AN EDGE CASE, and it
                        never renders as £0 or as a dash. The wizard says the
                        same thing at its own step; this is the model's first
                        sight of it. */}
                    <span className={price ? 'text-sm font-bold text-rose-dark' : 'text-xs text-muted'}>
                      {price ?? 'Price agreed in the chat'}
                    </span>
                  </div>

                  {/* The stylist's own per-slot choice. A slot with none of
                      these is not in `forDay` at all — item 196. */}
                  {names.length > 0 && (
                    <p className="mt-1 text-xs text-muted">{names.join(' · ')}</p>
                  )}

                  <Link
                    href={`/stylist/${providerId}/apply?step=3&date=${s.date}&slot=${s.id}`}
                    className="mt-3 inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white hover:bg-rose-dark"
                  >
                    Apply for this time
                  </Link>
                </li>
              )
            })}
          </ul>

          {/* ⚠️ AT THE MOMENT OF CHOOSING, NOT ONLY INSIDE THE WIZARD. Choosing
              a specific time implies it is being held, and it is not. This
              sentence already exists on the membership step; the risk it covers
              starts here, so it has to be legible here. */}
          <p className="mt-4 text-xs text-muted">
            Your place isn’t held while you apply — slots are first come, first served.
          </p>
        </>
      )}
    </section>
  )
}
