/**
 * gen-supabase-types.mjs — generate the database's types, stamp them, and put
 * a copy where each app can import it. Audit item 84.
 *
 *   npx supabase login            # once, browser flow
 *   node scripts/gen-supabase-types.mjs
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 * Every call to the database from every app is an unchecked string today:
 * 401 `.from()` calls over ~30 tables and 20 `.rpc()` calls over 15 functions.
 * `supabase.rpc('create_session_with_consent', { … })` compiles whether or not
 * that function exists and whether or not those are its arguments. The first
 * thing that disagrees is a live user — twice on 23 Sep 2026:
 *   * the web's first application, refused because the call carried a
 *     parameter the function does not have (item 83);
 *   * a mobile chat query asking for a `materials_cost` column that does not
 *     exist, which failed the WHOLE query so no treatment showed in chat.
 *
 * ── ⚠️ WHAT THIS DOES NOT DO, AND MUST NEVER BE READ AS DOING ───────────
 * It checks NAMES AND SHAPES. It does not check PERMISSION.
 *
 * A perfectly typed query can return nothing at all because an RLS policy
 * filtered it — which is most of this audit's findings, not a rare case: the
 * suspended stylist whose update was filtered (66), the hidden provider whose
 * row vanished from a model who had booked her (76), the apply gate (49).
 * PostgREST returns success and an empty set, not an error.
 *
 * **A green build must never start reading as "the query works".** It means
 * the names are real. Whether the caller is allowed to see the rows is a
 * different question, answered only by running it as that member — which is
 * what the verify blocks with `set local role authenticated` are for.
 *
 * ── THE FILE IS COMMITTED, AND COPIED THREE TIMES ───────────────────────
 * The three apps share no code — separate package.json, no workspace linkage
 * (CLAUDE.md) — and TypeScript will not import across those boundaries. So one
 * generation writes three identical copies, from one source, in one run. They
 * cannot drift because nothing regenerates them individually.
 */

import { execSync } from 'node:child_process'
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const PROJECT_REF = 'ptluekkhiopowuyvkgnd'

/** One generation, three destinations. Add an app here, not a second script. */
const DESTINATIONS = [
  'site/lib/database.types.ts',
  'mobile/src/lib/database.types.ts',
  'admin/lib/database.types.ts',
]

/**
 * ── THE STAMP IS NOW A CLAIM ABOUT THE DATABASE. Audit item 91, closed 25 Sep
 * 2026. ────────────────────────────────────────────────────────────────────
 *
 * It used to be the newest migration FILE ON DISK, and it was named after the
 * database anyway. Micky caught the gap the first time it mattered: 0054 was
 * applied, 0055 was written and pending, and the types — correctly generated
 * from a database at 0054 — came out stamped 0055.
 *
 * The types were right. The STAMP was a claim about a folder, printed in a
 * form that reads as a claim about the database, and it could read AHEAD of
 * the thing it described. A freshness check built on it inherited that: it
 * spent most of 24–25 Sep saying "these types describe an older schema" about
 * types that described the live schema exactly.
 *
 * ⚠️ SO THE NUMBER IS NO LONGER DERIVED. IT IS SUPPLIED, AND REQUIRED:
 *
 *     node scripts/gen-supabase-types.mjs --applied 0062
 *
 * This script has the Supabase CLI's login and a project ref, not a database
 * connection, so it cannot read public.schema_migrations itself. The choice
 * was between a guess that looks like a fact and a fact somebody has to state.
 * A required argument is the honest one: it cannot be silently wrong in the
 * direction that matters, because nothing fills it in for you.
 *
 * It is validated against the folder — a version with no migration file is
 * refused, and so is one NEWER than any file, since neither can be true.
 * A version OLDER than the newest file is normal and expected: it means
 * migrations are written and pending, which is the state this repo is in for
 * most of any working session.
 */
function migrationVersionsOnDisk() {
  return readdirSync('supabase/migrations')
    .map(f => /^(\d{4})_/.exec(f)?.[1])
    .filter(Boolean)
    .sort()
}

