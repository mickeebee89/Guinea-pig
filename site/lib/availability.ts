import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Availability slots for a stylist. Ported from mobile/src/lib/availability.ts,
 * keeping the three properties that make it safe to run against live bookings.
 *
 *   1. UPSERT BEFORE DELETE. A failure part-way can never leave a day emptied.
 *   2. A BOOKED SLOT IS NEVER DELETED. Anything a session references is kept
 *      back and counted, so the caller can say so rather than quietly dropping
 *      someone's confirmed treatment.
 *   3. SCOPED TO ONE DATE. Every query filters on provider AND date, so an edit
 *      cannot reach another day.
 *
 * Treatment-id resolution is deliberately NOT ported. Mobile has to cope with
 * slugs from its DEFAULT_TREATMENTS fallback; here the editor only ever offers
 * the provider's real provider_treatments rows, so the slug path cannot arise
 * and reproducing it would be carrying dead complexity across.
 */

export interface Slot {
  /** availability.id — absent for a slot the user has just added. */
  dbId?: string
  startTime: string      // HH:MM
  endTime: string        // HH:MM
  treatmentIds: string[]
  /**
   * What the stylist asks for this slot, in pence. null is "not set", 0 is
   * free, and they are different answers — see lib/price.ts. 0050.
   */
  pricePence?: number | null
  /**
   * CLIENT ONLY, never written: what the stylist has typed into the price box,
   * so "12." survives on its way to "12.50". It lives on the slot rather than
   * in state keyed by row number, because removing a slot shifts every index
   * below it and a price sliding onto the wrong slot is worse than none.
   */
  priceInput?: string
  /**
   * CLIENT ONLY, never written, same rule as `priceInput`: which of the two
   * answers the stylist has picked for this slot.
   *
   * ⚠️ IT EXISTS BECAUSE "FREE" AND "NOT DECIDED YET" BOTH LOOK LIKE AN
   * EMPTY BOX. Since 23 Nov 2026 a price is REQUIRED, and the only way to
   * require one without forcing a stylist to charge is to make £0 a thing she
   * SELECTS rather than types. `'paid'` with no number yet is a real, saveable-
   * blocking state and cannot be represented by `pricePence` alone, which is
   * null for both "chose a price, hasn't typed it" and "chose nothing".
   *
   * Undefined means she has not chosen, which is only possible on one of the
   * 67 rows written before the requirement. Those stay as they are until the
   * day they are edited; nobody decides on their behalf what they cost.
   */
  priceMode?: 'free' | 'paid'
  /**
   * What this particular slot is for, in the stylist's own words. 280
   * characters, enforced by `availability_note_len` (0103) and not only by the
   * textarea.
   *
   * null and '' both mean "nothing said" and are not distinguished anywhere —
   * unlike pricePence, where null and 0 are different answers. A stylist who
   * clears the box has not said "this slot is for nothing"; she has unsaid it.
   */
  note?: string | null
  /** True when a session references this slot. Not editable, not deletable. */
  isBooked?: boolean
}

const hhmm = (t: string) => t.substring(0, 5)
const toHHMMSS = (t: string) => (t.length === 5 ? `${t}:00` : t)

export async function loadDay(
  supabase: SupabaseClient,
  providerId: string,
  date: string,
): Promise<Slot[]> {
  const { data, error } = await supabase
    .from('availability')
    .select('id, start_time, end_time, active_treatments, is_taken, price_pence, note')
    .eq('provider_id', providerId)
    .eq('date', date)
    .order('start_time')
  if (error) throw error

  const rows = (data ?? []) as {
    id: string; start_time: string; end_time: string
    active_treatments: string[] | null; is_taken: boolean | null
    price_pence: number | null; note: string | null
  }[]
  const booked = await bookedAmong(supabase, rows.map(r => r.id))

  return rows.map(r => ({
    dbId: r.id,
    startTime: hhmm(r.start_time),
    endTime: hhmm(r.end_time),
    treatmentIds: r.active_treatments ?? [],
    pricePence: r.price_pence,
    // ⚠️ LOADED, NOT JUST SAVED. Without this the editor opens with an empty
    // box over a note that exists, and the next save writes that emptiness
    // back — a stylist would lose a note by opening the day and pressing save.
    note: r.note,
    isBooked: booked.has(r.id) || !!r.is_taken,
  }))
}

