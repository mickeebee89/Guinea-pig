/**
 * check-migration-tails — is every line below a migration's COMMIT a comment?
 *
 *   node scripts/check-migration-tails.mjs
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 * Everything after `commit;` in these files is PREFLIGHT and VERIFY: SQL
 * written to be read, copied and pasted by hand, and commented out so that
 * applying the migration does not run it.
 *
 * On 1 Oct 2026 three files shipped with that commenting broken. A multi-line
 * `raise exception E'…\n…'` lost its `--` prefixes partway through, so five
 * lines of a verify block sat in the file as live SQL. Applying 0067 stopped
 * with a syntax error at line 415 — in a region that is supposed to be inert.
 *
 * The cause was mechanical and had already happened twice that week: a
 * backslash escape passed through a shell heredoc arrived with one backslash
 * fewer, so `\\n` became a real newline and split the string across lines the
 * author never saw.
 *
 * ⚠️ WHAT MAKES THIS WORTH A SCRIPT. Nothing else looks at that part of the
 * file. The body is executed the moment the migration is applied, so a fault
 * there is found immediately and loudly. The tail is executed by nobody — it
 * is written, reviewed, committed, pushed, and then pasted into a SQL editor
 * days later by somebody who is not the person who wrote it. This is the
 * NINTH distinct way a verify block has failed in this repo.
 *
 * ── WHAT IT ASKS ────────────────────────────────────────────────────────
 * After `commit;`, every non-blank line must start with `--`. The single
 * exception is `notify pgrst, 'reload schema';`, which several migrations run
 * after committing on purpose.
 *
 * ⚠️ WHAT A PASS DOES NOT MEAN. It does not mean the verify block is CORRECT,
 * or that it tests anything — 0067's borrowed a row that did not exist and
 * would have reported a clean zero. It means only that the tail cannot be
 * executed by accident. The same honest limit the other checks here state.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIG_DIR = join(ROOT, 'supabase', 'migrations')

/** Run after committing on purpose, by several migrations. */
const ALLOWED_AFTER_COMMIT = [/^notify\s+pgrst\s*,\s*'reload schema'\s*;$/i]

let offending = 0
let checked = 0

for (const file of readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort()) {
  const lines = readFileSync(join(MIG_DIR, file), 'utf8').split(/\r?\n/)

  // The LAST top-level commit, because a file may mention the word earlier.
  const commitAt = lines.reduce(
    (found, line, i) => (/^\s*commit\s*;\s*$/i.test(line) ? i : found), -1)
  if (commitAt === -1) continue
  checked++

  for (let i = commitAt + 1; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('--')) continue
    if (ALLOWED_AFTER_COMMIT.some(re => re.test(trimmed))) continue

    offending++
    console.error(
      `${file}:${i + 1}: live SQL below the migration's COMMIT.\n` +
      `  ${trimmed.slice(0, 90)}\n` +
      `  Everything after commit; is PREFLIGHT/VERIFY and must be commented out, or it\n` +
      `  runs when the migration is applied. A multi-line string that lost its -- prefixes\n` +
      `  is the usual cause (see this script's header).`,
    )
  }
}

if (offending > 0) {
  console.error(
    `\nmigration tails — ${offending} executable line(s) below a COMMIT.\n` +
    `Nothing else in the pipeline reads that part of the file.`,
  )
  process.exit(1)
}

console.log(
  `migration tails — ${checked} migration(s) checked; every line below COMMIT is a comment ` +
  `(it does not mean the verify block is correct, only that it cannot run by accident)`,
)
