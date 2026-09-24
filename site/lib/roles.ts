/**
 * What a `users.role` value means. Audit item 116.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THERE ARE THREE ROLES, AND THE WEB ONLY EVER CHECKED FOR TWO
 * ══════════════════════════════════════════════════════════════════════════
 * `users.role` can be `'model'`, `'provider'` or **`'both'`**. Mobile has
 * supported the third since it was written — `settings.tsx:599-601` derives
 * `isProvider`, `isModel` and `isBoth`, and offers a switcher between the two
 * dashboards.
 *
 * The web used `role === 'provider'` in two places that decide what a member
 * can REACH:
 *
 *   * `layout.tsx` — the nav. A 'both' account was shown Browse and Profile
 *     and **not** Shop, Availability or Portfolio, so every stylist tool
 *     existed, worked, and was linked from nowhere.
 *   * `dashboard/page.tsx` — which dashboard she gets.
 *
 * Latent rather than live: the role query on 24 Sep 2026 returned model 3,
 * provider 2, **no 'both' accounts**. Fixed anyway, because a predicate that
 * is wrong for a value the column permits is wrong now and harmless by luck.
 *
 * ── WHY THIS IS A FILE AND NOT TWO EDITS ──────────────────────────────────
 * The same slip is available everywhere `role` is read, and it reads as
 * correct — `role === 'provider'` looks like it means "is a stylist". Naming
 * the question once is what stops the fourth instance.
 */

export type Role = 'model' | 'provider' | 'both' | (string & {})

/** She has a shop. True for 'provider' AND 'both'. */
export function isStylist(role: Role | null | undefined): boolean {
  return role === 'provider' || role === 'both'
}

/** She books treatments. True for 'model' AND 'both'. */
export function isModel(role: Role | null | undefined): boolean {
  return role === 'model' || role === 'both'
}

/**
 * Both at once — the case that needs a choice rather than a branch.
 *
 * ⚠️ A DASHBOARD IS EITHER/OR AND A NAV IS NOT. That is the whole reason this
 * is not one predicate applied everywhere:
 *
 *   * the NAV can show both sets of links, and now does;
 *   * the DASHBOARD has to pick one, and picking "stylist" for a 'both'
 *     account would take away her applications, favourites and the updates
 *     feed to give her panels that are summaries of things she can already
 *     reach from the nav.
 *
 * So the dashboard keeps the model view, matching mobile, which routes a
 * 'both' account to the model screen too (`index.tsx:150`) and offers a
 * switcher in Settings. The web has no equivalent switcher and does not need
 * one while `/bookings` shows both roles' sessions — which is where a
 * stylist's applications actually live.
 */
export function isBoth(role: Role | null | undefined): boolean {
  return role === 'both'
}
