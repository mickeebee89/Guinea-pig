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
 * Active £4.99/mo subscription.
 *
 * Two rules from mobile that are NOT obvious and must not be simplified away:
 *
 *   1. `subscription_waived` grants access with no Stripe subscription at all.
 *      It is how comps, promos and App Review demo accounts work, and it
 *      mirrors provider_fee_waived on the stylist side. Checked FIRST and read
 *      defensively — a hiccup reading it must never block a real subscriber.
 *
 *   2. `cancelling` still grants access until current_period_end. Someone who
 *      cancelled keeps what they paid for until the period runs out. There is
 *      no webhook, so this is date-driven: get it wrong and you cut off a
 *      paying customer early.
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
    .select('status, current_period_end')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return { active: false, waived: false }

  const row = data as { status: string; current_period_end: string | null }
  if (row.status === 'active') return { active: true, waived: false }
  if (row.status === 'cancelling') {
    return {
      active: !!row.current_period_end && new Date(row.current_period_end) > new Date(),
      waived: false,
    }
  }
  return { active: false, waived: false }
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
