'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getGateFlags } from '@/lib/verification'
import type { ConfirmOutcome } from '@/components/PayForm'

/**
 * The £4.99/mo model subscription, on the web.
 *
 * ── THESE ARE SERVER ACTIONS, NOT BROWSER CALLS ───────────────────────────
 * Mobile invokes the edge function from the client. This app does not: every
 * other write in site/ goes through a server action, and a second pattern for
 * the same job is what audit item 48 is about — the duplicate always looks
 * plausible because it was correct somewhere else.
 *
 * ── ⚠️ THE ASSUMPTION THIS CODE RESTS ON, NAMED WHERE IT IS MADE ──────────
 * See the note above each functions.invoke call. In short: the cookie-backed
 * server client is expected to forward the user's access token, which is how
 * stripe-payment resolves userId. If that is wrong, this fails as a 401 from
 * the edge function and the fix is written down at the call site.
 */

export type StartResult =
  /**
   * `finishing` is true when the answer came from STRIPE rather than our row:
   * Stripe holds a live or paid subscription that our record has not caught
   * up with yet (audit item 55). False when it is our own 'active' row.
   */
  | { ok: true; alreadyActive: true; finishing: boolean }
  | { ok: true; alreadyActive: false; clientSecret: string; subscriptionId: string }
  | { ok: false; error: string }

export async function startSubscription(): Promise<StartResult> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  // ── ⚠️⚠️ REFUSED HERE, BECAUSE STRIPE IS LIVE ──────────────────
  //
  // `subscription_enabled` is false, so no member is being asked to pay — and
  // the page below no longer offers the form. HIDING THE LINK IS NOT THE SAME
  // AS CLOSING THE DOOR: this is a server action, so anything that can POST to
  // this app can call it directly, and the next line after this check invokes
  // `stripe-payment` against LIVE KEYS. Real cards are charged (CLAUDE.md, live
  // since 17 Jul 2026). A stale tab, a double-submit, a bookmarked /subscribe,
  // or a crafted request would each have created a real subscription for a
  // product that is currently switched off.
  //
  // ⚠️ BEFORE THE INVOKE, NOT AFTER. The point is that no Stripe object is
  // created, so there is nothing to refund, cancel or reconcile afterwards.
  //
  // ⚠️ THE REVENUE FAIL DIRECTION APPLIES HERE TOO. getGateFlags treats an
  // unreadable flag as OFF, so a database wobble refuses a charge rather than
  // taking one. That is the right way round for money, and it is the opposite
  // of how the verification flags fail — see lib/verification.ts.
  const { subscriptionRequired } = await getGateFlags(supabase)
  if (!subscriptionRequired) {
    console.warn('[subscribe] startSubscription called while subscription_enabled is false')
    return {
      ok: false,
      error: 'Membership isn’t needed at the moment, so there’s nothing to pay. Nothing has been charged.',
    }
  }

  // ── ⚠️ ASSUMPTION: functions.invoke carries this user's session ───────────
  //
  // createSupabaseServerClient() is @supabase/ssr's cookie-backed client, and
  // functions.invoke is documented to send the current session's access token
  // as the Authorization header. stripe-payment resolves `userId` from that
  // JWT — it never trusts a body-supplied id, deliberately (a body-supplied
  // customer id is exactly what confirm_subscription refuses).
  //
  // This was NOT verified locally before shipping: proving it needs a signed-in
  // browser session, and the alternative was a temporary debug route that calls
  // a live payment action and then gets forgotten. Decided 14 Sep to find out
  // on a preview deployment instead.
  //
  // IF IT IS WRONG it looks like a 401 from the edge function, not a silent
  // failure. The fix is to read the session explicitly and pass the token:
  //   const { data: { session } } = await supabase.auth.getSession()
  //   supabase.functions.invoke('stripe-payment', {
  //     headers: { Authorization: `Bearer ${session?.access_token}` }, body: {...},
  //   })
  const { data, error } = await supabase.functions.invoke('stripe-payment', {
    body: { action: 'create_subscription' },
  })

  if (error) {
    console.error('[subscribe] create_subscription failed', error)
    return { ok: false, error: 'We could not start the membership. Nothing has been charged.' }
  }

  // ⚠️ alreadyActive is `subscriptions.status === 'active'` on our own row and
  // nothing else — no date check, no Stripe call. So a row whose period has
  // ended still short-circuits here. That is the FOURTH definition of
  // "subscribed" in this codebase (audit item 48) and it lives inside the
  // action this page has to call.
  //
  // Handled rather than trusted: this does not claim they are subscribed, it
  // reports that the server thinks a subscription already exists and sends
  // them to the gate, which applies the real rule.
  if (data?.alreadyActive) return { ok: true, alreadyActive: true, finishing: data.finishing === true }

  if (!data?.clientSecret || !data?.subscriptionId) {
    console.error('[subscribe] create_subscription returned no clientSecret', data)
    return { ok: false, error: 'We could not start the membership. Nothing has been charged.' }
  }

  return {
    ok: true,
    alreadyActive: false,
    clientSecret: data.clientSecret as string,
    subscriptionId: data.subscriptionId as string,
  }
}

/**
 * Called AFTER Stripe has confirmed the payment. Its job is to find out whether
 * we recorded it — never to assume.
 *
 * ── WHY THERE IS NO sync_subscription CALL HERE ───────────────────────────
 * Mobile's equivalent falls back to sync_subscription, which WRITES. The
 * webhook has owned subscriptions.status since 25 Aug 2026, and the decision on
 * 14 Sep was that the web reconciles read-only: one writer, one owner. So a
 * failed confirm is reported as PENDING and the webhook does the repair —
 * customer.subscription.created carries the same facts and arrives on its own.
 *
 * That is what `pending` means to the person: charged, not finished, nothing
 * for you to do, do not pay again.
 *
 * ── ⚠️⚠️ DELIBERATELY *NOT* GATED ON subscription_enabled ───────────
 * `startSubscription` refuses while the flag is off, so in the ordinary case
 * nothing can reach this. The flag is still not tested here, and that is a
 * decision rather than an omission: this function runs AFTER Stripe has taken
 * the money. Its only job is to record a charge that has already happened.
 *
 * Refusing it on a flag would mean a member whose card was charged — by a
 * payment started before the flag moved, or in flight while it moved — has
 * paid and we have no record of it. That is strictly the worst outcome
 * available: the gate exists to stop charges, not to lose them.
 */
export async function confirmSubscription(subscriptionId: string): Promise<ConfirmOutcome> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

  // Same session assumption as above.
  const { data, error } = await supabase.functions.invoke('stripe-payment', {
    body: { action: 'confirm_subscription', subscriptionId },
  })

  if (error) {
    console.error('[subscribe] confirm_subscription transport failed', error)
    return {
      ok: false,
      pending: true,
      error: 'We could not reach our own server to record it.',
    }
  }

  // ⚠️ confirm_subscription returns HTTP 200 with { success: false } when its
  // database write fails. supabase-js reports no error for that, so the absence
  // of `error` above proves nothing — this is the second path mobile's old code
  // could not see at all, and the reason it billed people invisibly.
  if (data?.success === false) {
    console.error('[subscribe] confirm_subscription reported failure', data)
    return {
      ok: false,
      pending: true,
      error: typeof data.error === 'string' ? data.error : 'The membership was not recorded.',
    }
  }

  revalidatePath('/dashboard')
  revalidatePath('/settings')
  return { ok: true }
}
