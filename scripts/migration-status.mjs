/**
 * migration-status.mjs — what has actually been applied, versus what is committed.
 *
 *   node scripts/migration-status.mjs           # report
 *   node scripts/migration-status.mjs --stamp   # write checksums into new files
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY for the report (public.schema_migrations
 * is admin-read only). --stamp is offline and needs nothing.
 *
 * WHY THIS EXISTS
 *   "Did this run?" has to be answerable from recorded state, not from memory
 *   or a naming convention. The database records what it applied; this compares
 *   that against the files on disk and reports three things a convention cannot:
 *
 *     PENDING     — committed but never applied
 *     DRIFTED     — applied, but the file has changed since (checksum mismatch)
 *     ORPHAN      — applied, but no file explains it
 *     SUPERSEDED  — never applied, and a later migration replaced it first
 *
 *   SUPERSEDED IS VERIFIED, NOT ASSERTED. A file may carry
 *   `-- SUPERSEDED BY 0010` near the top, and the tool then checks that 0010
 *   ACTUALLY APPLIED before it stops nagging. Without that check the marker
 *   would be a way to silence a genuinely pending migration by pointing it at
 *   something that never ran either — a comment that turns a real problem into
 *   a clean report, which is the exact failure this whole tool exists to
 *   prevent.
 *
 *   DRIFTED is the one that matters. It is the failure mode where the repo
 *   looks authoritative and is wrong — which is how supabase/ came to document
 *   about a third of the live schema while reading like a complete record.
 *
 * ── A RULE THAT WAS HERE FOR THREE TURNS AND WAS FALSE ────────────────────
 *
 *   This said: statements in the Supabase editor do not reliably share a
 *   session, so a migration BODY must never use a temp table, because 0034
 *   failed that way.
 *
 *   0034 did not fail that way. It applied end to end, temp tables and all, in
 *   one transaction — proven by every one of its migration_findings rows
 *   sharing a single timestamp to the microsecond. `begin;` IS atomic here and
 *   a whole-file paste IS one unit. The 42P01 came from a separate partial
 *   paste, which is ordinary SQL behaviour.
 *
 *   The rule was written from an error message plus an assumption, and it went
 *   into this file — the one place every future migration author reads — before
 *   anyone checked it. A false rule here is worse than no rule: it is a
 *   constraint people design around for reasons that do not exist.
 *
 *   WHAT IS ACTUALLY TRUE, and worth keeping:
 *
 *     * Prefer a single `do $$` block for anything multi-step. Not for
 *       correctness — because it is self-contained, so it survives being
 *       re-run on its own while debugging, which two statements sharing a temp
 *       table do not.
 *
 *     * Re-running PART of a migration is not the same as running it. If you
 *       select a fragment and get a "does not exist" error, suspect the
 *       selection before the editor.
 *
 * ── WRITING VERIFY BLOCKS: THEY RUN IN THE SUPABASE SQL EDITOR ─────────────
 *
 *   That is the only tool these are ever pasted into, and four blocks this
 *   month were written for a different one. A block that cannot be run is not
 *   a verification step; it is a step that gets skipped, which is how 0012's
 *   baseline was lost for good.
 *
 *   Rules that follow from the editor's behaviour:
 *
 *   * NO TEMP TABLES and no reliance on session state between statements.
 *     Statements do not reliably share a session, so `create temp table` in one
 *     and `select` from it in the next fails.
 *
 *   * NO SUBQUERY THAT THE BLOCK'S OWN WRITE INVALIDATES. 0024's Block E
 *     selected a user `not in (select user_id from subscriptions)`, inserted a
 *     row for them, then re-evaluated the same subquery — which now excluded
 *     the row it had just created and returned nothing. That reads as failure
 *     and is not. Capture the id in a literal, or use a CTE, or say plainly in
 *     the comment that the id must be pasted in by hand.
 *
 *   * PREFER ONE SELF-CONTAINED STATEMENT per check, with the expected result
 *     written above it.
 *
 *   * A BLOCK MUST SATISFY THE GUARDS OF THE THING IT TESTS. This one was
 *     missing and cost a fourth unrunnable block: 0027's blocks called an
 *     admin-only function from the SQL editor, where auth.uid() is NULL, so
 *     `is_admin()` was false and the gate raised before any of the behaviour
 *     under test was reached. Proving the guard is not proving the function.
 *     For an admin-only function, set a real admin's claim first:
 *       set local request.jwt.claims = '{"sub":"<admin user id>","role":"authenticated"}';
 *     and SELECT is_admin() before relying on it, so a claim that did not
 *     carry shows up as false rather than as a confusing error later.
 *
 *   * A BLOCK MUST DISTINGUISH THE THING FROM THE COMMENTARY ABOUT THE THING.
 *     0028's first Block A matched a removed sentence against
 *     pg_get_functiondef(), which includes the comment explaining the removal
 *     — so it reported the sentence as still present when the cut had worked.
 *     The artefact of the fix broke the test for the fix. Match the code and
 *     not the prose around it: strip comments before comparing, or match on
 *     something only the code can contain (a doubled apostrophe inside a SQL
 *     literal, for instance).
 *
 *   * `begin; ... rollback;` is fine — it is the multi-statement dependencies
 *     inside that break, not the transaction.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.join(HERE, '..', 'supabase', 'migrations')
const FOOTER = '-- MIGRATION FOOTER'
const STAMP = process.argv.includes('--stamp')

/** Checksum covers everything ABOVE the footer line — the migration itself,
 *  not the record of it. Must match the rule described in 0000. */
