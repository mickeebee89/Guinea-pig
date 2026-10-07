/**
 * check-demo-rpc-coverage — does demo mode know every RPC the site calls?
 * Audit items 69 and 186.
 *
 *   node scripts/check-demo-rpc-coverage.mjs
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 * On 7 Oct 2026 item 186's shared loader started calling `slot_contention()`
 * (added by 0090). `demoRpc`'s default THROWS on an unknown name — deliberately,
 * so a missing mock is loud rather than silently wrong — so **every stylist page
 * and the whole apply wizard broke in demo mode the moment that shipped.**
 *
 * Nothing caught it. Demo mode is local-only by design (item 69): `DEMO_MODE=1`
 * fails a build and fails on Vercel, so `next build` never exercises it and no
 * other checker reads it. It was found by running demo mode to verify something
 * else.
 *
 * Micky, 7 Oct 2026: *"check-admin-guards catches an unguarded function; the
 * unmocked case has no checker. Worth building one if it is cheap."*
 *
 * ⚠️ IT WAS CHEAP AND IT PAID IMMEDIATELY. On its first run it named THREE more
 * unmocked RPCs that predated slot_contention —
 * `notify_favourites_of_availability`, `set_my_postcode` and `unsubscribe_email`
 * — none of which anyone had met, because each sits on a path a walkthrough does
 * not take. That is the argument for a checker over a habit: the habit only
 * finds what somebody happens to click.
 *
 * ── WHAT IT ASKS ────────────────────────────────────────────────────────
 * Every `.rpc('name')` in site/app and site/lib (excluding lib/demo itself) must
 * appear as a `case 'name':` in lib/demo/rpc.ts.
 *
 * ⚠️ WHY EVERY CLIENT COUNTS, NOT JUST THE BROWSER ONE. next.config.ts aliases
 * BOTH `@supabase/ssr` and `@supabase/supabase-js` under DEMO_MODE, so server
 * components, server actions, route handlers and the browser all resolve to the
 * demo stub. There is no client that escapes it — which is why a route handler's
 * RPC is as much a demo concern as a button's.
 *
 * ── WHAT A PASS DOES NOT MEAN ───────────────────────────────────────────
 * ⚠️ IT COVERS ONE OF THE TWO WAYS DEMO MODE BREAKS. The other is the demo
 * ENGINE not supporting a query shape — an embedded select, a filter operator, a
 * view. That is what actually broke browse and every stylist page after 0087
 * introduced `users!user_id(is_verified)`, and this checker would not have seen
 * it. The embed shape is checked below as far as a text scan can; operators and
 * views are not checked at all, and the only real test is running demo mode.
 *
 * A pass means "no RPC the site calls is missing a mock". It does not mean demo
 * mode works.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = join(ROOT, 'site')
const MOCK = join(SITE, 'lib', 'demo', 'rpc.ts')
const SCAN = [join(SITE, 'app'), join(SITE, 'lib')]
const SKIP = join(SITE, 'lib', 'demo')

function* files(dir) {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (full.startsWith(SKIP)) continue
    if (statSync(full).isDirectory()) {
      if (e === 'node_modules' || e.startsWith('.next')) continue
      yield* files(full)
    } else if (/\.(ts|tsx)$/.test(e)) {
      yield full
    }
  }
}

const calls = new Map()      // rpc name -> Set of files
const embeds = new Map()     // embedded select text -> Set of files

for (const dir of SCAN) {
  for (const f of files(dir)) {
    const src = readFileSync(f, 'utf8')
    const where = relative(ROOT, f).replace(/\\/g, '/')
    for (const m of src.matchAll(/\.rpc\(\s*['"]([a-z_0-9]+)['"]/g)) {
      if (!calls.has(m[1])) calls.set(m[1], new Set())
      calls.get(m[1]).add(where)
    }
    // A select list containing a bracket is an embedded select.
    for (const m of src.matchAll(/\.select\(\s*[`'"]([^`'"]*\([^`'"]*)[`'"]/g)) {
      for (const part of m[1].split(',')) {
        const c = part.trim()
        if (!c.includes('(')) continue
        // Rejoin a split like "users!user_id(is_verified" -> keep the raw token.
        if (!embeds.has(c)) embeds.set(c, new Set())
        embeds.get(c).add(where)
      }
    }
  }
}

const mockSrc = readFileSync(MOCK, 'utf8')
const mocked = new Set([...mockSrc.matchAll(/case\s+'([a-z_0-9]+)'\s*:/g)].map(m => m[1]))

const missing = [...calls.keys()].filter(n => !mocked.has(n)).sort()
const unused = [...mocked].filter(n => !calls.has(n)).sort()

/**
 * The one embed shape lib/demo/engine.ts implements: `table!fk(cols)`.
 * ⚠️ Anything else is not a style question — the engine THROWS on it, which is
 * how browse and every stylist page died silently in demo mode for a day.
 */
