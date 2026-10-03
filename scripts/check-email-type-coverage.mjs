#!/usr/bin/env node
/**
 * check-email-type-coverage — the eleven emailable types exist in THREE hand-
 * maintained lists, and two of the three pairings have already drifted.
 * Audit item 151.
 *
 *   1. notify_email's WHEN clause        is an email ATTEMPTED
 *   2. run_email_reconcile's allowlist   is a missing one NOTICED
 *   3. copyFor() in send-email           what the member SEES
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

/** Comments are stripped before matching anything. 0028: the artefact of a fix
 *  broke the test for the fix, because pg_get_functiondef includes the comment
 *  explaining the removal. The same trap caught this change being written. */
const stripSql = s => s.replace(/^\s*--.*$/gm, '')
const stripTs = s =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

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

const where = `trigger ${trig.file}, reconciler ${rec.file}, copyFor send-email/index.ts`
if (problems.length) {
  console.error('email type coverage — THE THREE LISTS DISAGREE\n')
  for (const p of problems) console.error(`  ${p}`)
  console.error(`\n  read from: ${where}`)
  console.error('  All three are copies of one list. Fix the list that is wrong, not this check.')
  process.exit(1)
}

console.log(
  `email type coverage — ${triggerTypes.size} type(s); the trigger, the reconciler and copyFor agree ` +
  `(read from the REPO, not the database: a hand-run change to either function is invisible here — ` +
  `that is check-handrun-drift.mjs's job)`
)
