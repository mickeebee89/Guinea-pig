import { supabase } from './supabase'

/**
 * Cancel a booking you are party to.
 *
 * ── ONE CALL, NOT TWO ─────────────────────────────────────────────────────
 * `cancel_booking` (migration 0029) changes the status, records who/when/why,
 * and notifies the other party IN ONE TRANSACTION. The client deliberately does
 * none of those separately: the failure worth preventing is a booking that gets
 * cancelled while nobody is told, which is exactly what the block cascade used
 * to risk by doing the update and the notification as two statements.
 *
 * ── THE WORDING IS NOT HERE ───────────────────────────────────────────────
 * Neither client holds any cancellation message. All three live in
 * `public.cancellation_notice`, because they must not converge — the block
 * cascade's silence about cause is load-bearing, and a copy per client is how
 * one of them quietly grows a reason field "for consistency".
 *
 * ── NO TIME CUT-OFF ───────────────────────────────────────────────────────
 * Either party may cancel at any point before the appointment. A hard limit
 * would stop the person who most needs out — someone who has changed their mind
 * about being alone with a stranger — which is the same asymmetry that made
 * cancel-by-default right for revocation. The UI states the consequence and
 * does not argue.
 */
export async function cancelBooking(
  sessionId: string,
  reason?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = reason?.trim()
  const { error } = await supabase.rpc('cancel_booking', {
    p_session_id: sessionId,
    p_reason: trimmed ? trimmed : null,
  })

  if (error) {
    console.warn('[cancel] cancel_booking failed:', error.message)
    // The function raises readable messages for the cases a person can actually
    // hit — already cancelled, not a participant — so show them rather than
    // replacing them with something generic that hides which one happened.
    return { ok: false, error: error.message || 'That didn’t go through. Nothing has changed.' }
  }
  return { ok: true }
}

/**
 * Is this booking within 24 hours?
 *
 * Call it at the moment the sheet is opened, not during render — Date.now() is
 * impure, and a re-render could flip the line under the reader mid-decision.
 *
 * Dates are held without a time, so this compares against midnight. Close
 * enough to state a fact, and it is ONLY ever used to state one: nothing in the
 * product blocks or delays a cancellation, whatever this returns.
 */
export function isShortNotice(date: string): boolean {
  return (new Date(date + 'T00:00:00').getTime() - Date.now()) / 3_600_000 < 24
}
