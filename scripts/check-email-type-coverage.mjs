#!/usr/bin/env node
/**
 * check-email-type-coverage — the eleven emailable types exist in THREE hand-
 * maintained lists, and two of the three pairings have already drifted.
 * Audit item 151.
 *
 *   1. notify_email's WHEN clause        is an email ATTEMPTED
 *   2. run_email_reconcile's allowlist   is a missing one NOTICED
 *   3. copyFor() in send-email           what the member SEES
 *   4. every type anything WRITES        was this ever decided at all?
 *
 * ⚠️ AXIS 4 EXISTS BECAUSE THE FIRST THREE AGREEING IS NOT ENOUGH. Comparing
 * them to each other means a type present in NONE of them passes silently.
 * `admin_message` is exactly that: written by notify_as_admin, absent from all
 * three, so no email is sent and nothing says whether that was chosen.
 *
 * 0047 did choose it — "Not emailed: new_availability, stylist_invite,
 * admin_message, session_completed… not worth an interruption" — and that is
 * why NOT_EMAILED below exists and why each entry carries its reason. **A type
 * nobody listed is not the same as a type somebody decided not to email, and
 * only one of those is a decision.** Found 4 Oct 2026, when a live
 * notify_as_admin wrote its row correctly and no email arrived.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The drift is not hypothetical and both instances are in the record:
 *
 *   * admin_suspension was in the trigger and NOT the reconciler from 0061 to
 *     0068 — emailed and never checked, across seven migrations (item 135).
 *   * session_not_held was in both SQL lists with no copyFor case, which is how
 *     it acquired an attacker-controlled heading this week (item 144).
 *
 * ⚠️ AND THE ONLY THING HOLDING THEM TOGETHER WAS A COMMENT.
 * run_email_reconcile says "MUST MATCH the notify_email TRIGGER'S WHEN CLAUSE"
 * — and that comment was already there when admin_suspension drifted. A
 * sentence describing a property does not enforce it. This does.
 *
 * ── ⚠️ WHAT THIS CHECK CANNOT DO, STATED RATHER THAN IMPLIED ───────────────
 * IT READS THE REPO, NOT THE DATABASE. The two SQL lists are extracted from the
 * newest migration that defines each. That catches the drift this is for — one
 * list edited and not the others, at the moment it is authored — but it CANNOT
 * see a hand-run change that moved the live definition away from the repo.
 * check-handrun-drift.mjs is the check for that class.
 *
 * A live read is not available to a script: PostgREST exposes tables and RPCs,
 * not pg_get_functiondef, so reading the live bodies needs either a new
 * SECURITY DEFINER RPC or item 154's single source of truth. That is an
 * argument for 154, not a gap to paper over here.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')
const SEND_EMAIL = path.join(ROOT, 'supabase', 'functions', 'send-email', 'index.ts')
const FUNCTIONS = path.join(ROOT, 'supabase', 'functions')

/** Comments are stripped before matching anything. 0028: the artefact of a fix
 *  broke the test for the fix, because pg_get_functiondef includes the comment
 *  explaining the removal. The same trap caught this change being written. */
const stripSql = s => s.replace(/^\s*--.*$/gm, '')
const stripTs = s =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * ⚠️ DELIBERATELY NOT EMAILED. Each entry needs a REASON, because that is the
 * whole difference between a decision and an oversight. Decided in 0047 unless
 * noted.
 *
 * Adding a type here is a choice somebody makes and signs; leaving a type out
 * of here AND out of the three lists is the thing axis 4 refuses to let pass.
 */
const NOT_EMAILED = {
  new_availability:  '0047: a mass send — one per favouriter — so an email each is an interruption per stylist post',
  session_completed: '0047: "not worth an interruption". ⚠ CONTESTED — its body carries the ONLY review prompt in the product, and reviews feed providers.rating/review_count, the fields a stylist builds credibility with. A prompt that reaches only people who open the app is a weak version of the thing it is for. Item 159, UNDECIDED',
}

/**
 * Types built at runtime rather than written as a literal, so no regex can find
 * them in an insert. Each needs its source named.
 */
const DYNAMIC = {
  session_accepted:  "notify_session_transition: 'session_' || p_to (0078)",
  session_declined:  "notify_session_transition: 'session_' || p_to (0078)",
  session_completed: "notify_session_transition: 'session_' || p_to (0078)",
}

const files = readdirSync(MIGRATIONS).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()

