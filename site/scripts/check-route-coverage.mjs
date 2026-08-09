/**
 * check-route-coverage.mjs — fails the build if an (app) route has no proxy.ts
 * matcher entry.
 *
 * Runs as part of `npm run build`.
 *
 * WHY THIS EXISTS
 *   proxy.ts refreshes the Supabase session cookie, and its matcher is an
 *   ALLOWLIST — deliberately, because the admin console's catch-all version was
 *   nearly compiled into this site and would have put a login wall in front of
 *   every public page (web-phase-1-handover.md).
 *
 *   An allowlist fails safe in that direction and fails *silently* in the other.
 *   Add a page under app/(app) and forget the matcher entry, and nothing breaks
 *   today: the page renders, the session works, the auth gate in
 *   app/(app)/layout.tsx still does its job. What happens instead is that the
 *   access token stops being refreshed on that route, so a user sitting on it
 *   gets signed out early — hours later, somewhere else, with nothing in any log
 *   connecting the two.
 *
 *   That is the same shape as every expensive bug in this project: correct
 *   today, wrong later, invisible in between. So it is checked rather than
 *   remembered.
 *
 * WHAT IT DOES NOT DO
 *   It does not check that a route is AUTHORISED — app/(app)/layout.tsx is the
 *   gate, and keeping the two separate is what makes a missing matcher entry
 *   cost a stale token instead of an auth bypass. See the header of proxy.ts.
 *
 *   It also does not flag matcher entries with no matching route. A stale entry
 *   refreshes a cookie on a path nobody visits, which costs nothing.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_DIR = path.join(ROOT, 'app', '(app)')

function walk(dir) {
  const out = []
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const entry of entries) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry === 'page.tsx' || entry === 'route.ts') out.push(full)
  }
  return out
}

/** app/(app)/messages/[sessionId]/page.tsx -> /messages/[sessionId] */
function routeOf(file) {
  const rel = path.relative(path.join(ROOT, 'app'), file).split(path.sep)
  rel.pop()                                       // page.tsx / route.ts
  const segments = rel.filter(s => !/^\(.*\)$/.test(s))   // route groups are not URL segments
  return '/' + segments.join('/')
}

/** Does a matcher entry cover this route? '/x/:path*' covers /x and /x/anything. */
function coveredBy(route, entry) {
  if (entry.endsWith('/:path*')) {
    const prefix = entry.slice(0, -'/:path*'.length)
    return route === prefix || route.startsWith(prefix + '/')
  }
  return route === entry
}

const proxySrc = readFileSync(path.join(ROOT, 'proxy.ts'), 'utf8')

// Anchor on `export const config`, NOT on the first `matcher:` in the file.
// proxy.ts's header comment quotes the admin console's catch-all matcher as an
// example of what never to do, and a naive search finds that first — which is
// how the first version of this check reported /dashboard as uncovered while
// '/dashboard/:path*' was sitting right there in the real matcher.
const configIdx = proxySrc.indexOf('export const config')
const matcherBlock = configIdx === -1
  ? null
  : proxySrc.slice(configIdx).match(/matcher:\s*\[([\s\S]*?)\]/)

if (!matcherBlock) {
  console.error('\n  ✖ could not find the matcher array in proxy.ts')
  console.error('    This check reads it as text, anchored on `export const config`.')
  console.error('    If that shape changed, update this script.\n')
  process.exit(1)
}
const entries = [...matcherBlock[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1])

const routes = walk(APP_DIR).map(routeOf)
const uncovered = routes.filter(r => !entries.some(e => coveredBy(r, e)))

if (uncovered.length > 0) {
  console.error('\n  ✖ (app) route(s) with no proxy.ts matcher entry:\n')
  for (const r of uncovered) console.error(`      ${r}`)
  console.error('\n    Their session cookie is never refreshed, so a user sitting on one gets')
  console.error('    signed out early — with nothing in any log to connect it back here.')
  console.error('\n    Add to the matcher in site/proxy.ts, e.g.:')
  for (const r of uncovered) {
    const top = '/' + r.split('/').filter(Boolean)[0]
    console.error(`      '${top}/:path*',`)
  }
  console.error('')
  process.exit(1)
}

console.log(`route coverage ok — ${routes.length} (app) route(s), all covered by the proxy matcher`)
