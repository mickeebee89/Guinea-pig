import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The ID check, for anyone — stylist or model. Audit item 82.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM getStylistSetup ───────────────────────
 * The rule "is this person's ID check done, waiting, or refused" was written
 * inside `getStylistSetup` (queries/shop.ts), along with a provider id, a bio
 * length and a publish blocker list. A model has none of those and needs the
 * same three words.
 *
 * Copying the derivation would have made two versions of one rule, which is
 * how a rule comes to mean two things. So the DERIVATION lives here and both
 * callers use it; only the queries differ, because a stylist's page already
 * has the row in hand and a model's does not.
 *
 * ── WHAT IT IS, IN THE PRODUCT'S OWN WORDS ────────────────────────────────
 * A selfie holding a handwritten note, looked at by a person. It shows there
 * is a real person behind the account and that the profile photo has not been
 * taken from somewhere else. It is NOT an identity check — nobody sees a
 * passport or a driving licence, and the copy must never imply otherwise.
 */

export type IdCheckState = 'none' | 'pending' | 'rejected' | 'approved'

export interface IdCheck {
  state: IdCheckState
  /** The reviewer's note on a rejection. The only thing that makes it fixable. */
  note: string | null
}

/**
 * The one definition. `is_verified` wins over any request row: an approval is
 * the end of the process, and a stale rejected row beneath it must not show a
 * verified member a refusal.
 */
export function deriveIdCheck(
  isVerified: boolean | null | undefined,
  req: { status?: string | null; notes?: string | null } | null | undefined,
): IdCheck {
  if (isVerified) return { state: 'approved', note: null }
  const status = req?.status
  const state: IdCheckState =
    status === 'pending' || status === 'rejected' ? status : 'none'
  return { state, note: req?.notes?.trim() ? req.notes.trim() : null }
}

/** The same answer for a member with no provider row behind them. */
export async function getIdCheck(
  supabase: SupabaseClient,
  userId: string,
): Promise<IdCheck> {
  const [userRes, reqRes] = await Promise.all([
    supabase.from('users').select('is_verified').eq('id', userId).maybeSingle(),
    supabase
      .from('verification_requests')
      .select('status, notes')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  // Fail toward "not done": showing an unverified member the submit form again
  // costs a wasted photo, while showing a pending one the form invites a
  // resubmission that deletes their queued request.
  return deriveIdCheck(
    (userRes.data as { is_verified?: boolean } | null)?.is_verified,
    reqRes.data as { status?: string | null; notes?: string | null } | null,
  )
}
