/**
 * ⚠⚠⚠ SUPERSEDED — DO NOT RUN. THE BACKFILL IS DONE.
 *
 * The 7 rows were written on 21 Oct 2026 through the Supabase connector in
 * chat, directly and WITHOUT the service-role key this script asks for. This
 * file is kept as the record of how it would have been done — what it would
 * have touched, what it refused to touch, and why — not as pending work.
 *
 * ⚠️ It is harmless if run by accident: it is dry-run unless `--write`, and
 * `--write` would re-fetch and re-store the same five values. But there is
 * nothing to gain and it would make 7 live lookups for other people's
 * postcodes to learn nothing.
 *
 * ✅ THE RESULT, MEASURED — 7 rows, 5 distinct postcodes, coordinates untouched:
 *
 *     ME5 8PQ   Medway       Chatham       (3 rows: 1 model, 2 providers)
 *     SO16 2JE  Southampton  Southampton
 *     SE16 7PW  Southwark    Southwark
 *     S6 3BS    Sheffield    Sheffield
 *     CF10 5DS  Cardiff      Cardiff
 *
 * **bua was null on 0 of 5.** ⚠⚠ THAT IS NOT A RATE AND MUST NOT BE RECORDED AS
 * ONE. All five are urban, and the rural case — the one 0099's two-column design
 * exists for — is still unmeasured. ME5 8PQ is the only row where the two names
 * differ, which is the whole reason the display prefers bua: "Chatham", not
 * "Medway".
 *
 * ---
 *
 * Backfill users.admin_district and users.bua for rows that already have a
 * postcode. Migration 0099, audit item 90's descendant.
 *
 *   node scripts/backfill-0099-towns.mjs            # DRY RUN — writes nothing
 *   node scripts/backfill-0099-towns.mjs --write    # actually writes
 *
 * ⚠️ DRY RUN BY DEFAULT, AND THAT IS NOT POLITENESS. It re-runs a live lookup
 * against a third party for real members' postcodes and then writes to
 * public.users. The dry run prints exactly what it would store, per row, so the
 * 7 rows can be read before any of them changes.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  ⚠️⚠️ WHY IT DOES NOT CALL set_my_postcode
 * ══════════════════════════════════════════════════════════════════════════
 * That function is SECURITY INVOKER and writes `where id = auth.uid()` — it can
 * only ever change the CALLER's own row. A backfill has no caller: it is one
 * process writing 7 other people's rows. So it writes the table directly with
 * the service-role key, and the two things the function would have guaranteed
 * are re-stated here instead:
 *
 *   1. It NEVER touches postcode, latitude or longitude. Those are already
 *      correct and already read back to the member on her settings page; a
 *      backfill that "corrected" a coordinate would move someone on the map
 *      without telling them. Only the two new town columns are written.
 *   2. A row with no postcode is skipped, so a town can never exist without one
 *      — the same invariant the function enforces with its `case when
 *      p_postcode is null`.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  ⚠️ THE POSTCODE IS NOT RE-VALIDATED, AND A FAILED LOOKUP CHANGES NOTHING
 * ══════════════════════════════════════════════════════════════════════════
 * These postcodes were validated when they were saved — `lookupPostcode`
 * refused anything without a coordinate, and the coordinate is in the row. So a
 * lookup that now says `not_found` or `unavailable` is about the SERVICE, not
 * about her postcode, and the row is left exactly as it is and reported.
 *
 * ⚠️ IT MUST NOT NULL A TOWN IT COULD NOT FETCH. Nothing is written on a failed
 * lookup — not even null — because "we could not ask" and "ONS has no town for
 * this postcode" are different facts and only one of them is hers.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  ⚠️ IT MEASURES THE bua NULL RATE RATHER THAN ASSUMING ONE
 * ══════════════════════════════════════════════════════════════════════════
 * 0099's header deliberately makes no claim about how often `bua` is null,
 * because nobody has measured it. This script is that measurement: it prints a
 * count of rows where bua came back null and admin_district had to carry the
 * display. ⚠️ SEVEN ROWS, FOUR OF THEM REAL AND ALL IN CITIES, IS NOT A RATE —
 * it is a first reading, and the summary says so rather than extrapolating.
 */
import { createClient } from '@supabase/supabase-js'

const WRITE = process.argv.includes('--write')

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('backfill: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in the environment.')
  console.error('⚠️ The service-role key is needed because this writes other people\'s rows, which')
  console.error('   RLS and set_my_postcode both rightly forbid. Do not paste it on a command line.')
  process.exit(1)
}
const db = createClient(URL, KEY, { auth: { persistSession: false } })

