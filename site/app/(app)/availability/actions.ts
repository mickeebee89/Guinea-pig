'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { saveDay, notifyFavourites, bookedSlotKeys, type Slot } from '@/lib/availability'
import { MAX_PRICE_PENCE, formatPrice } from '@/lib/price'

type Result =
  | { ok: true; skippedBooked: number }
  | { ok: false; error: string }

/**
 * Save one day's slots.
 *
 * The provider id is resolved from the SESSION, never taken from the client —
 * otherwise this would let any signed-in user write availability for any
 * stylist. RLS would refuse it, but the server should not be asking.
 */
export async function saveAvailability(date: string, slots: Slot[]): Promise<Result> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data: prov } = await supabase
    .from('providers').select('id, name').eq('user_id', user.id).maybeSingle()
  const provider = prov as { id: string; name: string | null } | null
  if (!provider) return { ok: false, error: 'Only a stylist account can set availability.' }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: 'That date isn’t valid.' }
  }
  for (const s of slots) {
    if (s.endTime <= s.startTime) {
      return { ok: false, error: `A slot has to end after it starts (${s.startTime}–${s.endTime}).` }
    }
  }

  // ⚠⚠ THE PRICE IS REQUIRED, AND IT IS REQUIRED HERE AS WELL AS IN THE FORM.
  // 23 Nov 2026. 67 of 78 slots carried no price and all 8 open ones were
  // blank, so a model picked a time, saw no figure, and had to raise money
  // herself with a stranger. The ambiguity was the problem, not the price —
  // £0 is a real answer and renders as "Free".
  //
  // The form checks this too, which is what makes it pleasant. This check is
  // what makes it true: DayEditor is a client component and its validation is
  // a courtesy, not a guarantee.
  let booked: Set<string>
  try {
    booked = await bookedSlotKeys(supabase, provider.id, date)
  } catch (e) {
    console.error('[availability] could not read booked slots', e)
    return { ok: false, error: 'That didn’t save. Your existing slots are unchanged.' }
  }

  for (const s of slots) {
    // ⚠️ BOOKED SLOTS ARE EXEMPT, AND THE LIST COMES FROM THE DATABASE, not
    // from the `isBooked` flag on the payload — see bookedSlotKeys. A booked
    // row predating 0050 has a null price and no control to fix it with;
    // refusing the save would lock her out of the rest of the day.
    if (booked.has(`${s.startTime}|${s.endTime}`)) continue

    if (s.pricePence === null || s.pricePence === undefined) {
      return {
        ok: false,
        error: `Set a price for the ${s.startTime} slot, or mark it Free.`,
      }
    }
    if (!Number.isInteger(s.pricePence) || s.pricePence < 0 || s.pricePence > MAX_PRICE_PENCE) {
      // The cap is also a CHECK constraint (availability_price_pence_range,
      // 0050); this is the friendly half of the same rule.
      return {
        ok: false,
        error: `The price on the ${s.startTime} slot has to be between £0 and `
          + `${formatPrice(MAX_PRICE_PENCE)}.`,
      }
    }
  }

  try {
    const { skippedBooked } = await saveDay(supabase, provider.id, date, slots)
    // Only shout about it when slots were actually added.
    if (slots.length > 0) {
      await notifyFavourites(supabase)
    }
    revalidatePath('/availability')
    revalidatePath('/dashboard')
    return { ok: true, skippedBooked }
  } catch (e) {
    console.error('[availability] save failed', e)
    return { ok: false, error: 'That didn’t save. Your existing slots are unchanged.' }
  }
}
