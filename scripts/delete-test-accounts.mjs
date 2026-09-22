/**
 * delete-test-accounts.mjs — one-off removal of the hand-made test accounts on
 * the live database, so the site can go live.
 *
 *   node scripts/delete-test-accounts.mjs            # DRY RUN. Reads only. Default.
 *   node scripts/delete-test-accounts.mjs --apply    # deletes
 *
 * The list is read from scripts/private/test-accounts-to-delete.txt (one address
 * per line, # for comments). That folder is gitignored: the addresses are real
 * inboxes and do not belong in version control. Pass --list <path> to use
 * another file.
 *
 * Needs ONE variable, SUPABASE_SERVICE_ROLE_KEY, set in the current PowerShell
 * session only. Its value is never printed, logged or echoed, including in
 * errors. The project URL is fixed below, so the key cannot be pointed at
 * another project by accident.
 *
 * ── NO STRIPE ───────────────────────────────────────────────────────────
 * This script holds no Stripe key and makes no Stripe call. Instead it REFUSES
 * any account whose subscriptions row has a future end date or a live status.
 * An account that passes has nothing for delete-account's cancel step to
 * cancel. The one thing this cannot see is a live Stripe subscription with
 * no subscriptions row at all (the audit's section B trap), so check Stripe
 * before --apply.
 *
 * ── WHY NOT teardown.mjs, WHY NOT delete-account ────────────────────────
 * teardown only matches @seed.guineapig.invalid and must keep it that way.
 * delete-account needs a sign-in per account, and when its login delete fails
 * it leaves a usable login with no profile row (audit item 50). This script
 * does the database work through the same delete_account_data RPC
 * (0004:337-395), clears storage the way delete-account does
 * (delete-account/index.ts:180-192), deletes the login last, and on failure
 * BANS it (teardown.mjs:286-289).
 *
 * ── WHAT delete_account_data REMOVES THAT BELONGS TO SOMEONE ELSE ───────
 * Every booking the account is in, as model or as stylist, with all of its
 * messages, reviews and notifications, INCLUDING THE OTHER PARTY'S
 * (0004:376-382). The dry run names every booking shared with an account that
 * is not being deleted, so that loss is decided rather than discovered.
 * Reports survive de-identified; moderation_actions and session_consents
 * survive.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SUPABASE_URL = 'https://ptluekkhiopowuyvkgnd.supabase.co'
const EXPECTED_COUNT = 58
const APPLY = process.argv.includes('--apply')
const listArg = process.argv.indexOf('--list')
const LIST_PATH = resolve(listArg > -1 ? process.argv[listArg + 1] ?? '' : 'scripts/private/test-accounts-to-delete.txt')

// Never deleted. If any of these is on the list the script refuses outright.
// The ids come from CLAUDE.md and are checked against the database at runtime.
const KEEP = new Map([
  ['micky.buckfield@gmail.com',        'Micky B — backup admin, stylist shop'],
  ['admin@guineapigapp.co.uk',         'console admin'],
  ['micky.buckfield@hotmail.co.uk',    'model test account (0040 C, 0042 D, 0043 C)'],
  ['nahitih259@bevriz.com',            'provider test account (0040 A, B)'],
  ['micky.buckfield+model2@gmail.com', 'the live £4.99 subscription, renews 14 Oct'],
])
const MODEL_TEST_ID = 'b0df9c2f-02c5-4fef-afb0-9b184c3b9130'
const JOJO_B_PROVIDER = 'c42537d1-0b26-49b1-8770-a390b048ef9e' // 0040 section 4 and Block D
const BUCKETS = ['verification-selfies', 'profile-pics', 'model-photos', 'portfolio-photos']
const LIVE_SUB_STATUSES = ['active', 'trialling', 'trialing', 'cancelling', 'past_due']

// ── Environment: present, never printed ────────────────────────────────────
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
if (!KEY) {
  console.error('\nRefusing to run: SUPABASE_SERVICE_ROLE_KEY is not set in this session.')
  console.error('Nothing was read or written.\n')
  process.exit(1)
}
// It must be a service-role key. Checked by shape only; nothing is printed.
function isServiceKey(k) {
  if (k.startsWith('sb_secret_')) return true
  const parts = k.split('.')
  if (parts.length !== 3) return false
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString()).role === 'service_role' }
  catch { return false }
}
if (!isServiceKey(KEY)) {
  console.error('\nRefusing to run: the key in SUPABASE_SERVICE_ROLE_KEY is not a service-role key.')
  console.error('Nothing was read or written.\n')
  process.exit(1)
}

// ── HTTP, service role. Error text never includes the key or headers ───────
async function call(path, init = {}) {
  let res
  try {
    res = await fetch(`${SUPABASE_URL}${path}`, {
      ...init,
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
  } catch (e) {
    throw new Error(`request failed (${e?.cause?.code ?? e?.code ?? 'network error'})`)
  }
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  if (!res.ok) {
    const msg = body?.message ?? body?.msg ?? body?.error_description ?? body?.error ?? 'no message'
    const err = new Error(`${res.status}: ${msg}`)
    err.status = res.status
    throw err
  }
  return body
}

/** Every row of a PostgREST select, paged with Range so no page cap truncates it. */
async function all(table, query) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const rows = await call(`/rest/v1/${table}?${query}`, {
      headers: { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' },
    })
    out.push(...(rows ?? []))
    if (!rows || rows.length < 1000) return out
  }
}

