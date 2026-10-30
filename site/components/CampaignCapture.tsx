'use client'

import { useEffect } from 'react'
import { readArrival } from '@/lib/attribution'
import { storeArrival } from '@/lib/arrivalStore'

/**
 * Keeps the campaign parameters a visitor arrived with, so they survive the
 * walk from the landing page to /sign-up. Renders nothing.
 *
 * ── ⚠️ WHY THE ROOT LAYOUT AND NOT (public) ────────────────────────────────
 * An advert can land anywhere — the home page, a treatment page, /for-models,
 * or straight on /sign-up — and /sign-up is in (auth), not (public). Mounting
 * this once in the root layout is the only placement that covers every door
 * into the site. It sits next to SiteAnalytics, which is there for the same
 * reason.
 *
 * It mounts in the member area too, where there is nothing to capture. That is
 * deliberate rather than tolerated: an `if` on the pathname would be a second
 * list of routes to keep in step with the first, and a signed-in member's URL
 * carries no utm parameters, so the effect reads an empty query string and
 * stores nothing.
 *
 * ── ⚠️⚠️ WHY NOT useSearchParams(), WHICH IS THE OBVIOUS CHOICE ────────────
 * `useSearchParams()` would also catch a client-side navigation that adds
 * parameters. It would also opt every page that renders it out of static
 * prerendering unless each one wraps it in Suspense — which is the exact
 * silent SEO loss that `app/(public)/layout.tsx` and
 * `scripts/check-client-boundary.mjs` are built to prevent, arriving by a
 * different door.
 *
 * `window.location.search` inside an effect costs nothing: the effect runs only
 * in the browser, after hydration, and the server render is unaffected. What it
 * gives up is the case it cannot see — a client-side navigation to a URL that
 * carries parameters, without a full page load. An advert click is a full page
 * load from another origin, so the case that matters is covered, and the case
 * that is not covered cannot happen from an advert.
 *
 * ── ⚠️ ONE RUN PER PAGE LOAD, AND FIRST TOUCH WINS ─────────────────────────
 * The empty dependency array is not laziness. `storeArrival` refuses to
 * overwrite, so re-running would be harmless but pointless, and the only event
 * that can bring new parameters is a fresh page load — which remounts this
 * anyway.
 */
export function CampaignCapture() {
  useEffect(() => {
    const arrival = readArrival(window.location.search)
    storeArrival(arrival)
  }, [])

  return null
}
