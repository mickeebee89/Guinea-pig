#!/usr/bin/env node
/**
 * read-only-columns — database columns something READS and nothing WRITES.
 *
 *   node scripts/read-only-columns.mjs
 *
 * ── A REPORT, NOT A GATE, AND THAT IS DELIBERATE ──────────────────────────
 * This is NOT wired into any build. Writes happen in places a grep cannot see:
 * triggers, column defaults, SECURITY DEFINER functions, edge functions, the
 * Supabase dashboard, and by hand. So it produces false positives by
 * construction.
 *
 * A gate that cries wolf gets disabled, and a disabled gate is worse than none —
 * it looks like coverage. So this is something you run and read.
 *
 * ── WHY IT EXISTS ─────────────────────────────────────────────────────────
 * Three columns shipped that render in the UI and can never hold anything:
 *
 *   providers.banner_url   read in 4 places, no upload anywhere, no bucket
 *   providers.status_text  read by two dashboard feeds and the mobile shop page;
 *                          no composer exists, so "What's on near you" can only
 *                          ever be empty
 *   patch_tests.*          described in the privacy policy in the present tense;
 *                          the only surface is a checkbox that is never persisted
 *
 * Each was found by hand, weeks apart, by someone noticing an empty screen. All
 * three would have appeared in this report the day they were written.
 *
 * ── HOW TO READ IT ────────────────────────────────────────────────────────
 * A column here is a QUESTION, not a defect: "what writes this?" If the answer
 * is "a trigger" or "a default", add it to ACKNOWLEDGED below with that reason.
 * If the answer is "nothing", you have found a feature that cannot work.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const CLIENT_DIRS = ['site', 'mobile/src', 'admin']
const SQL_DIRS = ['supabase']

/** Written by a trigger, a default, or somewhere a grep cannot follow. */
const ACKNOWLEDGED = new Map([
  ['id', 'primary key, database default'],
  ['created_at', 'column default'],
  ['updated_at', 'column default or trigger'],
  ['reported_email_hash', 'trg_report_subjects (migration 0004)'],
  ['reporter_email_hash', 'trg_report_subjects (migration 0004)'],
  ['target_email_hash', 'trg_moderation_subject (account-deletion-fix.sql)'],
  ['target_name', 'trg_moderation_subject (account-deletion-fix.sql)'],
  ['subject_name', 'trg_consent_subject (account-deletion-fix.sql)'],
  ['subject_email_hash', 'trg_consent_subject (account-deletion-fix.sql)'],
  ['slug', 'generated in public_stylists view'],
  ['short_id', 'generated in public_stylists view'],
])

function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.next' || e === '.git') continue
    const full = path.join(dir, e)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const reads = new Map()        // column -> Set(file)
const writes = new Set()
const dynamicWriters = new Set()   // files that write columns by computed key

function noteRead(col, file) {
  if (!reads.has(col)) reads.set(col, new Set())
  reads.get(col).add(file)
}

