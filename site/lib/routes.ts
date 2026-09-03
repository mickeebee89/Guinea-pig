/**
 * Route paths that more than one file needs to agree on.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 * `/sessions` was renamed to `/bookings` on 2 Sep 2026. Nothing outside this
 * app linked to it, so the rename itself was safe — but the path was written
 * out in five places, two of them `revalidatePath()` calls in server actions.
 *
 * Those two are the dangerous ones. Rename the route and miss a
 * `revalidatePath` and nothing breaks loudly: the page just serves stale data
 * after an accept or a decline, which looks like a caching quirk rather than a
 * missed rename. Two places holding the same path with nothing comparing them
 * is the same shape as `STRIPE_SECRET_KEY` beside `stripe_secret_key`, and as
 * `location` beside `location_text`.
 *
 * So the path is a constant and every call site imports it. The next rename is
 * one edit, and it cannot half-happen.
 *
 * ── THE ONE PLACE THAT CANNOT IMPORT THIS ─────────────────────────────────
 * `proxy.ts`'s `config.matcher` must be statically analysable at build time, so
 * it needs literal strings and cannot use these constants. That is covered by a
 * different mechanism: `scripts/check-route-coverage.mjs` fails the build if an
 * (app) route is not in the matcher, so a renamed directory is caught there
 * rather than silently losing its session-cookie refresh.
 */

/**
 * The bookings list.
 *
 * ── "BOOKING" IS THE USER-FACING WORD; `sessions` IS THE TABLE ────────────
 * These deliberately differ, and the boundary is the query layer
 * (`site/lib/queries/sessions.ts`). Above it: bookings. Below it: sessions.
 * Renaming the table would touch RLS policies, functions and triggers across
 * the whole product for no user-visible gain, and `CLAUDE.md` already records
 * "Bookings are `sessions` (not `bookings`)".
 *
 * The nav has always said "Bookings" while pointing at `/sessions`; the URL was
 * the only place the internal word leaked to users.
 *
 * ⚠️ MOBILE STILL USES `/(app)/sessions` AND SHOULD BE LEFT ALONE. That is an
 * Expo Router route inside the app binary, not a web URL — nothing links
 * between the two, and renaming it would be churn with a chance of breaking a
 * `router.push`. So mobile and web now use different words for the same screen,
 * on purpose. Do not "fix" the app to match.
 */
export const BOOKINGS_PATH = '/bookings'
