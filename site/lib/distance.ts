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
  // ⚠️ 15 ADDED 23 Nov 2026 for the stylist-side invite list, and it lands in
  // the SHARED list on purpose: a stylist filtering to 15 miles and a model
  // finding no 15 on Browse would be two vocabularies for one idea, which is
  // the reason this list is shared at all (see above).
  { key: '15',  label: '15 miles',     miles: 15 as number | null },
  { key: '20',  label: '20 miles',     miles: 20 as number | null },
  { key: 'any', label: 'Any distance', miles: null as number | null },
] as const

export type RadiusKey = typeof RADII[number]['key']

/**
 * The default on arrival: ANY DISTANCE.
 *
 * ── ⚠️ IT WAS 20 MILES, AND THE CHANGE IS ABOUT A FIRST IMPRESSION ──────
 * 20 miles is a county rather than a street, and that reasoning was sound when
 * there were enough shops for a county to contain some. Measured 26 Oct 2026:
 * THREE published shops — Welling, Woking, and one with no coordinates at all.
 * A located model in Southwark saw exactly ONE of them.
 *
 * An almost-empty Browse is a worse first impression than a national list, and
 * widening cannot bury anybody local: `browse.ts` sorts bookable-first then
 * nearest, so a nearby stylist with open slots still comes first.
 *
 * ⚠️ THIS IS A DENSITY DECISION, NOT A PERMANENT ONE. When there are enough
 * shops that a 20-mile view is full, the honest default moves back — and the
 * thing to watch is whether a member ever has to NARROW to find somebody near
 * her, which is the opposite complaint.
 *
 * ⚠️⚠️ THREE SURFACES READ THIS, NOT TWO. Browse and the model dashboard's
 * stylist-updates feed both call radiusFromParam, so the feed widens with
 * them. That is consistent — an empty feed is the same bad first impression —
 * but it is a third page changing, and it is not obvious from the name.
 * The Salon Floor has its own default (queries/salonFloor.ts) and is changed
 * alongside this rather than by it.
 */
// ⚠⚠ BY KEY, NOT BY INDEX. This read RADII[3] and meant "Any distance";
// inserting 15 above would silently have made it 20 miles, narrowing Browse and
// the model dashboard's updates feed for everybody, with nothing on screen to
// say why. A positional reference into a list other people add to is a bug
// waiting for the next addition.
export const DEFAULT_RADIUS = RADII.find(r => r.key === 'any') ?? RADII[RADII.length - 1]

/**
 * The default for the stylist-side invite list — 15 miles, not "any".
 *
 * ⚠️ IT IS A DIFFERENT DEFAULT FROM BROWSE BECAUSE IT IS A DIFFERENT
 * QUESTION. Browse widens because an almost-empty list is a bad first
 * impression for a model choosing a stylist. This list is a stylist deciding
 * who to invite to come to her premises, where "anywhere in the UK" is not a
 * useful starting point and the people at the top of a national list are not
 * the ones she can realistically see.
 *
 * MEASURED 23 Nov 2026, models within N miles of each of the 7 published
 * shops, out of 58 placed models:
 *
 *   Flowers Mobile   17 at 15mi, 26 at 20
 *   Mayera           14          22
 *   Nadia            28          30
 *   Nhi @ SKINDUSTRY 20          28
 *   Petra Pekarik     3          11
 *   SimpliciTee       0           0   (4 at 30)
 *   Taty Tint studio 28          30
 *
 * ⚠️ 20 IS STRICTLY BETTER FOR THE TWO WORST-OFF SHOPS and costs the others
 * nothing — Petra goes 3 to 11. 15 is here because it was the decision; the
 * numbers are here so the decision can be revisited against them rather than
 * inherited. SimpliciTee sees nobody at either, which is the argument for this
 * being a filter she can widen rather than a cap.
 */
export const DEFAULT_INVITE_RADIUS = RADII.find(r => r.key === '15') ?? DEFAULT_RADIUS

/** Read a `within=` parameter for the invite list, defaulting to 15 miles. */
export function inviteRadiusFromParam(within: string | undefined) {
  return RADII.find(r => r.key === within) ?? DEFAULT_INVITE_RADIUS
}

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
