'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { markAllNotificationsRead } from '@/lib/queries/notifications'

/**
 * Mark everything read.
 *
 * ── WHY A BUTTON AND NOT "ON VIEW" ────────────────────────────────────────
 * Marking read inside the page's server component would have been fewer files.
 * It is also wrong: Next prefetches routes on hover and on viewport entry, and
 * a prefetch runs the page function. Notifications would go read because a link
 * scrolled into view, which is a data loss the user never sees happen.
 *
 * A deliberate press is also what mobile does (notifications.tsx: "Mark all
 * read"), so the two clients agree on when the dot clears.
 *
 * revalidatePath at the layout level, not the page: the bell lives in the (app)
 * layout, and revalidating only this page would clear the list's unread marks
 * while leaving the dot lit until the next full navigation.
 */
export async function markAllRead(): Promise<{ ok: boolean }> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  try {
    await markAllNotificationsRead(supabase, user.id)
  } catch (e) {
    console.error('[notifications] mark all read failed', e)
    return { ok: false }
  }

  revalidatePath('/', 'layout')
  return { ok: true }
}

/**
 * Mark one notification read.
 *
 * ── WHY PER-ROW AND NOT JUST TAP-THROUGH ──────────────────────────────────
 * Only notifications carrying a session_id are links on this page, so a
 * mark-on-click would have covered some rows and silently skipped the rest —
 * and the skipped ones are the account-level messages: warnings, verification
 * results, a rejected status post. The ones most worth being able to clear.
 *
 * That is the same shape as the notification-type allowlist this file's sibling
 * comment describes: a rule correct for the rows that happened to exist when it
 * was written. So the control is on every row, and does not depend on what the
 * row links to.
 *
 * RLS confines the update to the caller's own rows; the .eq('user_id') is a
 * second lock on the same door rather than the only one.
 */
export async function markOneRead(id: string): Promise<{ ok: boolean }> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .is('read_at', null)

  if (error) {
    console.error('[notifications] mark one read failed', error)
    return { ok: false }
  }

  revalidatePath('/', 'layout')
  return { ok: true }
}
