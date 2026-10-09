/**
 * check-handrun-drift — does a hand-run .sql file still hold a function,
 * trigger or policy that a migration has since replaced? Audit item 123.
 *
 *   node scripts/check-handrun-drift.mjs
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 * `supabase/*.sql` (not `migrations/`) are files somebody pastes into the SQL
 * editor by hand. Nothing applies them, nothing records that they ran, and
 * nothing notices when a migration later redefines something they contain.
 *
 * Found live on 24 Sep 2026: `suspension-enforcement.sql` still held the
 * pre-0058 `my_suspension()`, the one that returned the admin's REASON to the
 * suspended member — the exact leak 0058 was written to close. Re-running that
 * file would have failed, because `create or replace` cannot rename a RETURNS
 * TABLE column, and the obvious way to "fix" that error is to drop the function
 * and run it again — which would have reinstated the leak. It failed safe by
 * luck, not by design.
 *
 * It was not alone. Four more files hold superseded copies, including
 * `delete_account_data`, which is a legal obligation and a store requirement.
 *
 * ── WHAT IT ASKS ────────────────────────────────────────────────────────
 * Only what the repo can answer without a database: does a hand-run file
 * define something a migration also defines? If so, SOMEBODY MUST HAVE DECIDED
 * which one is current, and the decision has to be written down where the next
 * person will meet it:
 *
 *   -- MIGRATION-OWNS: <name> <migration>   the migration is current; this
 *                                           file holds an older copy
 *   -- FILE-OWNS: <name> <migration>         THIS FILE is current; the
 *                                           migration created it once and
 *                                           has since been superseded
 *
 * ⚠️ BOTH DIRECTIONS EXIST AND THEY ARE NOT INTERCHANGEABLE. Added 30 Sep
 * 2026 with `view`, because the first view overlap was the second kind:
 * public-web-views.sql is the LIVING definition of public_stylists. 0063
 * refuses to run until that file has been re-run by hand, and 0064 depends on
 * it too. Marking it MIGRATION-OWNS 0034 would tell the next person that a
 * migration from August is authoritative, and following that would restore
 * banner_url and the pre-0060 bio predicate. A marker pointing the wrong way
 * is worse than no marker.
 *
 * ⚠️ WHAT A PASS DOES NOT MEAN. It does not mean the copy is up to date — a
 * marker is a claim by whoever wrote it, not a comparison. The only real check
 * is `pg_get_functiondef`, which needs a connection CI has not got (item 38).
 * This makes the drift VISIBLE and forces a decision; it does not verify it.
 * That is the same honest limit check-types-freshness.mjs states about itself.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SQL_DIR = join(ROOT, 'supabase')
const MIG_DIR = join(SQL_DIR, 'migrations')

/** Snapshots are a record of a past state, so of course they hold old copies. */
const IGNORE = /snapshot/i

/**
 * Functions, triggers and policies alike. A function was the fault that
 * prompted this (item 123), but a trigger and a policy drift exactly the same
 * way — a hand-run file that recreated `notify_email` or a RESTRICTIVE policy
 * would undo a migration just as quietly, and 0061 had just recreated
 * notify_email when this was written.
 *
 * Widened on 25 Sep 2026 while there were ZERO trigger and policy overlaps,
 * which is the cheapest moment a check is ever widened: nothing to triage, and
 * the next one is caught rather than found.
 */
const PATTERNS = [
  ['function', /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi],
  // ⚠️ `constraint` IS NOT OPTIONAL IN THIS ALTERNATION. 0086 creates
  // session_needs_consent_record with `create constraint trigger`, and the
  // pattern without it never learned that 0086 owns that name — so a hand-run
  // file recreating the deferred consent trigger would have been invisible to
  // this check. Found 9 Oct 2026 while sweeping public.sessions' six triggers.
  ['trigger',  /create\s+(?:constraint\s+)?trigger\s+([a-z0-9_]+)/gi],
  ['policy',   /create\s+policy\s+"?([a-z0-9_ ]+?)"?\s+on\s/gi],
  // ⚠️ ADDED 30 Sep 2026, AND IT WAS NOT FREE. Unlike the trigger and policy
  // widening above, this one had overlaps waiting for it: the public website's
  // views are created BOTH by public-web-views.sql and by the migrations that
  // introduced them. That drift was invisible for nine days, through the whole
  // of item 131 — a fault in one of these very views.
  ['view',     /create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?([a-z0-9_]+)/gi],
  // ⚠⚠ ADDED 9 Oct 2026, AT THE CHEAPEST MOMENT IT COULD BE: measured first, and
  // NINE index names are created by hand-run supabase/*.sql files while ZERO of
  // them are also created by a migration. Nothing to triage, and the next one is
  // caught rather than found — the same argument the trigger/policy widening
  // above was made on.
  //
  // ⚠️ AND IT WAS ADDED THE DAY BEFORE IT WAS NEEDED. 0093 adopts
  // sessions_active_slot_uniq, which booking-guard.sql also creates. Without this
  // pattern that overlap would exist with nothing in the repo saying so — two
  // owners of the only atomic double-booking guard, which is precisely what this
  // check exists to prevent.
  //
  // ⚠️ AN INDEX DRIFTS DIFFERENTLY FROM A FUNCTION, AND WORSE. `create index if
  // not exists` matches on the NAME ALONE: re-running a hand-run file against a
  // database whose index has drifted is a silent no-op, not an overwrite. So for
  // an index the marker is not "which copy would win" but "which file states the
  // definition that is meant to be live".
  ['index',    /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi],
]

