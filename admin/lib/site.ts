/**
 * Where the public site lives, for links out of the console.
 *
 * ── ⚠️ HARDCODED, AND THAT IS THE SAFER OF THE TWO OPTIONS ────────────────
 * The obvious alternative is `process.env.NEXT_PUBLIC_SITE_ORIGIN`. It would
 * be unset on Vercel until somebody remembered, and an unset origin produces
 * links to nowhere that still LOOK like links — the exact failure these links
 * are supposed to avoid. There is one public site and its address has not
 * changed since the brand did; a constant that is wrong is a one-line fix in
 * a named place, which an unset variable is not.
 *
 * ⚠️ NOTE THE DOMAIN. The repo, the folder and the `guineapigapp.co.uk` domain
 * all keep the old name on purpose, but the live site is `cavybeauty.com` —
 * CLAUDE.md, and the legal documents point there. Do not "correct" this to
 * match the repo name.
 */
export const SITE_ORIGIN = 'https://cavybeauty.com'

/**
 * ⚠️ THE TWO PROFILE ROUTES TAKE DIFFERENT KINDS OF ID, AND ALWAYS WILL.
 *
 *   /model/[id]    an AUTH USER ID   (public.users.id)
 *   /stylist/[id]  a PROVIDERS ROW ID (public.providers.id)
 *
 * A model has no provider row, so there is no single id that addresses both.
 * `site/app/(app)/model/[id]/page.tsx` and `.../stylist/[id]/page.tsx` both say
 * so in their own headers, and `site/lib/report.ts` takes a TAGGED subject
 * rather than a bare string for the same reason.
 *
 * ⚠️ Passing a user id to the stylist route does not 404 cleanly — it looks up
 * a providers row by that id, finds nothing, and renders the not-found page.
 * Indistinguishable from a deleted shop. Hence two functions, not one with a
 * flag.
 */
export const modelProfileUrl = (userId: string) => `${SITE_ORIGIN}/model/${userId}`
export const stylistProfileUrl = (providerId: string) => `${SITE_ORIGIN}/stylist/${providerId}`
