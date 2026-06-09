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
  await supabase.from('admin_audit_log').insert({
    action,
    target_user_id: opts.targetUserId ?? null,
    target_provider_id: opts.targetProviderId ?? null,
    target_session_id: opts.targetSessionId ?? null,
    details: opts.details ?? null,
    admin_note: opts.adminNote ?? null,
  })
}
