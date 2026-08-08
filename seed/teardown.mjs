/**
 * teardown.mjs — remove every seeded demo account and everything it owns.
 *
 *   node seed/teardown.mjs            # delete
 *   node seed/teardown.mjs --dry-run  # list what WOULD be deleted
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in the environment (never committed):
 *   $env:SUPABASE_SERVICE_ROLE_KEY = '<key>'   # PowerShell, current session only
 *
 * ── THE SAFETY PROPERTY ────────────────────────────────────────────────────
 * Every seeded account's email ends in @seed.guineapig.invalid.
 *
 * `.invalid` is a reserved TLD (RFC 2606) that can never be registered and
 * cannot receive mail, so NO real user can ever hold one — not by accident, not
 * by signing up, not ever. Teardown matches on that suffix alone, which makes it
 * structurally incapable of touching a real account.
 *
 * It refuses to run if the suffix is edited to something non-reserved.
 * ---------------------------------------------------------------------------
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ptluekkhiopowuyvkgnd.supabase.co'
const SEED_EMAIL_SUFFIX = '@seed.guineapig.invalid'
const BUCKETS = ['verification-selfies', 'profile-pics', 'model-photos', 'portfolio-photos']

const DRY_RUN = process.argv.includes('--dry-run')

// Refuse to run against anything that isn't a reserved, unregisterable domain.
// Without this, a careless edit to the suffix could match live accounts.
if (!/@seed\.[a-z-]+\.(invalid|test|example|localhost)$/.test(SEED_EMAIL_SUFFIX)) {
  console.error(
    `REFUSING TO RUN: "${SEED_EMAIL_SUFFIX}" is not a reserved test domain.\n` +
    'Teardown only deletes accounts on an RFC 2606 reserved TLD (.invalid/.test/.example),\n' +
    'which real users can never hold. Do not point this at a real domain.',
  )
  process.exit(1)
}

const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!key) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set. Set it in this shell only:')
  console.error("  $env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'")
  process.exit(1)
}

const db = createClient(SUPABASE_URL, key, { auth: { persistSession: false } })

/**
 * Every FK that points at auth.users with ON DELETE NO ACTION, as of 7 Aug 2026.
 * One of these holds the row when auth.admin.deleteUser fails — GoTrue only ever
 * says "Database error deleting user", which is a dead end on its own.
 *
 * `session_consents` and `moderation_actions` carry prevent_mutation triggers on
 * BEFORE DELETE: their rows are immutable by design and CANNOT be removed here.
 * If one of them is the blocker, the right outcome is usually to ban the auth
 * user (`banned_until = 'infinity'`) and leave the row, not to disable a safety
 * mechanism someone added deliberately.
 */
// Kept in sync by hand, which is exactly why it has been wrong before: the
// 7 Aug 2026 chase missed sessions.model_user_id, then patch_tests, then
// admin_audit_log.target_user_id, one round-trip at a time. If this list is
// ever unhelpful again, stop extending it and ask the database instead:
//
//   select con.conrelid::regclass, att.attname
//   from pg_constraint con
//   join unnest(con.conkey) k(attnum) on true
//   join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
//   where con.contype = 'f' and con.confrelid = 'auth.users'::regclass
//     and con.confdeltype <> 'c';   -- CASCADE takes care of itself
const BLOCKING_REFS = [
  ['sessions', 'model_user_id'],
  ['sessions', 'model_id'],
  ['reports', 'reviewed_by'],
  ['reports', 'reporter_id'],
  ['session_consents', 'user_id'],
  ['patch_tests', 'logged_by'],
  ['patch_tests', 'model_id'],
  ['patch_tests', 'provider_id'],
  ['moderation_actions', 'admin_id'],
  ['moderation_actions', 'target_user_id'],
  ['admin_audit_log', 'admin_id'],
  ['admin_audit_log', 'target_user_id'],
]

/** Name whatever is still referencing a user we failed to delete. */
async function diagnose(userId) {
  const hits = []
  for (const [table, col] of BLOCKING_REFS) {
    const { count, error } = await db
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(col, userId)
    if (error) continue // table may not exist in this environment
    if ((count ?? 0) > 0) hits.push(`${table}.${col} (${count})`)
  }
  return hits
}

/** Every seeded auth user, paging through the admin list. */
async function findSeededUsers() {
  const found = []
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const users = data?.users ?? []
    found.push(...users.filter(u => (u.email ?? '').toLowerCase().endsWith(SEED_EMAIL_SUFFIX)))
    if (users.length < 200) break
  }
  return found
}

