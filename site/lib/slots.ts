/**
 * Has this slot already started? Audit item 133.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 * Every availability query in both apps filtered with `date >= today` and
 * nothing anywhere compared the TIME OF DAY. So from midnight a slot was
 * correctly offered, and after it began it went on being offered for the rest
 * of the day — as bookable, as "Slots open" in browse, and as a pale-pink day
 * on the shop calendar.
 *
 * Found by Micky on 30 Sep 2026 by applying at 16:37 for a 9am slot THAT
 * MORNING. The application was accepted and landed in the stylist's diary.
 *
 * ⚠️ THIS IS THE PRESENTATION HALF ONLY. It stops a past slot being offered;
 * it cannot stop one being submitted, because the wizard keeps its state in
 * the URL and a page open since this morning still holds a slot id. The half
 * that cannot be bypassed is in the database.
 *
 * ── ⚠️ EUROPE/LONDON, EXPLICITLY, AND NOT BY ACCIDENT ───────────────────
 * `availability.date` and `.start_time` are a bare date and a bare time: they
 * mean UK wall-clock time, with no offset attached.
 *
 * Comparing them against `new Date()` compares them against the clock of
 * whatever machine is running the code — and this runs on a Vercel server set
 * to UTC. From late March to late October the UK is UTC+1, so a naive
 * comparison is an hour LENIENT for seven months of the year: at 09:30 London
 * the server reads 08:30 and a 09:00 slot is still "in the future".
 *
 * An hour of leniency is exactly the size of a slot. So the current time is
 * taken in London, as strings, and compared as strings — both are fixed-width
 * and zero-padded, so 'YYYY-MM-DD' and 'HH:MM' order lexicographically. No
 * dependency, no offset arithmetic, and nothing to get wrong twice a year.
 */

const LONDON = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
})

/** The wall clock in London right now, as the same shapes the columns hold. */
export function londonNow(): { date: string; time: string } {
  const p: Record<string, string> = {}
  for (const part of LONDON.formatToParts(new Date())) p[part.type] = part.value
  // Some engines render midnight as hour "24" under hour12:false.
  const hour = p.hour === '24' ? '00' : p.hour
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}` }
}

/**
 * True once the slot has begun.
 *
 * START, not end: an appointment that is already under way is not something
 * to apply for, and "you can still book the last ten minutes of it" is not a
 * rule anybody wants to explain.
 *
 * `startTime` may arrive as 'HH:MM' or 'HH:MM:SS' — Postgres returns the
 * latter — so only the first five characters are compared.
 */
export function slotHasStarted(
  date: string,
  startTime: string,
  now = londonNow(),
): boolean {
  if (date < now.date) return true
  if (date > now.date) return false
  return startTime.slice(0, 5) <= now.time
}

/**
 * Drop the slots that have started, from any row shape.
 *
 * ⚠️ ONE HELPER, EVERY CALL SITE. The same `date >= today` was written out
 * five times across two apps, and all five were wrong in the same way. A rule
 * copied five times is five places to fix and four places to forget — the
 * fault this codebase has now recorded in FeaturedStylists, in safeList and
 * here. The `now` is resolved ONCE per call so a long list cannot straddle a
 * minute boundary and filter inconsistently.
 */
export function withoutStartedSlots<T>(
  rows: T[],
  pick: (row: T) => { date: string; startTime: string },
): T[] {
  const now = londonNow()
  return rows.filter(r => {
    const { date, startTime } = pick(r)
    return !slotHasStarted(date, startTime, now)
  })
}
