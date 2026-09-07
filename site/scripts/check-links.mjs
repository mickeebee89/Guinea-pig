#!/usr/bin/env node
/**
 * check-links — every link points at a route that exists, and every route is
 * linked from somewhere.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THIS DOES NOT PROVE LINKS WORK. READ THIS BEFORE TRUSTING A GREEN RUN.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * It proves a link POINTS SOMEWHERE REAL. It cannot prove that clicking it
 * goes there. Nothing static can: that needs a running browser.
 *
 * This was written in response to a specific bug and DOES NOT CATCH IT. On
 * 7 Sep 2026 a dashboard link to /shop did not navigate. The href was right,
 * the route existed, the markup was valid, the two sibling links in the same
 * paragraph worked, and /shop rendered fine when typed into the address bar.
 * The route was fine; the client-side TRANSITION was not. This check passes
 * that page with zero findings, and it is correct to.
 *
 * So a green run means: no link points at a route that does not exist, and no
 * route is orphaned. It does not mean the links work. If someone reports a
 * dead-feeling link and this check is green, believe them — the check has not
 * looked at the thing they are describing.
 *
 * Runs in `npm run checks`, so it FAILS THE BUILD and a Vercel deploy.
 *
 * ── WHY BOTH DIRECTIONS ───────────────────────────────────────────────────
 * They are different bugs and this project has now had both:
 *
 *   link -> no route   a dead link. Nothing tells you; the click just does
 *                      nothing useful and it looks like a JS fault.
 *   route -> no link   an unreachable page. /model/[id] shipped on 24 Aug and
 *                      nothing pointed at it for nine days, which is items 9
 *                      and 10 of the audit. On a safety surface, unreachable
 *                      and absent are the same thing to the person who needs it.
 *
 * ── WHAT IT CANNOT SEE, AND WHY IT SAYS SO ────────────────────────────────
 * `href={someVariable}` cannot be resolved without running the app. Those are
 * COUNTED AND PRINTED, never silently skipped — a check that quietly ignores
 * what it cannot handle is the exact shape this repo has spent a month
 * removing. If that number climbs, the check is covering less than it looks.
 *
 * Imported path constants (BOOKINGS_PATH) are resolved from lib/routes.ts, so
 * the one deliberate indirection does not count as unresolvable.
 *
 * The `[treatment]` catch-all is expanded to its six real slugs — see below.
 * Left as a wildcard it swallowed every single-segment dead link, and the check
 * passed a deliberately broken one on its first real test.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const APP = path.join(process.cwd(), 'app')
const SRC_DIRS = ['app', 'components', 'lib']

// ── 1. Routes that exist, from the filesystem ──────────────────────────────
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const full = path.join(dir, e)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const routes = new Set(['/'])
for (const file of walk(APP)) {
  const base = path.basename(file)
  if (base !== 'page.tsx' && base !== 'route.ts') continue
  const rel = path
    .relative(APP, path.dirname(file))
    .split(path.sep)
    .filter(seg => !/^\(.*\)$/.test(seg))   // (public) etc. are grouping only
    .join('/')
  routes.add('/' + rel)
}
routes.delete('/')
routes.add('/')

/**
 * ── A CATCH-ALL SEGMENT MAKES THIS CHECK USELESS UNLESS IT IS EXPANDED ────
 *
 * The first working version PASSED a deliberately dead link, `/nope-not-a-route`.
 * Not a bug in the matcher — a true fact about the route table. `[treatment]` is
 * a top-level dynamic segment, so EVERY single-segment path "matches" it, and
 * the check could never fail on one.
 *
 * But that route sets `dynamicParams = false` and generates its params from
 * TREATMENTS, so only six values actually resolve; anything else 404s. The
 * route table alone says "matches"; the route's own configuration says
 * otherwise, and the configuration is the truth.
 *
 * So it is replaced by its six real slugs. Without this the check reports
 * success on every single-segment dead link there could ever be — which is a
 * check that runs, passes, and proves nothing.
 */
// `routes` answers "is this route reachable". `matchRoutes` answers "does this
// href point somewhere". They are NOT the same set, and conflating them
// produced fourteen false positives in one run.
const matchRoutes = new Set(routes)

