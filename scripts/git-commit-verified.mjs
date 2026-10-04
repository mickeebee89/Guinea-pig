#!/usr/bin/env node
/**
 * git-commit-verified — commit from a message FILE and prove the message
 * arrived intact. Audit item 146.
 *
 *   node scripts/git-commit-verified.mjs <message-file> [-- <paths to add>]
 *
 * ── WHY THIS EXISTS RATHER THAN A RULE ─────────────────────────────────────
 * The rule "never put backticks inside a double-quoted shell string; use
 * `git commit -F <file>`" was written as item 146 and then broken THREE times
 * by its own author, within two days:
 *
 *   1. The original: backticks executed and DEPLOYED AN EDGE FUNCTION.
 *   2. A nine-paragraph `-m` chain whose backticks ran `into` as a command;
 *      the commit succeeded and silently lost the word twice.
 *   3. A `printf` chain with an unbalanced quote; the whole command died and
 *      nothing was applied.
 *
 * **A rule its author has broken three times is not working as a rule.** The
 * middle case is the one that matters: the commit SUCCEEDED, so there was
 * nothing to notice. This script makes that case visible.
 *
 * ── WHAT IT DOES ───────────────────────────────────────────────────────────
 * Commits with `-F`, then reads the message back with `git log -1 --format=%B`
 * and compares it to the file. A mismatch is reported with a diff and exits 1.
 *
 * ⚠️ TRAILING NEWLINE IS NORMALISED, AND THAT DETAIL IS LOAD-BEARING.
 * `--format=%B` appends one. Comparing raw reports a difference on EVERY
 * commit — a check that always fails, which is as useless as one that cannot,
 * and would have been shipped had the comparison not been run by hand first.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const sep = argv.indexOf('--')
const msgFile = argv[0]
const paths = sep === -1 ? [] : argv.slice(sep + 1)

if (!msgFile || msgFile === '--') {
  console.error('usage: node scripts/git-commit-verified.mjs <message-file> [-- <paths>]')
  process.exit(2)
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8' })

let want
try {
  want = readFileSync(msgFile, 'utf8')
} catch (e) {
  console.error(`cannot read message file: ${msgFile}`)
  process.exit(2)
}
if (!want.trim()) {
  console.error('the message file is empty — refusing to commit a blank message')
  process.exit(2)
}

if (paths.length) git(['add', ...paths])

const staged = git(['diff', '--cached', '--name-only']).trim()
if (!staged) {
  console.error('nothing staged — refusing to create an empty commit')
  process.exit(2)
}

git(['commit', '-q', '-F', msgFile])

// ⚠️ Normalise the trailing newline only. Anything else differing is real.
const norm = (s) => s.replace(/\n+$/, '')
const got = git(['log', '-1', '--format=%B'])

if (norm(want) !== norm(got)) {
  console.error('⚠️ THE COMMITTED MESSAGE DOES NOT MATCH THE FILE.\n')
  const w = norm(want).split('\n')
  const g = norm(got).split('\n')
  for (let i = 0; i < Math.max(w.length, g.length); i++) {
    if (w[i] !== g[i]) {
      console.error(`  line ${i + 1}`)
      console.error(`    file:      ${w[i] ?? '(absent)'}`)
      console.error(`    committed: ${g[i] ?? '(absent)'}`)
    }
  }
  console.error('\n  The commit EXISTS with the wrong message. Fix with:')
  console.error(`    git commit --amend -F ${msgFile}`)
  console.error('  and re-run this. Do not push a commit whose message you have not verified.')
  process.exit(1)
}

const sha = git(['rev-parse', '--short', 'HEAD']).trim()
const files = staged.split('\n').length
console.log(`committed ${sha} — ${files} file(s), message verified byte-for-byte against ${msgFile}`)
