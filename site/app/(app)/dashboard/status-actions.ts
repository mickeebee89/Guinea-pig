'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'

type Result = { ok: true } | { ok: false; error: string }

/**
 * Post a status update, or clear the current one.
 *
 * ── NOTHING HERE ENFORCES ANYTHING ────────────────────────────────────────
 * No screening, no link stripping, no moderation decision. All three are
 * triggers on `status_posts` (migration 0032), because a check in this file is
 * bypassed by calling PostgREST directly with the author's own token — the
 * session the app already handed them.
 *
 * So this is a plain insert. The guarantees are downstream, and the composer
 * reads back what the database decided rather than predicting it.
 */

const MAX = 280

export async function postStatus(providerId: string, body: string): Promise<Result> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  const text = body.trim()
  if (!text) return { ok: false, error: 'Write something first.' }
  if (text.length > MAX) return { ok: false, error: `That's over ${MAX} characters.` }

  // One live post at a time. Posting again replaces the last one, which is what
  // "what's on" means — a second, older update still showing would be worse
  // than none. RLS confines the delete to this stylist's own rows.
  const { error: clearErr } = await supabase
    .from('status_posts')
    .delete()
    .eq('provider_id', providerId)
    .gt('expires_at', new Date().toISOString())
  if (clearErr) {
    console.error('[status] clearing the previous post failed', clearErr)
    return { ok: false, error: 'That didn’t save. Nothing has changed.' }
  }

  const { error } = await supabase
    .from('status_posts')
    .insert({ provider_id: providerId, body: text })

  if (error) {
    console.error('[status] post failed', error)
    // RLS refuses a provider_id that is not yours, which is the one failure a
    // person can actually cause here.
    return { ok: false, error: error.message || 'That didn’t save. Nothing has changed.' }
  }

  revalidatePath('/dashboard')
  return { ok: true }
}

export async function clearStatus(providerId: string): Promise<Result> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('status_posts')
    .delete()
    .eq('provider_id', providerId)
    .gt('expires_at', new Date().toISOString())

  if (error) {
    console.error('[status] clear failed', error)
    return { ok: false, error: 'That didn’t clear. Nothing has changed.' }
  }

  revalidatePath('/dashboard')
  return { ok: true }
}