/** The newest migration whose stripped body matches, so a later redefinition
 *  wins over the one that introduced it. */
function newestMatching(re) {
  for (let i = files.length - 1; i >= 0; i--) {
    const body = stripSql(readFileSync(path.join(MIGRATIONS, files[i]), 'utf8'))
    if (re.test(body)) return { file: files[i], body }
  }
  return null
}

const fail = msg => { console.error(`email type coverage — ${msg}`); process.exit(1) }

// ── 1. notify_email's WHEN clause ──────────────────────────────────────────
const trig = newestMatching(/create trigger notify_email\b/)
if (!trig) fail('no migration defines the notify_email trigger. The check cannot run, which is not a pass.')
const whenClause = trig.body.slice(trig.body.search(/create trigger notify_email\b/))
const whenBlock = whenClause.match(/when\s*\(([\s\S]*?)\)\s*execute/i)
if (!whenBlock) fail(`found the trigger in ${trig.file} but not its WHEN clause. Shape changed — read it before trusting this.`)
const triggerTypes = new Set([...whenBlock[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]))

// ── 2. run_email_reconcile's allowlist ─────────────────────────────────────
const rec = newestMatching(/create or replace function public\.run_email_reconcile\b/)
if (!rec) fail('no migration defines run_email_reconcile. The check cannot run, which is not a pass.')
const recBody = rec.body.slice(rec.body.search(/create or replace function public\.run_email_reconcile\b/))
const inList = recBody.match(/n\.type\s+in\s*\(([\s\S]*?)\)/i)
if (!inList) fail(`found run_email_reconcile in ${rec.file} but not its type list. Shape changed — read it before trusting this.`)
const reconcilerTypes = new Set([...inList[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]))

