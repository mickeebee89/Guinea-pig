'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'

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

const fmtDate = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

async function transition(
  sessionId: string,
  to: 'accepted' | 'declined' | 'completed',
  notify: { type: string; title: string; body: (date: string) => string },
): Promise<Result> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('sessions')
    .update({ status: to })
    .eq('id', sessionId)
    .select('id, model_user_id, date')

  if (error) {
    console.error(`[sessions] ${to} failed`, error)
    return { ok: false, error: 'That didn’t go through. Nothing has changed.' }
  }

  const rows = (data ?? []) as { id: string; model_user_id: string; date: string }[]
  if (rows.length === 0) {
    // Zero rows means the guard or RLS refused it — most often because the
    // booking already moved on. Do NOT notify.
    console.warn(`[sessions] ${to} matched no rows`, sessionId)
    return { ok: false, error: 'This booking has already changed. Reload to see where it is now.' }
  }

  const row = rows[0]
  // Best-effort, deliberately: the status change is the thing that matters and
  // a failed notification must not undo it or report failure to the stylist.
  const { error: noteErr } = await supabase.from('notifications').insert({
    user_id: row.model_user_id,
    type: notify.type,
    title: notify.title,
    body: notify.body(row.date),
    session_id: row.id,
  })
  if (noteErr) console.warn(`[sessions] ${to} notification failed`, noteErr)

  revalidatePath('/sessions')
  revalidatePath('/dashboard')
  return { ok: true }
}

export async function acceptSession(sessionId: string): Promise<Result> {
  return transition(sessionId, 'accepted', {
    type: 'session_accepted',
    title: 'Treatment accepted! 🎉',
    body: d => `Your booking for ${fmtDate(d)} has been confirmed.`,
  })
}

export async function declineSession(sessionId: string): Promise<Result> {
  return transition(sessionId, 'declined', {
    type: 'session_declined',
    // Mobile's wording, kept: it does not say "declined" to the model.
    title: 'Treatment update',
    body: d => `Your booking for ${fmtDate(d)} was not confirmed.`,
  })
}

export async function completeSession(sessionId: string): Promise<Result> {
  return transition(sessionId, 'completed', {
    type: 'session_completed',
    title: 'Treatment complete',
    body: d => `Your treatment on ${fmtDate(d)} is marked complete. Leave a review?`,
  })
}
