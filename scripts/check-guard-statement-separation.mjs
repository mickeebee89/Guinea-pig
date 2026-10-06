#!/usr/bin/env node
/**
 * check-guard-statement-separation — a guard in a different statement from the
 * action it guards does not stop that action. Audit item 178.
 *
 *   node scripts/check-guard-statement-separation.mjs
 *   node scripts/check-guard-statement-separation.mjs --write-baseline
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 * On 6 Oct 2026 nine rows were deleted from production by a block whose guard
 * had already raised. The paste was `begin;` → `create temp table` → DO guard →
 * `delete … using` that temp table → DO post-condition → `commit;`. The editor
 * reported `relation _target does not exist` AGAINST THE GUARD, and
 * `pg_stat_statements` afterwards showed all three statements with calls=1 and
 * the delete with rows=9. The rows were gone and committed.
 *
 * ⚠️⚠️ THE CAUSE IS NOT KNOWN, AND TWO EXPLANATIONS HAVE BEEN REFUTED.
 *
 *   1. Pooled connections spreading statements across sessions — refuted. A
 *      probe recording pg_backend_pid() and txid_current() either side of a
 *      deliberate raise returned NO rows after the error: atomic.
 *   2. `begin;`/`commit;` not taking effect — refuted. The same probe with the
 *      transaction restored behaved identically: also atomic.
 *
 * Neither probe reproduces the incident. **This file does not guess at a
 * third.** It is recorded the way scripts/migration-status.mjs records the
 * temp-table rule as false: the observation, the refuted explanations, and no
 * cause. The remaining primary source is the Supabase Postgres log, which
 * carries timestamps and session identity where pg_stat_statements carries
 * neither (audit item 180).
 *
 * ── THE RULE, WHICH DOES NOT DEPEND ON THE MECHANISM ────────────────────
 *
 *     GUARD AND ACTION IN ONE STATEMENT, OR THE GUARD IS THEATRE.
 *
 * A separated guard has been observed, once, failing to stop a delete on
 * production. That is sufficient grounds without knowing why. ⚠️ Waiting for a
 * mechanism before adopting it would be the same error as writing a rule from
 * one error message plus an assumption — just in the other direction.
 *
 * In practice:
 *
 *   · DML — put the guard in the action's own statement. A data-modifying CTE
 *           does it:  with guard as (…), del as (delete … using guard g
 *           where … and g.n = 9 and g.outsiders = 0 returning 1) select …
 *   · DDL — revoke/grant/drop/alter take no WHERE, so issue them with
 *           `execute` INSIDE the guarding DO block. ✅ 0084 already does
 *           exactly that and is the ONLY migration absent from the baseline —
 *           a shape arrived at for drift-avoidance that turned out to be the
 *           only correct one.
 *   · A `begin; … commit;` wrapper is NOT a substitute. It was there. It did
 *     not hold.
 *
 * ── WHY NODE AND NOT PYTHON ─────────────────────────────────────────────
 * This was written in Python first. `npm run checks` runs in three GitHub
 * Actions workflows, where `python` is not a command on Ubuntu runners
 * (`python3` is) while Windows wants `python`. A check that reds the build for
 * a reason unrelated to the check is one that gets switched off, so it was
 * ported rather than wired as-is. One implementation, not two — a second copy
 * would be item 162's class.
 *
 * ── THE BASELINE ────────────────────────────────────────────────────────
 * 74 files already carry the separated shape and are NOT rewritten here;
 * doing that in one night is how a safety change becomes the outage. They are
 * listed in check-guard-statement-separation.baseline with a SHA-256 of each
 * file, so:
 *
 *   · a NEW file with a separated guard fails immediately;
 *   · a grandfathered file that is EDITED loses its exemption, because its
 *     hash stops matching. Touching one means fixing it.
 *
 * ⚠️ `supabase/cleanup-consentless-test-sessions.sql` is the one to fix first:
 * its abort guards five deletes, and it is the file someone reaches for when a
 * delete has already gone wrong.
 *
 * ⚠️ WHAT A PASS DOES NOT MEAN. It does not mean the 74 are safe. It means
 * none is new and none has been edited. The same honest limit
 * check-types-freshness.mjs and check-handrun-drift.mjs both state about
 * themselves.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const BASELINE = path.join(HERE, 'check-guard-statement-separation.baseline')

const ACTION = /^\s*(delete\s+from|update\s+|drop\s+|revoke\s+|alter\s+table|truncate|insert\s+into)/i

/** Top-level semicolons only, respecting $tag$ quoting, '' literals and -- comments. */
function splitStatements(sql) {
  const out = []
  let buf = '', i = 0, tag = null
  const n = sql.length
  while (i < n) {
    if (tag === null) {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (m) { tag = m[0]; buf += tag; i += tag.length; continue }
      if (sql[i] === "'") {
        let j = i + 1
        while (j < n) {
          if (sql[j] === "'") {
            if (j + 1 < n && sql[j + 1] === "'") { j += 2; continue }
            break
          }
          j++
        }
        buf += sql.slice(i, j + 1); i = j + 1; continue
      }
      if (sql.startsWith('--', i)) {
        let j = sql.indexOf('\n', i)
        if (j === -1) j = n
        buf += sql.slice(i, j); i = j; continue
      }
      if (sql[i] === ';') { out.push(buf); buf = ''; i++; continue }
    } else if (sql.startsWith(tag, i)) {
      buf += tag; i += tag.length; tag = null; continue
    }
    buf += sql[i]; i++
  }
  if (buf.trim()) out.push(buf)
  return out
}

