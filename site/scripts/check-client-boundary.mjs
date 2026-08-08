/**
 * check-client-boundary.mjs — fails the build if the two halves get mixed.
 *
 * Runs as part of `npm run build`.
 *
 * WHY A BUILD STEP AND NOT A COMMENT
 *   The public half of this site is statically rendered. Reading cookies makes
 *   a route dynamic, and a route that quietly stops being prerendered does not
 *   break: the page still works, still looks correct, and silently loses its
 *   SEO. Nothing surfaces it except reading the build output carefully every
 *   time — which is exactly the kind of vigilance that fails eventually.
 *
 *   Principle 1 in web-phase-1-handover.md: if a comment is the only thing
 *   making something safe, it isn't. supabase-server.ts carries the warning;
 *   this file enforces it.
 *
 * TWO DIRECTIONS, BOTH WRONG
 *   (public) importing supabase-server  -> breaks static rendering, and the
 *                                          route can leak session-dependent
 *                                          output into a cached page.
 *   (app)/(auth) importing supabase-public -> reads as anon, so the page shows
 *                                          nothing and looks like a data bug.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir) {
  const out = []
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const entry of entries) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const RULES = [
  {
    dir: path.join(ROOT, 'app', '(public)'),
    forbidden: 'lib/supabase-server',
    why: 'reading cookies makes the route dynamic and silently drops it from static rendering',
  },
  {
    dir: path.join(ROOT, 'app', '(app)'),
    forbidden: 'lib/supabase-public',
    why: 'the anon client has no session, so the page renders as a signed-out stranger',
  },
  {
    dir: path.join(ROOT, 'app', '(auth)'),
    forbidden: 'lib/supabase-public',
    why: 'the anon client has no session, so the page renders as a signed-out stranger',
  },
]

let violations = 0

for (const rule of RULES) {
  for (const file of walk(rule.dir)) {
    const src = readFileSync(file, 'utf8')
    // match both @/lib/... and relative ../../lib/...
    const needle = rule.forbidden.replace('lib/', '')
    if (new RegExp(`from\\s+['"][^'"]*${needle}['"]`).test(src)) {
      console.error(`\n  ✖ ${path.relative(ROOT, file)}`)
      console.error(`    imports ${rule.forbidden} — ${rule.why}`)
      violations++
    }
  }
}

// The public half must also never touch cookies or headers directly, which
// would make it dynamic without importing either client.
for (const file of walk(path.join(ROOT, 'app', '(public)'))) {
  const src = readFileSync(file, 'utf8')
  if (/from\s+['"]next\/headers['"]/.test(src)) {
    console.error(`\n  ✖ ${path.relative(ROOT, file)}`)
    console.error(`    imports next/headers — any cookie or header read makes this route dynamic`)
    violations++
  }
}

if (violations > 0) {
  console.error(`\n${violations} client-boundary violation(s). See site/lib/supabase-server.ts.\n`)
  process.exit(1)
}

console.log('client boundary ok — (public) is cookie-free, (app)/(auth) use the session client')