if (matchRoutes.has('/[treatment]')) {
  matchRoutes.delete('/[treatment]')
  const site = readFileSync(path.join(process.cwd(), 'lib', 'site.ts'), 'utf8')

  // ONLY the TREATMENTS array. The first version matched every `slug:` in the
  // file and swallowed CITIES too, inventing eight top-level routes — /london,
  // /manchester and so on — that do not exist. It then reported all eight as
  // unreachable, which they were, because they were never routes.
  const block = site.slice(site.indexOf('export const TREATMENTS'))
  const end = block.indexOf('\nexport const ')
  const treatments = end === -1 ? block : block.slice(0, end)
  const slugs = [...treatments.matchAll(/slug:\s*'([^']+)'/g)].map(m => m[1])

  if (slugs.length === 0) {
    console.error('link check: [treatment] exists but no slugs found in TREATMENTS.')
    console.error('  Expanding it is what stops every single-segment dead link passing.')
    process.exit(1)
  }
  for (const slug of slugs) matchRoutes.add('/' + slug)
}

/**
 * Does a concrete or templated href match a route?
 *
 * ── A LITERAL CAN BE PROVEN DEAD. A COMPUTED SEGMENT CANNOT ──────────────
 * `[x]` marks a segment that came from `${...}` — its value is only known at
 * runtime, so it matches ANY route segment. Anything else must match exactly or
 * land on a dynamic segment.
 *
 * This distinction was learned the hard way, twice in five minutes. Expanding
 * `[treatment]` into its six literal slugs stopped every single-segment dead
 * link passing — and immediately reported two REAL links as dead:
 * `` href={`/${o.slug}`} `` in the treatment page and the 404 page. Those build
 * a path from the same slug list; they are unprovable, not broken.
 *
 * A check that reports working code as broken gets switched off just as fast as
 * one that misses things, so the standard is: prove it dead, or say you cannot.
 */
function matches(href) {
  const clean = href.split('?')[0].split('#')[0].replace(/\/$/, '') || '/'
  if (matchRoutes.has(clean)) return true
  const parts = clean.split('/')
  for (const r of matchRoutes) {
    const rp = r.split('/')
    if (rp.length !== parts.length) continue
    if (rp.every((seg, i) =>
      seg === parts[i] ||
      /^\[.+\]$/.test(seg) ||       // route has a dynamic segment here
      parts[i] === '[x]'            // href value is only known at runtime
    )) return true
  }
  return false
}

// ── 2. Path constants, so the one deliberate indirection resolves ──────────
const constants = new Map()
try {
  const routesFile = readFileSync(path.join(process.cwd(), 'lib', 'routes.ts'), 'utf8')
  for (const m of routesFile.matchAll(/export const (\w+)\s*=\s*'([^']+)'/g)) {
    constants.set(m[1], m[2])
  }
} catch { /* no routes.ts yet — not an error */ }

// ── 3. Every href in the source ────────────────────────────────────────────
const dead = []
const linked = new Set()      // exact hrefs — strict, used for DEAD LINKS
const mentioned = new Set()   // path literals anywhere — used for REACHABILITY
let unresolved = 0          // href={expr} — shape unknown
let runtimeValued = 0       // href={`/x/${y}`} — shape known, value is not
const unresolvedWhere = []

/**
 * TWO STANDARDS, ON PURPOSE.
 *
 * "Does this link point somewhere real?" needs the exact href, or the answer is
 * a guess. "Is this route reachable at all?" does not: the dominant idiom here
 * is a nav array — `const NAV = [{ href: '/for-stylists' }]` rendered as
 * `href={item.href}` — and the resolver cannot follow that.
 *
 * The first version of this check reported /for-stylists, /for-models,
 * /settings, /delete-account and /model/[id] as unreachable. All five are
 * linked, from SiteHeader, SiteFooter and AppNav, through exactly that pattern.
 * Five false positives out of five, on its first run.
 *
 * That matters more than it looks: a check that cries wolf gets switched off,
 * and then it joins the list of mechanisms that read as diligence and catch
 * nothing. So reachability accepts weaker evidence — a path literal appearing
 * anywhere in the source — while dead-link detection stays strict.
 */