function offenders() {
  const found = []
  for (const sub of ['supabase', path.join('supabase', 'migrations')]) {
    const dir = path.join(ROOT, sub)
    if (!existsSync(dir)) continue
    for (const fn of readdirSync(dir).sort()) {
      if (!fn.endsWith('.sql') || fn.includes('snapshot')) continue
      const rel = path.join(sub, fn).split(path.sep).join('/')
      const raw = readFileSync(path.join(ROOT, rel), 'utf8')
      const digest = createHash('sha256').update(raw.replace(/\r\n/g, '\n'), 'utf8').digest('hex')
      // Verify blocks live below the footer and are comments, not statements.
      const cut = raw.indexOf('-- MIGRATION FOOTER')
      const body = cut === -1 ? raw : raw.slice(0, cut)
      let guardSeen = false
      const verbs = new Set()
      for (const stmt of splitStatements(body)) {
        const s = stmt.replace(/--[^\n]*/g, '').trim()
        if (!s) continue
        if (!guardSeen && /^do\s/i.test(s) && /raise exception/i.test(s)) { guardSeen = true; continue }
        if (guardSeen && ACTION.test(s)) verbs.add(/^\s*(\w+)/.exec(s)[1].toLowerCase())
      }
      if (guardSeen && verbs.size) found.push({ rel, digest, verbs: [...verbs].sort() })
    }
  }
  return found
}

function readBaseline() {
  if (!existsSync(BASELINE)) return {}
  const out = {}
  for (const line of readFileSync(BASELINE, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const [digest, rel] = t.split('  ')
    if (rel) out[rel] = digest
  }
  return out
}

const found = offenders()

if (process.argv.includes('--write-baseline')) {
  const header = [
    '# Files with a guard in a different statement from the action it guards,',
    '# as of the day audit item 178 was found. NOT a list of files that are',
    '# correct — a list of ones not rewritten yet.',
    '#',
    '# The hash is the point: edit a grandfathered file and it stops matching,',
    '# so the exemption lapses and the file must comply.',
    '#',
    '# Regenerate deliberately, never to make a failure go away.',
    '',
  ].join('\n')
  writeFileSync(BASELINE, header + found.map(f => `${f.digest}  ${f.rel}`).join('\n') + '\n')
  console.log(`wrote baseline: ${found.length} file(s)`)
  process.exit(0)
}

const base = readBaseline()
const added = found.filter(f => !(f.rel in base))
const changed = found.filter(f => f.rel in base && base[f.rel] !== f.digest)

if (added.length || changed.length) {
  console.error('guard/action separation — A GUARD IN A DIFFERENT STATEMENT DOES NOT STOP THE ACTION\n')
  for (const f of added) {
    console.error(`  NEW        ${f.rel}`)
    console.error(`             destructive statements after the guard: ${f.verbs.join(', ')}`)
  }
  for (const f of changed) {
    console.error(`  NO LONGER EXEMPT (edited since the baseline)  ${f.rel}`)
    console.error(`             destructive statements after the guard: ${f.verbs.join(', ')}`)
  }
  console.error('\n  Put the guard in the SAME statement as the action. For DDL that means')
  console.error('  issuing it with `execute` inside the guarding DO block — see migration 0084,')
  console.error('  the only one in this directory already built that way.')
  console.error('  Audit item 178. A begin;/commit; wrapper is not a substitute: on 6 Oct 2026')
  console.error('  one was present and nine rows were deleted from production anyway.')
  process.exit(1)
}

console.log(
  `guard/action separation — ${found.length} file(s) carry the separated shape, all ` +
  `grandfathered and unchanged (it does NOT mean they are safe, only that none is new)`)
