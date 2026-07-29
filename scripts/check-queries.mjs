/**
 * check-queries.mjs — verify every Supabase .select() in the codebase names
 * columns that actually exist.
 *
 *   node scripts/check-queries.mjs
 *
 * Needs the service-role key — PostgREST only serves its schema document to a
 * secret key. The script is READ-ONLY: one GET for the schema, nothing else.
 *   $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * PostgREST rejects the WHOLE query if ONE column name is wrong (error 42703).
 * Combined with the very common `if (data) { … }` pattern, which discards the
 * error, a single typo renders as "nothing here" rather than as a failure.
 *
 * That exact bug hid every stylist's treatment list for weeks: the shop page
 * asked for `duration_mins` and `materials_cost` on a table whose columns are
 * `duration` and `price`, so every shop said "No treatments listed yet" — real
 * providers included. Nothing in the UI suggested a problem.
 *
 * Schema truth comes from PostgREST's own OpenAPI document, so this checks
 * against the LIVE database rather than against anything committed here.
 * ---------------------------------------------------------------------------
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SUPABASE_URL = 'https://ptluekkhiopowuyvkgnd.supabase.co'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCAN = ['mobile/src', 'app', 'lib', 'seed']
const EXT  = new Set(['.ts', '.tsx', '.mjs', '.js'])

const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!key) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set. Set it in this shell only:')
  console.error("  $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'")
  process.exit(1)
}

// ── Schema, straight from PostgREST ──────────────────────────────────────────
async function loadSchema() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
  })
  if (!res.ok) throw new Error(`Schema fetch failed: ${res.status} ${await res.text()}`)
  const spec = await res.json()
  const tables = new Map()
  for (const [name, def] of Object.entries(spec.definitions ?? {})) {
    tables.set(name, new Set(Object.keys(def.properties ?? {})))
  }
  return tables
}

// ── Source scanning ──────────────────────────────────────────────────────────
function* walk(dir) {
  let entries
  try { entries = readdirSync(dir) } catch { return }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.next' || e === '.expo' || e === 'dist') continue
    const full = path.join(dir, e)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (EXT.has(path.extname(full))) yield full
  }
}

/** Split a select list on top-level commas, keeping embedded `table(...)` intact. */
function splitCols(s) {
  const out = []
  let depth = 0, cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out.map(c => c.trim()).filter(Boolean)
}

/** `alias:table!fk` → `table` */
function relationOf(token) {
  let rel = token
  if (rel.includes(':')) rel = rel.split(':').pop()
  if (rel.includes('!')) rel = rel.split('!')[0]
  return rel.trim()
}

const problems = []
const unchecked = []

function checkList(list, table, schema, where) {
  const cols = schema.get(table)
  if (!cols) { unchecked.push(`${where}  unknown table/view '${table}'`); return }

  for (const raw of splitCols(list)) {
    const paren = raw.indexOf('(')
    if (paren >= 0) {
      // Embedded join: recurse into the related table.
      const rel = relationOf(raw.slice(0, paren))
      const inner = raw.slice(paren + 1, raw.lastIndexOf(')'))
      checkList(inner, rel, schema, where)
      continue
    }
    if (raw === '*' || raw.startsWith('...')) continue
    // `alias:column` → the real column is after the colon.
    let col = raw.includes(':') ? raw.split(':').pop().trim() : raw
    col = col.replace(/::.*$/, '').replace(/\.\.\..*/, '').trim()
    if (!col || col === '*') continue
    if (col.endsWith('.count') || col === 'count') continue
    if (!cols.has(col)) {
      problems.push({ where, table, col })
    }
  }
}

function scanFile(file, schema) {
  const src = readFileSync(file, 'utf8')
  const rel = path.relative(ROOT, file)
  const fromRe = /\.from\(\s*['"](\w+)['"]\s*\)/g

  let m
  while ((m = fromRe.exec(src))) {
    const table = m[1]
    // Look ahead only as far as the next .from(, so we never attribute a
    // select to the wrong table.
    const nextFrom = src.indexOf('.from(', m.index + 1)
    const slice = src.slice(m.index, nextFrom === -1 ? m.index + 800 : nextFrom)
    const selIdx = slice.indexOf('.select(')
    if (selIdx === -1) continue

    const after = slice.slice(selIdx + 8)
    const line = src.slice(0, m.index).split('\n').length
    const where = `${rel}:${line}`

    const q = after.trimStart()[0]
    // A backtick select is only unverifiable if it INTERPOLATES. Most are just
    // multi-line strings, and the admin console's biggest queries are written
    // that way — skipping them would leave the console unchecked.
    if (q === '`') {
      const close = after.indexOf('`', after.indexOf('`') + 1)
      const body = close === -1 ? '' : after.slice(after.indexOf('`') + 1, close)
      if (body && !body.includes('${')) checkList(body.replace(/\s+/g, ' '), table, schema, where)
      else unchecked.push(`${where}  interpolated select on '${table}'`)
      continue
    }
    if (q !== "'" && q !== '"') {
      if (/^\w/.test(after.trimStart())) unchecked.push(`${where}  variable select on '${table}'`)
      continue
    }
    const start = after.indexOf(q)
    const end = after.indexOf(q, start + 1)
    if (end === -1) continue
    checkList(after.slice(start + 1, end), table, schema, where)
  }
}

const schema = await loadSchema()
console.log(`Schema: ${schema.size} tables/views from PostgREST\n`)

let files = 0
for (const dir of SCAN) {
  for (const f of walk(path.join(ROOT, dir))) { scanFile(f, schema); files++ }
}

console.log(`Scanned ${files} files.\n`)

if (problems.length) {
  console.log(`✗ ${problems.length} column(s) that DO NOT EXIST — these queries return nothing:\n`)
  for (const p of problems) console.log(`  ${p.where.padEnd(52)} ${p.table}.${p.col}`)
} else {
  console.log('✓ Every checkable column exists.')
}

if (unchecked.length) {
  console.log(`\n${unchecked.length} not verified (dynamic or non-table):`)
  for (const u of [...new Set(unchecked)]) console.log(`  ${u}`)
}

// Set the code rather than calling process.exit(): forcing exit while fetch's
// handle is still closing makes libuv assert on Windows, which looks alarming
// on an otherwise clean run.
process.exitCode = problems.length ? 1 : 0
