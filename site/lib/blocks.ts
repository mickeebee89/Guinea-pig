import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Port of mobile/src/lib/blocks.ts. Kept deliberately identical so the two can
 * be diffed — a difference between platforms here means one of them shows a
 * conversation the other hides.
 *
 * ── WHAT THIS DOES AND DOES NOT PROTECT ────────────────────────────────────
 *
 * This is the LISTING half only: hide a blocked party from lists so you do not
 * have to look at them. It is presentation, and it runs on data the caller
 * already has permission to read.
 *
 * The half that matters for safety is enforced in the database. `messages` has
 * a RESTRICTIVE policy `messages_insert_not_blocked` that refuses the INSERT
 * outright, so a blocked user cannot send even by calling PostgREST directly
 * with their own token. Nothing on this side is load-bearing for that, and
 * nothing here should ever become the only thing standing between two people.
 */
export async function getBlockedIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('blocks')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`)
  if (error) throw error

  const ids = new Set<string>()
  for (const row of (data ?? []) as { blocker_id: string; blocked_id: string }[]) {
    // Whichever side isn't me is the other party. A block hides the pair in
    // BOTH directions — being blocked hides them from you too, so neither
    // person can tell which way round it was.
    ids.add(row.blocker_id === userId ? row.blocked_id : row.blocker_id)
  }
  return ids
}
