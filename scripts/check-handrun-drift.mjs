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
 *   -- MIGRATION-OWNS: <name> <migration>
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
  ['trigger',  /create\s+trigger\s+([a-z0-9_]+)/gi],
  ['policy',   /create\s+policy\s+"?([a-z0-9_ ]+?)"?\s+on\s/gi],
]

/** Every object a file creates, as name -> kind. */
const objectsIn = src => {
  const out = new Map()
  for (const [kind, re] of PATTERNS) {
    for (const m of src.matchAll(re)) out.set(m[1].toLowerCase().trim(), kind)
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
  const markers = new Set(
    [...src.matchAll(/--\s*MIGRATION-OWNS:\s*([a-z0-9_]+)/gi)].map(m => m[1].toLowerCase()),
  )

  for (const [name, kind] of [...objectsIn(src)].sort()) {
    if (!ownedBy.has(name)) continue
    if (markers.has(name)) { marked++; continue }
    unmarked++
    const fn = name
    console.error(
      `${basename(f)}: defines the ${kind} ${name}, which migration ${ownedBy.get(name).join(' and ')} also defines.\n` +
      `  Re-running this file would overwrite the migration's version with this one.\n` +
      `  Check it against pg_get_functiondef, bring it forward if it is behind, then record the\n` +
      `  decision above the function as:  -- MIGRATION-OWNS: ${fn} ${ownedBy.get(fn).at(-1)}`,
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
  `hand-run drift — ${marked} declared overlap(s) (functions, triggers, policies) ` +
  `between supabase/*.sql and migrations ` +
  `(a marker records a decision; it does NOT prove the copy is current)`,
)
