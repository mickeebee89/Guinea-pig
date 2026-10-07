import type { SupabaseClient } from '@supabase/supabase-js'
import { withoutStartedSlots } from '@/lib/slots'

/**
 * ONE ANSWER TO "WHICH SLOTS CAN A MODEL BOOK". Audit items 186, 192, 196.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 * The question was answered in two places with two different answers.
 *
 *   `queries/stylist.ts` marked a calendar day open on `withoutStartedSlots`
 *     plus `!is_taken`.
 *   `queries/apply.ts` added a third test — its own read of `sessions` for
 *     pending or accepted applications.
 *
 * ⚠️ THEY AGREED ONLY BY ACCIDENT, AND BOTH WERE WRONG IN THE SAME DIRECTION.
 * `"participants can read sessions"` is
 * `using (auth.uid() = model_user_id OR <provider owner>)`, so a model's read
 * returned ONLY HER OWN sessions — silently, with no error. So apply.ts's third
 * test found nothing, which is why the two surfaces never visibly disagreed.
 * That is audit item 192, and 0090's `slot_contention()` is its fix.
 *
 * ⚠️⚠️ WHICH MEANT A PARTIAL FIX WOULD HAVE BEEN WORSE THAN NONE. Correct
 * apply.ts alone and the stylist page starts advertising days the wizard then
 * refuses — a dead end created by fixing half of it. **That is the reason this
 * is one function with two callers rather than two corrected call sites.**
 *
 * ── WHAT IT COMPOSES, AND WHAT IT REFUSES TO ────────────────────────────
 * Four filters, in one place:
 *
 *   1. `is_taken` — the stylist's own flag.
 *   2. started slots — `withoutStartedSlots`, item 133. Europe/London, not the
 *      server's clock; see lib/slots.ts for why that is not pedantry.
 *   3. contention — `slot_contention(provider_id)` from 0090.
 *   4. a treatment — `active_treatments` must be non-empty. Item 196.
 *
 * ⚠️ 3 IS A FUNCTION CALL AND MUST STAY ONE. `slot_contention` answers exactly
 * one question and 0090's header forbids it answering the others: folding
 * `is_taken` or the started-slot rule into it would make it a second
 * implementation of "bookable", which is the class it was written to close.
 *
 * ── ⚠️ WHY `blockedBy` IS THREE-VALUED AND NOT A BOOLEAN ────────────────
 * The wizard's time step renders `s.isTaken ? 'Booked'`. A slot held back for
 * having no treatment is NOT booked, and labelling it so would tell a model
 * something false about a stylist's diary. So the reason travels with the slot
 * and each caller decides what to do with it:
 *
 *   'taken' / 'contested'  → the wizard may show it, disabled, as "Booked".
 *   'no_treatment'         → NOT SHOWN AT ALL. Item 196: the panel's three
 *                            columns are time, treatment and price, and one of
 *                            them does not exist, so a blank would be the dead
 *                            end moved earlier rather than removed.
 */

export type SlotBlock = 'taken' | 'contested' | 'no_treatment'

export interface LoadedSlot {
  id: string
  date: string
  /** hh:mm, trimmed from the column's hh:mm:ss. */
  startTime: string
  endTime: string
  treatmentIds: string[]
  pricePence: number | null
  /** null means bookable. See the note above on why this is not a boolean. */
  blockedBy: SlotBlock | null
}

export interface LoadedTreatment {
  id: string
  name: string | null
  category: string | null
}

export interface LoadedSlots {
  slots: LoadedSlot[]
  treatments: LoadedTreatment[]
}

const hhmm = (t: string) => t.substring(0, 5)

/**
 * How far ahead a slot is loaded, in days.
 *
 * ⚠⚠ BOUNDED, AND IT IS ONE CONSTANT RATHER THAN A PARAMETER. Micky's catch,
 * 7 Oct 2026, on a first version that was unbounded:
 *
 *   "MonthCalendar renders one month, so an unbounded loader reads every future
 *    slot to display thirty days of them. At four rows that is invisible; at a
 *    stylist with a year of availability it is a full-year read per page view."
 *
 * Right, and the argument I had given for unbounded — "nothing visible depended
 * on the bound" — showed the old bound was INERT, not that its absence was safe.
 * Those are different claims. **The read must scale with what is displayed, not
 * with the size of a stylist's diary**, and the diary is the thing the product
 * exists to grow.
 *
 * ⚠️ WHY A CONSTANT AND NOT A PER-CALLER PARAMETER. A parameter would let the
 * calendar ask for 60 days and the wizard for 90, and a date would then appear in
 * one surface and not the other — EXACTLY the class this whole file was written to
 * close. One horizon, used by both, cannot diverge. If a consumer ever genuinely
 * needs a different window, add the parameter THEN, with a reason; do not
 * pre-build the divergence.
 *
 * 60 days is not arbitrary: it is what the empty state has always promised —
 * "hasn't posted availability for the next couple of months".
 *
 * ⚠⚠ AND THE BOUND DOES NOT REDUCE slot_contention's WORK. That function takes a
 * provider id and nothing else, so it still considers every future slot for the
 * stylist; the bound trims the `availability` select and the join, not the
 * function. **If row counts ever actually matter, the function needs a horizon
 * argument too, and that is a migration.** Recorded so nobody concludes this
 * constant settled the scaling question.
 */
