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
 *   * ⚠⚠ STATE THE EXPECTED ANSWER BEFORE RUNNING A LOOKUP, AND NAME THE
 *     MECHANISM FOR EACH PART OF IT. Twice on 6 Oct 2026 this is what turned a
 *     read into evidence:
 *
 *       item 190 — four candidate signatures written down with their lengths and
 *         md5s; the second was measured, so one number distinguished four worlds
 *         and killed the competing hypothesis in the same breath.
 *       item 193 — ELEVEN NOT NULL columns predicted with a named setter each;
 *         SEVEN returned. The GAP was the finding: four columns nullable that
 *         three separate guards assume are not.
 *
 *     ⚠️ THE POINT IS NOT THAT PREDICTIONS ARE USUALLY RIGHT. A wrong prediction
 *     LOCALISES THE SURPRISE — it says which rows to look at. A lookup with no
 *     stated expectation has nothing to be surprised against, so it gets read,
 *     accepted, and quoted later as though it had been checked.
 *
 *     And an enumeration says what EXISTS, never what MAINTAINS it: a NOT NULL
 *     column filled by a BEFORE trigger is indistinguishable in
 *     information_schema from one filled by the insert. The attribution is the
 *     finding; the list is just the prompt for it.
 *
 *   * ⚠⚠ NEVER `type <file> | clip` FOR SQL ON THIS MACHINE. Measured 6 Oct
 *     2026, on a file verified clean beforehand (no BOM, no CR, LF only):
 *
 *                            after `type | clip`   after the fix
 *       first char is a BOM        TRUE                false
 *       has em-dash U+2014         false               TRUE
 *       has U+00E2 (mojibake)      TRUE                false
 *
 *     TWO independent faults. `clip.exe` PREPENDS A BOM, so the paste begins
 *     `﻿do $$` and Postgres rejects the first statement. And PowerShell 5.1's
 *     `type` (Get-Content with no -Encoding) decodes a BOM-less UTF-8 file as
 *     CP1252, so every em-dash and every ⚠️ becomes `â€”`-style mojibake —
 *     harmless in a comment, visible in a raise message, and silent either way.
 *
 *     Use instead:
 *
 *       Set-Clipboard -Value (Get-Content -Raw -Encoding UTF8 <file>)
 *
 *     ⚠️ SAME CLASS AS ITEM 190, FROM THE OTHER DIRECTION: the SQL editor adds CR
 *     on the way IN, clip mangles UTF-8 on the way OUT, and neither is visible
 *     until something compares bytes. Any pipeline that carries SQL between a
 *     file and the editor is a place to check lengths and hashes, not to trust.
 *
 *   * ⚠⚠ A BLOCK IS PRINTED, NEVER DESCRIBED. Micky, 6 Oct 2026, on the third
 *     occurrence: *"the third time a block has been described rather than
 *     printed — worth noticing as a habit rather than as three separate
 *     omissions."*
 *
 *     A preflight or verify summarised as "it reads the ownership, the body and
 *     the status list, expect all true" cannot be run, cannot be checked against
 *     the file, and silently invites a retyped approximation of itself — which is
 *     the two-copies fault (item 190) arriving through prose. The block is the
 *     deliverable; the description is at best a caption for it.
 *
 *     So: print it from the FILE, in full, in one fence, every time it is
 *     handed over — including when it has already been handed over once and
 *     changed since, because that is exactly when a reader uses the older copy.
 *
 *   * ⚠⚠ AN ID A BLOCK DEPENDS ON IS RESOLVED AND PRINTED, NEVER PASTED IN.
 *     Micky, 6 Oct 2026, after 0089's verify:
 *
 *       "An id a block depends on should be resolved and printed, not pasted in."
 *
 *     0089's block hardcoded v_admin from 0057's own verify, where it is labelled
 *     "must be in public.admins". It is not one. The block would have reported
 *     SKIPPED on two of five sections — not a failure, but TWO SECTIONS PROVING
 *     NOTHING INSIDE A BLOCK THAT LOOKS MOSTLY GREEN, which is item 188's class
 *     wearing a different hat. So:
 *
 *       select a.user_id into v_admin from public.admins a limit 1;
 *       if v_admin is null then raise exception 'no admin row; nothing tested'; end if;
 *
 *     and PRINT it as line 0 of the output, so the result says what it tested
 *     rather than leaving it to be assumed. The same goes for a provider id, a
 *     session id, or anything else resolved from data: print what was used.
 *
 *   * ⚠⚠ A BODY THAT MUST MATCH AN EXACT STRING IS BUILT FROM chr(10) AND
 *     PASSED THROUGH format(). The Supabase SQL editor CONVERTS LF TO CRLF ON
 *     PASTE — measured 6 Oct 2026, item 190, by predicting four signatures and
 *     measuring the second. So a body written as literal multi-line SQL arrives
 *     with CRLF while a chr(10)-built comparison string stays LF, and the two
 *     render IDENTICALLY in every error message. 0089 refused itself on exactly
 *     this.
 *
 *       execute format('create or replace function … as $f$%s$f$', v_want);
 *
 *     Two copies of one string is the fault; only one of them survives a
 *     clipboard. And a textual anchor on a function body MUST NOT SPAN A LINE
 *     BREAK for the same reason — 241 anchors across 29 migrations happen not to,
 *     by habit rather than by rule, which is why it is now a rule.
 *
 *   * ⚠️ A REFUSAL THAT COMPARES STRINGS PRINTS length AND md5, AND hex WHEN THE
 *     STRINGS ARE SHORT. 0089's first version printed two delimited bodies that
 *     RENDERED IDENTICALLY, because the difference was invisible whitespace. It
 *     fired correctly and reported unactionably — item 188's class one step
 *     along: a check that fails informatively to itself and opaquely to its
 *     reader. md5 says THAT they differ; encode(convert_to(x,'UTF8'),'hex') says
 *     HOW, which for a stray 0d or a missing 0a is the only actionable form.
 *
 *   * ⚠⚠ A VERIFY THAT TESTS WHAT A ROLE *CAN* DO MUST ALSO COUNT WHAT IT CAN
 *     DO IN TOTAL. Micky, 6 Oct 2026, after 0088:
 *
 *       "A verify that tests what a role CAN do and never counts what it can do
 *        in total proves the named cases and nothing about the ones nobody
 *        thought to name. The count is what catches a column accidentally
 *        retained."
 *
 *     0088's block proved eight named columns writable and five named columns
 *     refused, and would have passed unchanged with a sixteenth column left in
 *     the grant by a typo — because nothing asked how many there were. The two
 *     lines that close that gap:
 *
 *       select count(*) ... where grantee = 'authenticated' and privilege_type = 'UPDATE'
 *       select string_agg(table_name || '.' || column_name, ', ' order by 1) ...
 *
 *     The COUNT catches an extra; the LIST says which, so a mismatch is
 *     actionable rather than just alarming. And the count for the role that is
 *     supposed to hold NOTHING (anon, here) is the other half — a revoke that
 *     silently missed a role reads exactly like one that worked.
 *
 *     This sits alongside the outside-the-list control, and it is not the same
 *     check: the control proves the migration did not reach too FAR, the count
 *     proves it reached FAR ENOUGH.
 *
 *   * ⚠⚠ WHEN A REPO READ AND A LIVE READ DISAGREE, THE LIVE READ IS RIGHT,
 *     AND THE USUAL CAUSE IS A BOUNDARY THE PARSER GOT WRONG RATHER THAN A
 *     STALE FILE. Three times on 6 Oct 2026 a repo read contradicted a live
 *     one and was wrong every time. The mechanism, recorded because the
 *     instances keep differing and the mechanism does not:
 *
 *       A FUNCTION BODY IS NOT RELIABLY DELIMITED BY `$$`. Postgres writes
 *       `as $function$` when it round-trips a definition, so migrations
 *       written against pg_get_functiondef() output carry a mix of `$$` and
 *       `$function$` — sometimes in the same file. A matcher that ends a body
 *       at `$$;` RUNS PAST THE END of any `$function$` body and reads the NEXT
 *       function's header. That is how _admin_apply_user_action was reported
 *       SECURITY DEFINER on 6 Oct when all seven of its definitions declare no
 *       mode at all and the live catalogue said INVOKER.
 *
 *     The failure is silent and it is confident: the match succeeds, it is
 *     just a match against the wrong object. So —
 *
 *       - Delimit a body by the NEXT `create ... function` boundary, never by
 *         a closing dollar-quote tag you guessed.
 *       - Take security mode, volatility and the argument list from pg_proc
 *         (`prosecdef`, `provolatile`, `pg_get_function_identity_arguments`),
 *         never by grepping the source text for them.
 *       - A repo-derived claim about a live object is a HYPOTHESIS. Put it in
 *         the migration's GUARD so the database refuses it if it is wrong,
 *         rather than in the header where it merely reads as true. 0088 does
 *         this for the two cleared INVOKER writers.
 *
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
 *   ── ✅ THE EDITOR APPENDS `ALTER TABLE … ENABLE ROW LEVEL SECURITY` ───
 *
 *     **CAUSE FOUND 6 Oct 2026, IN THE POSTGRES LOG. Two earlier explanations
 *     in this file were wrong and are withdrawn.**
 *
 *     The Supabase SQL editor appends, to the end of a paste it believes
 *     created a table:
 *
 *         -- Added by Supabase: enable Row Level Security on newly created tables
 *         ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;
 *
 *     That is a statement NEITHER AUTHOR WROTE, and it is the source of both
 *     behaviours this file previously blamed on the author's own SQL:
 *
 *       1. 0079's verify block "being rewritten" with
 *          `ALTER TABLE v_other ENABLE ROW LEVEL SECURITY` spliced in, breaking
 *          the dollar quoting. Blamed first on `record` declarations, then on
 *          `select … into`. **Both wrong.** The append matched a NAME it should
 *          not have matched.
 *       2. On 6 Oct, a block using `create temp table _target on commit drop`
 *          reported `relation _target does not exist` — because the append ran
 *          AFTER `commit;`, by which point `on commit drop` had dropped the
 *          table. The editor showed that 42P01 **in place of the trailing
 *          select's result**, and a correct, fully-guarded delete looked as
 *          though it had run without its guard.
 *
 *     ⚠️ THE SCALAR-SUBQUERY WORKAROUND WAS AIMED AT THE WRONG THING. It does
 *     no harm and is fine to keep using, but it is NOT a rule with a reason
 *     behind it. `select … into` never caused anything.
 *
 *     ✅ THE RULE THAT SURVIVES, AND IT IS THE ONE THAT FOUND THIS:
 *
 *         AN ERROR SHOWN BY THE SQL EDITOR MAY COME FROM A STATEMENT THE
 *         EDITOR ADDED. DIAGNOSE FROM THE LOGGED STATEMENT TEXT, NOT FROM THE
 *         ERROR.
 *
 *     Three hypotheses were built on 6 Oct from an error message belonging to
 *     somebody else's statement — pooled connections, `begin;` not holding,
 *     and a "guard and action in one statement" rule that was briefly wired
 *     into CI before the log retracted it. `pg_stat_statements` could not
 *     settle it: it carries neither timestamps nor session identity. **The log
 *     did, in one line.**
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
