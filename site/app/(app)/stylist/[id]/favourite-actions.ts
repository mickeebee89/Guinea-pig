'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'

/**
 * Saving a stylist. Audit item 94.
 *
 * ── WHAT THIS IS NOT: A BOOKMARK ──────────────────────────────────────────
 * A row in `favourites` is what subscribes a model to `new_availability`
 * notifications: `notifyFavourites` (lib/availability.ts) writes one to every
 * favouriter each time this stylist posts times. So the control has a
 * consequence beyond her own list, and the copy has to say so — mobile's heart
 * says nothing at all, and a model tapping it has no way to know she has just
 * asked to be told things.
 *
 * ⚠️ IT IS NOT AN EMAIL, AND MUST NEVER BE DESCRIBED AS ONE. 0047 lists
 * new_availability among the types that are deliberately NOT emailed, because
 * it is a mass send — one per favouriter, every time. It reaches her
 * notifications list, and a push on the app.
 *
 * ── AND THE STYLIST CAN SEE IT ────────────────────────────────────────────
 * `fav_select` permits the favourited stylist to read her own favouriters
 * ("owner + favourited stylist read", rls-lockdown.sql:62). Nothing in any of
 * the three apps shows her today — verified across the provider dashboard, the
 * web dashboard and the whole admin console — but the permission is deliberate,
 * so this is not a private action and must not be worded as one.
 */

export type FavouriteResult = { ok: true; saved: boolean } | { ok: false; error: string }

export async function setFavourite(providerId: string, saved: boolean): Promise<FavouriteResult> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  if (!providerId) return { ok: false, error: 'That stylist couldn’t be found.' }

  if (!saved) {
    // Deletes by the PAIR, not by id. There is a unique index on
    // (user_id, provider_id) — read from pg_indexes, 23 Sep 2026 — so there
    // is only ever one row, and this is the same statement either way. It
    // stays written this way because it needs no id to have been read first.
    const { error } = await supabase
      .from('favourites').delete()
      .eq('user_id', user.id).eq('provider_id', providerId)
    if (error) {
      console.error('[favourite] remove failed', { code: error.code, message: error.message })
      return { ok: false, error: 'That didn’t save. They’re still in your list.' }
    }
    revalidateBoth(providerId)
    return { ok: true, saved: false }
  }

  // Check first, then insert, and treat a duplicate as success — the same
  // shape mobile's verify-payment.tsx uses, and for the same reason: two
  // devices, or two taps, must not produce two rows. A second row would mean
  // a second `new_availability` notification every time this stylist posts.
  const { data: existing } = await supabase
    .from('favourites').select('id')
    .eq('user_id', user.id).eq('provider_id', providerId)
    .maybeSingle()

  if (!existing) {
    const { error } = await supabase
      .from('favourites').insert({ user_id: user.id, provider_id: providerId })
    // 23505 means it landed on another device between the read and the write.
    if (error && error.code !== '23505') {
      console.error('[favourite] save failed', { code: error.code, message: error.message })
      // 42501 would be RLS: the row's user_id must be the caller's, which it
      // is, so this is not a case a member can reach by using the page.
      return { ok: false, error: 'That didn’t save. Try again in a moment.' }
    }
  }

  revalidateBoth(providerId)
  return { ok: true, saved: true }
}

function revalidateBoth(providerId: string) {
  revalidatePath(`/stylist/${providerId}`)
  // The dashboard's Favourites card is the other half of this: until now it
  // told her to save a stylist and nothing on the website could.
  revalidatePath('/dashboard')
}
