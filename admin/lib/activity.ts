import { supabase } from './supabase'

/**
 * The "something happened here" dots.
 *
 * ── ⚠️ ELEVEN KEYS, AND THE DATABASE IS THE ONE THAT DECIDES ────────────
 * `admin_activity_seen_key_known` (0104) is a CHECK constraint naming exactly
 * these eleven. This list must agree with it; if it ever does not, the write
 * is refused by the database rather than silently creating a watermark for a
 * key nothing counts — which would look exactly like the feature working.
 *
 * ⚠️ 'activity' IS NOT A KEY. The Activity page's dot is the sum of its five
 * types, computed here from counts already fetched. A twelfth watermark would
 * be a number that could disagree with the five it is made of.
 */
export const ACTIVITY_KEYS = [
  'users', 'providers', 'verification', 'moderation', 'reports', 'messages',
  'signup', 'slot', 'booking', 'photo', 'favourite',
] as const

export type ActivityKey = typeof ACTIVITY_KEYS[number]

export interface ActivityCount {
  key: ActivityKey
  new_count: number
  muted: boolean
}

/**
 * ⚠️⚠️ NO TYPE SHIM HERE, AND THE REASON IS WORTH KNOWING. The first draft had
 * one, on the assumption that calling an RPC absent from `database.types.ts`
 * would not compile — which is what happened in `site/` when 0099 landed.
 *
 * It is not true in `admin/`. `admin/lib/supabase.ts` calls
 * `createBrowserClient(url, key)` with NO `<Database>` generic, so the client
 * is untyped: every `.from()`, `.select()` and `.rpc()` in this console is
 * unchecked, and `admin/lib/database.types.ts` — regenerated and committed on
 * every schema change — is imported by nothing.
 *
 * So the shim was protecting against a check that does not run. Removing it
 * leaves plain calls that will start being checked the day somebody
 * parameterises that client, which is the right direction to be pointing.
 */
/**
 * Per-key counts for the signed-in admin.
 *
 * ⚠️ THIS CALL WRITES. On an admin's first ever load it seeds a watermark at
 * now() for every missing key and reports 0 — so the console never opens as a
 * wall of dots over 52 users and 46 messages that were always there. Calling it
 * is therefore not free of consequence, which is why it happens on mount and on
 * navigation rather than on a timer.
 *
 * ⚠️ FAILS TO AN EMPTY LIST, WHICH MEANS NO DOTS. A console that invented dots
 * when it could not reach the database would send someone looking for work that
 * does not exist; one that shows none is merely uninformative, and the error is
 * logged either way.
 */
export async function fetchActivityCounts(): Promise<ActivityCount[]> {
  const { data, error } = await supabase.rpc('admin_activity_counts')
  if (error) {
    console.warn('[activity] counts failed:', error.message)
    return []
  }
  return (data ?? []) as ActivityCount[]
}

/** Advance this admin's watermark for one key. Fire and forget by design. */
export async function markActivitySeen(key: ActivityKey): Promise<void> {
  const { error } = await supabase.rpc('admin_mark_activity_seen', { p_key: key })
  if (error) console.warn('[activity] mark seen failed:', key, error.message)
}

/**
 * Which nav item each key lights up.
 *
 * ⚠️ ONLY SIX OF THE ELEVEN HAVE A PAGE. The other five — signup, slot,
 * booking, photo, favourite — are the Activity feed's types and have no nav
 * item of their own; their dot is the Activity one.
 *
 * ⚠️ `users` AND `signup` BOTH COUNT users.created_at, deliberately. Opening
 * Users clears the Users dot and leaves the Activity one, because "I have
 * looked at the user table" and "I have read the new-signup feed" are different
 * claims. They will often light together, and that is correct rather than
 * double counting.
 */
export const NAV_KEY_BY_HREF: Record<string, ActivityKey> = {
  '/users': 'users',
  '/providers': 'providers',
  '/verification': 'verification',
  '/moderation': 'moderation',
  '/reports': 'reports',
  '/messages': 'messages',
}

/** The five types the Activity page shows, and whose counts form its dot. */
export const ACTIVITY_FEED_KEYS: ActivityKey[] =
  ['signup', 'slot', 'booking', 'photo', 'favourite']

/** Plain-English names, used in the settings toggles and the feed's labels. */
export const KEY_LABEL: Record<ActivityKey, string> = {
  users: 'Users',
  providers: 'Shops going live',
  verification: 'ID checks waiting',
  moderation: 'Profile photos to review',
  reports: 'Reports',
  messages: 'Messages',
  signup: 'New sign-ups',
  slot: 'New availability slots',
  booking: 'New bookings',
  photo: 'New model photos',
  favourite: 'New favourites',
}

