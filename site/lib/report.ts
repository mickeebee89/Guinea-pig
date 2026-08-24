import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReportReason } from './reportReasons'

/**
 * Port of `mobile/src/lib/report.ts`. Kept deliberately parallel so the two can
 * be diffed — a difference here means one platform files a report the other
 * refuses, or blocks without cancelling the bookings the other cancels.
 *
 * ── WHY THE SUBJECT IS A UNION AND NOT A STRING ───────────────────────────
 * `reports.reported_id` must be an auth user id. The failure when it isn't is
 * illegible: `trg_report_subjects` looks the id up in `public.users` to fill the
 * NOT NULL `reported_email_hash`, finds nothing, and the insert dies on a NOT
 * NULL violation on a column the caller never mentioned.
 *
 * The trap is the normal case, not the careless one. `/stylist/[id]` takes a
 * `providers.id` — its own header says so — and the owner's user id only exists
 * after `getStylistProfile` has run. So the caller does not get a slot to put
 * the wrong id in: it says which kind it holds, and this file resolves it.
 *
 * ── REPORTING AND BLOCKING ARE SEPARATE ───────────────────────────────────
 * Two functions, neither calling the other. Someone may want one without the
 * other, and coupling them raises the cost of the safety action.
 *
 * ── THIS RUNS SERVER-SIDE ─────────────────────────────────────────────────
 * Called from `app/(app)/safety/actions.ts`, a server action. Same reasoning as
 * the `/verify` upload: ChatThread stays the only browser-client user on this
 * site, so the anon key's blast radius does not grow with each safety surface.
 */

export type ReportSubject =
  | { userId: string }
  /** A `providers.id`. Resolved to `providers.user_id` here, once. */
  | { providerId: string }

export type SafetyResult =
  | { ok: true; cancelledBookings: number }
  | { ok: false; error: string }

const GENERIC_FAILURE =
  'We couldn’t send that just now. Please try again — if it keeps failing, ' +
  'email support@guineapigapp.co.uk.'

const GONE =
  'We couldn’t find that account — it may have been deleted. If you still want to ' +
  'tell us what happened, email support@guineapigapp.co.uk.'

async function resolveUserId(
  supabase: SupabaseClient,
  subject: ReportSubject,
): Promise<string | null> {
  if ('userId' in subject) {
    // Confirm it really is a user id. A providers.id passed here would be a
    // well-formed uuid matching nothing — exactly the silent case.
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
 * `sessionId` is optional and usually absent — the point of this work.
 * `reports.session_id` has been nullable since migration 0004 and the insert
 * policy never required a relationship between the parties; every client just
 * happened to only offer reporting from inside a chat.
 */
export async function reportUser(
  supabase: SupabaseClient,
  args: {
    reporterId: string
    subject: ReportSubject
    reason: ReportReason
    details?: string
    sessionId?: string | null
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { reporterId, subject, reason, details, sessionId } = args

  const reportedUserId = await resolveUserId(supabase, subject)
  if (!reportedUserId) {
    console.error('[report] could not resolve a user id for', subject)
    return { ok: false, error: GONE }
  }

  const trimmed = (details ?? '').trim()
  if (reason.requiresDetails && !trimmed) {
    return { ok: false, error: 'Please tell us what happened.' }
  }

  const { error } = await supabase.from('reports').insert({
    reporter_id: reporterId,
    reported_id: reportedUserId,
    session_id:  sessionId ?? null,
    // `reason` stays the human label so existing admin surfaces read unchanged;
    // `reason_code` is the machine half added by migration 0021.
    reason:      reason.label,
    reason_code: reason.code,
    details:     trimmed || null,
  })

  if (error) {
    console.error('[report] insert failed', error)
    if ((error as { code?: string }).code === '23514') {
      console.error('[report] reason_code rejected by the database — ' +
        'site/lib/reportReasons.ts has drifted from migration 0021')
    }
    return { ok: false, error: GENERIC_FAILURE }
  }
  return { ok: true }
}

/**
 * Block someone, and cancel any live bookings between the two of you.
 *
 * The cancellation half is not optional garnish: a block that left a live
 * appointment standing would leave two people who cannot message each other
 * holding a booking, which is the outcome blocking exists to prevent. It is
 * best-effort — if it fails the block still stands — but the returned count is
 * what the confirmation reports, so it never overstates.
 *
 * `cancelled` is terminal in `enforce_session_status_transition`. Unblocking
 * cannot bring a booking back, and the caller's confirmation must say so.
 */
export async function blockUser(
  supabase: SupabaseClient,
  args: { blockerId: string; subject: ReportSubject },
): Promise<SafetyResult> {
  const blockedId = await resolveUserId(supabase, args.subject)
  if (!blockedId) {
    return {
      ok: false,
      error: 'We couldn’t find that account — it may have been deleted, in which case ' +
        'they can no longer contact you.',
    }
  }

  const { error } = await supabase.from('blocks')
    .insert({ blocker_id: args.blockerId, blocked_id: blockedId })
  // 23505 = unique_violation → already blocked. The user asked for a state, not
  // an event, so that is success.
  if (error && (error as { code?: string }).code !== '23505') {
    console.error('[block] insert failed', error)
    return { ok: false, error: GENERIC_FAILURE }
  }

  let cancelledBookings = 0
  try {
    const me = args.blockerId
    const them = blockedId

    const { data: provRows } = await supabase.from('providers')
      .select('id, user_id').in('user_id', [me, them])
    const rows = (provRows ?? []) as { id: string; user_id: string }[]
    const myProviderId    = rows.find(p => p.user_id === me)?.id
    const theirProviderId = rows.find(p => p.user_id === them)?.id

    const orParts: string[] = []
    if (myProviderId)    orParts.push(`and(model_user_id.eq.${them},provider_id.eq.${myProviderId})`)
    if (theirProviderId) orParts.push(`and(model_user_id.eq.${me},provider_id.eq.${theirProviderId})`)

    if (orParts.length > 0) {
      const { data: pairSessions } = await supabase.from('sessions')
        .select('id')
        .in('status', ['pending', 'accepted'])
        .or(orParts.join(','))
      const ids = ((pairSessions ?? []) as { id: string }[]).map(r => r.id)
      if (ids.length > 0) {
        const { error: cancelErr } = await supabase
          .from('sessions').update({ status: 'cancelled' }).in('id', ids)
        if (cancelErr) throw cancelErr
        cancelledBookings = ids.length
        // Notify the other party per cancelled session — never mention blocking.
        await supabase.from('notifications').insert(
          ids.map(sid => ({
            user_id:    them,
            type:       'session_cancelled',
            title:      'Booking cancelled',
            body:       'Your upcoming treatment has been cancelled.',
            session_id: sid,
          }))
        )
      }
    }
  } catch (e) {
    console.warn('[block] cancel/notify bookings failed (non-blocking):', e)
  }

  return { ok: true, cancelledBookings }
}