/**
 * The (start|end) keys of this date's slots that someone has already booked.
 *
 * ⚠️ FOR THE SERVER TO VALIDATE AGAINST, INSTEAD OF TRUSTING `isBooked`.
 * The editor hides the price control on a booked slot, so a booked row
 * legitimately arrives carrying the null price it has had since before 0050 —
 * validating it would lock a stylist out of editing the REST of that day. But
 * reading `isBooked` off the submitted payload to decide what to skip would
 * make the requirement a suggestion, since the payload is the thing being
 * checked. So the answer is read from the database.
 */
export async function bookedSlotKeys(
  supabase: SupabaseClient,
  providerId: string,
  date: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('availability')
    .select('id, start_time, end_time, is_taken')
    .eq('provider_id', providerId)
    .eq('date', date)
  if (error) throw error
  const rows = (data ?? []) as {
    id: string; start_time: string; end_time: string; is_taken: boolean | null
  }[]
  const booked = await bookedAmong(supabase, rows.map(r => r.id))
  return new Set(
    rows
      .filter(r => booked.has(r.id) || !!r.is_taken)
      .map(r => `${hhmm(r.start_time)}|${hhmm(r.end_time)}`),
  )
}

/** Which of these availability rows a session points at. */
async function bookedAmong(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const { data, error } = await supabase
    .from('sessions')
    .select('availability_id')
    .in('availability_id', ids)
  if (error) throw error
  return new Set(
    ((data ?? []) as { availability_id: string | null }[])
      .map(r => r.availability_id)
      .filter(Boolean) as string[],
  )
}

/**
 * Save one date. Returns how many booked slots were kept back, so the caller
 * can tell the user rather than letting them think a deletion happened.
 *
 * ⚠️ AND THE IDS IT WROTE, which `notifyModelsOfAvailability` needs. The notice
 * lists the actual slots — treatment, day and time, price — so it has to be
 * told which rows this save was about. Without them it would describe every
 * open slot the stylist has, which is a different and larger claim.
 *
 * ⚠️ THEY ARE NOT A PERMISSION. The RPC filters on `provider_id = <the
 * caller's>` before it looks at this list, so an id belonging to somebody else
 * narrows the set to nothing rather than reaching into their diary.
 */
export async function saveDay(
  supabase: SupabaseClient,
  providerId: string,
  date: string,
  slots: Slot[],
): Promise<{ skippedBooked: number; savedIds: string[] }> {
  const savedIds: string[] = []
  // 1. Upsert first — a failure here leaves the existing day untouched.
  if (slots.length > 0) {
    const rows = slots.map(s => ({
      provider_id: providerId,
      date,
      start_time: toHHMMSS(s.startTime),
      end_time: toHHMMSS(s.endTime),
      active_treatments: s.treatmentIds,
      // ⚠️ Present in EVERY payload, including when it is null. A PostgREST
      // upsert only updates the columns it is given, so omitting this on a
      // "no price" slot would silently keep whatever was there before and
      // make clearing a price impossible.
      price_pence: s.pricePence ?? null,
      // ⚠️ THE SAME RULE, FOR THE SAME REASON. Present in EVERY payload,
      // including when it is null: a PostgREST upsert updates only the columns
      // it is given, so omitting this on a slot with no note would keep
      // whatever was there and make clearing one impossible.
      //
      // ⚠️ AND '' IS NORMALISED TO null ON THE WAY IN, so a box the stylist
      // emptied does not become an empty string the model-facing code then has
      // to decide whether to render. One representation of "nothing said".
      note: s.note?.trim() ? s.note.trim() : null,
    }))
    const { data: saved, error } = await supabase
      .from('availability')
      // FOUR columns. The unique index on availability is
      // (provider_id, date, start_time, end_time) -- see booking-guard.sql:30 and
      // ON_CONFLICT in mobile/src/lib/availability.ts:237. Naming three of them
      // fails every save with 42P10, "no unique or exclusion constraint matching
      // the ON CONFLICT specification".
      .upsert(rows, { onConflict: 'provider_id,date,start_time,end_time', ignoreDuplicates: false })
      // ⚠️ `.select()` TURNS THE UPSERT INTO A RETURNING, which is the only way
      // to learn the ids of rows PostgREST may have either inserted or updated.
      // It covers both, deliberately: a slot whose price or treatment changed is
      // as worth announcing as a brand-new one, and distinguishing them would
      // mean trusting `dbId`'s absence in a payload the client controls.
      .select('id')
    if (error) throw error
    for (const r of (saved ?? []) as { id: string }[]) savedIds.push(r.id)
  }

  // 2. Then remove only what is genuinely gone, compared against the DATABASE
  //    rather than against what the client thinks was there.
  const { data: existing, error: fetchErr } = await supabase
    .from('availability')
    .select('id, start_time, end_time')
    .eq('provider_id', providerId)
    .eq('date', date)
  if (fetchErr) throw fetchErr

  const desired = new Set(slots.map(s => `${hhmm(s.startTime)}|${hhmm(s.endTime)}`))
  const toRemove = ((existing ?? []) as { id: string; start_time: string; end_time: string }[])
    .filter(r => !desired.has(`${hhmm(r.start_time)}|${hhmm(r.end_time)}`))
    .map(r => r.id)

  const { skippedBooked } = await deleteSlots(supabase, toRemove)
  return { skippedBooked, savedIds }
}

