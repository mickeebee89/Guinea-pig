/**
 * migration-status.mjs — what has actually been applied, versus what is committed.
 *
 *   node scripts/migration-status.mjs           # report
 *   node scripts/migration-status.mjs --stamp   # write checksums into new files
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY for the report (public.schema_migrations
 * is admin-read only). --stamp is offline and needs nothing.
 *
 * WHY THIS EXISTS
 *   "Did this run?" has to be answerable from recorded state, not from memory
 *   or a naming convention. The database records what it applied; this compares
 *   that against the files on disk and reports three things a convention cannot:
 *
 *     PENDING  — committed but never applied
 *     DRIFTED  — applied, but the file has changed since (checksum mismatch)
 *     ORPHAN   — applied, but no file explains it
 *
 *   DRIFTED is the one that matters. It is the failure mode where the repo
 *   looks authoritative and is wrong — which is how supabase/ came to document
 *   about a third of the live schema while reading like a complete record.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.join(HERE, '..', 'supabase', 'migrations')
const FOOTER = '-- MIGRATION FOOTER'
const STAMP = process.argv.includes('--stamp')

/** Checksum covers everything ABOVE the footer line — the migration itself,
 *  not the record of it. Must match the rule described in 0000. */
function checksumOf(sql) {
  const i = sql.indexOf(FOOTER)
  const body = i === -1 ? sql : sql.slice(0, i)
  return createHash('sha256').update(body.replace(/\r\n/g, '\n'), 'utf8').digest('hex')
}

const files = readdirSync(DIR)
  .filter(f => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .map(f => {
    const sql = readFileSync(path.join(DIR, f), 'utf8')
    return { file: f, version: f.slice(0, 4), name: f.slice(5, -4), sql, checksum: checksumOf(sql) }
  })

if (STAMP) {
  let changed = 0
  for (const m of files) {
    if (!m.sql.includes('PENDING_CHECKSUM')) continue
    writeFileSync(path.join(DIR, m.file), m.sql.replace('PENDING_CHECKSUM', m.checksum))
    console.log(`stamped ${m.file} -> ${m.checksum.slice(0, 16)}…`)
    changed++
  }
  console.log(changed ? `\n${changed} file(s) stamped. Commit, then paste into the SQL editor.`
                      : 'Nothing to stamp — no PENDING_CHECKSUM found.')
  process.exit(0)
}

const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!key) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set. Set it in this shell only:')
  console.error("  $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'")
  process.exit(1)
}

const { createClient } = await import('@supabase/supabase-js')
const db = createClient('https://ptluekkhiopowuyvkgnd.supabase.co', key, {
  auth: { persistSession: false },
})

const { data, error } = await db.from('schema_migrations').select('version, name, checksum, applied_at')
if (error) {
  // The framework itself not being applied is the most likely first answer.
  console.error('Could not read public.schema_migrations:', error.message)
  console.error('If it does not exist yet, apply supabase/migrations/0000_migrations_framework.sql first.')
  process.exit(1)
}

const applied = new Map((data ?? []).map(r => [r.version, r]))
const pad = (s, n) => String(s).padEnd(n)
let problems = 0

console.log('\n  VERSION  NAME                       STATUS')
console.log('  ' + '-'.repeat(62))

for (const m of files) {
  const row = applied.get(m.version)
  let status
  if (!row) { status = 'PENDING  — committed, never applied'; problems++ }
  else if (row.checksum === 'bootstrap') status = `applied ${row.applied_at.slice(0, 10)}`
  else if (row.checksum !== m.checksum) {
    status = `DRIFTED  — file changed since it was applied`; problems++
  } else status = `applied ${row.applied_at.slice(0, 10)}`
  console.log(`  ${pad(m.version, 9)}${pad(m.name, 27)}${status}`)
}

for (const [version, row] of applied) {
  if (files.some(m => m.version === version)) continue
  console.log(`  ${pad(version, 9)}${pad(row.name, 27)}ORPHAN   — applied, no file explains it`)
  problems++
}

console.log()
if (problems > 0) {
  console.error(`${problems} migration(s) need attention.`)
  process.exit(1)
}
console.log('All migrations applied and unchanged since.')
