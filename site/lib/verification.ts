import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The apply gate. Port of mobile/src/lib/verification.ts.
 *
 * A model may apply for a session only with BOTH an active subscription AND
 * identity verification. Reproduced rather than reinvented, because both halves
 * carry rules that are easy to drop silently and expensive to get wrong — a
 * model who has paid being told they have not is a support ticket and a refund
 * argument.
 */

export interface GateState {
  subscribed: boolean
  verified: boolean
  canApply: boolean
  /** True when access comes from an admin waiver rather than a payment. */
  waived: boolean
}

/** users.is_verified — the ID check passed, independent of any subscription. */
export async function isIdentityVerified(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('users').select('is_verified').eq('id', userId).maybeSingle()
  if (error) throw error
  return !!(data as { is_verified?: boolean } | null)?.is_verified
}

/**
 * Active GBP 4.99/mo subscription.
 *
 * -- WHY THIS ASKS STRIPE SOMETIMES ----------------------------------------
 * Reading our own row alone fails in BOTH directions, and both were live on
 * 24 Aug 2026:
 *
 *   OVER-GRANT. This used to be `if (status === 'active') return true`, with the
 *     date check applied only to 'cancelling'. An 'active' row whose period had
 *     ended kept granting access for ever. 8 of 11 rows were in that state.
 *
 *   OVER-REVOKE. Adding a bare date check would have been worse. There is no
 *     webhook, so current_period_end is written only by confirm_subscription at
 *     initial subscribe. Stripe renews; our row does not move. Someone who
 *     subscribed in January still shows a February end date in April while
 *     paying every month - and a date check alone would cut them off.
 *
 * So a lapsed-looking row is not evidence. It is a reason to ask Stripe, which
 * is what sync_subscription does: it reconciles, repairs our rows, and returns
 * the authoritative answer. The fast path below means Stripe is only consulted
 * when our own record cannot settle it.
 *
 * FAILS CLOSED-ISH, DELIBERATELY: if Stripe cannot be reached the answer is
 * "keep granting" rather than "deny". Wrongly denying a paying subscriber is a
 * worse outcome than briefly granting one who has lapsed, and an outage on our
 * side must not look like non-payment on theirs.
 */
export async function hasActiveSubscription(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ active: boolean; waived: boolean }> {
  const { data: u } = await supabase
    .from('users').select('subscription_waived').eq('id', userId).maybeSingle()
  if ((u as { subscription_waived?: boolean } | null)?.subscription_waived) {
    return { active: true, waived: true }
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .select('status, current_period_end, stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return { active: false, waived: false }

  const row = data as {
    status: string; current_period_end: string | null; stripe_customer_id: string | null
  }

  const endsInFuture = !!row.current_period_end &&
    new Date(row.current_period_end).getTime() > Date.now()

  // Fast path: unambiguously current, no Stripe call.
  if (['active', 'cancelling'].includes(row.status) && endsInFuture && row.stripe_customer_id) {
    return { active: true, waived: false }
  }

  if (!['active', 'cancelling'].includes(row.status)) return { active: false, waived: false }

  // Ambiguous - lapsed date, or no customer id to trust. Ask Stripe.
  try {
    const { data: synced, error: syncErr } = await supabase.functions.invoke('stripe-payment', {
      body: { action: 'sync_subscription' },
    })
    if (syncErr) throw syncErr
    if (synced?.active === true)  return { active: true,  waived: false }
    if (synced?.active === false) return { active: false, waived: false }
    return { active: true, waived: false }   // null = Stripe unreachable
  } catch (e) {
    console.warn('[verification] sync_subscription failed, granting on last known state', e)
    return { active: true, waived: false }
  }
}

/** Both halves, in one call. Fails closed: an error means "cannot apply". */
export async function getGateState(
  supabase: SupabaseClient,
  userId: string,
): Promise<GateState> {
  const [sub, verified] = await Promise.all([
    hasActiveSubscription(supabase, userId).catch(() => ({ active: false, waived: false })),
    isIdentityVerified(supabase, userId).catch(() => false),
  ])
  return {
    subscribed: sub.active,
    verified,
    waived: sub.waived,
    canApply: sub.active && verified,
  }
}
