import type { SupabaseClient } from '@supabase/supabase-js'

/** Ported from mobile/src/app/(app)/notifications.tsx:123-141. */

export interface AppNotification {
  id: string
  type: string
  title: string
  body: string | null
  session_id: string | null
  data: Record<string, unknown> | null
  read_at: string | null
  created_at: string
}

export async function getNotifications(
  supabase: SupabaseClient,
  userId: string,
): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, session_id, data, read_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100)

  // Surfaced, not swallowed: an empty list and a failed query look identical to
  // a user, and the difference is the whole bug.
  if (error) throw error
  return (data ?? []) as AppNotification[]
}

export async function markAllNotificationsRead(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null)
}
