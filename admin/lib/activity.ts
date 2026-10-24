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
