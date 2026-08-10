'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'

type Result = { ok: true } | { ok: false; error: string }

/**
 * Remove a block YOU created.
 *
 * Scoped to blocker_id = the signed-in user, matching the blocks_delete_own
 * policy. That is not belt-and-braces: it is the whole rule. Being blocked BY
 * someone is not yours to undo, and the delete would match zero rows and report
 * success if this were written loosely — so the row count is checked rather
 * than the absence of an error.
 */
export async function unblockUser(blockedId: string): Promise<Result> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('blocks')
    .delete()
    .eq('blocker_id', user.id)
    .eq('blocked_id', blockedId)
    .select('blocker_id')

  if (error) {
    console.error('[settings] unblock failed', error)
    return { ok: false, error: 'That didn’t work. Nothing has changed.' }
  }
  if ((data ?? []).length === 0) {
    // Nothing matched. Either it was already removed, or this was never your
    // block to remove. Say so rather than showing a success that changed
    // nothing.
    return { ok: false, error: 'That block is no longer there. Reload to see the current list.' }
  }

  revalidatePath('/settings')
  revalidatePath('/messages')
  return { ok: true }
}