/** Delete slots, skipping any a session references. */
export async function deleteSlots(
  supabase: SupabaseClient,
  ids: string[],
): Promise<{ skippedBooked: number }> {
  if (ids.length === 0) return { skippedBooked: 0 }
  const booked = await bookedAmong(supabase, ids)
  const deletable = ids.filter(id => !booked.has(id))
  if (deletable.length > 0) {
    const { error } = await supabase.from('availability').delete().in('id', deletable)
    if (error) throw error
  }
  return { skippedBooked: ids.length - deletable.length }
}

/**
 * Tell models that new slots are up: the ones who favourited this stylist, and
 * every model within ten miles of a published shop. 0116.
 *
 * ⚠️ ONE LINE, BECAUSE THE RULE LIVES IN THE DATABASE (0075, 0116). The payload
 * — type, title, body and `data.provider_id` — was written twice, once per
 * client, and the web copy omitted provider_id for 54 days while its own body
 * said "tap to view their shop" (item 143). Mobile's copy carried the field
 * under a comment reading "don't drop it". A comment is the weakest mechanism
 * available; a single call site is the one that has worked every time here.
 *
 * The RPC STILL TAKES NO PROVIDER: it derives the stylist from auth.uid(), so
 * it cannot be aimed at anyone else's audience. The only argument is the list
 * of slots this save wrote, and that can only NARROW a set already filtered to
 * the caller's own rows.
 *
 * ⚠️ THE ONCE-A-DAY RULE IS NOT HERE AND MUST NOT COME HERE. It is a UNIQUE
 * constraint on `availability_notices` claimed by an ON CONFLICT inside the
 * function, so three edits to one day produce one notice whoever is calling and
 * however fast. A count in this file would be a rule only this file obeys.
 *
 * Still best-effort, and still called once per save action rather than per
 * statement — a trigger would have sent several notices where one was sent,
 * because applySlotsToDates saves a date at a time.
 *
 * ⚠️ `notify_favourites_of_availability` still exists as a delegate, for the
 * dormant mobile caller only. Nothing live should call it: the name says
 * favourites and the behaviour no longer stops there.
 */
export async function notifyModelsOfAvailability(
  supabase: SupabaseClient,
  slotIds: string[],
): Promise<void> {
  // Nothing written means nothing to describe. The RPC would return 0 anyway;
  // not making the call is one fewer round trip on a save that changed nothing.
  if (slotIds.length === 0) return
  try {
    const { error } = await supabase.rpc('notify_models_of_availability', { p_slot_ids: slotIds })
    if (error) console.warn('[availability] new-times notify failed', error.message)
  } catch (e) {
    console.warn('[availability] notifying models failed', e)
  }
}
