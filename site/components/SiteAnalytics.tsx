'use client'

import { Analytics } from '@vercel/analytics/next'

/**
 * Vercel Web Analytics, counting page visits across the whole site (public and
 * member area). Rendered once, from the root layout.
 *
 * ── WHAT IT SENDS, AND WHERE ─────────────────────────────────────────────
 * In production the script is /_vercel/insights/script.js and it posts to
 * /_vercel/insights/*, both on this origin, so the CSP's 'self' already covers
 * them (next.config.ts). No cookies. It only writes localStorage if a user or
 * group id is set, and this site never sets one. Read from the served script on
 * 22 Sep 2026 (audit item 67).
 *
 * The page address it sends is the URL below, after beforeSend: the script
 * builds it from location.href, then hands it to beforeSend before anything
 * leaves the browser. It also sends the route pattern (`dp`), which the Next
 * component computes from the params and never carries an id. The referrer is
 * sent only when it comes from another site.
 *
 * ── NOTHING THAT IDENTIFIES A PERSON OR A BOOKING LEAVES IN THE ADDRESS ──
 * Two things are removed, because the Privacy policy says this doesn't
 * identify individuals:
 *
 *   1. The query string and fragment. /browse?place=<a town> is where someone
 *      is looking for a stylist.
 *   2. Ids in the PATH. Every member-area route with a dynamic segment is
 *      reported as its pattern, never its real address:
 *
 *        /messages/<booking id>  →  /messages/[sessionId]   app/(app)/messages/[sessionId]
 *        /model/<user id>        →  /model/[id]             app/(app)/model/[id]
 *        /stylist/<provider id>  →  /stylist/[id]           app/(app)/stylist/[id]
 *
 *      Those are all of them as of 22 Sep 2026. The one other dynamic route,
 *      /[treatment], is public with six fixed slugs and no id, so it is
 *      reported as it is: which treatment page is the useful part.
 *
 *      ⚠️ A NEW DYNAMIC MEMBER ROUTE IS NOT IN THIS LIST UNTIL SOMEONE ADDS IT.
 *      So there is a net under it: any path segment shaped like a UUID, which
 *      is what every id in this schema is, becomes [id] wherever it appears.
 *      Add the route here anyway: the net keeps the id out, but only the list
 *      gives it its real name.
 *
 * The auth links that carry one-time tokens (/auth/confirm, /auth/reset) are
 * route handlers, not pages, so they never render this at all.
 *
 * A client component because beforeSend is a function, and a server component
 * cannot pass one down.
 */

const ID_ROUTES: [RegExp, string][] = [
  [/^\/messages\/[^/]+/, '/messages/[sessionId]'],
  [/^\/model\/[^/]+/, '/model/[id]'],
  [/^\/stylist\/[^/]+/, '/stylist/[id]'],
]

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** The address as reported: origin and path only, ids replaced by their pattern. */
export function reportedUrl(raw: string): string {
  let origin = ''
  let path: string
  try {
    const u = new URL(raw)
    origin = u.origin
    path = u.pathname
  } catch {
    path = raw.split(/[?#]/)[0]
  }
  for (const [re, pattern] of ID_ROUTES) {
    if (re.test(path)) { path = path.replace(re, pattern); break }
  }
  return origin + path.replace(UUID, '[id]')
}

export function SiteAnalytics() {
  return <Analytics beforeSend={(event) => ({ ...event, url: reportedUrl(event.url) })} />
}
