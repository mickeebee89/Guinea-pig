/**
 * What to do when a public-site query fails. Audit item 131.
 *
 * ── THE RULE, IN ONE LINE ───────────────────────────────────────────────
 * Degrade at runtime. Fail at build.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────
 * The reason to swallow a failed query and render an empty state is to protect
 * a live visitor: a missing view or an RLS refusal should not turn somebody's
 * page into a stack trace. That reason is real and it stays.
 *
 * During a build there is no visitor. The failure is not absorbed, it is
 * BAKED IN — `next build` prerenders the page and ships static HTML asserting
 * that nobody is offering hair on Cavy. The page is then wrong for everyone,
 * for as long as the deploy lasts, and it looks exactly like a correct page
 * about an empty database.
 *
 * That happened. 0060 revoked EXECUTE on `bio_publish_problem` from `anon`
 * while `public_stylists` filtered on it, so every public read died on
 * `permission denied for function bio_publish_problem`. All six treatment
 * pages said "No one is offering <treatment> on Cavy yet" for four days while
 * a stylist qualified. `npm run verify` exited 0 throughout — it printed the
 * error eighteen times on its way to passing.
 *
 * ── WHY NOT GREP THE BUILD LOG ──────────────────────────────────────────
 * Because that matches a SENTENCE, not a CONDITION. The wording is ours and
 * will drift, Next interleaves worker output, and it would become a
 * hand-maintained list of message shapes — the "check correct for the cases
 * present when it was written" pattern this codebase already has four
 * instances of. The error object is right here; use it.
 *
 * ── EVERY ERROR, NOT A CLASSIFIED SUBSET. Decided 30 Sep 2026. ──────────
 * The narrower option was to fail only on `permission denied` and
 * `does not exist` and keep degrading on network trouble. Rejected: it is a
 * hand-written list of cases, which is the shape that has now bitten twice.
 *
 * ⚠️ THE COST IS REAL AND WAS ACCEPTED. A transient Supabase blip during a
 * build now fails the deploy, and a build with no database credentials no
 * longer succeeds. Both are safe failures — the previous deploy stays live and
 * it is one retry — and both are louder than shipping a page that says the
 * product is empty.
 */

/**
 * Thrown only during a build. A distinct class so a `catch` that exists to
 * absorb NETWORK errors does not also absorb this one and turn a deliberate
 * build failure back into an empty list — which is the exact bug, one level up.
 */
export class BuildQueryError extends Error {
  constructor(label: string, detail: string) {
    super(
      `[${label}] query failed during the build: ${detail}\n` +
      `  Refusing to prerender a page that would assert this data is empty (item 131).\n` +
      `  At runtime this same failure degrades to an empty state on purpose; at build\n` +
      `  time there is no visitor to protect and the wrong answer would be shipped.`,
    )
    this.name = 'BuildQueryError'
  }
}

/**
 * `next build` sets NEXT_PHASE. Both phases are treated the same: either way
 * the output is written to disk rather than sent to somebody waiting for it.
 */
const isBuild = () =>
  process.env.NEXT_PHASE === 'phase-production-build' ||
  process.env.NEXT_PHASE === 'phase-export'

/**
 * Call this from EVERY place that catches a failed public query and carries on.
 *
 * It either throws (build) or warns (runtime), so the call sites keep their
 * existing shape — `onQueryFailure(...); return []` reads the same as the
 * `console.warn(...); return []` it replaces.
 *
 * ⚠️ ONE HELPER, CALLED FROM ALL THREE SITES, and that is the point. The
 * pattern used to be written out twice: once as `safeList` in lib/stylists.ts
 * with a long comment explaining the risk, and once inline in
 * components/FeaturedStylists.tsx with a shorter comment explaining the same
 * risk. Two copies of a rule is two places to fix it and one place to forget.
 */
export function onQueryFailure(label: string, detail: string): void {
  if (isBuild()) throw new BuildQueryError(label, detail)
  console.warn(`[${label}] query failed, degrading:`, detail)
}
