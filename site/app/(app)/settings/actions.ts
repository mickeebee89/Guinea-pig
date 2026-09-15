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

export type CancelResult =
  | { ok: true; cancelsAt: string | null }
  | { ok: false; error: string }

/**
 * Cancel the £4.99/mo membership.
 *
 * ── WHAT THIS ACTUALLY DOES, WHICH IS NOT "CANCEL" ────────────────────────
 * cancel_subscription sets cancel_at_period_end on the Stripe subscription and
 * writes 'cancelling'. Nobody loses access they have paid for: it runs to
 * current_period_end and stops renewing. The UI says the date rather than the
 * word, because "cancelled" to a person means "it has stopped".
 *
 * ── ⚠️ IT CAN ALSO REPAIR A MISSING ROW, AND THAT IS DELIBERATE ───────────
 * If we hold no subscriptions row, the edge action does NOT return 404. It
 * calls syncSubscription, asks Stripe, and repairs — which WRITES.
 *
 * That looks like it crosses the 14 Sep decision that the web reconciles
 * read-only. It does not: that decision is about the GATE, which reads on every
 * page load and would otherwise race the webhook. This is a user pressing a
 * button, the same category as confirm_subscription. And it is the behaviour
 * that made "cancel at any time" true again — returning 404 because our own
 * table was empty is precisely how the promise failed at the one moment it
 * mattered, while Stripe carried on billing.
 *
 * ── THE SESSION ─────────────────────────────────────────────────────────
 * functions.invoke forwards this user's access token from the cookie-backed
 * server client. Assumed when written on 14 Sep 2026 and CONFIRMED the same day
 * by a real £4.99 payment through /subscribe, which resolved userId server-side
 * and wrote both tables.
 */
export async function cancelMembership(): Promise<CancelResult> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.functions.invoke('stripe-payment', {
    body: { action: 'cancel_subscription' },
  })

  if (error) {
    console.error('[settings] cancel_subscription failed', error)
    return {
      ok: false,
      error: 'We could not cancel it just now. Nothing has changed, and you have not been charged '
        + 'anything extra. Try again, or email support@guineapigapp.co.uk.',
    }
  }

  // Never read the absence of an error as success: cancel_subscription returns
  // 500 with { success: false } when its database write fails AFTER Stripe has
  // already been told to stop. That state — cancelled at Stripe, still 'active'
  // here — is the one a person must be told about, because the app would go on
  // showing them as a member while nothing renews.
  if (data?.success === false) {
    console.error('[settings] cancel_subscription reported failure', data)
    return {
      ok: false,
      error: 'Stripe has stopped the renewal, but we could not update our own records. Do not pay '
        + 'again — email support@guineapigapp.co.uk so we can put it right.',
    }
  }

  revalidatePath('/settings')
  revalidatePath('/dashboard')
  return { ok: true, cancelsAt: (data?.cancelsAt as string | null) ?? null }
}
