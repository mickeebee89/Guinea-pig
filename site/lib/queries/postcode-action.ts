'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { lookupPostcode, postcodeMessage } from '@/lib/postcode'
import { BOOKINGS_PATH } from '@/lib/routes'

/**
 * Save or clear the signed-in member's postcode. Audit item 90.
 *
 * One action for both roles. A stylist's coordinate has to reach
 * `providers` as well as `users`, and `set_my_postcode` (migration 0054) does
 * both in one transaction — so there is nothing role-shaped to decide here,
 * and no second code path to keep in step.
 *
 * ── WHAT THIS DOES NOT DO ─────────────────────────────────────────────────
 * It does not write a coordinate the browser sent. The browser sends the
 * postcode and nothing else; the lookup happens here. A coordinate from a
 * form would let anyone place themselves anywhere, and being placed somewhere
 * you are not is the exact failure this feature exists to remove.
 */

export type PostcodeSaveResult =
  | { ok: true; postcode: string | null }
  | { ok: false; error: string }

export async function saveMyPostcode(raw: string): Promise<PostcodeSaveResult> {
  // The gate, not a source of the id. set_my_postcode reads auth.uid() itself
  // and RLS confines it to the caller's own rows, so there is no user id to
  // pass and nothing here decides whose postcode is being written.
  await requireUser()
  const supabase = await createSupabaseServerClient()

  const trimmed = raw.trim()

  // ── Clearing it ──────────────────────────────────────────────────────────
  // Optional means optional. Privacy calls location a consent-based item that
  // can be withdrawn at any time, so removing it has to work as well as
  // setting it — and it must not require getting a valid postcode past the
  // lookup first.
  if (trimmed === '') {
    // No arguments at all. All three parameters default to null in SQL (0054),
    // which is what lets clearing be written without a cast — the generator
    // marks a non-defaulted argument as required AND non-nullable, so `null`
    // would not type-check. The defaults are there for exactly this call.
    const { error } = await supabase.rpc('set_my_postcode', {})
    if (error) {
      console.error('[postcode] clear failed', { code: error.code, message: error.message })
      return { ok: false, error: 'That didn’t save. Your postcode is unchanged.' }
    }
    revalidateEverywhereItShows()
    return { ok: true, postcode: null }
  }

  const found = await lookupPostcode(trimmed)
  if (!found.ok) {
    // ⚠️ Nothing has been written at this point, and the messages say so where
    // it matters. 'unavailable' is ours, not hers.
    return { ok: false, error: postcodeMessage(found.reason) }
  }

  const { error } = await supabase.rpc('set_my_postcode', {
    p_postcode: found.place.postcode,
    p_lat: found.place.latitude,
    p_lng: found.place.longitude,
  })

  if (error) {
    console.error('[postcode] save failed', { code: error.code, message: error.message })
    // 42501 is the suspension policy or a missing row, not a bad postcode.
    // The database's own message is not shown: it names tables and columns.
    return { ok: false, error: 'That didn’t save. Your postcode is unchanged.' }
  }

  revalidateEverywhereItShows()
  return { ok: true, postcode: found.place.postcode }
}

/**
 * Every page whose content depends on where this member is.
 *
 * The dashboard is the one that matters — its updates feed goes from "we don't
 * know where you are" to a sorted list the moment this lands, and a stale
 * render would show her the old empty state after a successful save.
 */
function revalidateEverywhereItShows() {
  revalidatePath('/dashboard')
  revalidatePath('/settings')
  revalidatePath('/shop')
  revalidatePath('/browse')
  revalidatePath(BOOKINGS_PATH)
}