// ── Client code: .select('a, b, c') reads; insert/update/upsert payloads write
for (const dir of CLIENT_DIRS) {
  for (const file of walk(path.join(ROOT, dir))) {
    if (!/\.(ts|tsx)$/.test(file)) continue
    const src = readFileSync(file, 'utf8')
    const rel = path.relative(ROOT, file)

    for (const m of src.matchAll(/\.select\(\s*['"`]([^'"`]+)['"`]/g)) {
      for (const raw of m[1].split(',')) {
        const tok = raw.trim()
        // `reporter:users!reporter_id(id, email)` is an EMBEDDED RESOURCE, not
        // a column — the alias never exists in the table. Nine of the first
        // report's twenty-three findings were aliases of exactly this shape.
        if (tok.includes(':') || tok.includes('(') || tok.includes(')')) continue
        if (/^[a-z_][a-z0-9_]*$/.test(tok) && tok !== '*') noteRead(tok, rel)
      }
    }

    // `insert({ a: …, b: … })`, `.update({ … })`, `.upsert({ … })`
    for (const m of src.matchAll(/\.(?:insert|update|upsert)\(\s*\{([\s\S]{0,600}?)\}/g)) {
      for (const k of m[1].matchAll(/([a-z_][a-z0-9_]*)\s*:/g)) writes.add(k[1])
    }

    // `.update(payload)` where payload is a variable — take the keys of the
    // object literal it was built from.
    for (const m of src.matchAll(/\.(?:insert|update|upsert)\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)) {
      const decl = new RegExp(
        `(?:const|let|var)\\s+${m[1]}\\s*(?::[^=]+)?=\\s*\\{([\\s\\S]{0,800}?)\\n\\s*\\}`)
      const body = src.match(decl)
      if (body) for (const k of body[1].matchAll(/([a-z_][a-z0-9_]*)\s*:/g)) writes.add(k[1])
    }

    // ── THE ONE NO STATIC READ CAN RESOLVE ─────────────────────────────────
    // `.update({ [key]: value })` writes a column whose NAME is a runtime
    // value. model-profile.tsx does exactly this for every model attribute, so
    // hair_colour, eye_shape, skin_tone and a dozen others looked read-only on
    // the first run — thirteen false positives out of thirty-seven.
    //
    // A report that is mostly wrong gets skimmed and then ignored, which is the
    // failure this whole script exists to catch in other people's code. So
    // these are separated out and named, not silently dropped and not counted
    // as findings.
    if (/\.(?:insert|update|upsert)\(\s*\{\s*\[/.test(src)) dynamicWriters.add(rel)
  }
}

// ── SQL: insert column lists, `set col =`, and function parameters that map on
for (const dir of SQL_DIRS) {
  for (const file of walk(path.join(ROOT, dir))) {
    if (!/\.(sql|ts)$/.test(file)) continue
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/insert\s+into\s+[\w.]+\s*(?:as\s+\w+\s*)?\(([^)]+)\)/gi)) {
      for (const c of m[1].split(',')) {
        const col = c.trim()
        if (/^[a-z_][a-z0-9_]*$/.test(col)) writes.add(col)
      }
    }
    // `set a = 1, b = 2, c = 3` — the first version matched only `a`, so every
    // column after the first comma of an UPDATE looked unwritten.
    for (const m of src.matchAll(/\bset\s+([\s\S]{0,400}?)(?:\bwhere\b|;)/gi)) {
      for (const c of m[1].matchAll(/([a-z_][a-z0-9_]*)\s*=/gi)) writes.add(c[1].toLowerCase())
    }
    for (const m of src.matchAll(/^\s*([a-z_][a-z0-9_]*)\s*=\s*(?:excluded|coalesce)/gim)) writes.add(m[1])
    for (const m of src.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)[^,;]*default/gi)) {
      writes.add(m[1])   // has a database default, so it is written without a caller
    }
  }
}

// ── Report ─────────────────────────────────────────────────────────────────
const candidates = [...reads.keys()]
  .filter(c => !writes.has(c))
  .filter(c => !ACKNOWLEDGED.has(c))
  .sort()

// If ANY file that reads a column also writes columns by computed key, that
// file plausibly writes this one, and we cannot tell from source. `.some`, not
// `.every`: model attributes are read in site/lib/queries/model.ts AND in
// model-profile.tsx, and only the second writes them dynamically.
const undecidable = candidates.filter(
  c => [...reads.get(c)].some(f => dynamicWriters.has(f)),
)
const readOnly = candidates.filter(c => !undecidable.includes(c))

console.log(`\nread-only-columns — ${reads.size} column(s) read, ${writes.size} written\n`)

if (readOnly.length === 0) {
  console.log('Nothing read is unwritten. That is not proof: writes in triggers,')
  console.log('defaults and dashboards are invisible here, so this can only ever')
  console.log('narrow the question, never close it.\n')
} else {
  console.log(`${readOnly.length} column(s) READ and never written in this repo.`)
  console.log('Each is a question — "what writes this?" — not a verdict.\n')
  for (const col of readOnly) {
    const where = [...reads.get(col)].slice(0, 3)
    console.log(`  ${col}`)
    for (const w of where) console.log(`      read: ${w}`)
    if (reads.get(col).size > 3) console.log(`      … and ${reads.get(col).size - 3} more`)
  }
  console.log('\nIf a trigger or default writes one, add it to ACKNOWLEDGED with the')
  console.log('reason. If nothing does, you have found a feature that cannot work.\n')
}

if (undecidable.length > 0) {
  console.log(`${undecidable.length} column(s) CANNOT BE DECIDED from source:`)
  console.log('read only in files that write columns by computed key, e.g.')
  console.log('`.update({ [key]: value })`. Not findings, not clean either.\n')
  console.log('  ' + undecidable.join(', ') + '\n')
}
