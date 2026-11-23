import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * How many models have signed up, and roughly where. Counts only.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT A DIRECTORY ────────────────────────
 * A stylist signs up, publishes nothing, lands on the dashboard and sees an
 * empty screen. Seven did that and never came back. 85 models have signed up;
 * no surface on the website said so.
 *
 * The obvious build was model browse, and it is the wrong one — not on
 * privacy appetite but on how much exposure the question needs. An aggregate
 * answers "is anyone here?"; a directory publishes 85 people's names, photos
 * and physical attributes to answer it.
 *
 * ⚠⚠ THIS PARAGRAPH USED TO SAY SOMETHING FALSE, and it is worth knowing
 * what. It read: "**A stylist cannot contact a model at all.** The sessions
 * RLS policy 'model can create session' requires `auth.uid() =
 * model_user_id`… so no provider-initiated path exists anywhere in the
 * product. A directory would power a button nobody has."
 *
 * The button exists, and has since **20 June 2026** — `invite_model` is
 * called from `salon-floor/actions.ts` on this website. The sessions sentence
 * is true and was the wrong thing to generalise from: a stylist cannot start
 * a BOOKING, which is not the same as cannot make CONTACT.
 *
 * Corrected 23 Nov 2026. The conclusion is unchanged because it never needed
 * that premise — migration 0113's header carries the retraction in full and
 * names 0112, where the claim was first written down.
 *
 * So this answers one question — "is anyone here?" — and returns nothing that
 * could identify a person. See migration 0112 for the threshold argument.
 *
 * ⚠️ 0097 IS UNTOUCHED. `nearby_models` stays revoked from `authenticated`.
 * This calls a different function that was built to return aggregates.
 */

/** One postcode area with enough members to name. Never fewer than three. */
export interface DemandArea {
  /** The AREA, not the outward code: 'SE', never 'SE16'. */
  area: string
  count: number
  /**
   * Miles from the viewer to the CENTROID of that area's members — the mean of
   * three or more coordinates. Null when we cannot place the viewer, which is
   * the only reason it is ever null.
   */
  distanceMiles: number | null
}

export interface ModelDemand {
  /** Every model account. */
  total: number
  /** Those with a usable coordinate. */
  placed: number
  /** Those inside an area that cleared the threshold. */
  inNamedAreas: number
  /** Nearest first when the viewer is placed; largest first when they are not. */
  areas: DemandArea[]
  /** False when the viewer has no coordinate, so every distance is null. */
  viewerPlaced: boolean
}

/**
 * ⚠️ RETURNS NULL ON FAILURE, AND THE CALLER MUST RENDER NOTHING FOR IT.
 *
 * The one thing this panel must never do is fail into "0 models have signed
 * up". That sentence is the exact false impression the panel was built to
 * correct, and it would be delivered with full confidence to the people most
 * likely to leave over it. Mobile learned the same lesson on the same data —
 * "Don't let a failed RPC render as 'no models nearby' — that reads as an
 * empty marketplace rather than a fault" (provider-dashboard.tsx:621).
 *
 * Null is "we don't know", and the dashboard shows no panel at all for it.
 */
export async function getModelDemand(
  supabase: SupabaseClient,
  userId: string,
): Promise<ModelDemand | null> {
  // The viewer's own coordinate, for ordering the areas by distance. Not fatal
  // if it is missing: a radius around nowhere is meaningless, but a COUNT is
  // not, so a stylist we cannot place still gets the numbers. Same rule as
  // lib/distance.ts, reached from the other side.
  const { data: meRow } = await supabase
    .from('users')
    .select('latitude, longitude')
    .eq('id', userId)
    .maybeSingle()

  const lat = (meRow?.latitude as number | null) ?? null
  const lng = (meRow?.longitude as number | null) ?? null

  const { data, error } = await supabase.rpc('model_demand_summary', {
    p_lat: lat,
    p_lng: lng,
  })

  if (error) {
    console.warn('[demand] model_demand_summary →', error.message)
    return null
  }

  // The function `returns table (...)`, so PostgREST hands back an array of
  // one row rather than a bare object.
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined
  if (!row) return null

  const rawAreas = Array.isArray(row.areas) ? (row.areas as Record<string, unknown>[]) : []

  return {
    total: Number(row.models_total ?? 0),
    placed: Number(row.models_placed ?? 0),
    inNamedAreas: Number(row.models_in_named_areas ?? 0),
    viewerPlaced: lat != null && lng != null,
    areas: rawAreas.map(a => ({
      area: String(a.area ?? ''),
      count: Number(a.count ?? 0),
      distanceMiles: a.distanceMi == null ? null : Number(a.distanceMi),
    })),
  }
}
