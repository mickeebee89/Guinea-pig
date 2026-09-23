import 'server-only'

/**
 * Turning a postcode into a coordinate. Audit item 90.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  SERVER ONLY, AND `server-only` IS IMPORTED TO MAKE THAT A BUILD ERROR
 * ══════════════════════════════════════════════════════════════════════════
 * Privacy §11 says, of this website: "Our fonts are served from this site
 * rather than a third party, so loading a page doesn't share your IP address
 * with anyone else." Calling postcodes.io from the browser would send the
 * member's IP address to a third party and make that sentence false.
 *
 * From here, our server's address goes and hers does not. The import above is
 * the enforcement: if anyone ever pulls this into a Client Component, the
 * build fails rather than the claim quietly becoming untrue.
 *
 * This is also the FIRST outbound call to a third party anywhere in site/.
 * There were none before. Adding a second deserves the same paragraph.
 *
 * ── WHY postcodes.io ──────────────────────────────────────────────────────
 * ONS open data, no API key, no account, no billing, UK-only — which matches
 * `users.region = 'UK'`. The deciding factor is the licence: we KEEP the
 * coordinate, and Google's Geocoding terms forbid storing results outside a
 * Google map. Mapbox and OS Places both need keys and billing.
 *
 * ── WHY A TYPO MATTERS MORE THAN AN OUTAGE ────────────────────────────────
 * An outage is loud: she is told, nothing is saved, she tries later. A typo
 * is silent — "BR1 2AD" for "BR1 2AB" is a real postcode a mile away, and a
 * stylist placed a mile from her salon has no way to discover it. That is why
 * the postcode is stored and read back to her on the page: she is the only
 * check on the lookup being right, so she has to be able to see what it used.
 */

/** Canonical form, as postcodes.io returns it: upper case, one space. */
export interface PostcodePlace {
  postcode: string
  latitude: number
  longitude: number
}

export type PostcodeLookup =
  | { ok: true; place: PostcodePlace }
  /** Not postcode-shaped. Never sent anywhere. */
  | { ok: false; reason: 'malformed' }
  /** Well formed, and no such postcode. */
  | { ok: false; reason: 'not_found' }
  /** A real postcode that ONS holds no coordinate for. Rare, and real. */
  | { ok: false; reason: 'not_located' }
  /** The lookup itself failed. NOT her fault, and must never be worded as if. */
  | { ok: false; reason: 'unavailable' }

/**
 * Deliberately loose. It catches "hello" and a half-typed postcode without
 * trying to re-decide what postcodes.io already knows — a strict UK regex
 * eventually refuses something real (GIR 0AA, the Anguilla and overseas
 * formats, new districts), and refusing a valid postcode is worse than making
 * one extra request.
 */
const SHAPE = /^[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}$/i

/** "br1  2ab" → "BR1 2AB". The one space is part of the canonical form. */
function canonicalise(raw: string): string | null {
  const squashed = raw.replace(/\s+/g, '').toUpperCase()
  if (squashed.length < 5 || squashed.length > 7) return null
  return `${squashed.slice(0, -3)} ${squashed.slice(-3)}`
}

/** Long enough for a slow network, short enough not to hang a form submit. */
const TIMEOUT_MS = 4000

export async function lookupPostcode(raw: string): Promise<PostcodeLookup> {
  const trimmed = raw.trim()
  if (!SHAPE.test(trimmed)) return { ok: false, reason: 'malformed' }

  const canonical = canonicalise(trimmed)
  if (!canonical) return { ok: false, reason: 'malformed' }

  let res: Response
  try {
    res = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(canonical)}`,
      {
        // Coordinates for a postcode do not change between requests, but
        // Next would otherwise cache this into the page's own revalidation.
        // An explicit no-store keeps a member's postcode out of a shared
        // fetch cache entirely.
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json' },
      },
    )
  } catch (e) {
    // Timeout, DNS, connection refused. Distinguished from 404 on purpose.
    console.error('[postcode] lookup failed to complete', e)
    return { ok: false, reason: 'unavailable' }
  }

  if (res.status === 404) return { ok: false, reason: 'not_found' }
  if (!res.ok) {
    console.error('[postcode] lookup returned', res.status)
    return { ok: false, reason: 'unavailable' }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    console.error('[postcode] lookup returned unparseable JSON')
    return { ok: false, reason: 'unavailable' }
  }

  const result = (body as { result?: unknown } | null)?.result
  if (!result || typeof result !== 'object') return { ok: false, reason: 'not_found' }

  const r = result as { postcode?: unknown; latitude?: unknown; longitude?: unknown }
  // ⚠️ A 200 does not guarantee a coordinate. ONS holds some real postcodes
  // with no location — non-geographic ones, and new builds not yet placed.
  // Storing a postcode with no coordinate would put someone back in exactly
  // the state this whole change exists to end, so it is refused instead.
  if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') {
    return { ok: false, reason: 'not_located' }
  }

  return {
    ok: true,
    place: {
      // The service's own spelling, not hers, so what is stored and what is
      // read back cannot drift apart over spacing or case.
      postcode: typeof r.postcode === 'string' ? r.postcode : canonical,
      latitude: r.latitude,
      longitude: r.longitude,
    },
  }
}

/**
 * What she is told, per outcome.
 *
 * ⚠️ 'unavailable' IS THE ONE THAT MATTERS. A service outage must never read
 * as "your postcode is wrong" — she would retype a correct postcode until she
 * concluded the site was broken. It says nothing changed, because nothing did.
 *
 * Same distinction the consent re-read had to make this morning between
 * "the terms moved" and "we could not read the terms": one is about her, the
 * other is about us, and they cannot share a sentence.
 */
export function postcodeMessage(reason: 'malformed' | 'not_found' | 'not_located' | 'unavailable'): string {
  switch (reason) {
    case 'malformed':
      return 'That doesn’t look like a UK postcode. It should look like BR1 2AB.'
    case 'not_found':
      return 'We couldn’t find that postcode. Check it and try again.'
    case 'not_located':
      return 'That postcode exists, but we don’t have a location for it. Try the postcode of a nearby street.'
    case 'unavailable':
      return 'We couldn’t check that postcode just now, so nothing has changed. Please try again in a moment.'
  }
}
