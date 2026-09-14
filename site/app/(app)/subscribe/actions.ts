'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
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
  | { ok: true; alreadyActive: true }
  | { ok: true; alreadyActive: false; clientSecret: string; subscriptionId: string }
  | { ok: false; error: string }

export async function startSubscription(): Promise<StartResult> {
  await requireUser()
  const supabase = await createSupabaseServerClient()

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
  if (data?.alreadyActive) return { ok: true, alreadyActive: true }

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
