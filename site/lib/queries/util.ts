/**
 * Shared helpers for the query modules.
 *
 * These queries all follow the same shape as their mobile originals: fetch a
 * page of rows, collect the ids they reference, fetch those in one batch each,
 * then stitch. `public_profiles`, `providers` and `provider_treatments` cannot
 * be joined in a single PostgREST call here — public_profiles is a view with no
 * declared relationship to sessions — so the stitching is manual and this is
 * the bit that repeats.
 */

/** Index rows by id. Generic so callers keep their row type through the map. */
export function indexById<T extends { id: string }>(rows: unknown): Record<string, T> {
  return Object.fromEntries(((rows ?? []) as T[]).map(r => [r.id, r]))
}

export interface ProviderRef {
  id: string
  user_id: string
  name: string | null
  profile_pic_url: string | null
}

export interface ProfileRef {
  id: string
  first_name: string
  last_initial: string | null
  profile_pic_url: string | null
}

export interface TreatmentRef {
  id: string
  name?: string | null
  category: string | null
}

/** "Sarah B." — the only form of a model's name any other user ever sees. */
export function displayName(p: ProfileRef | undefined, fallback = 'Model'): string {
  if (!p?.first_name) return fallback
  return `${p.first_name} ${p.last_initial ?? ''}.`.trim()
}
