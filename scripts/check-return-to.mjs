/**
 * check-return-to — is the `?next=` allowlist still an allowlist? Item 186.
 *
 *   node scripts/check-return-to.mjs
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 * `safeReturnTo` is the only thing between a URL anyone can construct and a
 * redirect performed on a member mid-payment. **An open redirect there would be
 * exploited at the most trusting moment in the product** — somebody who has just
 * entered card details, sent to a page wearing our flow's clothes.
 *
 * It is a regex. Regexes get loosened by people fixing a real bug — an id that
 * is not lowercase hex, a query character somebody needs — and a loosening that
 * lets `//evil.example` through does not look different from one that doesn't.
 * **So the refusals are asserted, not trusted.**
 *
 * ⚠️ THE CASES LIVE BESIDE THE PATTERN, in site/lib/return-to.ts, not here. A
 * test file that drifts from the thing it tests is the two-copies fault; this
 * script only runs what the module itself declares must stay refused.
 *
 * ── WHAT A PASS DOES NOT MEAN ───────────────────────────────────────────
 * It means the listed cases behave. It cannot know about an attack nobody
 * listed — which is why the pattern is an allowlist in the first place, so the
 * unlisted case is refused by default rather than by enumeration.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'site', 'lib', 'return-to.ts')
const ts = readFileSync(SRC, 'utf8')

/**
 * The module is TypeScript, so it is evaluated by stripping the types rather
 * than imported. ⚠️ Crude on purpose: a real transpile would be a dependency
 * this repo does not have for one file, and the three things under test — a
 * regex literal, two functions and an array of plain objects — survive the
 * stripping unchanged.
 *
 * ⚠️ ALL THREE COME FROM ONE EVALUATION. A first version re-parsed the cases out
 * of the source with a second regex and JSON.parse, which failed on unquoted
 * keys — and would have been a divergent reading of the same file even if it had
 * worked. One eval, one source of truth.
 */
const js = ts
  .replace(/:\s*\{ input: string; accepted: boolean; why: string \}\[\]/g, '')
  .replace(/export function (\w+)\(([^)]*)\)\s*:\s*[^{]+\{/g, 'function $1($2) {')
  .replace(/^export /gm, '')
  .replace(/(\w+)\s*:\s*string \| undefined \| null/g, '$1')
  .replace(/(\w+)\s*:\s*string/g, '$1')

const { safeReturnTo, applyReturnTo, RETURN_TO_CASES: cases } =
  new Function(`${js}; return { safeReturnTo, applyReturnTo, RETURN_TO_CASES }`)()

if (!Array.isArray(cases) || cases.length === 0) {
  console.error('check-return-to: FAIL - could not read RETURN_TO_CASES from ' +
    SRC.replace(ROOT, '.') + '. A checker that tests nothing and exits 0 is audit item 188.')
  process.exit(1)
}

let failed = false
console.log(`check-return-to: ${cases.length} case(s) from site/lib/return-to.ts`)
for (const c of cases) {
  const got = safeReturnTo(c.input)
  const accepted = got !== null
  const ok = accepted === c.accepted
  if (!ok) failed = true
  console.log(`  ${ok ? 'ok     ' : 'FAILED '} ${c.accepted ? 'accept' : 'refuse'}  ` +
              `${JSON.stringify(c.input).padEnd(62)} ${c.why}`)
  if (!ok) console.error(`           got ${JSON.stringify(got)}`)
}

/**
 * ⚠️ THE ROUND TRIP, which is what stops the two sides drifting: anything the
 * apply page BUILDS must be something the subscribe page ACCEPTS. A pattern
 * tightened for a good reason can still quietly stop matching our own links,
 * and that failure is silent — the member simply never gets sent back.
 */
const built = applyReturnTo(
  'b604a402-91b7-448a-91de-4aedff94521c',
  '?step=3&date=2026-10-11&slot=a5eedb2b-c37a-4fd2-83ec-34fd814e85c3',
)
if (safeReturnTo(built) !== built) {
  failed = true
  console.error(`\ncheck-return-to: FAIL - applyReturnTo produced a path safeReturnTo refuses:`)
  console.error(`  ${built}`)
  console.error('The builder and the validator have drifted. Our own return link would be dropped.')
} else {
  console.log(`  ok      round trip  ${built}`)
}

if (failed) {
  console.error('\ncheck-return-to: FAIL. An open redirect here is performed on a member')
  console.error('mid-payment. Do not relax a case to make this pass.')
  process.exit(1)
}

console.log('\ncheck-return-to: ok - the allowlist still refuses everything it is meant to.')
console.log('⚠️ It proves the LISTED cases, not that no attack exists; the pattern is an')
console.log('allowlist so the unlisted case is refused by default rather than by enumeration.')
