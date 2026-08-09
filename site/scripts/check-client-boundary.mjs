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
 * ── REWRITTEN 8 Aug 2026: IT WAS NOT ENFORCING WHAT IT CLAIMED ─────────────
 *
 *   The original walked the FILES INSIDE app/(public) and looked for a
 *   forbidden import line. Every (public) page imports from site/components/,
 *   which that walk never visited — so the check passed with the forbidden
 *   import one level down, in a shared component. Proven by putting
 *   supabase-browser into components/StylistCard.tsx: exit 0, "boundary ok".
 *
 *   The hole was there from phase 1 and applied to supabase-server too. Slice 2
 *   made it matter more rather than creating it: NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   now exists, so a client-side query is possible to write in more places, and
 *   the guard replacing the unprefixed-key forcing function has to actually
 *   hold. A guard that looks stronger than it is, is worse than none — it stops
 *   people checking by hand.
 *
 *   So this now follows the IMPORT GRAPH from every (public) entry point and
 *   reports the chain that reaches the violation, because "StylistCard imports
 *   the browser client" is not actionable without knowing which page drags it
 *   into the static build.
 *
 * ── WHY (public) IS TRANSITIVE AND THE OTHERS ARE NOT ──────────────────────
 *   (public) importing supabase-server or supabase-browser fails SILENTLY: the
 *   page renders correctly and stops being prerendered. That is worth a graph
 *   walk.
 *
 *   (app)/(auth) importing supabase-public fails LOUDLY: the page reads as a
 *   signed-out stranger and shows nothing. It is also legitimate for a shared
 *   component to use the anon client on behalf of a public page, so a
 *   transitive rule there would flag correct code. Direct import only.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
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

const IMPORT_RE = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g

/** Resolve an import specifier to a file in this project, or null if external. */
function resolveImport(fromFile, spec) {
  let base
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else return null                                   // bare specifier -> node_modules

  for (const candidate of [
    base, `${base}.ts`, `${base}.tsx`,
    path.join(base, 'index.ts'), path.join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Every project file reachable from `entry`, with the chain that got there. */
function reachableFrom(entry) {
  const seen = new Map([[entry, [entry]]])
  const queue = [entry]
  while (queue.length) {
    const file = queue.shift()
    const src = readFileSync(file, 'utf8')
    for (const [, spec] of src.matchAll(IMPORT_RE)) {
      const target = resolveImport(file, spec)
      if (!target || seen.has(target)) continue
      seen.set(target, [...seen.get(file), target])
      queue.push(target)
    }
  }
  return seen
}

const rel = f => path.relative(ROOT, f).replace(/\\/g, '/')

// Modules (public) must not reach, at any depth.
const FORBIDDEN_IN_PUBLIC = [
  {
    file: 'lib/supabase-server.ts',
    why: 'reading cookies makes the route dynamic and silently drops it from static rendering',
  },
  {
    file: 'lib/supabase-browser.ts',
    why: 'a client-side query means the content is not in the prerendered HTML a crawler reads',
  },
]

let violations = 0

// ── (public): transitive ────────────────────────────────────────────────────
for (const entry of walk(path.join(ROOT, 'app', '(public)'))) {
  const reachable = reachableFrom(entry)
  for (const { file, why } of FORBIDDEN_IN_PUBLIC) {
    const target = path.join(ROOT, file)
    if (!reachable.has(target)) continue
    const chain = reachable.get(target).map(rel)
    console.error(`\n  ✖ ${chain[0]}`)
    console.error(`    reaches ${file} — ${why}`)
    if (chain.length > 2) console.error(`    via: ${chain.slice(1, -1).join(' -> ')}`)
    violations++
  }
  // next/headers makes a route dynamic without importing either client.
  for (const [file, chain] of reachable) {
    if (/from\s+['"]next\/headers['"]/.test(readFileSync(file, 'utf8'))) {
      console.error(`\n  ✖ ${rel(chain[0])}`)
      console.error(`    reaches next/headers via ${rel(file)} — any cookie or header read makes this route dynamic`)
      violations++
    }
  }
}

// ── (app)/(auth): direct import only, see header ────────────────────────────
for (const dir of ['(app)', '(auth)']) {
  for (const file of walk(path.join(ROOT, 'app', dir))) {
    if (/from\s+['"][^'"]*supabase-public['"]/.test(readFileSync(file, 'utf8'))) {
      console.error(`\n  ✖ ${rel(file)}`)
      console.error(`    imports lib/supabase-public — the anon client has no session, so the page renders as a signed-out stranger`)
      violations++
    }
  }
}

if (violations > 0) {
  console.error(`\n${violations} client-boundary violation(s). See site/lib/supabase-server.ts.\n`)
  process.exit(1)
}

console.log('client boundary ok — nothing reachable from (public) touches cookies or the browser client')
