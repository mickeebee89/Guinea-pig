/**
 * /api/version — which commit is this deployment serving?
 *
 * Audit item 75. The whole point is that a deploy can fail, or never run at
 * all, and the site just goes on serving the previous build. Nothing about a
 * stale site looks wrong: the pages work, they are simply old. On 22 Sep 2026
 * that lasted nine hours, and before that a stale build served for five weeks
 * (audit item 45).
 *
 * So the deployment states its own commit, and .github/workflows/live-drift.yml
 * compares it with `main` every hour.
 *
 * ── WHAT IT EXPOSES ───────────────────────────────────────────────────────
 * A commit SHA and a branch name, from a PUBLIC repository. Nothing about the
 * database, the environment or a person. Deliberately no build timestamp: the
 * honest one is not available at runtime, and a wrong one would be worse than
 * none.
 *
 * `VERCEL_GIT_COMMIT_SHA` is set by Vercel. Locally it is absent, which is
 * why the answer says 'local' rather than pretending.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json(
    {
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? 'local',
      mode: process.env.PUBLIC_SITE_MODE ?? 'unknown',
    },
    // Never cached: a cached answer would report the previous deployment and
    // this exists to catch exactly that.
    { headers: { 'cache-control': 'no-store' } },
  )
}
