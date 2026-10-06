/**
 * check-admin-guards — does every admin-surface function still refuse a
 * non-admin BEFORE it does anything? Audit item 149.
 *
 *   node scripts/check-admin-guards.mjs
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 * On 6 Oct 2026 item 149 was read in full: `revoke_verification`,
 * `admin_act_on_user`, `admin_act_on_report` and `admin_act_on_provider` are all
 * SECURITY DEFINER with EXECUTE granted to `authenticated`, so an `is_admin()`
 * check inside each is the only thing between any signed-in member and admin
 * powers over somebody else's account. All four passed.
 *
 * ⚠️ NOTHING ENFORCED THAT, AND THAT WAS THE FINDING RATHER THAN A HOLE. Four
 * functions correct BY CONVENTION. The real risk is not these four; it is
 * somebody writing `admin_act_on_X` next month and forgetting, on a surface
 * where there is no RLS underneath to catch it — a DEFINER function runs as its
 * owner and the owner is not subject to row policies. The guard is not the first
 * line of defence, it is the only one.
 *
 * It is the same allowlist-by-omission class as 0040's trigger and 156's grant
 * list, but at the FUNCTION level, where there is no GRANT that can make it
 * deny-by-default: the admin console must be able to call these as a signed-in
 * admin, so the EXECUTE grant cannot be narrowed.
 *
 * ── ⚠️⚠️ WHAT A PASS DOES NOT MEAN. READ THIS BEFORE TRUSTING IT. ───────────
 * **THIS READS THE REPO. IT CANNOT SEE THE LIVE DEFINITION.** A function
 * replaced by hand in the SQL editor is invisible here, and so is one whose
 * guard was removed there. The real check is `pg_get_functiondef` against the
 * database, which needs a connection CI has not got — **that is audit item 38
 * and it stays open.**
 *
 * This matters more than usual for this particular check, because on 6 Oct 2026
 * a repo read of these same functions disagreed with the live catalogue three
 * times in one night (item 188). The live read is always the authority. A pass
 * here means "the migrations in this repo, applied in order, would produce
 * guarded functions" — nothing about what is running.
 *
 * ⚠️ So a green run is NOT evidence the live functions are guarded. It is
 * evidence that nobody has committed an unguarded one. Those are different
 * claims and only the second is in scope.
 *
 * ── WHAT IT ASKS, PER FUNCTION ──────────────────────────────────────────
 * For the LATEST definition of every admin-surface function:
 *
 *   1. Is it declared `security definer`?
 *   2. Does it call `is_admin()` before its first statement that reads or
 *      writes?
 *   3. Does its DECLARE block run a query?
 *
 * (3) is not padding. DECLARE initialisers execute BEFORE `begin`, so a
 * `v_x := (select …)` in a declaration runs before the guard no matter where the
 * guard sits. That was the subtle way all four could have failed on 6 Oct and
 * the only reason they did not is that every initialiser is `auth.uid()` or a
 * string function.
 *
 * ── THE TWO THINGS IT DELIBERATELY DOES NOT CHECK ───────────────────────
 * **`language sql` functions are skipped for (2) and (3).** There is no
 * procedural order in a single expression, so "before the first read" has no
 * meaning. `is_admin()` is itself `language sql` and has no guard because it IS
 * the guard — checking it would be the check asking itself.
 *
 * **EXECUTE grants are not modelled.** `check-anon-view-grants.mjs` does model
 * them across migrations and could be extended here, but a function being
 * unreachable by clients is an exemption, and an exemption belongs in the
 * baseline where a human has written down why — not inferred by a second piece
 * of analysis that can also be wrong.
 *
 * ── THE BASELINE ────────────────────────────────────────────────────────
 * `check-admin-guards.baseline.json`. Every entry needs a reason a person wrote.
 *
 * ⚠️ A STALE BASELINE IS ALSO A FAILURE. If an entry no longer violates
 * anything, this exits non-zero and says so. Without that a baseline becomes a
 * graveyard, and the next real violation gets added to it because that is what
 * the file appears to be for.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIG_DIR = join(ROOT, 'supabase', 'migrations')
const BASELINE = join(ROOT, 'scripts', 'check-admin-guards.baseline.json')

/**
 * The admin surface. A name test, because that is what a repo checker can see
 * and what the risk actually follows: somebody adds `admin_act_on_shop`.
 *
 * `revoke_verification` is listed explicitly — it is an admin entry point whose
 * name says nothing about it, which is exactly why it is the one of the four
 * with a single guard and the one whose errcodes were wrong until 0089.
 */
const SURFACE = /^_?admin_/
const ALSO = new Set(['revoke_verification'])

const isSurface = name => SURFACE.test(name) || ALSO.has(name)

/**
 * Strip `--` to end of line.
 *
 * ⚠️ A `--` inside a string literal is mis-stripped by this. It only ever
 * REMOVES text, so the failure mode is a false positive — a guard that exists
 * being reported missing — which is loud and gets looked at. A false negative
 * would need an `is_admin()` call sitting after `--` on the same line inside a
 * literal. Stated rather than solved, because matching prose instead of code is
 * 0028's fault and stripping is the cheaper half of avoiding it.
 */
const stripComments = sql =>
  sql.split('\n').map(line => {
    const i = line.indexOf('--')
    return i < 0 ? line : line.slice(0, i)
  }).join('\n')

