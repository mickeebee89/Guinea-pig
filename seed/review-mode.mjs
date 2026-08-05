/**
 * review-mode.mjs — make every seeded stylist UNBOOKABLE while leaving the demo
 * profiles on display.
 *
 *   node seed/review-mode.mjs            # strip availability
 *   node seed/review-mode.mjs --dry-run  # report what WOULD be stripped
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in the environment (never committed):
 *   $env:SUPABASE_SERVICE_ROLE_KEY = '<key>'   # PowerShell, current session only
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * We want the seeded stylists visible through app review so the marketplace
 * doesn't look abandoned. But a seeded stylist with availability is GENUINELY
 * bookable: a real member of the public could pay £4.99 for a subscription,
 * apply, and wait forever for a reply from an account with nobody behind it.
 *
 * Availability is the only surface where that can happen. Messaging needs an
 * accepted session and reviews need a completed one, so both are unreachable
 * without a booking. Favouriting and profile views are harmless.
 *
 * So: strip availability from ALL seeded stylists. The bookable account used to
 * exercise the flow during review is a REAL provider account with a real person
 * behind it, not one of these.
 *
 * This does NOT delete profiles, portfolios, treatments or reviews — those are
 * what make the app look populated. Use teardown.mjs to remove the accounts
 * entirely before launch.
 * ---------------------------------------------------------------------------
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ptluekkhiopowuyvkgnd.supabase.co'
const SEED_EMAIL_SUFFIX = '@seed.guineapig.invalid'

const DRY_RUN = process.argv.includes('--dry-run')

// Same guard as teardown: only ever touch accounts on a reserved, unregisterable
// domain (RFC 2606), which no real user can hold.
if (!/@seed\.[a-z-]+\.(invalid|test|example|localhost)$/.test(SEED_EMAIL_SUFFIX)) {
  console.error(
    `REFUSING TO RUN: "${SEED_EMAIL_SUFFIX}" is not a reserved test domain.\n` +
    'This only ever modifies accounts on an RFC 2606 reserved TLD.',
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

async function main() {
  console.log(DRY_RUN ? '— DRY RUN, nothing will change —\n' : '— STRIPPING SEEDED AVAILABILITY —\n')

  const users = await findSeededUsers()
  if (!users.length) {
    console.log('No seeded accounts found. Nothing to do.')
    return
  }

  let totalSlots = 0
  let stylists = 0

  for (const u of users) {
    const { data: provs, error: provErr } = await db
      .from('providers').select('id, name').eq('user_id', u.id)
    if (provErr) throw provErr
    if (!provs?.length) continue          // a seeded model, not a stylist

    for (const p of provs) {
      // Count first so the dry run and the real run report the same number.
      const { count, error: cErr } = await db
        .from('availability')
        .select('id', { count: 'exact', head: true })
        .eq('provider_id', p.id)
      if (cErr) throw cErr

      stylists++
      totalSlots += count ?? 0
      console.log(`  ${p.name ?? u.email}: ${count ?? 0} slot(s)`)

      if (!DRY_RUN && (count ?? 0) > 0) {
        const { error: delErr } = await db
          .from('availability').delete().eq('provider_id', p.id)
        if (delErr) throw delErr
      }
    }
  }

  if (DRY_RUN) {
    console.log(`\nWould remove ${totalSlots} slot(s) across ${stylists} seeded stylist(s).`)
    console.log('Profiles, portfolios, treatments and reviews would be left alone.')
    return
  }

  console.log(`\nRemoved ${totalSlots} slot(s) across ${stylists} seeded stylist(s).`)

  // Prove it, rather than assuming — the same reason teardown re-checks.
  let remaining = 0
  for (const u of users) {
    const { data: provs } = await db.from('providers').select('id').eq('user_id', u.id)
    for (const p of provs ?? []) {
      const { count } = await db
        .from('availability').select('id', { count: 'exact', head: true }).eq('provider_id', p.id)
      remaining += count ?? 0
    }
  }
  console.log(remaining === 0
    ? 'Verified: no seeded stylist has any availability. None are bookable.'
    : `WARNING: ${remaining} slot(s) still present — re-run.`)

  console.log('\nReminder: seeded accounts are still live. Run teardown.mjs before launch.')
}

main().catch(e => { console.error(e); process.exit(1) })