function checksumOf(sql) {
  const i = sql.indexOf(FOOTER)
  const body = i === -1 ? sql : sql.slice(0, i)
  return createHash('sha256').update(body.replace(/\r\n/g, '\n'), 'utf8').digest('hex')
}

const files = readdirSync(DIR)
  .filter(f => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .map(f => {
    const sql = readFileSync(path.join(DIR, f), 'utf8')
    const supersededBy = (sql.match(/^--\s*SUPERSEDED BY\s+(\d{4})/m) ?? [])[1] ?? null
    return {
      file: f, version: f.slice(0, 4), name: f.slice(5, -4),
      sql, checksum: checksumOf(sql), supersededBy,
    }
  })

if (STAMP) {
  let changed = 0
  for (const m of files) {
    if (!m.sql.includes('PENDING_CHECKSUM')) continue
    writeFileSync(path.join(DIR, m.file), m.sql.replace('PENDING_CHECKSUM', m.checksum))
    console.log(`stamped ${m.file} -> ${m.checksum.slice(0, 16)}…`)
    changed++
  }
  console.log(changed ? `\n${changed} file(s) stamped. Commit, then paste into the SQL editor.`
                      : 'Nothing to stamp — no PENDING_CHECKSUM found.')
  process.exit(0)
}

const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!key) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set. Set it in this shell only:')
  console.error("  $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'")
  process.exit(1)
}

const { createClient } = await import('@supabase/supabase-js')
const db = createClient('https://ptluekkhiopowuyvkgnd.supabase.co', key, {
  auth: { persistSession: false },
})

const { data, error } = await db.from('schema_migrations').select('version, name, checksum, applied_at')
if (error) {
  // The framework itself not being applied is the most likely first answer.
  console.error('Could not read public.schema_migrations:', error.message)
  console.error('If it does not exist yet, apply supabase/migrations/0000_migrations_framework.sql first.')
  process.exit(1)
}

const applied = new Map((data ?? []).map(r => [r.version, r]))
const pad = (s, n) => String(s).padEnd(n)
let problems = 0

console.log('\n  VERSION  NAME                       STATUS')
console.log('  ' + '-'.repeat(62))

for (const m of files) {
  const row = applied.get(m.version)
  let status
  if (!row && m.supersededBy) {
    // The marker only counts if the migration it names really applied.
    const by = applied.get(m.supersededBy)
    if (by) {
      status = `SUPERSEDED by ${m.supersededBy} — never applied, and must not be`
    } else {
      status = `PENDING  — marked superseded by ${m.supersededBy}, but ${m.supersededBy} has not applied either`
      problems++
    }
  }
  else if (!row) { status = 'PENDING  — committed, never applied'; problems++ }
  else if (row.checksum === 'bootstrap') status = `applied ${row.applied_at.slice(0, 10)}`
  else if (row.checksum !== m.checksum) {
    status = `DRIFTED  — file changed since it was applied`; problems++
  } else status = `applied ${row.applied_at.slice(0, 10)}`
  console.log(`  ${pad(m.version, 9)}${pad(m.name, 27)}${status}`)
}

for (const [version, row] of applied) {
  if (files.some(m => m.version === version)) continue
  console.log(`  ${pad(version, 9)}${pad(row.name, 27)}ORPHAN   — applied, no file explains it`)
  problems++
}

console.log()
if (problems > 0) {
  console.error(`${problems} migration(s) need attention.`)
  process.exit(1)
}
console.log('All migrations applied and unchanged since.')
