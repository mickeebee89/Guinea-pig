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
 * ── WHY THE QUERY STRING IS STRIPPED ─────────────────────────────────────
 * A page view carries its full URL. Here that would include what members type:
 * /browse?place=<a town> is where someone is looking for a stylist. The Privacy
 * policy says the analytics doesn't identify individuals, and a stream of
 * searched places is a step towards exactly that. The path alone answers the
 * only question this is for: which pages are visited.
 *
 * The auth links that carry one-time tokens (/auth/confirm, /auth/reset) are
 * route handlers, not pages, so they never render this at all. The strip
 * covers them anyway if that ever changes.
 *
 * A client component because beforeSend is a function, and a server component
 * cannot pass one down.
 */
export function SiteAnalytics() {
  return (
    <Analytics
      beforeSend={(event) => ({ ...event, url: event.url.split('?')[0].split('#')[0] })}
    />
  )
}
