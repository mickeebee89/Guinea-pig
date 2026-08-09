'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { saveDay, notifyFavourites, type Slot } from '@/lib/availability'

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

  try {
    const { skippedBooked } = await saveDay(supabase, provider.id, date, slots)
    // Only shout about it when slots were actually added.
    if (slots.length > 0) {
      await notifyFavourites(supabase, provider.id, provider.name ?? 'A stylist')
    }
    revalidatePath('/availability')
    revalidatePath('/dashboard')
    return { ok: true, skippedBooked }
  } catch (e) {
    console.error('[availability] save failed', e)
    return { ok: false, error: 'That didn’t save. Your existing slots are unchanged.' }
  }
}
