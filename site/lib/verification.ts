import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The apply gate. Port of mobile/src/lib/verification.ts.
 *
 * A model may apply for a session only with BOTH an active subscription AND
 * identity verification. Reproduced rather than reinvented, because both halves
 * carry rules that are easy to drop silently and expensive to get wrong — a
 * model who has paid being told they have not is a support ticket and a refund
 * argument.
 *
 * ── ⚠️⚠️ BOTH GATES ARE SWITCHED OFF, AND A FLAG IS WHY ─────────────
 * `subscription_enabled` and `verification_required_to_apply` are both false in
 * `settings`, so NOTHING is asked of a model today: she signs up and the apply
 * button is the next thing she touches.
 *
 * ⚠️ THE GATES ARE NOT DELETED, THEY ARE UNASKED. Every check below still
 * exists and still runs the moment its flag returns true — which is the whole
 * reason this is a flag and not a deletion. `tg_session_apply_gate` (0049) reads
 * the same two functions, so the database and this file cannot disagree about
 * whether a gate is live.
 *
 * ── ⚠️⚠️ THE TWO FAIL DIRECTIONS ARE OPPOSITE ON PURPOSE ─────────────
 * They look inconsistent and must not be made consistent:
 *
 *   subscription_enabled            a REVENUE gate. Unreadable means DO NOT
 *                                   CHARGE, so it fails OPEN (not required).
 *                                   Wrongly charging somebody is worse than
 *                                   wrongly letting them in free.
 *   verification_required_to_apply  a SAFETY gate. Unreadable means REQUIRED,
 *                                   so it fails CLOSED. A model decides whether
 *                                   to be alone with a stranger partly on this;
 *                                   an outage must not quietly lower the bar.
 *
 * The SQL coalesces to `false` and `true` respectively, and `getGateFlags`
 * below mirrors each one rather than picking a house style.
 *
 * ⚠️ `verified` BELOW MEANS "THE GATE IS SATISFIED", NOT "SHE PASSED THE ID
 * CHECK". With the flag off it is true for everybody. Anything that wants the
 * FACT — a badge, a status card, the setup panel — must ask
 * `getIdCheck()` (lib/queries/idCheck.ts), which reads `users.is_verified` and
 * the request row and knows nothing about flags.
 */

/**
 * Which gates are live at all, read once and passed down.
 *
 * ⚠️ ONE READ PER REQUEST, NOT ONE PER CALL. A page that renders two
 * gate-aware things used to be able to ask twice; two answers inside one render
 * is a panel that contradicts the button underneath it.
 */
export interface GateFlags {
  /** subscription_enabled() — is a membership being asked of anyone? */
  subscriptionRequired: boolean
  /** verification_required_to_apply() — is the ID check a condition of applying? */
  verificationRequired: boolean
}

export async function getGateFlags(supabase: SupabaseClient): Promise<GateFlags> {
  const [sub, ver] = await Promise.all([
    supabase.rpc('subscription_enabled'),
    supabase.rpc('verification_required_to_apply'),
  ])

  // ⚠️ THE ERROR ARMS ARE THE FAIL DIRECTIONS, and they differ. See the
  // header: money fails open, safety fails closed. Logged either way, because a
  // flag that cannot be read is a real fault even when the fallback is right.
  if (sub.error) {
    console.warn('[verification] subscription_enabled failed, treating as OFF:', sub.error.message)
  }
  if (ver.error) {
    console.warn('[verification] verification_required_to_apply failed, treating as REQUIRED:', ver.error.message)
  }

  return {
    // `=== true` so a null — which is what a missing settings row returns —
    // reads as off, matching the function's own coalesce.
    subscriptionRequired: sub.error ? false : sub.data === true,
    // `!== false` for the mirror reason: only an explicit false lowers it.
    verificationRequired: ver.error ? true : ver.data !== false,
  }
}

