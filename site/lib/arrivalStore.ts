/**
 * Keeping an arrival for the length of one visit — the storage half.
 *
 * `lib/attribution.ts` decides WHAT the value is. This file decides WHERE it
 * sits between the landing page and the signup form, and it is the only place
 * in `site/` that touches browser storage.
 *
 * ── ⚠️⚠️ WHY sessionStorage, AND WHY NOT A COOKIE ───────────────────────────
 *
 * 1. ⚠️⚠️ A COOKIE WOULD BE READ ON THE SERVER, AND THAT SILENTLY KILLS THE
 *    SEO OF EVERY PUBLIC PAGE. `app/(public)/layout.tsx` says it in writing:
 *    *"Nothing here reads cookies, so (public) stays statically rendered — the
 *    whole point of the split."* Reading a cookie makes a route dynamic, and a
 *    route that stops being prerendered does not break — it renders correctly
 *    and loses its ranking, with nothing on screen to say so. There is a build
 *    check (`scripts/check-client-boundary.mjs`) precisely because that failure
 *    is invisible. A campaign tag is not worth spending the static build on,
 *    and it does not need to: this value is only ever read by the browser that
 *    wrote it, one page later.
 *
 * 2. PER-VISIT BY CONSTRUCTION, NOT BY A `max-age` WE PROMISE TO HONOUR.
 *    sessionStorage dies with the tab. A cookie's lifetime is a number in a
 *    header somebody has to keep correct; this cannot outlive the visit even if
 *    the next person to touch the code wants it to.
 *
 * 3. IT NEVER LEAVES THE BROWSER ON ITS OWN. A cookie is attached to every
 *    subsequent request — every page, image and API route — whether anything
 *    wants it or not. This value makes exactly one journey: into a hidden field
 *    on a form somebody chose to submit.
 *
 * ── ⚠️ THE HONEST POSITION ON PECR, RATHER THAN THE CONVENIENT ONE ──────────
 *
 * PECR regulation 6 covers storing information on someone's device, and the ICO
 * applies it to localStorage and sessionStorage as well as cookies — "it is not
 * a cookie" is NOT an exemption. The exemption is for storage strictly
 * necessary to provide the service asked for, and remembering which advert
 * somebody clicked is not strictly necessary.
 *
 * So the accurate statement is: this is the lowest-risk end of a rule that
 * arguably applies, not something the rule misses. What makes it defensible is
 * that everything the rule aims at is absent — no third party receives it, no
 * identifier is stored, it cannot follow anyone to another site or another
 * visit, and it cannot be joined to anything until a form is filled in. What
 * makes it HONEST is that the Privacy policy now says it happens (section 11).
 * If the view is ever taken that a consent banner is needed, the banner is the
 * change — not this file.
 *
 * ── ⚠️⚠️ WHY THIS IS A STORE WITH SUBSCRIBERS AND NOT TWO sessionStorage CALLS ─
 *
 * The obvious shape — CampaignCapture writes in an effect, SignUpForm reads in
 * an effect — IS BROKEN, and the way it breaks is the case that matters most:
 * somebody landing straight on `/sign-up?utm_source=…`.
 *
 * React runs effects CHILD FIRST. CampaignCapture is mounted by the root
 * layout; SignUpForm is several levels below it. So the form's read fires
 * BEFORE the capture's write, reads an empty store, and the campaign on the URL
 * is lost — on exactly the link an advert is most likely to point at.
 *
 * A store fixes it at the cause rather than by ordering effects by hand: the
 * form subscribes, the capture writes, the write notifies, the form re-renders
 * with the value. Nothing depends on which effect runs first.
 *
 * ⚠️ AND THE SNAPSHOT IS A STRING, NOT AN OBJECT, FOR A HARD REASON.
 * `useSyncExternalStore` compares snapshots by identity and throws *"The result
 * of getSnapshot should be cached"* into an infinite render loop if a fresh
 * object comes back each call. A string compares by value, so the raw stored
 * JSON is the snapshot and the caller parses it.
 *
 * ── ⚠️ EVERY READ AND WRITE IS WRAPPED, BECAUSE THE ACCESSOR ITSELF THROWS ──
 *
 * `window.sessionStorage` is not merely empty when storage is blocked — in a
 * locked-down browser, reading the PROPERTY raises SecurityError. An unguarded
 * read in a render path is a blank signup page for the person whose browser is
 * set that way. Attribution must never be able to do that, so everything here
 * swallows and attribution is simply absent.
 */

