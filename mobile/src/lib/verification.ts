import { supabase } from './supabase'

// Identity verification only (users.is_verified). Use this for the "Verified" badge /
// status — it means the person passed the ID check, independent of any subscription.
export async function isIdentityVerified(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('users')
    .select('is_verified')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return !!(data as any)?.is_verified
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
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const { data: waived } = await supabase
    .from('users').select('subscription_waived').eq('id', userId).maybeSingle()
  if ((waived as any)?.subscription_waived) return true

  const { data, error } = await supabase
    .from('subscriptions')
    .select('status, current_period_end, stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error

  const row = data as {
    status: string; current_period_end: string | null; stripe_customer_id: string | null
  } | null

  const endsInFuture = !!row?.current_period_end &&
    new Date(row.current_period_end).getTime() > Date.now()

  // 'past_due' grants. A failed payment is not a lapse: Stripe retries for up to
  // ~3 weeks, and access runs to current_period_end either way. If Stripe gives
  // up it sends customer.subscription.deleted and the webhook writes 'expired',
  // which is what actually ends access. Cutting someone off on a card hiccup is
  // the failure this whole file already leans away from.
  // Fast path: unambiguously current, no Stripe call.
  if (row && ['active', 'cancelling', 'past_due'].includes(row.status) &&
      endsInFuture && row.stripe_customer_id) {
    return true
  }

  // Definitely nothing: no row at all, or already expired.
  if (!row || !['active', 'cancelling', 'past_due'].includes(row.status)) return false

  // Ambiguous - lapsed date, or no customer id to trust. Ask Stripe.
  try {
    const { data: synced, error: syncErr } = await supabase.functions.invoke('stripe-payment', {
      body: { action: 'sync_subscription' },
    })
    if (syncErr) throw syncErr
    if (synced?.active === true) return true
    if (synced?.active === false) return false
    return true   // active === null means Stripe was unreachable
  } catch (e) {
    console.warn('[verification] sync_subscription failed, granting on last known state:', e)
    return true
  }
}

// Apply gate: a model may apply ONLY with BOTH an active subscription AND identity
// verification. (apply-session checks the two parts individually so it can route the
// model to whichever step is missing; this is the combined yes/no for simple checks.)
export async function canApply(userId: string): Promise<boolean> {
  const [subscribed, verified] = await Promise.all([
    hasActiveSubscription(userId),
    isIdentityVerified(userId),
  ])
  return subscribed && verified
}
