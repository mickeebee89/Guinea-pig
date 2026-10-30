/**
 * Where a signup came from — the vocabulary, shared by the browser half that
 * captures it and the server half that stores it.
 *
 * No DOM and no React in here on purpose: `components/CampaignCapture.tsx`
 * needs it in the browser and `(auth)/sign-up/actions.ts` needs it on the
 * server, and a value sanitised by two different functions is a value with two
 * different definitions.
 *
 * ── ⚠️⚠️ WHAT WAS ACTUALLY BROKEN, WHICH IS NARROWER THAN "NOTHING FEEDS IT" ─
 *
 * The hidden `source` field is NOT inert. `(auth)/sign-up/page.tsx` reads
 * `?ref=` from the URL and renders it into that field, and two accounts carry a
 * `signup_source` in their auth metadata because of it — `flowersamaral` on
 * 21 Oct and `facebook` on 23 Oct (read from `auth.users`, 30 Oct 2026). A
 * search for the key `source` finds nothing in all 60 accounts because the key
 * is spelled `signup_source`; `buildSignupMetadata` renames it on the way in.
 *
 * Two real gaps, and they are different sizes:
 *
 *   1. ONLY `?ref=` IS READ. utm_source / utm_medium / utm_campaign / fbclid
 *      are ignored, and those are what an ad platform actually appends.
 *   2. ⚠️ IT ONLY SURVIVES A LANDING STRAIGHT ON /sign-up. A visitor who
 *      arrives on the home page carrying parameters and then walks to the form
 *      loses them at the first click: the next page's URL has no query string
 *      and nothing remembered the first one. That is the gap the capture
 *      closes, and it is the NORMAL path from an advert — an ad links to a page
 *      that sells the thing, not to a signup form.
 *
 * ── ⚠️⚠️⚠️ WHY A CAMPAIGN IS NOT A `ref`, AND WHY THEY MUST NOT SHARE A FIELD ─
 *
 * `handle_new_auth_user` (read live, 30 Oct 2026) does this:
 *
 *     if v_role = 'provider' and v_source is not null then
 *        … grant Founding Provider, claim a slot …
 *
 * So `signup_source` is not a label. It is the TRIGGER for a fee waiver:
 * `provider_fee_settled()` (migration 0045) treats `is_founding_provider` as
 * one of the three ways the stylist fee counts as settled. The cap reads 200
 * and one slot has gone, so 199 are open.
 *
 * ⚠️ WHICH MEANS: pour ad traffic into `signup_source` and every stylist who
 * clicks the advert silently becomes a Founding Provider. Nobody asked for
 * that, a later decision about pricing cannot take it back, and it would have
 * arrived as a side effect of a REPORTING change — the worst way to find out.
 *
 * So the two travel separately, the whole way down:
 *
 *   ref        → `source` field   → `signup_source`   → founding grant, as now
 *   utm/fbclid → `campaign` field → `signup_campaign` → a label, and nothing else
 *
 * A cohort link still means "a course leader sent her", which is what the
 * founding grant is for. An advert means "she clicked an advert", which earns
 * attribution and no benefit. Merging them is a one-line change in
 * `SignUpForm`'s hidden fields if that is ever the decision — but it should be
 * a decision, not a consequence.
 */

/**
 * The parameters worth keeping, in the order they are joined.
 */
export const CAMPAIGN_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign'] as const

/** The referral parameter, which is its own mechanism — see the header. */
export const REF_PARAM = 'ref'

/**
 * ⚠️⚠️ PRESENCE ONLY. THE VALUE IS NEVER KEPT.
 *
 * `fbclid` is a per-click identifier. Its only real use is handing a conversion
 * back to Meta so it can be joined to the person who clicked — the one thing
 * the Privacy policy rules out in four separate places, and which this site has
 * no code to do. Storing it against a named account would be collecting an
 * advertising identifier for a purpose we have told people we do not have.
 *
 * What IS useful is the fact: she came from a Facebook or Instagram link. So a
 * bare `fbclid` with no `utm_source` records the literal source `fbclid`, and
 * the identifier itself is dropped in the browser and never travels.
 */
export const CLICK_ID_PARAMS = ['fbclid', 'gclid'] as const

/**
 * Per-visit, per-tab. The key carries a version so a change of shape cannot be
 * read back as the old one.
 */
export const CAMPAIGN_STORAGE_KEY = 'cavy.arrival.v1'

