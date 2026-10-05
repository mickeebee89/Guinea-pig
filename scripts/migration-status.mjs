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
 *
 *   * ⚠️ A DEFERRED CONSTRAINT CANNOT BE TESTED BY INSERT-THEN-ROLLBACK.
 *     `CREATE CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` fires at
 *     COMMIT. A verify block ends in `raise exception` and `rollback`, so the
 *     commit never happens and **the trigger never fires** — the block reports
 *     the insert as having SUCCEEDED, which is exactly the refusal it was
 *     written to catch.
 *
 *     That is a check that cannot fail, arrived at from a new direction: not a
 *     bad predicate, but a guard whose moment never comes.
 *
 *     THE FIX: force the pending check inside the transaction.
 *
 *         insert into ... ;                 -- succeeds, check now pending
 *         set constraints all immediate;    -- <- the violation fires HERE
 *
 *     Wrap that line in its own begin/exception and match on it, not on the
 *     insert. Found 6 Oct 2026 while designing item 148's fix, from the fact
 *     that eight existing verify blocks insert a bare session and roll back —
 *     which is also why none of them will break when that trigger ships.
 *
 *   * ⚠️⚠️ A MIGRATION THAT TAKES SOMETHING AWAY NEEDS A CONTROL NAMING WHAT IT
 *     MUST **NOT** HAVE TOUCHED. Micky, 5 Oct 2026, on 0084 — he added the
 *     section himself and it is the one the file was missing.
 *
 *     0084's verify had four sections and all four proved the twenty tables
 *     WERE revoked. **Not one of them proved anything outside the list was
 *     left alone.** A slip as small as
 *
 *         revoke update on all tables in schema public from authenticated
 *
 *     produces an IDENTICAL result in every one of those four sections, while
 *     having undone 0079's column grant and locked members out of their own
 *     rows. The verify would have read as a clean pass.
 *
 *     So: name the things that must still work, and assert them. For 0084 that
 *     was `users`, `providers`, `model_attributes` still updatable and
 *     `sessions`' `status` column grant intact.
 *
 *     ⚠️ THE GENERAL SHAPE, WHICH IS WORTH MORE THAN THE RULE: a section that
 *     proves a change HAPPENED says nothing about whether it was BOUNDED. Every
 *     revoke, drop, policy tightening and grant narrowing needs both halves,
 *     and the second half is the one that gets left out, because the first half
 *     is what you set out to do.
 *
 *     Same family as a check that cannot fail, approached from the other side:
 *     there, the check could not go red; here, it cannot go red for the thing
 *     most likely to go wrong.
 *
 *   * ⚠️ PARENTHESISE A CONCATENATION BEFORE YOU CAST IT. `::` binds tighter
 *     than `||`, so this casts ONLY THE SECOND LITERAL:
 *
 *         '[{"a":1},' || ' {"b":2}]'::jsonb        -- casts ' {"b":2}]' alone
 *         ('[{"a":1},' || ' {"b":2}]')::jsonb      -- what was meant
 *
 *     0083's verify block failed its first run on exactly that, with "invalid
 *     input syntax for type json" — found by Micky, 5 Oct 2026. The fragment
 *     being cast is not valid JSON on its own, so the error names the type and
 *     not the precedence, which is what makes it read as a bug in the function
 *     under test rather than in the test.
 *
 *     Same family as 0075's 42804, where a bare `null` typed itself as `text`
 *     against a `uuid` column: an operator doing something defensible with the
 *     wrong operand. Both are only visible by RUNNING the block.
 *
 *   ── ⚠️ THE EDITOR SOMETIMES REWRITES A `do` BLOCK. CAUSE UNKNOWN ───────
 *
 *     OBSERVED ONCE, 3 Oct 2026, on 0079's verify block. The Supabase SQL
 *     editor spliced `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY` lines into
 *     the middle of the block, breaking the dollar quoting. The names it used
 *     were the three variables assigned by `select ... into`.
 *
 *     THE WORKAROUND THAT WORKED: assign from a scalar subquery instead.
 *
 *         v_other := (select p.id from public.providers p limit 1);
 *
 *     ⚠️⚠️ `into` IS **NOT** ESTABLISHED AS THE CAUSE, AND THIS FILE SAID IT
 *     WAS FOR ONE COMMIT. The same editor session ran THREE other `do` blocks
 *     containing `select ... into` without incident — one of them with five
 *     such statements, including a five-target
 *     `select date, start_time, price_pence, provider_id, not_held_provider_at
 *     into v_d0, v_t0, v_p0, v_prov0, v_nh0`.
 *
 *     And the counter-example is exact rather than approximate:
 *
 *         select p.id into v_other_prov from public.providers p where ...   RAN
 *         select p.id into v_other      from public.providers p where ...   REWRITTEN
 *
 *     Same shape. `into` is present in both, so it cannot be what separates
 *     them. **Do not repeat the claim that it is.**
 *
 *     THE TRIGGER IS UNIDENTIFIED. Candidates that the available evidence
 *     cannot separate: something else in that particular block's text, a
 *     non-deterministic heuristic on the editor's side, or an interaction with
 *     block length or structure. **Do not pick one.** If a block gets
 *     rewritten, reach for the scalar-subquery form; do not reason about why.
 *
 *     ── THE HISTORY, WHICH IS WORTH MORE THAN THE RULE ──
 *
 *     This is the THIRD attempt at a causal rule for this one behaviour:
 *
 *       1. `record` declarations cause it. FALSE. Inferred from an error
 *          message. The `$blk$` tag rename that appeared to fix it was
 *          coincidental — 0059 to 0062 still carry that tag and **it records no
 *          established reason.** Leave them; do not copy the tag expecting it
 *          to help.
 *       2. The `into` keyword causes it. FALSE, disproved within a day by the
 *          blocks that worked, above.
 *       3. Not attempted. This entry.
 *
 *     Two causal rules, both wrong, both written from a single failure plus an
 *     assumption, both into this file. **The editor's behaviour here is not
 *     understood.** That sentence is the useful one: it tells you to work
 *     around a rewritten block rather than design every block around a cause
 *     nobody has pinned down.
 *
 *   ── ⚠️ ONE `%` FED ONE CONCATENATED STRING. ADDED 3 Oct 2026 ────────────
 *
 *     In PL/pgSQL `%%` is an ESCAPED LITERAL PERCENT SIGN, not two
 *     placeholders. A `raise` written with `%%` between fifteen fields has two
 *     real placeholders for fifteen arguments and dies with "too many
 *     parameters specified for RAISE" — 0079's verify did exactly that.
 *
 *     Do not count placeholders. Build the message and pass one:
 *
 *         raise exception '%', 'ROLLED BACK ON PURPOSE.' || chr(10)
 *           || '1 move: '  || r1 || chr(10)
 *           || '2 price: ' || r2;
 *
 *     The counting problem is removed rather than solved, which is the only
 *     version that survives someone adding a field later.
 *
 *   ── ⚠️ ONE PASTEABLE BLOCK, NOT A NUMBERED SET. ADDED 4 Oct 2026 ───────
 *
 *     These are run in a web SQL editor. Five pastes is four too many, and a
 *     set invites running three of five and reporting a pass.
 *
 *     SHAPE: one `begin; do $v$ … $v$; rollback;` — sections inside it, each in
 *     its own `begin/exception` subtransaction so one failure does not lose the
 *     others, every result accumulated into a variable, ONE `raise` at the end.
 *
 *     ⚠️ TWO HAZARDS THAT ONLY EXIST ONCE SECTIONS SHARE A TRANSACTION. Both
 *     bit 0081's verify when it was merged from a numbered set:
 *
 *     1. **`created_at` DEFAULTS TO `now()`, WHICH IS CONSTANT FOR THE WHOLE
 *        TRANSACTION.** Rows written by different sections therefore TIE, and
 *        `order by created_at desc limit 1` picks between them arbitrarily. A
 *        read-back must be disambiguated by something else — the type, or a set
 *        of ids captured before the call. Note that `notifications.id` is a
 *        `gen_random_uuid()`, so ordering by id is not a substitute: it is not
 *        monotonic.
 *
 *     2. **A SECTION THAT READS A ROW BACK MUST PROVE THE ROW IS NEW.** Capture
 *        what exists before the call and exclude it afterwards, and SAY SO in
 *        the output. Otherwise "the function errored and an older row was
 *        already there" reads as a pass.
 *
 *        ⚠️ THIS IS NOT A PRECAUTION. IT FIRED, ON 0081, 4 Oct 2026.
 *
 *        Run against the database BEFORE 0081 was applied, section (c) printed
 *        the exact expected title, the exact expected body and the exact
 *        expected provider_id — **for a function that did not exist yet.** The
 *        row was a pre-existing Salon Floor invite written by the web client.
 *
 *        And it looked right for the WORST possible reason: 0081 consolidates
 *        the invite copy onto the WEB wording, and that stale row was written
 *        by the web client. **The row most likely to be lying was also the row
 *        most likely to look correct.**
 *
 *        The guard happened to be on section (e) and not on (c). (e) reported
 *        NO NEW ROW immediately; (c) said nothing and read as a clean pass.
 *
 *        ⚠️ GENERAL FORM, worth more than the instance: **whenever a change
 *        consolidates several existing variants onto one of them, every
 *        pre-existing row already written in that variant becomes
 *        indistinguishable from the change's own output.** Those are exactly
 *        the migrations where a read-back without a new-row guard cannot fail.
 *
 *        It is the same fault as a check that cannot fail, arriving through the
 *        DATA rather than through the logic — the third route to that outcome
 *        this record has logged, after an unordered actor pick (0070) and a
 *        no-op status write (0079).
 *
 *     Roll back at the end regardless. `set local` and `set_config(…, true)` are
 *     undone by a subtransaction abort, so a failing section resets its own
 *     role — but a SUCCEEDING one must reset explicitly.
 *
 *   ── ⚠️ A BLOCK HANDED OVER MUST BE COMPLETE. ADDED 3 Oct 2026 ───────────
 *
 *     Every variable declared in the `declare` section, not listed in a
 *     footnote below the block. 0079's verify named five variables underneath
 *     it as "declare alongside the others", so it would not compile as pasted.
 *     A block someone has to repair before running is a block that gets
 *     skipped — the same failure as the four unrunnable ones above, arrived at
 *     from the opposite direction: not written for the wrong tool, but written
 *     for no tool at all.
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