import {
  CAMPAIGN_STORAGE_KEY,
  cleanCampaign,
  cleanPart,
  hasArrival,
  type CapturedArrival,
} from './attribution'

export const EMPTY_ARRIVAL: CapturedArrival = { ref: '', campaign: '' }

/** '' means "nothing stored". Cached because the snapshot must be stable. */
let cached: string | null = null
const listeners = new Set<() => void>()

function readRaw(): string {
  try {
    return window.sessionStorage.getItem(CAMPAIGN_STORAGE_KEY) ?? ''
  } catch {
    // Private window, blocked site data, or a browser that throws on the
    // property itself. Attribution is what fails here, and it fails to nothing.
    return ''
  }
}

/**
 * ⚠️ FIRST TOUCH WINS, WITHIN THE VISIT. The parameters that brought somebody
 * here are the ones on the page they arrived at. If they later reach a URL
 * carrying different ones — a second advert in another tab's link, a shared
 * link with a stale campaign on it — overwriting would re-attribute a visit
 * that was already earned. Returns true when it actually stored something, so
 * a caller can report nothing rather than assume.
 */
export function storeArrival(next: CapturedArrival): boolean {
  if (!hasArrival(next)) return false
  if (arrivalSnapshot() !== '') return false

  const raw = JSON.stringify(next)
  try {
    window.sessionStorage.setItem(CAMPAIGN_STORAGE_KEY, raw)
  } catch {
    // ⚠️ THE IN-MEMORY COPY IS KEPT ANYWAY, AND IT IS NOT A CONSOLATION PRIZE.
    // With storage blocked, attribution degrades to "works if they sign up
    // during this page load" instead of "never works" — and landing straight on
    // /sign-up is a single page load, so the advert case still records.
  }
  cached = raw
  for (const notify of listeners) notify()
  return true
}

/** For useSyncExternalStore. The value cannot change except through
 *  storeArrival, which notifies; nothing else in the app writes this key. */
export function subscribeArrival(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => { listeners.delete(onChange) }
}

/** The raw stored JSON, or ''. A string, so it is identity-stable — see the
 *  header. Read from sessionStorage once per page load, then cached. */
export function arrivalSnapshot(): string {
  if (cached === null) cached = readRaw()
  return cached
}

/** ⚠️ ALWAYS EMPTY. There is no server-side knowledge of this value, and
 *  claiming one would be a hydration mismatch on every signup page. */
export function arrivalServerSnapshot(): string {
  return ''
}

/**
 * Turn a snapshot back into the two values, re-cleaned.
 *
 * ⚠️ RE-CLEANED BECAUSE sessionStorage IS WRITABLE BY ANYONE WITH A CONSOLE,
 * and because a stored value from an older build is exactly the sort of thing
 * still sitting there after a deploy. The versioned key stops a DIFFERENT shape
 * being read; this stops a corrupted one of the right shape.
 */
export function parseArrival(raw: string): CapturedArrival {
  if (!raw) return EMPTY_ARRIVAL
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_ARRIVAL
    const o = parsed as Record<string, unknown>
    return {
      ref: cleanPart(typeof o.ref === 'string' ? o.ref : ''),
      campaign: cleanCampaign(typeof o.campaign === 'string' ? o.campaign : '') ?? '',
    }
  } catch {
    return EMPTY_ARRIVAL
  }
}