/**
 * ⚠️ BOUNDARIES AT THE NEXT `create … function`, NEVER AT A CLOSING
 * DOLLAR-QUOTE TAG. Postgres writes `as $function$` when it round-trips a
 * definition, so migrations written from `pg_get_functiondef` output carry a mix
 * of `$$` and `$function$` — sometimes in the same file. A matcher that ends a
 * body at `$$;` runs past any `$function$` body into the NEXT function's header.
 *
 * That is not hypothetical: on 6 Oct 2026 it reported
 * `_admin_apply_user_action` as SECURITY DEFINER when all seven of its
 * definitions declare no mode at all. Item 188.
 */
function definitionsIn(sql) {
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi
  const starts = []
  let m
  while ((m = re.exec(sql)) !== null) starts.push({ at: m.index, name: m[1].toLowerCase() })
  return starts.map((s, i) => ({
    name: s.name,
    text: sql.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : sql.length),
  }))
}

/** Everything before the body's opening dollar quote: where the modifiers live. */
const headerOf = text => {
  const i = text.toLowerCase().indexOf('as $')
  return i < 0 ? text.slice(0, 600) : text.slice(0, i)
}

const READ_OR_WRITE =
  /\b(?:insert\s+into|update\s+(?:public\.|only\s)|delete\s+from|perform\s+|execute\s+|select\b)/i

function inspect(name, text) {
  const header = headerOf(text)
  const headerLower = header.toLowerCase()
  const problems = []

  if (!/\bsecurity\s+definer\b/.test(headerLower)) {
    problems.push('not declared SECURITY DEFINER')
  }

  // language sql has no procedural order; see the header.
  if (/\blanguage\s+sql\b/.test(headerLower)) return problems

  const code = stripComments(text)
  const declare = /\bdeclare\b([\s\S]*?)\bbegin\b/i.exec(code)
  if (declare && /:=\s*\(?\s*select\b/i.test(declare[1])) {
    problems.push('a DECLARE initialiser runs a query, which executes BEFORE the guard')
  }

  const beginAt = code.toLowerCase().indexOf('begin')
  const body = beginAt < 0 ? code : code.slice(beginAt + 'begin'.length)
  const guard = /\bis_admin\s*\(\s*\)/i.exec(body)
  const act = READ_OR_WRITE.exec(body)

  if (!guard) problems.push('no is_admin() call in the body')
  else if (act && act.index < guard.index) {
    problems.push(
      `a read or write ("${act[0].trim()}") precedes the is_admin() guard`)
  }
  return problems
}

// ── read every migration in order; the last definition of a name wins ───────
const latest = new Map()
for (const file of readdirSync(MIG_DIR).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()) {
  const sql = readFileSync(join(MIG_DIR, file), 'utf8')
  for (const d of definitionsIn(sql)) {
    if (isSurface(d.name)) latest.set(d.name, { ...d, file })
  }
}

const baseline = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf8'))
  : { exempt: {} }

const violations = []
const checked = []
for (const [name, def] of [...latest].sort()) {
  const problems = inspect(name, def.text)
  checked.push({ name, file: def.file, problems })
  if (problems.length && !baseline.exempt[name]) violations.push({ name, def, problems })
}

const stale = Object.keys(baseline.exempt).filter(name => {
  const found = checked.find(c => c.name === name)
  return !found || found.problems.length === 0
})

console.log(`check-admin-guards: ${checked.length} admin-surface function(s), ` +
            `latest definition of each, from ${MIG_DIR.replace(ROOT, '.')}`)
for (const c of checked) {
  const mark = c.problems.length === 0 ? 'ok      '
    : baseline.exempt[c.name] ? 'exempt  ' : 'VIOLATION'
  console.log(`  ${mark} ${c.name.padEnd(28)} ${c.file}`)
  for (const p of c.problems) console.log(`           - ${p}`)
}

if (!checked.length) {
  console.error('\ncheck-admin-guards: FAIL — no admin-surface function was found at all.\n' +
    'Either the migrations moved or SURFACE no longer matches anything. A checker that\n' +
    'examines nothing and exits 0 is the thing audit item 188 is about.')
  process.exit(1)
}

let failed = false
if (violations.length) {
  failed = true
  console.error('\ncheck-admin-guards: FAIL\n')
  for (const v of violations) {
    console.error(`  ${v.name}  (${v.def.file})`)
    for (const p of v.problems) console.error(`    - ${p}`)
  }
  console.error('\nThese are SECURITY DEFINER functions on the admin surface, so there is no RLS\n' +
    'underneath to catch a missing guard — it runs as the owner. Fix the function, or add\n' +
    `an entry to ${BASELINE.replace(ROOT, '.')} with a reason a person wrote.`)
}
if (stale.length) {
  failed = true
  console.error(`\ncheck-admin-guards: STALE BASELINE — ${stale.join(', ')}\n` +
    'These are listed as exempt but no longer violate anything (or no longer exist).\n' +
    'Remove them. A baseline nobody prunes becomes the place real violations get added,\n' +
    'because that is what the file appears to be for.')
}
if (failed) process.exit(1)

console.log('\ncheck-admin-guards: ok — every admin-surface function in the repo is DEFINER and\n' +
            'guards before it acts. ⚠️ This read the REPO. It says nothing about the live\n' +
            'database; that needs a connection CI has not got (audit item 38, open).')
