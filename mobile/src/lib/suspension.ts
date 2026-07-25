import { supabase } from '@/lib/supabase'

// A suspension/ban is enforced in the DB (RESTRICTIVE policies + is_suspended()),
// so a suspended user physically cannot apply, message, review or edit their shop.
// This is the UX half: it tells them WHY, instead of leaving them to hit silent
// failures that look like a broken app.
//
// `suspensions` is admin-only under RLS, so we read the caller's own status through
// the my_suspension() SECURITY DEFINER RPC rather than opening the table up.

export type Suspension = {
  banned: boolean
  suspendedUntil: string | null
  reason: string | null
}

export async function getMySuspension(): Promise<Suspension | null> {
  const { data, error } = await supabase.rpc('my_suspension')
  if (error) {
    // Fail OPEN: a lookup failure must not lock a legitimate user out of the app.
    // The DB policies are the real control, so nothing is actually bypassed here.
    console.warn('getMySuspension failed:', error.message)
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null
  return {
    banned: !!row.banned,
    suspendedUntil: row.suspended_until ?? null,
    reason: row.reason ?? null,
  }
}