/**
 * ⚠⚠ COMMENTS ARE STRIPPED FIRST, AND NOT AS A TIDINESS MEASURE. Every file in
 * this repo describes its own DDL in prose: a header that says "`create index if
 * not exists` matches on the name alone" made this script report an index called
 * `if`, and "a failed CREATE INDEX CONCURRENTLY leaves behind" one called
 * `leaves`.
 *
 * ⚠️ AND THE SIZE OF THAT PROBLEM WAS MEASURED, NOT ASSUMED. Across all 94
 * migrations the raw scan yields 155 names and the stripped scan 153: **exactly
 * two phantoms, `if` and `concurrently`, and both come from the index pattern
 * added today.** The function, trigger, policy and view patterns produced ZERO
 * — which is why nobody had met this before, and the honest reason it is being
 * fixed now rather than earlier.
 *
 * ✅ Fixed for all five patterns anyway, because the direction of the error is
 * what matters: a FALSE owner is worse than a missing one. It would tell somebody
 * a hand-run file holds a stale copy of an object no migration actually defines,
 * and send them to overwrite the live one. Verified the strip loses nothing —
 * every name the raw scan finds, the stripped scan still finds.
 *
 * ⚠️ THE HONEST LIMIT: this strips `--` to end of line and `/* *\/` blocks
 * textually, so a `--` inside a string literal takes the rest of that line with
 * it. That can only ever cause a MISSED definition, never a false one, and a
 * real DDL line does not carry a `--` before its own keyword.
 */
const stripComments = src => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')

/** Every object a file creates, as name -> kind. */
const objectsIn = src => {
  const out = new Map()
  const code = stripComments(src)
  for (const [kind, re] of PATTERNS) {
    for (const m of code.matchAll(re)) out.set(m[1].toLowerCase().trim(), kind)
  }
  return out
}

// ── who does each name belong to, by migration ─────────────────────────────
const ownedBy = new Map()
for (const f of readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort()) {
  const src = readFileSync(join(MIG_DIR, f), 'utf8')
  for (const name of objectsIn(src).keys()) {
    if (!ownedBy.has(name)) ownedBy.set(name, [])
    ownedBy.get(name).push(f.slice(0, 4))
  }
}

let unmarked = 0
let marked = 0

for (const f of readdirSync(SQL_DIR).filter(f => f.endsWith('.sql') && !IGNORE.test(f)).sort()) {
  const src = readFileSync(join(SQL_DIR, f), 'utf8')
  // ⚠️ THE MARKERS ARE READ FROM THE RAW SOURCE, because a marker IS a comment.
  // Only the DDL scan above strips them.
  const markers = new Set(
    [...src.matchAll(/--\s*(?:MIGRATION-OWNS|FILE-OWNS):\s*([a-z0-9_]+)/gi)].map(m => m[1].toLowerCase()),
  )

  for (const [name, kind] of [...objectsIn(src)].sort()) {
    if (!ownedBy.has(name)) continue
    if (markers.has(name)) { marked++; continue }
    unmarked++
    const fn = name
    // ⚠️ ONE READ PER KIND. Naming the wrong one sends somebody to a query that
    // returns nothing for their object — and `pg_get_functiondef` on an index name
    // does not return empty, it RAISES, which reads like the object is gone.
    const liveDef = { view: 'pg_get_viewdef', index: 'pg_get_indexdef',
                      trigger: 'pg_get_triggerdef' }[kind] ?? 'pg_get_functiondef'
    console.error(
      `${basename(f)}: defines the ${kind} ${name}, which migration ${ownedBy.get(name).join(' and ')} also defines.\n` +
      `  Re-running this file would overwrite the migration's version with this one.\n` +
      `  Check it against ${liveDef}, decide WHICH DIRECTION is current, and record it
` +
      `  above the ${kind} as ONE of:
` +
      `    -- MIGRATION-OWNS: ${fn} ${ownedBy.get(fn).at(-1)}   (the migration is current)
` +
      `    -- FILE-OWNS: ${fn} ${ownedBy.get(fn).at(-1)}        (this file is current)`,
    )
  }
}

if (unmarked > 0) {
  console.error(
    `\nhand-run drift — ${unmarked} undeclared overlap(s). These files are pasted in by hand, so\n` +
    `nothing else will ever tell you they have gone stale.`,
  )
  process.exit(1)
}

console.log(
  `hand-run drift — ${marked} declared overlap(s) (functions, triggers, policies, views, indexes) ` +
  `between supabase/*.sql and migrations ` +
  `(a marker records a decision; it does NOT prove the copy is current)`,
)