function collectMentions(src) {
  for (const m of src.matchAll(/['\`](\/[a-z0-9\-_/\[\]$\{\}.]*)['\`]/gi)) {
    const raw = m[1]
    if (raw.startsWith('//')) continue          // protocol-relative URL
    mentioned.add(raw.replace(/\$\{[^}]*\}/g, '[id]').replace(/\/$/, '') || '/')
  }
}

for (const dir of SRC_DIRS) {
  const abs = path.join(process.cwd(), dir)
  let files
  try { files = walk(abs) } catch { continue }
  for (const file of files) {
    if (!/\.(tsx|ts)$/.test(file)) continue
    const src = readFileSync(file, 'utf8')
    const rel = path.relative(process.cwd(), file)
    collectMentions(src)

    // href="/x"  |  href={`/x/${y}`}  |  href={CONST}  |  href={anythingElse}
    for (const m of src.matchAll(/href=(?:"([^"]*)"|\{`([^`]*)`\}|\{([A-Za-z_$][\w$]*)\}|\{([^}]*)\})/g)) {
      const [, plain, tmpl, ident, other] = m

      let href = plain ?? tmpl
      if (ident !== undefined) {
        if (!constants.has(ident)) { unresolved++; unresolvedWhere.push(`${rel}  href={${ident}}`); continue }
        href = constants.get(ident)
      }
      if (href === undefined) {
        // A computed expression. Countable, not resolvable.
        unresolved++
        unresolvedWhere.push(`${rel}  href={${(other ?? '').trim().slice(0, 40)}…}`)
        continue
      }

      // External, anchors, mailto, tel — not ours to check.
      if (!href.startsWith('/')) continue

      // `${...}` becomes a wildcard segment for matching purposes.
      const normalised = href.replace(/\$\{[^}]*\}/g, '[x]')
      if (normalised.includes('[x]')) runtimeValued++
      if (matches(normalised)) linked.add(normalised.replace(/\[x\]/g, '[id]'))
      else dead.push(`${rel}  ->  ${href}`)
    }
  }
}

// ── 4. Routes nothing links to ─────────────────────────────────────────────
// Entry points and machine endpoints are reached by URL or by redirect, not by
// a link, so requiring an inbound link would be wrong rather than strict.
const NO_LINK_NEEDED = new Set([
  '/', '/dashboard', '/sign-in', '/sign-up', '/forgot-password',
  '/auth/confirm', '/auth/new-password', '/auth/problem', '/auth/reset',
  '/api/waitlist',
  // Linked generically as `/${t.slug}` from the treatment page and the 404
  // page, so no literal href to this route exists or should.
  '/[treatment]',
])

const generic = v => v.replace(/\[[^\]]+\]/g, '[id]')
const reachable = new Set([...linked, ...mentioned].map(generic))

const unreachable = [...routes].filter(
  r => !NO_LINK_NEEDED.has(r) && !reachable.has(generic(r)),
)

// ── 5. Report ──────────────────────────────────────────────────────────────
let failed = false

if (dead.length) {
  failed = true
  console.error(`\nDEAD LINKS — ${dead.length} href(s) point at no route:\n`)
  for (const d of dead) console.error('  ' + d)
}

if (unreachable.length) {
  failed = true
  console.error(`\nUNREACHABLE ROUTES — ${unreachable.length} route(s) nothing links to:\n`)
  for (const u of unreachable) console.error('  ' + u)
  console.error('\n  If one is reached by URL or redirect on purpose, add it to')
  console.error('  NO_LINK_NEEDED in scripts/check-links.mjs — with a reason.')
}

// ALWAYS printed, pass or fail. The number this check cannot see is part of its
// result, not a footnote: a rising count means it covers less than it appears to.
// The summary line says what was checked, not "links ok". A green line that
// reads like a guarantee is how the next person concludes the links work.
console.log(
  `link check — no dead or orphaned routes (does NOT prove links navigate) — ` +
  `${routes.size} route(s) (${matchRoutes.size} after expansion), ` +
  `${linked.size} linked exactly, ` +
  `${reachable.size} reachable, ` +
  `${runtimeValued} href(s) with a runtime value, ` +
  `${unresolved} href(s) could not be resolved statically`
)
if (unresolved > 0) {
  for (const u of unresolvedWhere) console.log('    unresolved: ' + u)
}

if (failed) process.exit(1)
