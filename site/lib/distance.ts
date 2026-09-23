/**
 * Distance, and the one rule that governs every use of it. Audit item 92.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  A RADIUS APPLIES ONLY IF WE CAN PLACE THE VIEWER
 * ══════════════════════════════════════════════════════════════════════════
 * This file exists because that rule was learned twice and written down once.
 *
 * The stylist-updates feed applied its 20-mile default to members with no
 * coordinate of their own. Every distance was null, the filter removed every
 * row, and the page said "these aren't filtered by distance yet" directly
 * above "no stylists have posted an update within 20 miles". Both sentences on
 * screen; one of them a lie (item 90).
 *
 * Browse was about to gain the same control from the same machinery, so the
 * rule moved here rather than being copied — along with the haversine, which
 * had one copy in the web and one in mobile and was on its way to three.
 *
 * ── THE SECOND HALF, WHICH IS EASY TO DROP ────────────────────────────────
 * Someone we cannot place is EXCLUDED by a radius, not included. Being unable
 * to prove a stylist is near is not proof that she is. Mobile has always been
 * right about this — "If we can't place a stylist, a radius can't include
 * them" (index.tsx:454) — and it was tried the other way round first, where a
 * chosen radius matched everybody and the chip filtered nothing.
 *
 * But exclusion has to be VISIBLE, which is what `unplaceable` is for. A list
 * shortened in silence and a list with nothing in it look identical, and only
 * one of them is worth widening the radius for.
 */

/** Miles. Same constant and formula as mobile/src/app/(app)/index.tsx:44. */
export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * The distances this website offers, everywhere it offers them.
 *
 * ⚠️ DELIBERATELY NOT THE SAME LIST AS MOBILE, which offers 1/2/4/10/20. That
 * list is for someone standing somewhere with GPS running; this one is for
 * someone who typed a postcode, where a one-mile radius is a false precision —
 * a postcode centroid can be most of a mile from the person using it.
 *
 * Two pages sharing one list matters more than either matching the app: a
 * model who filters to 10 miles on the dashboard and finds no 10 on browse
 * has been given two vocabularies for one idea.
 */
export const RADII = [
  { key: '5',   label: '5 miles',      miles: 5 as number | null },
  { key: '10',  label: '10 miles',     miles: 10 as number | null },
  { key: '20',  label: '20 miles',     miles: 20 as number | null },
  { key: 'any', label: 'Any distance', miles: null as number | null },
] as const

export type RadiusKey = typeof RADII[number]['key']

/** The default, for a member we CAN place. 20 miles is a county, not a street. */
export const DEFAULT_RADIUS = RADII[2]

/** Read a `within=` query parameter, falling back to the default. */
export function radiusFromParam(within: string | undefined) {
  return RADII.find(r => r.key === within) ?? DEFAULT_RADIUS
}

/** What a distance-filtered list came back as, and why it is the length it is. */
export interface Placed<T> {
  items: (T & { distanceMiles: number | null })[]
  /** False when the viewer has no coordinate, which disables filtering entirely. */
  viewerHasLocation: boolean
  /**
   * The radius ACTUALLY used, which is not always the one that was asked for:
   * null whenever the viewer cannot be placed, however the controls look.
   */
  radiusApplied: number | null
  /** How many were removed for being unplaceable. Say this out loud. */
  unplaceableHidden: number
}

/**
 * Attach a distance to each item, then apply the radius — but only if the
 * viewer has one of their own.
 *
 * Sorting is left to the caller. The two lists using this want different
 * answers: the updates feed is purely nearest-first, while browse puts a
 * stylist with open slots above a nearer one with none, because a stylist you
 * cannot book is not a result anyone wanted.
 */
export function withinRadius<T>(
  items: T[],
  viewer: { latitude: number | null; longitude: number | null } | null,
  coordsOf: (item: T) => { lat: number | null; lng: number | null },
  radiusMiles: number | null,
): Placed<T> {
  const hasLoc = viewer?.latitude != null && viewer?.longitude != null

  const placed = items.map(item => {
    const { lat, lng } = coordsOf(item)
    return {
      ...item,
      distanceMiles:
        hasLoc && lat != null && lng != null
          ? haversineMiles(viewer!.latitude!, viewer!.longitude!, lat, lng)
          : null,
    }
  })

  // THE RULE. Not "radiusMiles", which is what the control asked for.
  const radiusApplied = hasLoc ? radiusMiles : null

  const kept = radiusApplied == null
    ? placed
    : placed.filter(p => p.distanceMiles != null && p.distanceMiles <= radiusApplied)

  return {
    items: kept,
    viewerHasLocation: !!hasLoc,
    radiusApplied,
    unplaceableHidden: placed.length - kept.length,
  }
}

/**
 * Drop the coordinates before the result leaves the server.
 *
 * ⚠️ THIS IS A SAFETY BOUNDARY, NOT TIDINESS. public-web-views.sql refuses to
 * publish lat/lng with the reason spelled out — "publishing a lone worker's
 * coordinates is a safety exposure" — and being behind the auth gate does not
 * change what a coordinate is. A signed-in model does not need to know where a
 * stylist's shop is to the metre; she needs to know it is four miles away, and
 * `distanceMiles` is already that answer.
 *
 * So the coordinates are used to compute a distance and then discarded, here,
 * once, rather than at each call site where one could be forgotten.
 */
export function withoutCoords<T extends { lat: unknown; lng: unknown }>(
  item: T,
): Omit<T, 'lat' | 'lng'> {
  const copy = { ...item } as Record<string, unknown>
  delete copy.lat
  delete copy.lng
  return copy as Omit<T, 'lat' | 'lng'>
}

/** "3.4 miles" / "under a mile". Never more precision than a centroid earns. */
export function formatMiles(miles: number): string {
  if (miles < 1) return 'under a mile'
  return `${miles.toFixed(miles < 10 ? 1 : 0)} miles`
}
