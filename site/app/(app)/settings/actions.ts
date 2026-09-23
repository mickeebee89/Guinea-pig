'use server'

import { SUPPORT_EMAIL } from '@/lib/site'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'

type Result = { ok: true } | { ok: false; error: string }

/**
 * Turn notification emails on or off. Audit item 74.
 *
 * Stored in users.notification_preferences, the jsonb column that already
 * existed and that the Privacy policy already describes, as
 * `{"email": {"enabled": false}}`. Merged rather than replaced, so anything
 * added to that column later survives.
 *
 * DEFAULT IS ON, without a backfill: the send-email function treats a null
 * column, a missing key, and anything but an explicit `false` as yes. Only
 * someone who turns it off is written to at all.
 *
 * The member's own session writes their own row — notification_preferences is
 * not one of 0040's protected columns, so no privileged path is needed.
 */
export async function setEmailNotifications(enabled: boolean): Promise<Result> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data: row } = await supabase
    .from('users').select('notification_preferences').eq('id', user.id).maybeSingle()
  const current = ((row as { notification_preferences?: Record<string, unknown> } | null)
    ?.notification_preferences) ?? {}

  const { data, error } = await supabase
    .from('users')
    .update({ notification_preferences: { ...current, email: { enabled } } })
    .eq('id', user.id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[settings] email preference save failed', { code: error.code, message: error.message })
    return { ok: false, error: 'That didn’t save. Your setting is unchanged — try again in a moment.' }
  }
  // No row back and no error is RLS filtering the update out, e.g. a suspension.
  if (!data) return { ok: false, error: `That couldn’t be saved from your account. Email ${SUPPORT_EMAIL} and we’ll look into it.` }

  revalidatePath('/settings')
  return { ok: true }
}

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
        + `anything extra. Try again, or email ${SUPPORT_EMAIL}.`,
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
        + `again — email ${SUPPORT_EMAIL} so we can put it right.`,
    }
  }

  revalidatePath('/settings')
  revalidatePath('/dashboard')
  return { ok: true, cancelsAt: (data?.cancelsAt as string | null) ?? null }
}

/* ───────────────────────────────────────────────────────────────────────────
 * DELETING YOUR OWN ACCOUNT
 * ───────────────────────────────────────────────────────────────────────── */

export type DeleteResult = { ok: false; error: string; retryable?: boolean }

/**
 * Permanently delete the signed-in member's own account. Audit item 85.
 *
 * ── IT DOES ALMOST NOTHING ITSELF, ON PURPOSE ─────────────────────────────
 * The work is in the `delete-account` edge function: preflight, Stripe,
 * delete_account_data in one transaction, storage, then the auth user. This
 * invokes it **with her own JWT** — the function derives the target from the
 * verified caller and never from a passed id, which is the whole of its safety
 * model. Passing the service key here would hand it an id instead, and turn a
 * self-service button into an "delete any account" endpoint.
 *
 * `delete_account_data` is revoked from authenticated (account-deletion-fix.sql:358),
 * so the web could not take a shortcut past the function even if it wanted to.
 *
 * ── ⚠️ ITEM 50's GAP: THE WEB CANNOT PREVENT IT ───────────────────────────
 * If the database transaction commits and the AUTH delete then fails, the
 * login survives with no profile row — the one state where item 50's unguarded
 * insert path is reachable. That happens inside the edge function, between two
 * steps, and no amount of care out here closes it.
 *
 * What this can do is not make it worse:
 *   * it does NOT sign her out on that failure, because signing out would
 *     strand a half-deleted account with nobody able to reach it;
 *   * it offers Try again, and re-invoking is safe — the preflight passes, the
 *     RPC finds nothing left to delete, and the auth delete is retried.
 *
 * ── SIGN-OUT IS NOT OPTIONAL ON THE WEB ───────────────────────────────────
 * Mobile just signs out. A browser holds a session cookie for a user that no
 * longer exists, and every subsequent request tries to refresh a token for a
 * deleted account. So on success: sign out, then redirect to a public page.
 */
export async function deleteMyAccount(): Promise<DeleteResult> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.functions.invoke('delete-account')

  // A non-2xx comes back as an error here, with the body in `data` when the
  // function answered at all. Both are read: the function distinguishes
  // "nothing was removed" from "your data is gone but the account is not",
  // and flattening them would tell someone their data survived when it did not.
  const body = (data ?? {}) as { success?: boolean; error?: string; blockers?: string[] }

  if (error || !body.success) {
    const message = body.error ?? error?.message ?? ''
    console.error('[settings] account deletion failed', {
      userId: user.id, message, blockers: body.blockers,
    })

    // The one failure where her data is already gone. Its wording is the
    // function's own and says so plainly; Try again is the only sane next step.
    const partial = /could not be closed/i.test(message)
    if (partial) {
      return {
        ok: false,
        error: 'Your data was removed but the account could not be closed. Try again — it picks up where it stopped.',
        retryable: true,
      }
    }

    return {
      ok: false,
      error: message.trim()
        ? `${message} If it keeps happening, email ${SUPPORT_EMAIL}.`
        : `We couldn’t delete your account, and nothing has been removed. Please try again, or email ${SUPPORT_EMAIL}.`,
    }
  }

  // Gone. Drop the cookie before anything else can try to use it.
  await supabase.auth.signOut()
  redirect('/?deleted=1')
}