function requiredAppliedVersion(versions) {
  const argv = process.argv.slice(2)
  const i = argv.findIndex(a => a === '--applied' || a.startsWith('--applied='))
  const raw = i < 0 ? null
    : argv[i].includes('=') ? argv[i].split('=')[1]
    : argv[i + 1]

  const newestFile = versions[versions.length - 1] ?? '0000'

  if (!raw) {
    console.error('\nThis needs to know what the DATABASE is at, and it cannot ask.\n')
    console.error('  node scripts/gen-supabase-types.mjs --applied <version>\n')
    console.error('Get the version from the database itself:\n')
    console.error('  select version from public.schema_migrations order by version desc limit 1;\n')
    console.error(`The newest migration FILE here is ${newestFile}. That is NOT the answer unless`)
    console.error('it has actually been applied — which is the whole reason this is an argument')
    console.error('and not something the script works out. Audit item 91.\n')
    process.exit(1)
  }

  if (!/^\d{4}$/.test(raw)) {
    console.error(`\n"${raw}" is not a four-digit migration version.\n`)
    process.exit(1)
  }
  if (!versions.includes(raw)) {
    console.error(`\nThere is no migration ${raw} in supabase/migrations.`)
    console.error('A version the repo has never heard of cannot be what the database is at.\n')
    process.exit(1)
  }
  if (raw > newestFile) {
    console.error(`\n${raw} is newer than every migration file here (${newestFile}).\n`)
    process.exit(1)
  }
  return { applied: raw, newestFile }
}

const versions = migrationVersionsOnDisk()
const { applied: stamp, newestFile } = requiredAppliedVersion(versions)

if (stamp < newestFile) {
  const pending = versions.filter(v => v > stamp)
  console.log(`\nNote: ${pending.length} migration(s) written but not applied: ${pending.join(', ')}.`)
  console.log('The types will describe the database WITHOUT them, which is correct.')
}

console.log(`\nGenerating types for ${PROJECT_REF}…`)
console.log('If this asks you to log in: npx supabase login\n')

let types
try {
  // execSync, not execFileSync with `shell: true`. Node deprecated that
  // combination (DEP0190) because an argument array plus a shell means the
  // shell re-parses arguments that were meant to be passed literally. The
  // shell is needed on Windows, where `npx` is a .cmd and cannot be spawned
  // directly, so the honest form is a command string.
  //
  // Nothing interpolated here comes from outside this file: PROJECT_REF is a
  // constant above. If that ever stops being true, this must go back to
  // execFileSync with a real executable and no shell.
  types = execSync(
    `npx supabase gen types typescript --project-id ${PROJECT_REF}`,
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
} catch (e) {
  console.error('\nCould not generate types.')
  console.error('Usually this is not being logged in: run `npx supabase login` and try again.')
  console.error(String(e?.stderr ?? e?.message ?? e).split('\n').slice(0, 5).join('\n'))
  process.exit(1)
}

if (!types.includes('export type Database')) {
  console.error('\nThe output does not look like a types file. Nothing was written.')
  process.exit(1)
}

// ⚠️ The stamp is the whole freshness mechanism. check-types-freshness.mjs
// reads it and compares against the newest migration, which is the only
// staleness check possible WITHOUT database access — CI's Supabase keys are
// publishable ones and cannot read pg_proc (audit item 38).
const header = `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Written by scripts/gen-supabase-types.mjs from the live database.
// TYPES_STAMP: ${stamp}
// TYPES_FILES_AT_GEN: ${newestFile}
//
// TYPES_STAMP is the migration the DATABASE was at when these were generated,
// stated by whoever ran it (--applied). TYPES_FILES_AT_GEN is the newest
// migration file that existed at the same moment. When they differ, migrations
// were written and pending — which is normal, and is why the first number is
// not derived from the second. Audit item 91.
//
// Regenerate whenever a migration is applied:
//   node scripts/gen-supabase-types.mjs
//
// ⚠️ This checks names and shapes, never permission. A typed query can still
// return nothing because an RLS policy filtered it. See item 84.

`

for (const dest of DESTINATIONS) {
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, header + types, 'utf8')
  console.log(`  wrote ${dest}`)
}

console.log(`\nStamped: database at ${stamp}, newest file ${newestFile}. ${DESTINATIONS.length} copies written.\n`)
