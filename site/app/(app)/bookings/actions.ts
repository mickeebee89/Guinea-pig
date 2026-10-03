'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { BOOKINGS_PATH } from '@/lib/routes'

/**
 * Accept / decline / complete a booking. Ported from
 * mobile/src/app/(app)/sessions.tsx:196-270.
 *
 * ── THE UPDATE MUST BE PROVEN, NOT ASSUMED ────────────────────────────────
 * supabase.update() resolves without error when it matches ZERO rows. There is
 * a status-transition guard on sessions (supabase/session-status-guard.sql) and
 * RLS on top, so an accept on an already-cancelled booking legitimately changes
 * nothing — and would still look like success.
 *
 * Mobile handles this with mustWrite() and says exactly why: without it "the
 * model would be pushed 'Treatment accepted! 🎉' for a booking that never
 * moved." So every action here selects the updated row back and treats an empty
 * result as a failure. The notification is only sent once the change is real.
 *
 * Server Actions rather than the browser client: these work with JavaScript
 * off, they revalidate the affected pages, and they keep the write on the
 * server where the session is already verified.
 */

type Result = { ok: true } | { ok: false; error: string }

// fmtDate was deleted with the notification copy it served (0078). The date
// is rendered in SQL now — to_char(d, 'FMDay FMDD FMMonth') — so that web and
// mobile cannot drift again. They already had: 'Friday 3 October' here,
// 'Fri 3 Oct' on mobile, both reaching inboxes.

/**
 * Accept, decline or complete a booking.
 *
 * ⚠️ ONE RPC, BECAUSE THE TRANSITION AND THE TELLING ARE ONE THING (0078,
 * item 144). This used to be a table UPDATE followed by a best-effort
 * notification insert, and both halves were wrong in their own way:
 *
 *   * the insert was addressed to somebody else, which only worked because
 *     the notifications INSERT policy lets any signed-in account write a
 *     notification to anyone — the hole item 144 exists to close; and
 *   * "best-effort, deliberately" meant a booking could be accepted while the
 *     model was never told, with a console warning nobody reads.
 *
 * Now `transition_session` does both in one transaction. If the trigger
 * refuses, nothing is written and nothing is announced.
 *
 * ⚠️ THE COPY MOVED INTO THE DATABASE and is NOT duplicated here. It existed
 * six times across two clients and had already drifted three ways — the
 * completed title, the review prompt, and the date format, which rendered
 * "Friday 3 October" on web and "Fri 3 Oct" on mobile while both reached
 * inboxes. Changing it is now a migration. That is the cost and the point.
 *
 * ⚠️ A DOUBLE-CLICK SENDS ONE EMAIL, NOT TWO. The status trigger permits a
 * no-op update, so the old code notified on every click. The RPC returns
 * `changed: false` for the second one and announces nothing — demonstrated,
 * not reasoned: notices went 0 -> 1 -> 1 across two identical calls.
 */
async function transition(
  sessionId: string,
  to: 'accepted' | 'declined' | 'completed',
): Promise<Result> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('transition_session', {
    p_session_id: sessionId,
    p_to: to,
  })

  if (error) {
    // The trigger's own refusals land here — "Only the provider can set a
    // session to accepted" among them. Verified: the model is refused 42501.
    console.error(`[sessions] ${to} failed`, error)
    return { ok: false, error: 'That didn’t go through. Nothing has changed.' }
  }

  const res = (data ?? {}) as { ok?: boolean; changed?: boolean; reason?: string }

  if (!res.ok) {
    // `not_found_or_not_yours` is deliberately not distinguished for the user:
    // RLS hides a booking you are not party to, so the function cannot tell
    // "gone" from "not yours" and neither should the message.
    console.warn(`[sessions] ${to} refused`, { sessionId, reason: res.reason })
    return { ok: false, error: 'This booking has already changed. Reload to see where it is now.' }
  }

  // changed:false is the no-op — the booking is already what was asked for.
  // Not an error, and nothing was announced.
  revalidatePath(BOOKINGS_PATH)
  revalidatePath('/dashboard')
  return { ok: true }
}

export async function acceptSession(sessionId: string): Promise<Result> {
  return transition(sessionId, 'accepted')
}

export async function declineSession(sessionId: string): Promise<Result> {
  return transition(sessionId, 'declined')
}

export async function completeSession(sessionId: string): Promise<Result> {
  return transition(sessionId, 'completed')
}

/**
 * Cancel a booking you are party to.
 *
 * Unlike accept/decline/complete above, this does NOT write the status and the
 * notification as two steps. `cancel_booking` (migration 0029) does both in one
 * transaction, so a cancellation can never happen without the other person
 * being told — which is the failure that matters here. It also picks the
 * wording, because the three cancellation messages must not converge and the
 * only way to guarantee that is for no client to hold any of them.
 *
 * Either participant may cancel and there is no time cut-off. That is
 * deliberate: a hard limit stops the person who most needs out.
 */
/**
 * Either party records that a booking did not happen.
 *
 * Goes through the RPC rather than an UPDATE, because the RPC stamps the
 * caller's own not_held_*_at from auth.uid() — a client that chose which
 * column to set could record one party's statement under the other's name.
 * The guard refuses the write without it either way (0070).
 */
export async function reportNotHeld(sessionId: string): Promise<Result> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.rpc('report_not_held', { p_session_id: sessionId })
  if (error) {
    console.error('[sessions] report_not_held failed', error)
    return { ok: false, error: 'That didn’t go through. Nothing has changed.' }
  }

  revalidatePath(BOOKINGS_PATH)
  return { ok: true }
}

export async function cancelBooking(sessionId: string, reason?: string): Promise<Result> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  // `p_reason text default null`, and the body does
  // `nullif(btrim(coalesce(p_reason, '')), '')` — so a missing reason and an
  // explicit null are the same statement to it. Omitted rather than sent as
  // null because the generated types describe a defaulted argument as optional,
  // which is what the live database says it is. No behaviour changes.
  const reasonText = reason?.trim()
  const { error } = await supabase.rpc('cancel_booking', {
    p_session_id: sessionId,
    ...(reasonText ? { p_reason: reasonText } : {}),
  })

  if (error) {
    console.error('[sessions] cancel failed', error)
    // The function raises readable messages for the cases a person can hit —
    // already cancelled, not a participant — so show them rather than replacing
    // them with something generic.
    return { ok: false, error: error.message || 'That didn’t go through. Nothing has changed.' }
  }

  revalidatePath(BOOKINGS_PATH)
  revalidatePath('/dashboard')
  return { ok: true }
}