export interface GateState {
  /**
   * ⚠️ THE EFFECTIVE ANSWER, NOT THE FACT. True when she is subscribed OR
   * comped OR nobody is being asked to subscribe. Every consumer that asks
   * "may she apply" wants exactly this and needed no change when the flag went
   * off; anything that wants to TALK about money must check
   * `subscriptionRequired` first.
   */
  subscribed: boolean
  /** The same shape for the ID check. See the header's warning. */
  verified: boolean
  canApply: boolean
  /** True when access comes from an admin waiver rather than a payment. */
  waived: boolean
  /** Is a membership asked of anyone at all right now? */
  subscriptionRequired: boolean
  /** Is the ID check a condition of applying right now? */
  verificationRequired: boolean
  /**
   * Neither gate is live, so nothing is owed and nothing should be said.
   *
   * ⚠️ THIS IS WHAT A PANEL SHOULD TEST, NOT `canApply`. With both flags off
   * `canApply` is true for everybody, so "you're all set — your ID check and
   * your membership are both done" would render to a member who has done
   * neither and was never asked to.
   */
  anyGateLive: boolean
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
 *   OVER-REVOKE. Adding a bare date check would have been worse.
 *
 *     ⚠️ CORRECTED 14 Sep 2026. This said "There is no webhook, so
 *     current_period_end is written only by confirm_subscription at initial
 *     subscribe. Stripe renews; our row does not move." The webhook has been
 *     live since 25 Aug 2026 and writes the fresh period on every renewal, so
 *     the row DOES move. Note the same file already knew: the past_due comment
 *     below reasons correctly about the webhook writing 'expired'. One file,
 *     arguing both ways, forty lines apart.
 *
 *     The date check is still not safe ALONE, for a smaller reason: a renewal
 *     event that was never delivered, filed as failed, or could not be
 *     attributed to a user leaves the row behind while the person keeps paying.
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
  /**
   * Read once by the caller. Omitted, this reads them itself — correct, but a
   * second round trip, which is what `getGateState` exists to avoid.
   */
  flags?: GateFlags,
): Promise<{ active: boolean; waived: boolean }> {
  // ⚠️ THE WAIVER SHORT-CIRCUIT IS KEPT, AND IT IS STILL FIRST. A comped
  // account is WAIVED, which is not the same fact as "nobody is being charged":
  // /subscribe and Settings word those two differently, and the comp survives
  // the flag being switched back on. Losing it here would turn a deliberate
  // admin decision into an accident of configuration.
  const { data: u } = await supabase
    .from('users').select('subscription_waived').eq('id', userId).maybeSingle()
  if ((u as { subscription_waived?: boolean } | null)?.subscription_waived) {
    return { active: true, waived: true }
  }

  // ⚠⚠ THE FLAG, BEFORE THE ROW AND BEFORE STRIPE. With subscription_enabled
  // false there is nothing to be active or lapsed about — and everything below
  // this line can end in a LIVE Stripe call (sync_subscription). Asking Stripe
  // about a product nobody is being sold is a real request on behalf of a gate
  // that is not running.
  //
  // `waived: false` deliberately: she is not comped, she is simply not being
  // asked. The caller that needs to know which is which has the flag.
  const required = (flags ?? await getGateFlags(supabase)).subscriptionRequired
  if (!required) return { active: true, waived: false }

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

  // 'past_due' grants. A failed payment is not a lapse: Stripe retries for up to
  // ~3 weeks, and access runs to current_period_end either way. If Stripe gives
  // up it sends customer.subscription.deleted and the webhook writes 'expired',
  // which is what actually ends access. Cutting someone off on a card hiccup is
  // the failure this whole file already leans away from.
  // Fast path: unambiguously current, no Stripe call.
  if (['active', 'cancelling', 'past_due'].includes(row.status) && endsInFuture && row.stripe_customer_id) {
    return { active: true, waived: false }
  }

  if (!['active', 'cancelling', 'past_due'].includes(row.status)) return { active: false, waived: false }

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

/**
 * Both halves, in one call. Fails closed: an error means "cannot apply".
 *
 * ⚠️ THE FLAGS ARE READ ONCE, HERE, AND HANDED DOWN. Both halves take the
 * same object, so one render cannot see them disagree — and the Stripe path
 * inside hasActiveSubscription is skipped without a second round trip to ask
 * whether it should be.
 */
export async function getGateState(
  supabase: SupabaseClient,
  userId: string,
): Promise<GateState> {
  const flags = await getGateFlags(supabase)

  const [sub, verified] = await Promise.all([
    hasActiveSubscription(supabase, userId, flags)
      .catch(() => ({ active: false, waived: false })),
    // ⚠️ NOT ASKED AT ALL WHEN IT IS NOT A CONDITION. `isIdentityVerified`
    // reads users.is_verified, which is still the right answer to a different
    // question — but the answer to THIS one is "the gate is satisfied", and
    // reading the column would make an unverified member fail a gate that is
    // switched off.
    flags.verificationRequired
      ? isIdentityVerified(supabase, userId).catch(() => false)
      : Promise.resolve(true),
  ])

  return {
    subscribed: sub.active,
    verified,
    waived: sub.waived,
    subscriptionRequired: flags.subscriptionRequired,
    verificationRequired: flags.verificationRequired,
    anyGateLive: flags.subscriptionRequired || flags.verificationRequired,
    canApply: sub.active && verified,
  }
}
