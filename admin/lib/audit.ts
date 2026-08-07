import { supabase } from './supabase'

export async function logAction(
  action: string,
  opts: {
    targetUserId?: string
    targetProviderId?: string
    targetSessionId?: string
    details?: Record<string, unknown>
    adminNote?: string
  } = {}
) {
  // Stamp the acting admin centrally so every call site records who did it
  // (session is cookie-based; the proxy gate guarantees this user is an admin).
  const { data: { user } } = await supabase.auth.getUser()

  await supabase.from('admin_audit_log').insert({
    action,
    admin_id: user?.id ?? null,
    target_user_id: opts.targetUserId ?? null,
    target_provider_id: opts.targetProviderId ?? null,
    target_session_id: opts.targetSessionId ?? null,
    details: opts.details ?? null,
    admin_note: opts.adminNote ?? null,
  })
}
