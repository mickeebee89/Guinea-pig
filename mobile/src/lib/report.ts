import { supabase } from './supabase'
import type { ReportReason } from './reportReasons'

/**
 * Reporting and blocking, in one place, for every surface that offers either.
 *
 * ── WHY THE SUBJECT IS A UNION AND NOT A STRING ───────────────────────────
 * `reports.reported_id` must be an auth user id. It is not enforced as one at
 * the call site, and the failure when you get it wrong is illegible: the
 * `trg_report_subjects` trigger looks the id up in `public.users` to fill the
 * NOT NULL `reported_email_hash`, finds nothing, and the insert dies on a NOT
 * NULL violation on a column the caller never mentioned. The report is lost and
 * the reason why is nowhere near the mistake.
 *
 * The trap is real and not hypothetical: `provider/[id].tsx` has a
 * `providers.id` in its route param, and the stylist's user id only arrives
 * later as `provData.user_id`. A profile screen holding the wrong id is the
 * normal case, not the careless one.
 *
 * So the caller does not get a slot to put the wrong id in. It says which kind
 * of id it holds, and this file resolves a provider id to its owner. Getting it
 * wrong now requires deliberately mislabelling, rather than merely passing the
 * variable that was to hand.
 *
 * There is a second, runtime belt: the resolved id is checked against
 * `public.users` before the insert, so anything that still slips through fails
 * with a sentence rather than a constraint code.
 *
 * ── REPORTING AND BLOCKING ARE SEPARATE ───────────────────────────────────
 * Two functions, neither calling the other. Someone may want one without the
 * other, and coupling them raises the cost of the safety action — which is the
 * opposite of what a safety action should cost. The UI offers each on its own.
 */

export type ReportSubject =
  | { userId: string }
  /** A `providers.id`. Resolved to `providers.user_id` here, once. */
  | { providerId: string }

export type SafetyResult =
  | { ok: true; cancelledBookings: number }
  | { ok: false; message: string }

/** The failure text is what a distressed person reads, so it says what to do next. */
const GENERIC_FAILURE =
  'We couldn’t send that just now. Please check your connection and try again — ' +
  'if it keeps failing, email support@guineapigapp.co.uk.'

/**
 * Turn whichever id the caller holds into the auth user id the tables want, and
 * refuse rather than guess.
 */
async function resolveUserId(subject: ReportSubject): Promise<string | null> {
  if ('userId' in subject) {
    // Confirm it really is a user id. A providers.id passed here would be a
    // well-formed uuid that matches nothing, which is exactly the silent case.
    const { data } = await supabase
      .from('users').select('id').eq('id', subject.userId).maybeSingle()
    return (data as { id: string } | null)?.id ?? null
  }

  const { data } = await supabase
    .from('providers').select('user_id').eq('id', subject.providerId).maybeSingle()
  return (data as { user_id: string | null } | null)?.user_id ?? null
}

/**
 * File a report.
 *
 * `sessionId` is optional and usually absent — that is the whole point of this
 * work. `reports.session_id` has been nullable since migration 0004, and the
 * insert policy has never required a relationship between the two parties;
 * every client just happened to only offer reporting from inside a chat.
 *
 * Works against a suspended or deleted counterparty by design. A suspended user
 * still has a `public.users` row, so the lookup succeeds. A deleted one does
 * not — and that case is handled explicitly below rather than left to fail.
 */
