import { supabase } from '@/lib/supabase'

// A suspension/ban is enforced in the DB (RESTRICTIVE policies + is_suspended()),
// so a suspended user physically cannot apply, message, review or edit their shop.
// This is the UX half: it tells them WHY, instead of leaving them to hit silent
// failures that look like a broken app.
//
// `suspensions` is admin-only under RLS, so we read the caller's own status through
// the my_suspension() SECURITY DEFINER RPC rather than opening the table up.
//
// ⚠️ UNTIL 0058 THIS READ `reason`, WHICH IS THE ADMIN'S EVIDENCE. It may name
// the person who reported them, and the gate printed it under a heading saying
// "Reason" (audit item 118). my_suspension() now returns `message`, the field
// written for the member. Do not put `reason` back — the RPC no longer returns
// it, and that is deliberate.

export type Suspension = {
  banned: boolean
  suspendedUntil: string | null
  message: string | null
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
    message: row.message ?? null,
  }
}
