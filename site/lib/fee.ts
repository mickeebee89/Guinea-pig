import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Does Cavy charge stylists a fee AT ALL right now?
 *
 * ── ⚠️⚠️ A DIFFERENT QUESTION FROM isProviderFeeSettled, AND THE UI NEEDS
 *    THIS ONE ──────────────────────────────────────────────────────────────
 * `provider_fee_settled` answers "does she owe anything", and it short-circuits
 * to TRUE whenever the fee is switched off. That is right for a GATE — nobody
 * should be blocked — but it is wrong for COPY, because "settled" renders as a
 * sentence about a debt that was cleared. Every stylist was being shown a setup
 * step headed "The one-off fee" reading "Settled. Nothing to pay." Six of the
 * seven were told Cavy has a fee that was somehow settled for them, and the
 * seventh was thanked for a Founding Provider slot that confers nothing since
 * 0102 — all of it contradicting the free-for-stylists pitch she had just read.
 *
 * ⚠️ SO THE STEP IS HIDDEN ON THIS FLAG, NOT DELETED. The fee can come back
 * (supabase/FEE-REINSTATEMENT.md), and a deleted step comes back as an
 * unannounced charge. Hidden on the flag, it returns the moment the flag does.
 *
 * ── ⚠️ FAILS TOWARD "OFF" ────────────────────────────────────────────────
 * The opposite direction from isProviderFeeSettled below, and for the same
 * reason: an unreachable database must not invent a debt. Off means the step
 * is not drawn, which is what the live answer is anyway.
 */
export async function isProviderFeeEnabled(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('provider_fee_enabled')
  if (error) {
    console.warn('[fee] provider_fee_enabled failed, treating as off:', error.message)
    return false
  }
  return data === true
}

/**
 * Has this stylist's one-off verification fee been settled?
 *
 * ── ⚠️⚠️ ONE PLACE. THIS IS THE WHOLE POINT OF THE FILE ──────────────────
 * Until 0102 the rule existed THREE times — once in SQL and twice here, copied
 * into `queries/shop.ts` and `verify/actions.ts` because `authenticated` had no
 * EXECUTE on the function. 0102 grants it, so both call sites now ask the
 * database the same question the database asks itself.
 *
 * ⚠️ That matters more than tidiness. The fee is now switched OFF behind
 * `provider_fee_enabled` (default false), and a flag inside the SQL function
 * alone would have left the two TypeScript copies still charging — including
 * `publishRefusal`, which BLOCKS a shop going live. A stylist would have read
 * "Cavy is free" and then been refused by a gate nobody had told.
 *
 * ── ⚠️ PASS THE SIGNED-IN USER. NEVER SOMEBODY ELSE ──────────────────────
 * `provider_fee_settled` is SECURITY INVOKER on purpose: it reads payment and
 * waiver state under the CALLER's own RLS, which is what stops it becoming an
 * oracle on another account. The consequence is that asking about a different
 * user returns a confident `false` whatever the truth is, because RLS hides the
 * rows rather than erroring.
 *
 * ── ⚠️ FAILS TOWARD "SETTLED", DELIBERATELY ──────────────────────────────
 * An unreachable database must not invent a debt. The fee is off by default,
 * no payment has ever been taken, and wrongly telling a stylist she owes money
 * is a worse outcome than wrongly letting a free account through a gate that
 * currently refuses nobody. The error is logged so the cause is findable.
 */
export async function isProviderFeeSettled(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('provider_fee_settled', { p_user_id: userId })
  if (error) {
    console.warn('[fee] provider_fee_settled failed, treating as settled:', error.message)
    return true
  }
  return data === true
}
