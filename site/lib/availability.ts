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
    .select('id, start_time, end_time, active_treatments, is_taken, price_pence')
    .eq('provider_id', providerId)
    .eq('date', date)
    .order('start_time')
  if (error) throw error

  const rows = (data ?? []) as {
    id: string; start_time: string; end_time: string
    active_treatments: string[] | null; is_taken: boolean | null
    price_pence: number | null
  }[]
  const booked = await bookedAmong(supabase, rows.map(r => r.id))

  return rows.map(r => ({
    dbId: r.id,
    startTime: hhmm(r.start_time),
    endTime: hhmm(r.end_time),
    treatmentIds: r.active_treatments ?? [],
    pricePence: r.price_pence,
    isBooked: booked.has(r.id) || !!r.is_taken,
  }))
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
 */
export async function saveDay(
  supabase: SupabaseClient,
  providerId: string,
  date: string,
  slots: Slot[],
): Promise<{ skippedBooked: number }> {
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
    }))
    const { error } = await supabase
      .from('availability')
      // FOUR columns. The unique index on availability is
      // (provider_id, date, start_time, end_time) -- see booking-guard.sql:30 and
      // ON_CONFLICT in mobile/src/lib/availability.ts:237. Naming three of them
      // fails every save with 42P10, "no unique or exclusion constraint matching
      // the ON CONFLICT specification".
      .upsert(rows, { onConflict: 'provider_id,date,start_time,end_time', ignoreDuplicates: false })
    if (error) throw error
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

  return deleteSlots(supabase, toRemove)
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
 * Tell models who favourited this stylist that new slots are up.
 *
 * Best-effort by design: a notification failure must never affect whether the
 * availability itself saved.
 */
export async function notifyFavourites(
  supabase: SupabaseClient,
  providerId: string,
  stylistName: string,
): Promise<void> {
  try {
    const { data } = await supabase.from('favourites').select('user_id').eq('provider_id', providerId)
    // ⚠️ DE-DUPLICATED, BECAUSE NOTHING GUARANTEES THE ROWS ARE UNIQUE.
    //
    // No file in this repo creates a unique index on (user_id, provider_id) —
    // the table predates the migration ledger. mobile's verify-payment.tsx
    // handles 23505 as though one exists; mobile's provider/[id].tsx inserts
    // with no check at all, which only works if one does. One of those two is
    // wrong and the database has not been asked which.
    //
    // The consequence lands here and only here: two rows for the same model
    // mean she is notified twice, every time this stylist posts times. A Set
    // costs nothing and holds whichever way that question is answered — and
    // it also cleans up after any duplicates already sitting in the table.
    const users = [...new Set(((data ?? []) as { user_id: string }[]).map(f => f.user_id))]
    if (users.length === 0) return
    await supabase.from('notifications').insert(users.map(uid => ({
      user_id: uid,
      type: 'new_availability',
      title: 'New availability posted',
      body: `${stylistName} has new slots available — tap to view their shop`,
    })))
  } catch (e) {
    console.warn('[availability] notifying favourites failed', e)
  }
}
