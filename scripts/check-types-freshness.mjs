/**
 * check-types-freshness — are the generated types older than the migrations?
 * Audit item 84.
 *
 *   node scripts/check-types-freshness.mjs
 *
 * ── THE ONE STALENESS CHECK POSSIBLE WITHOUT THE DATABASE ───────────────
 * The honest check would be "do these types match what is running", and that
 * needs a connection CI does not have: its Supabase variables are
 * `sb_publishable_…` keys (audit item 38), which cannot read pg_proc.
 *
 * So this asks the question that CAN be answered from the repo alone:
 * **were the types generated before the newest migration?** If a migration has
 * landed since, they describe an older schema, and that is the common failure
 * — not someone editing the database by hand.
 *
 * ⚠️ WHAT A PASS DOES NOT MEAN. It does not mean the types are correct. They
 * are stamped when GENERATED, not when applied, so a types file made against a
 * migration that was written but never run would pass this and still be wrong.
 * 0009 is the standing example of exactly that gap (item 83). This narrows the
 * window; it does not close it.
 *
 * Wired into site/'s `npm run checks` on 23 Sep 2026, once the five calls it
 * flagged had been triaged and fixed (item 84b). It runs from `site/`, so
 * every path here is resolved against this file's own location.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ⚠️ RESOLVED FROM THIS FILE, NOT FROM THE CURRENT DIRECTORY. Wired into
// `npm run checks` on 23 Sep 2026, which runs with the cwd set to `site/` —
// and every path below is a repo-root path. A cwd-relative version would have
// thrown ENOENT in `checks` and passed when run by hand from the root, which
// is the most confusing way for a check to be wrong.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const at = p => join(ROOT, p)

const TYPES = [
  'site/lib/database.types.ts',
  'mobile/src/lib/database.types.ts',
  'admin/lib/database.types.ts',
]

const newest = readdirSync(at('supabase/migrations'))
  .map(f => /^(\d{4})_/.exec(f)?.[1])
  .filter(Boolean)
  .sort()
  .pop() ?? '0000'

let failed = false
const missing = []

for (const path of TYPES) {
  if (!existsSync(at(path))) { missing.push(path); continue }

  const stamp = /TYPES_STAMP:\s*(\d{4})/.exec(readFileSync(at(path), 'utf8'))?.[1]
  if (!stamp) {
    console.error(`${path}: no TYPES_STAMP. It was not written by gen-supabase-types.mjs — regenerate it.`)
    failed = true
    continue
  }
  if (stamp < newest) {
    console.error(
      `${path}: generated against migration ${stamp}, but ${newest} exists. ` +
      `These types describe an older schema.`,
    )
    failed = true
  }
}

if (missing.length === TYPES.length) {
  // Not an error: item 84 has not been turned on. Said out loud rather than
  // passing silently, because a check that quietly does nothing is worse than
  // no check — this repo has three of those in its own record.
  console.log('types check — not generated yet, so nothing was checked (audit item 84)')
  process.exit(0)
}

if (missing.length > 0) {
  console.error(`Some copies are missing and some are not: ${missing.join(', ')}`)
  console.error('One generation writes all three. Run: node scripts/gen-supabase-types.mjs')
  failed = true
}

if (failed) {
  console.error('\nRegenerate with: node scripts/gen-supabase-types.mjs')
  process.exit(1)
}

console.log(`types check — generated against migration ${newest}, which is the newest on disk ` +
  `(does NOT prove they match the live database, and never checks RLS)`)