/**
 * What the dot is counting, said plainly — because two of these do not mean
 * what the others do, and a toggle list is where that has to be visible.
 */
export const KEY_NOTE: Record<ActivityKey, string> = {
  users: 'New accounts since you last opened Users.',
  providers: 'Shops published since you last looked. Not new stylist sign-ups — that is New sign-ups.',
  verification: 'ID checks currently waiting. Counts what is outstanding, so it does not clear by looking.',
  moderation: 'Profile photos not yet reviewed. Outstanding, so it does not clear by looking.',
  reports: 'Reports filed since you last opened Reports.',
  messages: 'Messages sent since you last opened Messages.',
  signup: 'Accounts created since you last opened Activity.',
  slot: 'Availability posted since you last opened Activity.',
  booking: 'Bookings created since you last opened Activity.',
  photo: 'Model photos uploaded since you last opened Activity.',
  favourite: 'Stylists favourited since you last opened Activity.',
}

/** "3 new" / "" — the words a screen reader gets, since a dot is colour only. */
export const countPhrase = (n: number) => (n > 0 ? `${n} new` : '')

/**
 * Accounts whose activity is Micky testing the product, not a member using it.
 *
 * ── ⚠️ DECLARED BY ID, WITH THE ADDRESS AS THE REASON ───────────────────
 * The id is stable and the email is readable, so both are here: a uuid alone
 * is unauditable and an email alone changes. Each entry has to be ADDED ON
 * PURPOSE — there is no pattern match on "looks like a test", because
 * `samanthaflowersamaral221@gmail.com` is a real founding provider and
 * `Fullrunthroughtest A` is not, and no rule reads those two correctly.
 *
 * ⚠️⚠️ THIS HIDES ROWS. IT DOES NOT DELETE THEM. Every slot, booking, photo
 * and favourite these accounts made is still in the database and still visible
 * on every other screen in the console. The Activity feed is a reading of
 * what members are doing, and five accounts doing QA is not that.
 *
 * ⚠️ AND IT IS A FEED FILTER ONLY — the sidebar dots still count these
 * accounts, because the counts come from `admin_activity_counts` in SQL and
 * changing them is a migration. So a slot posted from a test account lights
 * the Activity dot and then does not appear in the feed. Known, and the page
 * says so rather than leaving it to be discovered.
 */
export const TEST_ACCOUNT_IDS: Record<string, string> = {
  'ff06d568-8936-45fa-ad5f-0b88c150ec30': 'micky.buckfield@gmail.com — Micky B, the stylist account',
  'b0df9c2f-02c5-4fef-afb0-9b184c3b9130': 'micky.buckfield@hotmail.co.uk — Model B, the model test account',
  'a923c7cc-e5c1-403e-96c7-addbe8fc73d3': 'micky.buckfield+stylist@gmail.com — testest T',
  '517c2853-50bb-4e8f-87fe-d79311bc37c0': 'nahitih259@bevriz.com — Fullrunthroughtest A',
  '8788ed3d-40a6-44da-ad61-c38d0932b6d5': 'admin@guineapigapp.co.uk — the dedicated console admin',
}

export const isTestAccount = (userId: string | null | undefined) =>
  !!userId && userId in TEST_ACCOUNT_IDS

/**
 * When 0104 stamped `availability.created_at` on every row that already
 * existed.
 *
 * ⚠️⚠️ THE 57 ROWS AT THIS INSTANT ARE NOT EVENTS. `availability` had no
 * created_at before 0104, and `default now()` gave every pre-existing row the
 * migration's own clock — measured, all 57 share this exact timestamp. When
 * a stylist actually posted those slots is not recorded anywhere and cannot be
 * recovered.
 *
 * So the feed excludes them rather than presenting 57 simultaneous "events"
 * that never happened. 0104's own header says these values are fiction; this
 * is the first thing to act on it.
 *
 * ⚠️ A REAL SLOT POSTED IN THAT SAME SECOND WOULD ALSO BE HIDDEN. One second,
 * once, against 57 permanent fictions — and anything posted after it is shown
 * normally. The alternative is a feed that opens on a wall of made-up times
 * for as long as the 7-day window reaches back to the migration.
 *
 * ⚠️ IT DOES NOT AFFECT THE DOTS, and that is not luck: the `slot` count
 * measures against a watermark seeded at first load, which is later than this,
 * so these rows were never going to be counted as new.
 */
export const SLOT_BACKFILL_INSTANT = '2026-10-24T20:07:16.386287Z'
