#!/usr/bin/env node
/**
 * check-migration-forward-refs — a promise that names a migration number points
 * at nothing the moment the number is reused. Audit item 155.
 *
 * ── THE FAULT, THREE TIMES ─────────────────────────────────────────────────
 *   1. 0077: "the verification APPROVAL notice stays in the client until 0078".
 *      0078 became stage B. The promise pointed at nothing and nobody noticed
 *      for a week.
 *   2. 0034: "the drop goes in 0035". 0035 became admin_act_on_user.
 *      `providers.status_text` and `status_expires_at` are STILL in the live
 *      database, read by nothing, dropped by nothing.
 *   3. The forward-number check and the -F verification were both deferred
 *      "with 0082". 0082 became the admin_message migration. **Deferred by the
 *      person who had written the rule against it, one day earlier.**
 *
 * ── WHAT THIS FAILS ON, AND WHY THAT EXACT RULE ────────────────────────────
 * A comment citing a migration number that DOES NOT EXIST ON DISK.
 *
 * That is the dangerous case and the whole of it. A reference to a migration
 * that exists is harmless — either the plan was carried out, or it is in flight
 * and visible. A reference to a number not yet allocated is a promise about a
 * file nobody has written, and sequence allocation means the next migration
 * takes that number for whatever it happens to be about.
 *
 * It needs no grandfathering, which is why this rule and not a stricter one:
 * the repo has ~100 forward references today and every one of them names a file
 * that exists. So the check passes on history as written and bites only on new
 * promises — and it would have caught all three above at the moment they were
 * typed.
 *
 * ── WHAT TO WRITE INSTEAD ──────────────────────────────────────────────────
 * Name the CONDITION, not the number:
 *
 *   ✗ "stays in the client until 0078"
 *   ✓ "stays in the client until the approval notice has a definer function"
 *
 * The first is checkable by nothing. The second is checkable by reading the
 * database, and stays true whichever number does the work. And raise an audit
 * item at the moment of deferral — an applied migration's prose cannot be
 * corrected, so a promise written there can only be abandoned.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.join(HERE, '..', 'supabase', 'migrations')

const files = readdirSync(DIR).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()
const exists = new Set(files.map(f => f.slice(0, 4)))

const problems = []
for (const f of files) {
  const own = f.slice(0, 4)
  const lines = readFileSync(path.join(DIR, f), 'utf8').split('\n')
  lines.forEach((l, i) => {
    const st = l.trim()
    if (!st.startsWith('--')) return          // prose only
    // ⚠️ THE LEADING ZERO IS REQUIRED. An earlier version matched
      // /\b\d{4}\b/ and reported every YEAR in every comment — 2026, 1990,
      // a date of birth inside a verify block. Migration files are 0000-0999,
      // so the zero is what separates a migration reference from a year, and
      // the check was useless without it. Found by RUNNING it, not reading it.
      // ⚠️ AND NOT ADJACENT TO A DOT, A QUOTE OR A DIGIT. The leading-zero
      // version still reported two, both DATA inside verify blocks: a longitude
      // `0.0148` and a phone number `'0161 496 0000'` from 0072's digit-rule
      // test set. Verify blocks are comments, so "prose only" does not exclude
      // them. A real citation is surrounded by words; a number inside a literal
      // is not. Both false positives were found by running the check, which is
      // the third thing this one check has taught by being run rather than read.
      // ⚠️ AND A FOLLOWING FULL STOP IS FINE — ONLY A DECIMAL IS NOT.
      // The previous lookahead was (?![.\d]), which excluded "until 0099." — the
      // most natural way to write the exact thing this check looks for. So the
      // fix for two false POSITIVES created a false NEGATIVE, which is worse,
      // and the drift test caught it: injecting "deferred until 0099." produced
      // exit 0. Only (?!\.\d) — a decimal point followed by a digit — excludes.
      //
      // Three faults in this one regex, all found by running it and none by
      // reading it: years matched, literals matched, sentence-final citations
      // missed. The last was only visible because the drift test existed.
      for (const m of st.matchAll(/(?<![.'\d])(0\d{3})(?!\d)(?!\.\d)/g)) {
      const cited = m[1]
      if (cited <= own) continue              // backward or self: fine
      if (exists.has(cited)) continue         // forward but allocated: visible
      problems.push({ file: f, line: i + 1, cited, text: st.replace(/^-+\s*/, '').slice(0, 110) })
    }
  })
}

if (problems.length) {
  console.error('migration forward refs — A PROMISE NAMES A MIGRATION THAT DOES NOT EXIST\n')
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line} cites ${p.cited}, which is not on disk`)
    console.error(`    ${p.text}`)
  }
  console.error('\n  Sequence allocation means the next migration takes that number for')
  console.error('  whatever it is about. Name the CONDITION instead, and raise an audit item')
  console.error('  at the moment of deferral. See this file\'s header for the three instances.')
  process.exit(1)
}

console.log(
  `migration forward refs — ${files.length} migration(s); no comment cites a migration that does not ` +
  `exist (it does NOT check that a promise was kept — only that its number was allocated)`
)
