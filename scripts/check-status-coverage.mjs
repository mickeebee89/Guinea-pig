/**
 * check-status-coverage — can every session status a row may hold actually be
 * SEEN? Audit items 87, 134, 137, 138.
 *
 *   node scripts/check-status-coverage.mjs
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 * A booking's status has to pass two separate gates before a member sees it:
 *
 *   1. `getSessions` filters `.in('status', […])`. A value missing here never
 *      leaves the database.
 *   2. The bookings page sorts rows into Groups by `r.status === '…'`. A value
 *      missing there arrives and renders nowhere.
 *
 * Neither failure looks like a failure. The row does not error, it is simply
 * absent — and absence is indistinguishable from "you have no bookings of that
 * kind", which is a legitimate thing for that screen to say.
 *
 * It has happened four times:
 *
 *   'cancelled'  24 Sep (item 87)   a cancelled booking disappeared from both
 *                                   clients; the only trace was a notification,
 *                                   and notifications are deletable
 *   'expired'     1 Oct (item 134)  added to the Past group first; the row still
 *                                   did not appear, because gate 1 dropped it
 *   'declined'    1 Oct (item 137)  a model who was turned down watched the
 *                                   booking vanish
 *   'not_held'    2 Oct (item 138)  added to gate 1 and not gate 2, so pressing
 *                                   "It didn't happen" made the booking vanish
 *                                   from the screen it was pressed on
 *
 * ⚠️ ALL FOUR WERE FOUND BY A PERSON NOTICING AN ABSENCE. Three of them were
 * found by somebody opening the page and counting rows. The fourth was found
 * because a demo list said PAST (3) where it should have said PAST (4). Nothing
 * automated has ever caught one: they are green to tsc, to eslint, and to the
 * build, because every list involved is a perfectly valid array of strings.
 *
 * The third instance is the sharpest. By then there was a comment in the file
 * explaining this exact pair of gates, written three days earlier after the
 * second instance — and the fourth happened anyway, in that same file, to the
 * person who wrote the comment. Knowing where a trap is does not stop you
 * walking into it. Only something that checks does.
 *
 * ── WHAT IT ASKS ────────────────────────────────────────────────────────
 * Every value `sessions_status_check` permits must appear in BOTH gates.
 *
 * The permitted set is read from the newest migration that defines that
 * constraint, so the check tracks the vocabulary as it grows rather than
 * holding a copy of it that can go stale — which would be this same bug, one
 * level up.
 *
 * ── DELIBERATELY NOT SHOWING ONE ────────────────────────────────────────
 * If a status genuinely should not reach a member, say so where it is decided
 * and the check will accept it:
 *
 *   // STATUS-NOT-SHOWN: <value> <reason>
 *
 * in either file. A reason that has to be written down is the point; silence
 * is what this check exists to stop.
 *
 * ── ⚠️ SCOPE, STATED SO A PASS IS NOT READ TOO WIDELY ───────────────────
 * The WEB only. `mobile/src/app/(app)/sessions.tsx` has its own `.in` list
 * which predates 'declined', 'expired' and 'not_held' and has no UI bucket for
 * any of them. That is a known open item, deferred while mobile is unreleased;
 * covering it here would fail the build for work nobody has started. The web is
 * the live surface and is what this guards.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIG_DIR = join(ROOT, 'supabase', 'migrations')
const QUERY = join(ROOT, 'site', 'lib', 'queries', 'sessions.ts')
const PAGE = join(ROOT, 'site', 'app', '(app)', 'bookings', 'page.tsx')

const quoted = text => [...text.matchAll(/'([a-z_]+)'/g)].map(m => m[1])

// ── 1. what the database permits ──────────────────────────────────────────
// From the NEWEST migration that defines the constraint, so this grows with
// the vocabulary instead of holding a second copy of it.
let permitted = null
let fromFile = null
for (const file of readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort()) {
  const src = readFileSync(join(MIG_DIR, file), 'utf8')
  const m = /add\s+constraint\s+sessions_status_check\s+check\s*\(\s*status\s*=\s*any\s*\(\s*array\s*\[([^\]]+)\]/i.exec(src)
  if (m) {
    permitted = quoted(m[1])
    fromFile = file
  }
}

if (!permitted) {
  console.error(
    'check-status-coverage: no migration defines sessions_status_check.\n' +
    '  The permitted set is read from the newest one that does. If the constraint has\n' +
    '  moved, point this script at it rather than hard-coding the values here — a copy\n' +
    '  of the vocabulary is the bug this check exists to catch.',
  )
  process.exit(1)
}

// ── 2. the two gates ──────────────────────────────────────────────────────
const querySrc = readFileSync(QUERY, 'utf8')
const pageSrc = readFileSync(PAGE, 'utf8')

const loadMatch = /\.in\(\s*'status'\s*,\s*\[([^\]]+)\]/.exec(querySrc)
if (!loadMatch) {
  console.error(`check-status-coverage: no .in('status', [...]) found in ${QUERY}.`)
  process.exit(1)
}
const loaded = new Set(quoted(loadMatch[1]))
// ⚠️ FROM THE <Group> ELEMENTS ONLY, NOT THE WHOLE FILE.
//
// The first version of this check scanned every `status === '…'` in page.tsx
// and so PASSED the very mistake it was written for: removing 'not_held' from
// the Past group's filter left the string matched by the unrelated who-said-so
// block a few lines above, and the check reported full coverage.
//
// Routing is what matters here — which Group a row falls into — and only the
// <Group> elements do that. The row-detail blocks that also mention a status
// decide what a card says once it is already on the page, which is a different
// question this check has no opinion about.
//
// Caught by proving the check against the real mistake rather than a made-up
// one. A check validated against a fault you invented tests your imagination.
const groups = pageSrc.match(/<Group[\s\S]*?\/>/g) ?? []
if (groups.length === 0) {
  console.error(`check-status-coverage: no <Group …/> elements found in ${PAGE}.`)
  process.exit(1)
}
const rendered = new Set(
  groups.flatMap(g => [...g.matchAll(/status\s*===\s*'([a-z_]+)'/g)].map(m => m[1])),
)

const excused = new Set(
  [...(querySrc + pageSrc).matchAll(/STATUS-NOT-SHOWN:\s*([a-z_]+)/g)].map(m => m[1]),
)

// ── 3. report ─────────────────────────────────────────────────────────────
const problems = []
for (const status of permitted) {
  if (excused.has(status)) continue
  if (!loaded.has(status)) {
    problems.push({
      status,
      where: "getSessions' .in('status', […])",
      effect: 'the row never leaves the database, so it renders nowhere at all',
    })
  }
  if (!rendered.has(status)) {
    problems.push({
      status,
      where: "the bookings page's Group filters",
      effect: 'the row loads and belongs to no group, so it is silently dropped from the page',
    })
  }
}

if (problems.length > 0) {
  for (const p of problems) {
    console.error(
      `status '${p.status}' is permitted by sessions_status_check (${fromFile}) but is missing from ${p.where}.\n` +
      `  Effect: ${p.effect}.\n` +
      `  This does not error and does not look empty-by-mistake — it looks like having no\n` +
      `  bookings of that kind, which is a thing that screen legitimately says.`,
    )
  }
  console.error(
    `\nstatus coverage — ${problems.length} gap(s). Four have shipped this way already\n` +
    `(items 87, 134, 137, 138), every one of them found by a person noticing a row\n` +
    `that should have been there.`,
  )
  process.exit(1)
}

console.log(
  `status coverage — ${permitted.length} status(es) from ${fromFile}; each one both loads ` +
  `and renders (web only — mobile's own list is a known open item)`,
)