/** The two fields 0099 adds, read from the response site/lib/postcode.ts already gets. */
async function lookup(postcode) {
  let res
  try {
    res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),   // longer than the form's 4s: nobody is waiting
    })
  } catch (e) {
    return { ok: false, reason: 'unavailable', detail: String(e) }
  }
  if (res.status === 404) return { ok: false, reason: 'not_found' }
  if (!res.ok) return { ok: false, reason: 'unavailable', detail: `HTTP ${res.status}` }

  let body
  try { body = await res.json() } catch { return { ok: false, reason: 'unavailable', detail: 'bad JSON' } }
  const r = body?.result
  if (!r || typeof r !== 'object') return { ok: false, reason: 'not_found' }

  // ⚠️ `?? null` NOT `|| null`: an empty string from the service is a real
  // answer meaning "no name", and `||` would make it indistinguishable from
  // the field being absent. Both become null, but deliberately and once.
  const district = typeof r.admin_district === 'string' && r.admin_district.trim() !== ''
    ? r.admin_district.trim() : null
  const bua = typeof r.bua === 'string' && r.bua.trim() !== '' ? r.bua.trim() : null
  return { ok: true, district, bua }
}

const { data: rows, error } = await db
  .from('users')
  .select('id, email, postcode, latitude, admin_district, bua')
  .not('postcode', 'is', null)
  .order('created_at')

if (error) {
  // ⚠️ Destructured and reported, not swallowed — audit item 210.
  console.error('backfill: could not read users:', error.message)
  process.exit(1)
}

console.log(`${WRITE ? '*** WRITING ***' : 'DRY RUN (no writes)'} — ${rows.length} row(s) with a postcode\n`)

let wrote = 0, skipped = 0, failed = 0, buaNull = 0, bothNull = 0
for (const u of rows) {
  // Belt and braces against the invariant: a postcode with no coordinate
  // should not exist (lookupPostcode refuses it), so if one does, leave it
  // alone and say so rather than quietly giving it a town.
  if (u.latitude === null) {
    console.log(`  SKIP  ${u.postcode.padEnd(9)} ${mask(u.email)} — postcode with NO coordinate; left untouched`)
    skipped++
    continue
  }

  const got = await lookup(u.postcode)
  if (!got.ok) {
    console.log(`  FAIL  ${u.postcode.padEnd(9)} ${mask(u.email)} — ${got.reason}${got.detail ? ` (${got.detail})` : ''}; NOTHING written`)
    failed++
    continue
  }

  if (got.bua === null) buaNull++
  if (got.bua === null && got.district === null) bothNull++

  const shown = got.bua ?? got.district ?? '⚠️ NEITHER — this row would display no town'
  console.log(`  ${WRITE ? 'WRITE' : 'would'} ${u.postcode.padEnd(9)} ${mask(u.email)} — `
    + `bua=${got.bua ?? 'null'} district=${got.district ?? 'null'} → shows "${shown}"`)

  if (WRITE) {
    // ⚠️ ONLY the two columns. postcode, latitude and longitude are not in this
    // update at all, so a wrong lookup cannot move anybody.
    const { error: upErr } = await db
      .from('users')
      .update({ admin_district: got.district, bua: got.bua })
      .eq('id', u.id)
    if (upErr) { console.error(`        ⚠️ write failed: ${upErr.message}`); failed++; continue }
    wrote++
  }
}

console.log(`\n${WRITE ? 'wrote' : 'would write'} ${WRITE ? wrote : rows.length - skipped - failed}`
  + `, skipped ${skipped}, failed ${failed}`)
console.log(`bua null: ${buaNull} of ${rows.length - skipped - failed} looked up`
  + `${bothNull > 0 ? `; BOTH null: ${bothNull}` : ''}`)
console.log('⚠️ That is a FIRST READING, not a rate. Seven rows, four of them real and all in')
console.log('   cities, says nothing about rural postcodes — which is where bua is expected to')
console.log('   be absent. Do not write a null rate into a header from this.')
if (!WRITE) console.log('\nNothing was written. Re-run with --write to apply.')

/** Enough to tell the rows apart in a terminal, not enough to be a contact list. */
function mask(email) {
  if (!email) return '(no email)'
  const [u, d] = email.split('@')
  return `${u.slice(0, 1)}***@${d ?? '?'}`
}