/** Remove everything a user owns in a bucket. All app buckets key by `${userId}/…`. */
async function clearBucket(bucket, userId) {
  const { data: files, error } = await db.storage.from(bucket).list(userId, { limit: 1000 })
  if (error || !files?.length) return 0
  const paths = files.map(f => `${userId}/${f.name}`)
  const { error: rmErr } = await db.storage.from(bucket).remove(paths)
  if (rmErr) { console.warn(`  ! ${bucket}: ${rmErr.message}`); return 0 }
  return paths.length
}

async function main() {
  console.log(DRY_RUN ? '— DRY RUN, nothing will be deleted —\n' : '— DELETING SEEDED DATA —\n')

  const users = await findSeededUsers()
  if (!users.length) {
    console.log('No seeded accounts found. Nothing to do.')
    return
  }

  console.log(`Found ${users.length} seeded account(s):`)
  for (const u of users) console.log(`  · ${u.email}`)
  console.log()

  if (DRY_RUN) {
    console.log('Re-run without --dry-run to delete these and everything they own.')
    return
  }

  // ── Phase 1: gather the WHOLE cohort's ids before deleting anything ────────
  //
  // THE BUG THIS FIXES (7 Aug 2026): this script used to delete one user at a
  // time, but the rows that block a delete are shared BETWEEN users — user A's
  // notification points at user B's session. Processing A first failed to
  // delete B-referenced rows, the failure was not checked, and the auth delete
  // then failed for real. By the time B was processed, B's rows were gone and
  // the session sat orphaned. Two of nine accounts survived exactly that way,
  // and the script reported success.
  //
  // Gathering the whole cohort first means cross-references between seeded
  // users are cleared together, in dependency order, once.
  const userIds = users.map(u => u.id)

  const { data: provRows } = await db.from('providers').select('id').in('user_id', userIds)
  const providerIds = (provRows ?? []).map(p => p.id)

  const sessionSet = new Set()
  const addSessions = (rows) => { for (const r of rows ?? []) sessionSet.add(r.id) }
  // sessions carries BOTH model_id and model_user_id; check both or miss rows.
  addSessions((await db.from('sessions').select('id').in('model_user_id', userIds)).data)
  addSessions((await db.from('sessions').select('id').in('model_id', userIds)).data)
  if (providerIds.length) {
    addSessions((await db.from('sessions').select('id').in('provider_id', providerIds)).data)
  }
  const sessionIds = [...sessionSet]

  console.log(`Cohort: ${userIds.length} user(s), ${providerIds.length} provider(s), ${sessionIds.length} session(s)\n`)

  // ── Phase 2: cohort-wide dependents, in dependency order, once ─────────────
  // Errors are REPORTED, not swallowed — an unreported failure here is what
  // turned a bug into a script that lied about succeeding.
  const step = async (label, q) => {
    const { error } = await q
    if (error) console.warn(`  ! ${label}: ${error.message}`)
  }

  if (sessionIds.length) {
    console.log('Clearing shared references …')
    await step('messages(session)',      db.from('messages').delete().in('session_id', sessionIds))
    await step('reviews(session)',       db.from('reviews').delete().in('session_id', sessionIds))
    await step('notifications(session)', db.from('notifications').delete().in('session_id', sessionIds))
    await step('reports(session)',       db.from('reports').delete().in('session_id', sessionIds))
    await step('audit(session)',         db.from('admin_audit_log').update({ target_session_id: null }).in('target_session_id', sessionIds))
    await step('sessions',               db.from('sessions').delete().in('id', sessionIds))
  }

  for (const pid of providerIds) {
    await step('availability',         db.from('availability').delete().eq('provider_id', pid))
    await step('portfolio_items',      db.from('portfolio_items').delete().eq('provider_id', pid))
    await step('portfolio_categories', db.from('portfolio_categories').delete().eq('provider_id', pid))
    await step('provider_treatments',  db.from('provider_treatments').delete().eq('provider_id', pid))
  }
  if (providerIds.length) {
    await step('audit(provider)', db.from('admin_audit_log').update({ target_provider_id: null }).in('target_provider_id', providerIds))
  }

  // admin_audit_log.target_user_id is NO ACTION and blocks the auth delete.
  // Null the pointer, keep the audit row — the record of what admins did stays.
  await step('audit(user)',   db.from('admin_audit_log').update({ target_user_id: null }).in('target_user_id', userIds))
  await step('reports(user)', db.from('reports').delete().in('reporter_id', userIds))
  await step('reports(revd)', db.from('reports').update({ reviewed_by: null }).in('reviewed_by', userIds))
  console.log()

  // ── Phase 3: per-user leftovers, storage, then the account itself ──────────
  let files = 0
  for (const u of users) {
    console.log(`Deleting ${u.email} …`)

    for (const b of BUCKETS) files += await clearBucket(b, u.id)

    // Anything else keyed directly to the user.
    await db.from('reviews').delete().eq('reviewer_id', u.id)
    await db.from('reviews').delete().eq('reviewee_id', u.id)
    await db.from('model_photos').delete().eq('user_id', u.id)
    await db.from('model_photo_categories').delete().eq('user_id', u.id)
    await db.from('model_attributes').delete().eq('user_id', u.id)
    await db.from('notifications').delete().eq('user_id', u.id)
    await db.from('push_tokens').delete().eq('user_id', u.id)
    await db.from('favourites').delete().eq('user_id', u.id)
    await db.from('suspensions').delete().eq('user_id', u.id)
    await db.from('verification_requests').delete().eq('user_id', u.id)
    await db.from('verification_payments').delete().eq('user_id', u.id)
    await db.from('subscriptions').delete().eq('user_id', u.id)

    // patch_tests postdates this script and blocks the auth delete. NB its
    // provider_id references auth.users, NOT providers.id — unlike every other
    // provider_id in this schema.
    await db.from('patch_tests').delete().eq('model_id', u.id)
    await db.from('patch_tests').delete().eq('provider_id', u.id)
    await db.from('patch_tests').delete().eq('logged_by', u.id)

    await db.from('providers').delete().eq('user_id', u.id)

    // 3. public.users has NO FK to auth.users, so deleting the auth user does NOT
    //    remove it. Delete it explicitly, before the auth user.
    await db.from('users').delete().eq('id', u.id)

    // 4. Finally the auth user.
    const { error: authErr } = await db.auth.admin.deleteUser(u.id)
    if (authErr) {
      console.warn(`  ! auth user: ${authErr.message}`)
      const blockers = await diagnose(u.id)
      console.warn(
        blockers.length
          ? `    still referenced by: ${blockers.join(', ')}`
          : '    no known FK holds it — check pg_constraint for tables added since this script',
      )
      // A leftover auth user is not inert while a password is guessable, and
      // signing in grants the `authenticated` role that RLS opens up. Ban it.
      const { error: banErr } = await db.auth.admin.updateUserById(u.id, { ban_duration: '876000h' })
      console.warn(banErr ? `    ! could not ban: ${banErr.message}` : '    banned so it cannot sign in')
    }
  }

  console.log(`\nDone. Removed ${users.length} account(s) and ${files} file(s).`)

  // Prove it, rather than assuming.
  // Re-query rather than trusting the loop above. This is the only statement
  // that actually knows whether teardown worked.
  const left = await findSeededUsers()
  if (left.length === 0) {
    console.log('Verified: no seeded accounts remain.')
    return
  }

  // EXIT NON-ZERO. A partial teardown is a failure and must be one to the
  // shell, not just to a human reading scrollback.
  //
  // This used to print the warning and exit 0, which is how the 7 Aug 2026
  // teardown "succeeded" while leaving two sign-in-able accounts behind — with
  // a password that was, at that moment, committed to a public repository. Any
  // `teardown && deploy` chain would have carried straight on.
  //
  // Same lesson as the comment that caused that incident: a claim nobody
  // verifies is not a safeguard. The exit code is the verification.
  process.exitCode = 1
  console.error(
    `\nFAILED: ${left.length} seeded auth user(s) could not be deleted — see the blockers above.\n` +
    `  ${left.map(u => u.email).join('\n  ')}\n\n` +
    'Their app data and files ARE gone, and they have been banned so they cannot sign in.\n' +
    'But the accounts still exist, so this run did NOT fully tear down. Exiting 1.\n\n' +
    'If the blocker is an immutable consent or moderation record, banned-and-orphaned is the\n' +
    'correct end state — do not disable the trigger to force a delete. Acknowledge it and move\n' +
    'on; do not make this exit 0 to quieten it.',
  )
}

main().catch(e => { console.error(e); process.exit(1) })