/** Each part of the triple. 40 is generous for "meta" or "launch-oct". */
export const PART_MAX = 40

/** The whole joined value. The same cap `buildSignupMetadata` already puts on
 *  `signup_source`, so neither field can be the long one. */
export const CAMPAIGN_MAX = 120

/**
 * ⚠️⚠️ THE SEPARATOR IS SAFE ONLY BECAUSE THE PARTS CANNOT CONTAIN IT.
 *
 * `cleanPart` strips everything but `[a-z0-9_-]`, so a colon can never appear
 * inside a part, so `source:medium:campaign` is unambiguous and
 * `split_part(signup_campaign, ':', 1)` is a correct query rather than a
 * hopeful one. Sanitising AFTER joining would have let a crafted
 * `utm_source=a:b` invent a medium.
 */
export const CAMPAIGN_SEP = ':'

/**
 * One part of the value, made safe.
 *
 * ⚠️ THIS IS AN ALLOW-LIST, NOT AN ESCAPE. Everything outside `[a-z0-9_-]` is
 * REMOVED rather than encoded, because this string ends up in auth metadata, in
 * a database column and on an admin screen, and the only version of it that is
 * safe in all three is one that cannot contain anything else. Lower-cased so
 * `Meta`, `meta` and `META` are one row in a count rather than three.
 */
export function cleanPart(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, PART_MAX)
}

/**
 * The campaign triple, or '' when there is nothing to record.
 *
 * ⚠️⚠️ '' MEANS "NOTHING ARRIVED", AND IT IS NEVER TURNED INTO 'direct'.
 * "We do not know where she came from" and "she typed the address in" are
 * different facts, and a default would invent the second. The caller stores
 * null, so a count of null rows is honest about being a count of rows we know
 * nothing about.
 *
 * Trailing empty parts are dropped, so a lone `utm_source=meta` stores as
 * `meta` rather than `meta::`. An EMPTY MIDDLE is kept — `meta::launch` says
 * the medium was absent, which is true, and is not the same as not knowing.
 */
export function buildCampaign(get: (key: string) => string | null): string {
  const parts: string[] = CAMPAIGN_PARAMS.map((p) => cleanPart(get(p)))

  // A click id with no utm_source still names the platform. Presence only — the
  // identifier is not read, let alone kept. See CLICK_ID_PARAMS.
  if (!parts[0]) {
    const clicked = CLICK_ID_PARAMS.find((p) => (get(p) ?? '').trim() !== '')
    if (clicked) parts[0] = clicked
  }

  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  if (parts.length === 0) return ''
  return parts.join(CAMPAIGN_SEP).slice(0, CAMPAIGN_MAX)
}

/**
 * Re-clean a value that has been through a browser, a sessionStorage round trip
 * and a form post.
 *
 * ⚠️⚠️ THE SERVER DOES NOT TRUST THE BROWSER'S SANITISING, AND NOT AS A
 * FORMALITY. A hidden input is whatever was posted: anyone can POST this action
 * with `campaign` set to a megabyte of anything. The browser-side clean exists
 * so the value is RIGHT; this one exists so the value is SAFE. The parts are
 * re-split and re-cleaned individually, so the separator rule above survives a
 * value that never went through `buildCampaign` at all.
 */
export function cleanCampaign(raw: string | null | undefined): string | null {
  if (!raw) return null
  const parts = raw
    .slice(0, CAMPAIGN_MAX * 2)
    .split(CAMPAIGN_SEP)
    .slice(0, CAMPAIGN_PARAMS.length)
    .map(cleanPart)
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  if (parts.length === 0) return null
  return parts.join(CAMPAIGN_SEP).slice(0, CAMPAIGN_MAX) || null
}

/** What the capture keeps for the length of a visit. */
export interface CapturedArrival {
  /** The `?ref=` cohort code, if one arrived. Feeds `source`. */
  ref: string
  /** The campaign triple, if one arrived. Feeds `campaign`. */
  campaign: string
}

/**
 * Read both out of a query string. Pure, so the same function serves the
 * browser, the server and a test.
 */
export function readArrival(search: string): CapturedArrival {
  const q = new URLSearchParams(search)
  return {
    ref: cleanPart(q.get(REF_PARAM)),
    campaign: buildCampaign((k) => q.get(k)),
  }
}

/** True when there is something worth remembering. */
export const hasArrival = (a: CapturedArrival) => a.ref !== '' || a.campaign !== ''