export async function reportUser(args: {
  reporterId: string
  subject: ReportSubject
  reason: ReportReason
  details?: string
  sessionId?: string | null
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { reporterId, subject, reason, details, sessionId } = args

  const reportedUserId = await resolveUserId(subject)
  if (!reportedUserId) {
    // Almost always a deleted account. Say so plainly: someone who has just
    // worked up to reporting should not be told "something went wrong".
    console.error('[report] could not resolve a user id for', subject)
    return {
      ok: false,
      message:
        'We couldn’t find that account — it may have been deleted. If you still want to ' +
        'tell us what happened, email support@guineapigapp.co.uk.',
    }
  }

  const trimmed = (details ?? '').trim()
  if (reason.requiresDetails && !trimmed) {
    return { ok: false, message: 'Please tell us what happened.' }
  }

  const { error } = await supabase.from('reports').insert({
    reporter_id: reporterId,
    reported_id: reportedUserId,
    session_id:  sessionId ?? null,
    // `reason` stays the human label so every existing admin surface reads the
    // same as it always did; `reason_code` is the machine half added by 0021.
    reason:      reason.label,
    reason_code: reason.code,
    details:     trimmed || null,
  })

  if (error) {
    console.error('[report] insert failed', error)
    // 23514 = check_violation on reports_reason_code_check: this client's copy
    // of the reason list has drifted from the database. Loud on purpose.
    if ((error as { code?: string }).code === '23514') {
      console.error('[report] reason_code rejected by the database — ' +
        'mobile/src/lib/reportReasons.ts has drifted from migration 0021')
    }
    return { ok: false, message: GENERIC_FAILURE }
  }
  return { ok: true }
}

/**
 * Block someone, and cancel any live bookings between the two of you.
 *
 * Lifted out of `chat/[sessionId].tsx` unchanged in behaviour. It moved because
 * profile screens now offer blocking too, and a block from a profile that
 * quietly skipped the cancellation would leave two people who cannot message
 * each other holding a live appointment — the one outcome blocking exists to
 * prevent. Two implementations would have drifted into exactly that.
 *
 * The caller owns the confirmation dialog, because the wording differs by
 * surface. It must still say the cancellation is permanent: `cancelled` is
 * terminal in `enforce_session_status_transition`, so unblocking cannot undo it.
 */
export async function blockUser(args: {
  blockerId: string
  subject: ReportSubject
}): Promise<SafetyResult> {
  const blockedId = await resolveUserId(args.subject)
  if (!blockedId) {
    return {
      ok: false,
      message: 'We couldn’t find that account — it may have been deleted, in which case ' +
        'they can no longer contact you.',
    }
  }

  const { error } = await supabase.from('blocks')
    .insert({ blocker_id: args.blockerId, blocked_id: blockedId })
  // 23505 = unique_violation → already blocked. Treat as success: the user asked
  // for a state, not for an event.
  if (error && (error as { code?: string }).code !== '23505') {
    console.error('[block] insert failed', error)
    return { ok: false, message: error.message ?? GENERIC_FAILURE }
  }

  // Best-effort from here. If this half fails the block still stands, so it
  // logs rather than throwing — but the count returned to the caller is what
  // the confirmation reports, and it must not overstate.
  let cancelledBookings = 0
  // ── THE BLOCK CASCADE NOW RUNS SERVER-SIDE (migration 0029) ──────────────
  //
  // It used to find the pair's sessions here, UPDATE them to cancelled, and
  // then INSERT the notifications — three round trips and two writes, so a
  // failure between them cancelled bookings and told nobody. Now one call, one
  // transaction.
  //
  // THE WORDING MOVED WITH IT, and that is the more important half. The message
  // used to be a literal in this file, duplicated in the other client. It now
  // comes from `public.cancellation_notice('block', ...)`, alongside the two
  // messages for an ordinary cancellation — with the constraint written beside
  // them, because this is the one whose silence is load-bearing and the one a
  // tidy-up would "fix" by adding a reason.
  //
  // What must remain true, and is worth re-testing on a device after any change
  // here: the other party is told their booking is cancelled, is told NOTHING
  // about why, and `sessions.cancelled_by` stays NULL — recording the blocker
  // would put "who blocked whom" one query away from anything that renders it.
  try {
    const them = blockedId

    const { data, error } = await supabase.rpc('cancel_sessions_for_block', {
      p_other_user_id: them,
    })
    if (error) throw error
    cancelledBookings = (data as { cancelled?: number } | null)?.cancelled ?? 0
  } catch (e) {
    console.warn('block: cancel/notify bookings failed (non-blocking):', e)
  }

  return { ok: true, cancelledBookings }
}
