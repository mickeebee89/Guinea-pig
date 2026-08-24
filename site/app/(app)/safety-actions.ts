'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { reportUser, blockUser, type ReportSubject } from '@/lib/report'
import { REPORT_REASONS, type ReportReasonCode } from '@/lib/reportReasons'

/**
 * The two safety actions, for every surface on this site that offers them:
 * chat, a stylist's profile, a model's profile.
 *
 * Deliberately NOT under a route folder. These belong to no single page — a
 * copy per route is how the chat version and the profile version drift into
 * doing different things, which for a safety control is the failure that
 * matters.
 *
 * ── WHY THE REASON ARRIVES AS A CODE ──────────────────────────────────────
 * The client sends `reason_code`, not a label, and this file looks the label up
 * from the same list migration 0021 constrains. A client cannot invent a
 * category, and it cannot file one label under another's code.
 *
 * ── WHY THESE ARE SERVER ACTIONS ──────────────────────────────────────────
 * Same reasoning as the /verify upload: ChatThread stays the only browser-client
 * user on this site, so the anon key's blast radius does not grow with every
 * safety surface added.
 */

type ActionResult = { ok: true; cancelledBookings?: number } | { ok: false; error: string }

/** Resolve the code the client sent against the canonical list. */
function reasonFor(code: string) {
  return REPORT_REASONS.find(r => r.code === (code as ReportReasonCode)) ?? null
}

export async function submitReport(input: {
  subject: ReportSubject
  reasonCode: string
  details?: string
  sessionId?: string | null
}): Promise<ActionResult> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const reason = reasonFor(input.reasonCode)
  if (!reason) {
    // Only reachable if the client's copy of the list has drifted from this
    // one. Loud rather than filed under a guessed category.
    console.error('[safety] unknown reason code from client:', input.reasonCode)
    return { ok: false, error: 'Please choose a reason from the list.' }
  }

  const result = await reportUser(supabase, {
    reporterId: user.id,
    subject:    input.subject,
    reason,
    details:    input.details,
    sessionId:  input.sessionId ?? null,
  })

  return result.ok ? { ok: true } : { ok: false, error: result.error }
}

export async function submitBlock(input: { subject: ReportSubject }): Promise<ActionResult> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const result = await blockUser(supabase, { blockerId: user.id, subject: input.subject })
  if (!result.ok) return { ok: false, error: result.error }

  // A block changes what several pages should show: the other party disappears
  // from browse and messages, and any bookings between the pair are now
  // cancelled. Missing one of these leaves a cached page showing someone the
  // user has just blocked.
  revalidatePath('/messages')
  revalidatePath('/browse')
  revalidatePath('/sessions')
  revalidatePath('/settings')
  revalidatePath('/dashboard')

  return { ok: true, cancelledBookings: result.cancelledBookings }
}
