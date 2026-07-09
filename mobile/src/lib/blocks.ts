import { supabase } from './supabase'

// Returns the set of user ids that `userId` has blocked OR been blocked by (either
// direction) — the "other party" id in every `blocks` row involving this user.
// Used by the listing screens to filter out mutually-blocked users.
export async function getBlockedIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('blocks')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`)
  if (error) throw error

  const ids = new Set<string>()
  for (const row of (data ?? []) as { blocker_id: string; blocked_id: string }[]) {
    // Add whichever side isn't me (the other party).
    ids.add(row.blocker_id === userId ? row.blocked_id : row.blocker_id)
  }
  return ids
}
