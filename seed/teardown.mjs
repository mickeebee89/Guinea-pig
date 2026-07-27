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

  let files = 0
  for (const u of users) {
    console.log(`Deleting ${u.email} …`)

    // 1. Storage first — the DB rows hold the paths we need to find these.
    for (const b of BUCKETS) files += await clearBucket(b, u.id)

    // 2. Rows that do NOT cascade from public.users. Sessions reference providers,
    //    and messages/reviews reference sessions, so clear them in dependency order.
    const { data: provs } = await db.from('providers').select('id').eq('user_id', u.id)
    for (const p of provs ?? []) {
      const { data: sess } = await db.from('sessions').select('id').eq('provider_id', p.id)
      const ids = (sess ?? []).map(s => s.id)
      if (ids.length) {
        await db.from('messages').delete().in('session_id', ids)
        await db.from('reviews').delete().in('session_id', ids)
        await db.from('sessions').delete().in('id', ids)
      }
      await db.from('availability').delete().eq('provider_id', p.id)
      await db.from('portfolio_items').delete().eq('provider_id', p.id)
      await db.from('portfolio_categories').delete().eq('provider_id', p.id)
      await db.from('provider_treatments').delete().eq('provider_id', p.id)
    }

    // Sessions where this user was the MODEL (a different provider's booking).
    const { data: asModel } = await db.from('sessions').select('id').eq('model_user_id', u.id)
    const modelIds = (asModel ?? []).map(s => s.id)
    if (modelIds.length) {
      await db.from('messages').delete().in('session_id', modelIds)
      await db.from('reviews').delete().in('session_id', modelIds)
      await db.from('sessions').delete().in('id', modelIds)
    }

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
    await db.from('providers').delete().eq('user_id', u.id)

    // 3. public.users has NO FK to auth.users, so deleting the auth user does NOT
    //    remove it. Delete it explicitly, before the auth user.
    await db.from('users').delete().eq('id', u.id)

    // 4. Finally the auth user.
    const { error: authErr } = await db.auth.admin.deleteUser(u.id)
    if (authErr) console.warn(`  ! auth user: ${authErr.message}`)
  }

  console.log(`\nDone. Removed ${users.length} account(s) and ${files} file(s).`)

  // Prove it, rather than assuming.
  const left = await findSeededUsers()
  console.log(left.length === 0
    ? 'Verified: no seeded accounts remain.'
    : `WARNING: ${left.length} seeded account(s) still present — re-run.`)
}

main().catch(e => { console.error(e); process.exit(1) })