// ── 3. copyFor's cases ─────────────────────────────────────────────────────
const ts = stripTs(readFileSync(SEND_EMAIL, 'utf8'))
const copyForAt = ts.search(/function copyFor\s*\(/)
if (copyForAt === -1) fail('copyFor() not found in send-email. The check cannot run, which is not a pass.')
const copyForBody = ts.slice(copyForAt)
const copyTypes = new Set([...copyForBody.matchAll(/case\s+'([a-z_]+)'/g)].map(m => m[1]))

// ── compare ────────────────────────────────────────────────────────────────
const problems = []
for (const t of triggerTypes) {
  if (!reconcilerTypes.has(t)) problems.push(`${t}: EMAILED but not RECONCILED — a failure to send it is invisible (this is item 135's shape)`)
  if (!copyTypes.has(t)) problems.push(`${t}: EMAILED but has no copyFor case — it falls to the default and gets a generic subject`)
}
for (const t of reconcilerTypes) {
  if (!triggerTypes.has(t)) problems.push(`${t}: RECONCILED but not emailed — the reconciler counts a type the trigger never sends, so emailable is overstated`)
}
for (const t of copyTypes) {
  if (!triggerTypes.has(t)) problems.push(`${t}: has copyFor copy but is NOT emailed — dead copy, or a type that should be in the trigger`)
}

// ── 4. every type anything actually WRITES ─────────────────────────────────
//
// ⚠️⚠️ THE FIRST VERSION OF THIS AXIS COULD NOT FAIL, AND IT WAS WRITTEN ONE
// PARAGRAPH AFTER A COMMENT ABOUT CHECKS THAT CANNOT FAIL.
//
// It collected candidate type strings and then kept only those already present
// in one of the three lists or in NOT_EMAILED — a filter added to suppress
// false positives from column names and copy. The effect: a type in NO list
// could never enter the set, and this axis iterates the set. Removing
// `admin_message` from NOT_EMAILED — the precise case the axis exists for —
// produced exit 0. Proved by trying it, 4 Oct 2026.
//
// THE FIX IS A POSITIONAL PARSE, which needs no vocabulary and therefore cannot
// be circular: find `type` in the insert's own column list, then take the
// expression at that index. A bare quoted literal is the type. Anything built
// at runtime is not a literal and is covered by DYNAMIC above, declared by hand
// with its source named.
const written = new Set(Object.keys(DYNAMIC))

/** Split a parenthesised list on top-level commas only. */
function topLevel(list) {
  const out = []
  let depth = 0, cur = '', q = null
  for (const ch of list) {
    if (q) { cur += ch; if (ch === q) q = null; continue }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue }
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** Pull the type out of one `insert into … (cols) values (…)|select …`. */
function typesFromInsert(cols, rest) {
  const idx = topLevel(cols).findIndex(c => c.trim().toLowerCase() === 'type')
  if (idx === -1) return []
  const found = []
  const vals = rest.matchAll(/values\s*\(([\s\S]*?)\)\s*(?:returning|;|$)/gi)
  for (const v of vals) {
    const parts = topLevel(v[1])
    const lit = (parts[idx] ?? '').match(/^'([a-z_]+)'$/)
    if (lit) found.push(lit[1])
  }
  // `insert … select a, b, c from …` — take the nth select expression
  const sel = rest.match(/select\s+([\s\S]*?)\sfrom\s/i)
  if (sel) {
    const parts = topLevel(sel[1])
    const lit = (parts[idx] ?? '').match(/^'([a-z_]+)'$/)
    if (lit) found.push(lit[1])
  }
  return found
}

for (const f of files) {
  const body = stripSql(readFileSync(path.join(MIGRATIONS, f), 'utf8'))
  const rx = /insert\s+into\s+public\.notifications\s*\(([^)]*)\)([\s\S]{0,1400}?);/gi
  for (const m of body.matchAll(rx)) {
    for (const t of typesFromInsert(m[1], m[2])) written.add(t)
  }
}

// ── and the EDGE FUNCTIONS, which are not migrations and not clients ──────
// ⚠️ ADDED AFTER THE COUNTS FAILED TO RECONCILE. The first version scanned only
// the migrations and reported "13 written" against 11 emailed + 3 declared = 14.
// The missing one was `payment_failed`, written by
// supabase/functions/stripe-webhook/index.ts — an edge function. The comment
// here previously claimed the unscanned path was the CLIENT side and named
// `verification` as the only type at risk. Both were wrong: `verification` is
// written by a migration (admin_decide_verification), and the real gap was a
// third category nobody had listed.
//
// A count that does not reconcile is a reading that is wrong somewhere.
for (const dir of readdirSync(FUNCTIONS, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue
  const f = path.join(FUNCTIONS, dir.name, 'index.ts')
  let body
  try { body = stripTs(readFileSync(f, 'utf8')) } catch { continue }
  const rx = /from\(['"]notifications['"]\)[\s\S]{0,600}?\.insert\(([\s\S]{0,600}?)\)/gi
  for (const m of body.matchAll(rx)) {
    for (const t of m[1].matchAll(/type:\s*['"]([a-z_]+)['"]/g)) written.add(t[1])
  }
}

// ⚠️ THE CLIENT SIDE IS STILL NOT SCANNED, and that is now a one-line gap:
// after item 144's stages A–D there is exactly ONE client notification insert
// left — admin/app/verification/page.tsx, the approval notice, which 0082
// moves. Its type is `verification`, which a migration also writes, so nothing
// is currently missed. When 0082 lands, every write is in the database or an
// edge function and this scan is complete.

for (const t of written) {
  if (!triggerTypes.has(t) && !Object.hasOwn(NOT_EMAILED, t)) {
    problems.push(`${t}: WRITTEN but in no email list and not declared NOT_EMAILED — nobody has decided whether this should email. That is not the same as deciding not to.`)
  }
}
for (const t of Object.keys(NOT_EMAILED)) {
  if (triggerTypes.has(t)) {
    problems.push(`${t}: declared NOT_EMAILED but present in notify_email's WHEN clause — it IS emailed. One of the two is wrong.`)
  }
  if (!written.has(t)) {
    problems.push(`${t}: declared NOT_EMAILED but nothing writes it — dead declaration, or the type was renamed.`)
  }
}

const where = `trigger ${trig.file}, reconciler ${rec.file}, copyFor send-email/index.ts`
if (problems.length) {
  console.error('email type coverage — THE THREE LISTS DISAGREE\n')
  for (const p of problems) console.error(`  ${p}`)
  console.error(`\n  read from: ${where}`)
  console.error('  All three are copies of one list. Fix the list that is wrong, not this check.')
  process.exit(1)
}

console.log(
  `email type coverage — ${triggerTypes.size} emailed, ${Object.keys(NOT_EMAILED).length} declared not-emailed, ` +
  `${written.size} written in all; the trigger, the reconciler and copyFor agree ` +
  `(read from the REPO, not the database: a hand-run change to either function is invisible here — ` +
  `that is check-handrun-drift.mjs's job)`
)