const SUPPORTED_EMBED = /^[a-z_]+![a-z_]+\($/
const badEmbeds = [...embeds.keys()]
  .filter(c => !SUPPORTED_EMBED.test(c.replace(/[^(]*$/, '') + '('))
  .filter(c => !/^[a-z_]+![a-z_]+\(/.test(c))
  .sort()

console.log(`check-demo-rpc-coverage: ${calls.size} RPC(s) called by site/, ` +
            `${mocked.size} mocked in ${relative(ROOT, MOCK).replace(/\\/g, '/')}`)
for (const n of [...calls.keys()].sort()) {
  console.log(`  ${mocked.has(n) ? 'ok     ' : 'MISSING'} ${n}`)
}

if (calls.size === 0) {
  console.error('\ncheck-demo-rpc-coverage: FAIL — found no .rpc() calls at all.\n' +
    'Either the scan paths moved or the match broke. A checker that examines nothing\n' +
    'and exits 0 is what audit item 188 is about.')
  process.exit(1)
}

let failed = false
if (missing.length) {
  failed = true
  console.error('\ncheck-demo-rpc-coverage: FAIL — called by the site, unknown to demo mode:\n')
  for (const n of missing) {
    console.error(`  ${n}`)
    for (const f of [...calls.get(n)].sort()) console.error(`      ${f}`)
  }
  console.error('\ndemoRpc\'s default THROWS, so each of these is a real failure waiting on a\n' +
    'particular click. Add a `case` to site/lib/demo/rpc.ts. ⚠️ A mock must agree with\n' +
    'the real function about ANY key it uses — slot_contention keys on\n' +
    '(provider_id, date, start_time), and a demo that used availability_id would\n' +
    'disagree with the database about which slots are free.')
}
if (badEmbeds.length) {
  failed = true
  console.error('\ncheck-demo-rpc-coverage: FAIL — embedded select(s) the demo engine cannot parse:\n')
  for (const c of badEmbeds) {
    console.error(`  ${c}`)
    for (const f of [...embeds.get(c)].sort()) console.error(`      ${f}`)
  }
  console.error('\nlib/demo/engine.ts implements `table!fk(cols)` and throws on anything else.\n' +
    'That throw is what broke browse and every stylist page after 0087 introduced\n' +
    '`users!user_id(is_verified)`. Extend the engine, or do not use the shape.')
}

if (unused.length) {
  // ⚠️ REPORTED, NOT FAILED, and the asymmetry is deliberate. A stale baseline
  // entry manufactures confidence, so check-admin-guards fails on one. A mock
  // for an RPC nobody calls manufactures nothing — it is dead weight. Worth
  // pruning, not worth blocking a build over.
  console.log(`\nnote: mocked but no longer called — ${unused.join(', ')}. Harmless; prune when convenient.`)
}

if (failed) process.exit(1)

console.log('\ncheck-demo-rpc-coverage: ok — every RPC the site calls has a demo mock.\n' +
            '⚠️ This does NOT mean demo mode works: the engine can still refuse a query\n' +
            'SHAPE it does not implement, and only running demo mode tests that.')
