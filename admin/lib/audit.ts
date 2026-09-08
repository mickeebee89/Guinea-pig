import { supabase } from './supabase'

/**
 * ── THE AUDIT WRITE NOW REPORTS WHETHER IT LANDED ─────────────────────
 *
 * It used to be `await supabase.from('admin_audit_log').insert(...)` with the
 * result discarded. supabase-js resolves with `{ error }` rather than rejecting,
 * so a refused audit write was silent — and `admin_audit_log` is retained for
 * six years as moderation evidence (0005, 0006).
 *
 * Callers decide what to do with the result. `app/users/page.tsx` is the one
 * that must not ignore it; the rest still fire-and-forget for now, which is
 * audit item 27's remaining work rather than something this function can force.
 */
export type LogResult = { ok: true } | { ok: false; error: string }

export async function logAction(
  action: string,
  opts: {
    targetUserId?: string
    targetProviderId?: string
    targetSessionId?: string
    details?: Record<string, unknown>
    adminNote?: string
  } = {}
): Promise<LogResult> {
  // Stamp the acting admin centrally so every call site records who did it
  // (session is cookie-based; the proxy gate guarantees this user is an admin).
  const { data: { user } } = await supabase.auth.getUser()

  const { error } = await supabase.from('admin_audit_log').insert({
    action,
    admin_id: user?.id ?? null,
    target_user_id: opts.targetUserId ?? null,
    target_provider_id: opts.targetProviderId ?? null,
    target_session_id: opts.targetSessionId ?? null,
    details: opts.details ?? null,
    admin_note: opts.adminNote ?? null,
  })

  if (error) {
    console.error('[audit] could not record', action, error)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
