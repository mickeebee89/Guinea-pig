/**
 * check-anon-view-grants — can the PUBLIC WEBSITE actually read the views it is
 * granted? Audit item 131.
 *
 *   node scripts/check-anon-view-grants.mjs
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 * On 26 Sep 2026 migration 0060 ended with
 *
 *     revoke all on function public.bio_publish_problem(text) from public, anon;
 *
 * and `public_stylists` filters with `public.bio_publish_problem(p.bio) is null`.
 * cavybeauty.com reads that view with the ANON key, so every public read of it
 * died on `permission denied for function bio_publish_problem`. All six
 * treatment landing pages said "No one is offering hair on Cavy yet" while a
 * stylist qualified. It was live for four days.
 *
 * ⚠️ THE TRAP, STATED ONCE. These views are `security_invoker = false`, so they
 * read their TABLES as the view owner and anon needs no privileges on
 * `providers` or `users`. That is true, and it is ONLY about tables. EXECUTE on
 * a function called in the view body is still checked against the CALLER. A
 * view can be readable and unusable at the same time, and nothing about the
 * view — not its grants, not its definition — says so.
 *
 * Nothing else catches it. `npm run verify` exits 0 while printing the error;
 * safeList() in site/lib/stylists.ts turns it into an empty list and a 200; the
 * typed clients never see it, because the call is inside SQL.
 *
 * ── WHAT IT ASKS ────────────────────────────────────────────────────────
 * For every view in supabase/*.sql granted SELECT to anon: does each
 * `public.<fn>(` in its body still end up executable by anon, reading the
 * migrations in order?
 *
 * ⚠️ WHAT A PASS DOES NOT MEAN. This reads the REPO, not the database — the
 * same honest limit check-handrun-drift.mjs and check-types-freshness.mjs both
 * state about themselves. A grant made by hand in the SQL editor is invisible
 * here, and so is one revoked by hand. It models Postgres's default of EXECUTE
 * to PUBLIC on a newly created function, then applies each grant/revoke it can
 * see, in migration order. The real check is `has_function_privilege('anon',
 * ...)`, which needs a connection CI has not got (item 38).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SQL_DIR = join(ROOT, 'supabase')
const MIG_DIR = join(SQL_DIR, 'migrations')
const IGNORE = /snapshot/i

/**
 * Comments are stripped before anything is matched.
 *
 * Not fussiness: `public-web-views.sql` has a comment reading "Plain EXISTS
 * rather than has_open_availability()", and a first pass of this analysis by
 * hand reported that function as a second instance of the bug. It is not called
 * anywhere. A commented-out name looks exactly like a called one to a regex.
 */
const stripComments = sql =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')

const roles = list => list.toLowerCase().split(',').map(r => r.trim().replace(/;$/, ''))
/** `public` is a role that contains everyone, anon included. */
const touchesAnon = list => roles(list).some(r => r === 'anon' || r === 'public')

// ── what each function's EXECUTE looks like after the migrations ───────────
//    true = anon can call it, false = a revoke took it away and nothing
//    gave it back. Absent = no migration creates it.
const anonCanExecute = new Map()

for (const f of readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort()) {
  const src = stripComments(readFileSync(join(MIG_DIR, f), 'utf8'))

  // Postgres grants EXECUTE to PUBLIC on a new function unless told otherwise,
  // so creation starts a function as reachable and a later revoke is what
  // changes that. Modelling it the other way round would flag every function
  // nobody has ever granted explicitly, which is most of them.
  for (const m of src.matchAll(
    /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi)) {
    if (!anonCanExecute.has(m[1].toLowerCase())) anonCanExecute.set(m[1].toLowerCase(), true)
  }

  // Order within a file matters as much as order between files: 0064 revokes
  // from public and then grants to anon, two lines apart, and reading them in
  // the wrong order inverts the answer.
  const changes = [
    ...src.matchAll(/(revoke|grant)\s+(?:all|execute)[^;]*?\s+on\s+function\s+(?:public\.)?([a-z0-9_]+)\s*\([^)]*\)\s+(?:from|to)\s+([^;]+);/gi),
  ]
  for (const m of changes) {
    const [, verb, name, list] = m
    if (!touchesAnon(list)) continue
    anonCanExecute.set(name.toLowerCase(), verb.toLowerCase() === 'grant')
  }
}

// ── every view the anon key is allowed to select ───────────────────────────
let checked = 0
const problems = []

for (const f of readdirSync(SQL_DIR).filter(f => f.endsWith('.sql') && !IGNORE.test(f))) {
  const raw = readFileSync(join(SQL_DIR, f), 'utf8')
  const src = stripComments(raw)

  const granted = new Set()
  for (const m of src.matchAll(
    /grant\s+select\s+on\s+(?:table\s+)?(?:public\.)?([a-z0-9_]+)\s+to\s+([^;]+);/gi)) {
    if (touchesAnon(m[2])) granted.add(m[1].toLowerCase())
  }
  if (granted.size === 0) continue

  for (const m of src.matchAll(
    /create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?([a-z0-9_]+)([\s\S]*?);/gi)) {
    const view = m[1].toLowerCase()
    if (!granted.has(view)) continue
    checked++

    for (const call of new Set(
      [...m[2].matchAll(/public\.([a-z0-9_]+)\s*\(/gi)].map(c => c[1].toLowerCase()))) {
      const state = anonCanExecute.get(call)
      if (state === true) continue
      problems.push({
        file: basename(f),
        view,
        fn: call,
        why: state === false
          ? 'a migration revoked EXECUTE from anon (or from public) and nothing granted it back'
          : 'no migration creates it, so its grants cannot be read here',
      })
    }
  }
}

if (problems.length > 0) {
  for (const p of problems) {
    console.error(
      `${p.file}: view ${p.view} is granted to anon and calls public.${p.fn}(), but ${p.why}.\n` +
      `  The public website reads this view with the anon key, so EVERY read of it fails with\n` +
      `  "permission denied for function ${p.fn}" — not fewer rows, no rows and an error.\n` +
      `  Fix by granting a BOOLEAN wrapper rather than the function itself where the return\n` +
      `  value would tell the public something (0064 does this), or grant EXECUTE to anon.`,
    )
  }
  console.error(
    `\nanon view grants — ${problems.length} view/function pair(s) the public site cannot read.\n` +
    `This is exactly item 131, which was live for four days while every check passed.`,
  )
  process.exit(1)
}

console.log(
  `anon view grants — ${checked} anon-readable view(s) checked; every public.<fn>() they call ` +
  `is still executable by anon (read from the repo, not the database)`,
)
