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