export const SLOT_HORIZON_DAYS = 60

/**
 * What to call a treatment, in ONE place.
 *
 * `edit-shop` reliably fills only `category`, with `name` holding a copy of it
 * (see queries/stylist.ts), so the fallback is the normal path and not the
 * exception. ⚠️ This is the same rule `_withdraw_stylist` uses in SQL —
 * `coalesce(nullif(btrim(t.name), ''), t.category)` — so a slot panel and a
 * cancellation notice name the same treatment the same way.
 */
export function treatmentLabel(t: LoadedTreatment): string {
  const name = t.name?.trim()
  if (name) return name
  return t.category?.trim() || 'Treatment'
}

/**
 * Every FUTURE slot for one stylist, each with why it cannot be booked if it
 * cannot be. Returns slots in (date, start_time) order.
 *
 * ⚠️ IT DOES NOT FILTER. It labels, and the caller filters — because the two
 * callers want different subsets and a function that returned only bookable
 * slots would force the wizard to re-read the rest.
 */
export async function loadSlots(
  supabase: SupabaseClient,
  providerId: string,
): Promise<LoadedSlots> {
  const today = new Date().toISOString().slice(0, 10)
  const horizon = new Date(Date.now() + SLOT_HORIZON_DAYS * 86_400_000)
    .toISOString().slice(0, 10)

  const [slotRes, treatRes, contentionRes] = await Promise.all([
    supabase
      .from('availability')
      .select('id, date, start_time, end_time, active_treatments, is_taken, price_pence')
      .eq('provider_id', providerId)
      .gte('date', today)
      .lte('date', horizon)
      .order('date')
      .order('start_time'),
    // ⚠️ THREE COLUMNS, AND `price` IS DELIBERATELY NOT ONE OF THEM.
    // provider_treatments.price is item 187's fossil — nothing has ever written
    // it, and the price a model pays is availability.price_pence, per SLOT.
    // Selecting it here is how a per-treatment price would creep back in.
    supabase.from('provider_treatments').select('id, name, category').eq('provider_id', providerId),
    supabase.rpc('slot_contention', { p_provider_id: providerId }),
  ])

  const rawSlots = (slotRes.data ?? []) as {
    id: string; date: string; start_time: string; end_time: string
    active_treatments: string[] | null; is_taken: boolean | null; price_pence: number | null
  }[]

  /**
   * ⚠️ FAIL CLOSED, AND THIS ONE CAN ACTUALLY FIRE. The read it replaces had a
   * fail-closed arm guarding `error`, while the failure that occurred was RLS
   * filtering rows — which raises nothing, so the arm never ran (item 192, the
   * sharpest instance of audit item 188).
   *
   * `slot_contention` is SECURITY DEFINER, so it either returns rows or RAISES.
   * An error here is therefore a real error, and treating every slot as
   * contested is the safe reading: offering a slot that is gone costs a model
   * seven steps and possibly £4.99.
   */
  const contested = new Set<string>()
  if (contentionRes.error) {
    console.error('[slots] slot_contention failed; treating every slot as contested', {
      code: contentionRes.error.code, message: contentionRes.error.message,
    })
    for (const s of rawSlots) contested.add(s.id)
  } else {
    for (const row of (contentionRes.data ?? []) as { availability_id: string; contested: boolean }[]) {
      if (row.contested) contested.add(row.availability_id)
    }
  }

  // Started slots are dropped HERE rather than in the query: PostgREST cannot
  // compare date + start_time against now(), so `.gte('date', today)` above is
  // as far as SQL reaches. Item 133.
  const future = withoutStartedSlots(rawSlots, s => ({
    date: s.date, startTime: s.start_time,
  }))

  return {
    slots: future.map((s): LoadedSlot => {
      const treatmentIds = s.active_treatments ?? []
      // ⚠️ ORDER MATTERS IN ONE DIRECTION ONLY: 'taken' and 'contested' both
      // mean "somebody has it", and either label is honest. 'no_treatment' is
      // checked LAST so a slot that is both taken and treatment-less reports
      // the reason a model can see the consequence of.
      const blockedBy: SlotBlock | null =
        s.is_taken === true ? 'taken'
        : contested.has(s.id) ? 'contested'
        : treatmentIds.length === 0 ? 'no_treatment'
        : null
      return {
        id: s.id,
        date: s.date,
        startTime: hhmm(s.start_time),
        endTime: hhmm(s.end_time),
        treatmentIds,
        pricePence: s.price_pence,
        blockedBy,
      }
    }),
    treatments: (treatRes.data ?? []) as LoadedTreatment[],
  }
}

/** The slots a model may actually pick. */
export const bookable = (slots: LoadedSlot[]) => slots.filter(s => s.blockedBy === null)

/**
 * Dates with at least one bookable slot, ascending.
 *
 * ⚠️ A DATE IS MARKED ONLY IF SOMETHING ON IT CAN BE BOOKED. A marked day that
 * opens to nothing is the same broken promise one level up — item 196.
 */
export const bookableDates = (slots: LoadedSlot[]) =>
  [...new Set(bookable(slots).map(s => s.date))].sort()