/** Every auth user, paging the admin API. */
async function allAuthUsers() {
  const out = []
  for (let page = 1; page <= 100; page++) {
    const body = await call(`/auth/v1/admin/users?page=${page}&per_page=200`)
    const users = body?.users ?? []
    out.push(...users)
    if (users.length < 200) return out
  }
  throw new Error('more than 20,000 auth users — refusing to guess')
}

/** Top-level files under `${id}/` in a bucket, exactly what delete-account removes. */
async function listFolder(bucket, id) {
  const items = await call(`/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    body: JSON.stringify({ prefix: id, limit: 1000, offset: 0 }),
  })
  const files = (items ?? []).filter(i => i.id !== null)
  const folders = (items ?? []).filter(i => i.id === null)
  return { files: files.map(f => `${id}/${f.name}`), folders: folders.length }
}

const norm = (e) => String(e ?? '').trim().toLowerCase()
const day = (v) => (v ? String(v).slice(0, 10) : '—')
// Encoded: '+' in an address would otherwise arrive as a space.
const inList = (vals) => `in.(${vals.map(v => encodeURIComponent(v)).join(',')})`

// ── 1. The list ────────────────────────────────────────────────────────────
let raw
try { raw = readFileSync(LIST_PATH, 'utf8') } catch {
  console.error(`\nRefusing to run: cannot read the list at ${LIST_PATH}\n`)
  process.exit(1)
}
const wanted = raw.split(/\r?\n/).map(l => l.replace(/#.*/, '').trim()).filter(Boolean).map(norm)

const dupes = wanted.filter((e, i) => wanted.indexOf(e) !== i)
const keepHits = wanted.filter(e => KEEP.has(e))
if (dupes.length || keepHits.length || wanted.length !== EXPECTED_COUNT) {
  console.error('\nRefusing to run. The list itself is wrong:')
  if (wanted.length !== EXPECTED_COUNT) console.error(`  it has ${wanted.length} addresses, not ${EXPECTED_COUNT}`)
  for (const e of new Set(dupes)) console.error(`  listed twice: ${e}`)
  for (const e of keepHits) console.error(`  ON THE KEEP LIST: ${e} (${KEEP.get(e)})`)
  console.error('Nothing was read or written.\n')
  process.exit(1)
}

console.log(`\n${APPLY ? 'APPLY — DELETING' : 'DRY RUN — nothing will be written'}. Hand-made test accounts.`)
console.log(`List: ${LIST_PATH} (${wanted.length} addresses)\n`)

// ── 2. Resolve at runtime ──────────────────────────────────────────────────
const authUsers = await allAuthUsers()
const byEmail = new Map(authUsers.map(u => [norm(u.email), u]))

const unresolved = wanted.filter(e => !byEmail.has(e))
if (unresolved.length) {
  // A profile row with no login is a different state; name it rather than
  // leave "not found" looking like a typo.
  const orphanRows = await all('users', `select=id,email&email=${inList(unresolved.map(e => `"${e}"`))}`)
  const orphan = new Set(orphanRows.map(r => norm(r.email)))
  console.error(`Refusing to run: ${wanted.length - unresolved.length} of ${EXPECTED_COUNT} resolve to a login. These do not:`)
  for (const e of unresolved) {
    console.error(`  ${e}${orphan.has(e) ? '   (a public.users row exists with no login behind it)' : ''}`)
  }
  console.error('Nothing was written.\n')
  process.exit(1)
}

const targets = wanted.map(e => byEmail.get(e))
const targetIds = new Set(targets.map(t => t.id))

// The keep-list, resolved, so a changed email cannot slip an id through.
const keepIds = new Map()
for (const [email, why] of KEEP) {
  const u = byEmail.get(email)
  if (u) keepIds.set(u.id, `${email} — ${why}`)
  else console.log(`note: keep-list address ${email} has no login`)
}

// ── 3. Everything the report needs, read once ──────────────────────────────
const ids = [...targetIds]
const [admins, profiles, subs, fees, providers, sessions, messages, reviews, reports, founding, auditAsAdmin, settings] =
  await Promise.all([
    all('admins', 'select=user_id'),
    all('users', 'select=id,email,role'),
    all('subscriptions', `select=user_id,status,current_period_end,stripe_subscription_id&user_id=${inList(ids)}`),
    all('verification_payments', `select=user_id&user_id=${inList(ids)}`),
    all('providers', 'select=id,user_id,is_published'),
    all('sessions', 'select=id,model_user_id,model_id,provider_id,date,status'),
    all('messages', 'select=id,session_id,sender_id'),
    all('reviews', 'select=id,session_id,reviewer_id,reviewee_id'),
    all('reports', 'select=id,session_id,reporter_id,reported_id'),
    all('founding_providers', 'select=user_id,slot_number'),
    all('admin_audit_log', `select=admin_id&admin_id=${inList(ids)}`),
    all('settings', 'select=key,value&key=in.(founding_provider_cap,founding_provider_limit)'),
  ])

const adminIds = new Set(admins.map(a => a.user_id))
const profileById = new Map(profiles.map(p => [p.id, p]))
const emailById = new Map(authUsers.map(u => [u.id, norm(u.email)]))
const providerOwner = new Map(providers.map(p => [p.id, p.user_id]))
const partiesOf = (s) => [...new Set([s.model_user_id, s.model_id, providerOwner.get(s.provider_id)].filter(Boolean))]
const who = (id) => emailById.get(id) ?? profileById.get(id)?.email ?? `${String(id).slice(0, 8)}… (no login)`

// Bookings removed = any booking a target is in, as model or as stylist.
const doomedSessions = sessions.filter(s => partiesOf(s).some(id => targetIds.has(id)))
const doomedSessionIds = new Set(doomedSessions.map(s => s.id))

// ── 4. Refusals ────────────────────────────────────────────────────────────
function refusalsFor(u, subRows, auditRows) {
  const r = []
  if (keepIds.has(u.id)) r.push(`on the keep list (${keepIds.get(u.id)})`)
  if (adminIds.has(u.id)) r.push('is an admin')
  for (const sub of subRows) {
    if (sub.current_period_end && new Date(sub.current_period_end).getTime() > Date.now()) {
      r.push(`subscription ends ${day(sub.current_period_end)}, in the future`)
    }
    if (LIVE_SUB_STATUSES.includes(sub.status)) r.push(`subscription status is '${sub.status}'`)
  }
  if (auditRows > 0) r.push(`${auditRows} admin_audit_log row(s) as the acting admin (delete-account refuses these too)`)
  return r
}

const subsByUser = new Map()
for (const s of subs) subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) ?? []), s])
const feeUsers = new Set(fees.map(f => f.user_id))
const auditCount = new Map()
for (const a of auditAsAdmin) auditCount.set(a.admin_id, (auditCount.get(a.admin_id) ?? 0) + 1)

// ── 5. One line per account ────────────────────────────────────────────────
const refused = []
const sharedWithKept = []
let totalBookings = 0, totalMessages = 0

for (const u of targets) {
  const email = norm(u.email)
  const prof = profileById.get(u.id)
  const mine = doomedSessions.filter(s => partiesOf(s).includes(u.id))
  const mineIds = new Set(mine.map(s => s.id))
  const asModel = mine.filter(s => s.model_user_id === u.id || s.model_id === u.id).length
  const msgs = messages.filter(m => mineIds.has(m.session_id) || m.sender_id === u.id)
  const ownMsgs = msgs.filter(m => m.sender_id === u.id).length
  const revs = reviews.filter(r => mineIds.has(r.session_id) || r.reviewer_id === u.id || r.reviewee_id === u.id).length
  const repMade = reports.filter(r => r.reporter_id === u.id).length
  const repAgainst = reports.filter(r => r.reported_id === u.id).length
  const repOnBookings = reports.filter(r => r.session_id && mineIds.has(r.session_id)).length
  const shop = providers.find(p => p.user_id === u.id)
  const slot = founding.find(f => f.user_id === u.id)
  const userSubs = subsByUser.get(u.id) ?? []

  let files = 0, folders = 0
  for (const b of BUCKETS) {
    try { const l = await listFolder(b, u.id); files += l.files.length; folders += l.folders }
    catch (e) { console.log(`  ! ${email}: could not list ${b} (${e.message})`) }
  }

  const kept = []
  for (const s of mine) {
    for (const other of partiesOf(s).filter(id => !targetIds.has(id))) {
      kept.push(`${who(other)}${keepIds.has(other) ? ' [KEEP LIST]' : ''}`)
      sharedWithKept.push({ session: s, target: email, other })
    }
  }

  const refuse = refusalsFor(u, userSubs, auditCount.get(u.id) ?? 0)
  if (refuse.length) refused.push({ email, refuse })

  totalBookings += mine.length
  totalMessages += msgs.length

  const bits = [
    `${prof ? prof.role : 'NO PROFILE ROW'}`,
    `created ${day(u.created_at)}`,
    `bookings ${mine.length} (model ${asModel}, stylist ${mine.length - asModel})`,
    `messages ${msgs.length} (own ${ownMsgs})`,
    `reviews ${revs}`,
    `reports made/against/on-bookings ${repMade}/${repAgainst}/${repOnBookings} (kept, de-identified)`,
    shop ? `shop ${shop.is_published ? 'PUBLISHED' : 'hidden'}` : 'no shop',
    feeUsers.has(u.id) ? 'fee row' : null,
    ...userSubs.map(s => `sub ${s.status} to ${day(s.current_period_end)}`),
    slot ? `FOUNDING SLOT ${slot.slot_number}` : null,
    `files ${files}${folders ? ` (+${folders} subfolder(s) NOT cleared)` : ''}`,
    u.banned_until ? `banned until ${day(u.banned_until)}` : null,
    kept.length ? `SHARES A BOOKING WITH KEPT: ${[...new Set(kept)].join(', ')}` : null,
    refuse.length ? `REFUSED: ${refuse.join('; ')}` : null,
  ].filter(Boolean)
  console.log(`${email.padEnd(38)} ${bits.join(' · ')}`)
}

// ── 6. The separate report ─────────────────────────────────────────────────
console.log(`\nTotal: ${targets.length} accounts, ${totalBookings} booking-links (${doomedSessions.length} distinct bookings), ${totalMessages} message-links.`)

console.log('\nBookings shared with an account that is NOT being deleted (removed with ALL their messages):')
if (!sharedWithKept.length) console.log('  none')
for (const { session: s, target, other } of sharedWithKept) {
  const n = messages.filter(m => m.session_id === s.id).length
  console.log(`  ${s.id.slice(0, 8)}  ${day(s.date)}  ${s.status ?? '—'}  ${target}  with  ${who(other)}${keepIds.has(other) ? ' [KEEP LIST]' : ''}  · ${n} message(s)`)
}

console.log('\nThe keep-list accounts\' own bookings:')
for (const [id, label] of keepIds) {
  const theirs = sessions.filter(s => partiesOf(s).includes(id))
  const lost = theirs.filter(s => doomedSessionIds.has(s.id))
  console.log(`  ${label}: ${theirs.length} booking(s), ${lost.length} removed, ${theirs.length - lost.length} survive`)
}

const survivingSessions = sessions.filter(s => !doomedSessionIds.has(s.id))
const survivingMsgs = messages.filter(m => !doomedSessionIds.has(m.session_id) && !targetIds.has(m.sender_id))
const modelTestSessions = survivingSessions.filter(s => s.model_user_id === MODEL_TEST_ID)
const modelTestMsgs = survivingMsgs.filter(m => modelTestSessions.some(s => s.id === m.session_id))
const jojoOwner = providerOwner.get(JOJO_B_PROVIDER)

console.log('\nVerify blocks afterwards:')
console.log(`  0040 A, B (provider test account 517c2853…): ${keepIds.has('517c2853-50bb-4e8f-87fe-d79311bc37c0') ? 'kept — unaffected (they read its users row only)' : 'ID NOT FOUND ON THE KEEP LIST'}`)
console.log(`  0040 C (model test account b0df9c2f…): ${keepIds.has(MODEL_TEST_ID) ? 'kept — unaffected (needs no booking)' : 'ID NOT FOUND ON THE KEEP LIST'}`)
console.log(`  0040 D (Jojo B, provider ${JOJO_B_PROVIDER.slice(0, 8)}…): ${!jojoOwner ? 'provider row not found' : targetIds.has(jojoOwner) ? `OWNER ${who(jojoOwner)} IS ON THE LIST — block D would return nothing` : `owner ${who(jojoOwner)} kept — unaffected`}`)
console.log(`  0042 C (any provider): ${providers.filter(p => !targetIds.has(p.user_id)).length} provider row(s) survive`)
console.log(`  0042 D (model test account's latest booking): ${modelTestSessions.length} booking(s) survive${modelTestSessions.length ? '' : ' — BLOCK D WOULD RAISE "No booking"'}`)
console.log(`  0043 C (a message in the model test account's bookings): ${modelTestMsgs.length} message(s) survive${modelTestMsgs.length ? '' : ' — BLOCK C WOULD RAISE'}`)
console.log(`  0043 D (any message, plus a non-participant): ${survivingMsgs.length} message(s) survive, ${profiles.filter(p => !targetIds.has(p.id)).length} profile row(s) survive`)

const cap = settings.find(s => s.key === 'founding_provider_cap')?.value
const limit = settings.find(s => s.key === 'founding_provider_limit')?.value
const slotsHeld = founding.filter(f => targetIds.has(f.user_id))
const survivingSlots = founding.filter(f => !targetIds.has(f.user_id))
console.log('\nFounding providers:')
console.log(`  founding_providers rows now: ${founding.length}. Held by accounts on the list: ${slotsHeld.length}${slotsHeld.length ? ` (slot ${slotsHeld.map(f => f.slot_number).join(', ')})` : ''}.`)
console.log(`  Held by accounts that stay: ${survivingSlots.length}${survivingSlots.length ? ` (slot ${survivingSlots.map(f => `${f.slot_number} ${who(f.user_id)}`).join(', ')})` : ''}.`)
console.log(`  settings: founding_provider_cap = ${cap ?? 'absent'} (read by signup), founding_provider_limit = ${limit ?? 'absent'} (written by the admin console).`)

console.log('\nRefusals:')
if (!refused.length) console.log('  none — no account on the list has a live or future-dated subscription, an admin row, or a keep-list id')
for (const r of refused) console.log(`  ${r.email}: ${r.refuse.join('; ')}`)

if (!APPLY) {
  console.log('\nDry run complete. Nothing was written.')
  console.log(refused.length ? 'An --apply run would refuse to start until the refusals above are resolved.\n' : 'Re-run with --apply to delete.\n')
  process.exit(0)
}

// ── 7. Apply ───────────────────────────────────────────────────────────────
if (refused.length) {
  console.error('\nRefusing to apply: resolve the refusals above first. Nothing was written.\n')
  process.exit(1)
}

const outcome = { deleted: [], banned: [], skipped: [], failed: [] }

for (const u of targets) {
  const email = norm(u.email)
  process.stdout.write(`\n${email} … `)

  // Re-check immediately before the delete, from fresh reads.
  let fresh
  try { fresh = await call(`/auth/v1/admin/users/${u.id}`) } catch (e) {
    console.log(`SKIPPED: could not re-read the login (${e.message})`); outcome.skipped.push(email); continue
  }
  const freshSubs = await all('subscriptions', `select=user_id,status,current_period_end&user_id=eq.${u.id}`)
  const freshAdmin = (await all('admins', `select=user_id&user_id=eq.${u.id}`)).length > 0
  const freshAudit = (await all('admin_audit_log', `select=admin_id&admin_id=eq.${u.id}`)).length
  const again = [
    ...(norm(fresh?.email) !== email ? [`its email is now ${norm(fresh?.email)}`] : []),
    ...(KEEP.has(norm(fresh?.email)) ? ['its email is on the keep list'] : []),
    ...refusalsFor(u, freshSubs, freshAudit),
    ...(freshAdmin ? ['is an admin (fresh read)'] : []),
  ]
  if (again.length) { console.log(`SKIPPED: ${again.join('; ')}`); outcome.skipped.push(email); continue }

  // Database: one transaction. A failure rolls back in full, and then the
  // login is NOT deleted — that would strand whatever the RPC kept.
  let counts
  try {
    counts = await call('/rest/v1/rpc/delete_account_data', { method: 'POST', body: JSON.stringify({ p_user: u.id }) })
  } catch (e) {
    console.log(`FAILED in delete_account_data (${e.message}). Rolled back; nothing removed; login left as it was.`)
    outcome.failed.push(email); continue
  }

  // Storage, after the commit, as delete-account does it.
  const warnings = []
  for (const b of BUCKETS) {
    try {
      const { files } = await listFolder(b, u.id)
      if (files.length) {
        await call(`/storage/v1/object/${b}`, { method: 'DELETE', body: JSON.stringify({ prefixes: files }) })
      }
    } catch (e) { warnings.push(`${b}: ${e.message}`) }
  }

  // The login, last. If it fails, ban it so it cannot be signed into with no
  // profile row behind it (item 50).
  try {
    await call(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' })
    console.log(`deleted · ${JSON.stringify(counts)}${warnings.length ? ` · storage warnings: ${warnings.join('; ')}` : ''}`)
    outcome.deleted.push(email)
  } catch (e) {
    try {
      await call(`/auth/v1/admin/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ ban_duration: '876000h' }) })
      console.log(`data removed, LOGIN DELETE FAILED (${e.message}) — banned for 100 years so it cannot sign in`)
      outcome.banned.push(email)
    } catch (e2) {
      console.log(`data removed, LOGIN DELETE FAILED (${e.message}) AND THE BAN FAILED (${e2.message}) — THIS LOGIN IS USABLE. Ban it by hand now.`)
      outcome.failed.push(email)
    }
  }
}

// Prove it by reading again, rather than trusting the loop.
const after = await allAuthUsers()
const stillThere = after.filter(a => targetIds.has(a.id))
const orphanProfiles = await all('users', `select=id,email&id=${inList(ids)}`)
const stillThereUnbanned = stillThere.filter(a => !a.banned_until || new Date(a.banned_until).getTime() < Date.now())

console.log('\nSummary:')
console.log(`  deleted            ${outcome.deleted.length}`)
console.log(`  banned (kept login) ${outcome.banned.length}${outcome.banned.length ? `: ${outcome.banned.join(', ')}` : ''}`)
console.log(`  skipped            ${outcome.skipped.length}${outcome.skipped.length ? `: ${outcome.skipped.join(', ')}` : ''}`)
console.log(`  failed             ${outcome.failed.length}${outcome.failed.length ? `: ${outcome.failed.join(', ')}` : ''}`)
console.log(`Re-read: ${stillThere.length} login(s) from the list remain (${stillThereUnbanned.length} NOT banned), ${orphanProfiles.length} profile row(s) remain.`)

if (outcome.skipped.length || outcome.failed.length || stillThereUnbanned.length || orphanProfiles.length) process.exitCode = 1
console.log('')
