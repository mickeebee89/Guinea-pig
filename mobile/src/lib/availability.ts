import { supabase } from '@/lib/supabase'
import { CategoryColors, Colors } from '@/constants/Colors'

// Shared types, constants and DB operations for a provider's availability.
//
// The DB stores ONE ROW PER TIME SLOT in `availability`, and treatments are held
// PER SLOT in `active_treatments` (uuid[]). There is deliberately no day-level
// treatment concept — an earlier UI invented one and the two sources of truth
// drifted, so a day could display one treatment while saving another.
// A "day" is simply the set of slots sharing a date.

// ── Types ─────────────────────────────────────────────────────────────────────

export type Treatment = { id: string; name: string; category: string }

// `dbId` is the availability row's primary key (null for a slot not yet saved),
// so deletes target the PK instead of matching on date+start+end tuples.
export type TimeSlot = {
  id: string
  dbId: string | null
  startTime: string
  endTime: string
  treatmentIds: string[]
}

export type DaySlots = Record<string, TimeSlot[]>

// ── Constants ─────────────────────────────────────────────────────────────────

export const CATEGORY_COLOR: Record<string, string> = {
  Nails:       CategoryColors.nails,
  Lashes:      CategoryColors.lashes,
  Brows:       CategoryColors.brows,
  Hair:        CategoryColors.hair,
  Makeup:      CategoryColors.makeup,
  'Spray Tan': CategoryColors.sprayTan,
}

export const treatmentColour = (category: string) => CATEGORY_COLOR[category] ?? Colors.muted

export const DAYS_SHORT  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

// Half-hour slots 07:00 → 22:00
export const TIMES: string[] = []
for (let h = 7; h <= 22; h++) {
  TIMES.push(`${String(h).padStart(2, '0')}:00`)
  if (h < 22) TIMES.push(`${String(h).padStart(2, '0')}:30`)
}

// Fallback list when a provider hasn't defined their own treatments yet. These ids
// are SLUGS, not uuids, so they're resolved against treatment_categories on save.
export const DEFAULT_TREATMENTS: Treatment[] = [
  { id: 'nails',     name: 'Nails',     category: 'Nails' },
  { id: 'lashes',    name: 'Lashes',    category: 'Lashes' },
  { id: 'brows',     name: 'Brows',     category: 'Brows' },
  { id: 'hair',      name: 'Hair',      category: 'Hair' },
  { id: 'makeup',    name: 'Makeup',    category: 'Makeup' },
  { id: 'spray_tan', name: 'Spray Tan', category: 'Spray Tan' },
]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Date helpers ──────────────────────────────────────────────────────────────

// Local date parts — NEVER toISOString(), which shifts the day across UTC.
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function calendarRows(year: number, month: number): (Date | null)[][] {
  const startDow  = (new Date(year, month, 1).getDay() + 6) % 7  // Mon = 0
  const totalDays = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = [
    ...Array<null>(startDow).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => new Date(year, month, i + 1)),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7))
}

// "Wednesday 6 August"
export function formatDayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

// "Wed 6 Aug"
export function formatDayShort(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

let _slotCounter = 0
export const newSlotId = () => `slot-${++_slotCounter}`

export const hhmm     = (t: string) => t.substring(0, 5)
// Match the stored format so the unique index (provider_id,date,start_time,end_time)
// sees the conflict.
export const toHHMMSS = (t: string) => (t.length === 5 ? `${t}:00` : t)

// ── Loads ─────────────────────────────────────────────────────────────────────

export async function loadProviderId(userId: string): Promise<string | null> {
  const { data } = await supabase.from('providers').select('id').eq('user_id', userId).single()
  return (data as any)?.id ?? null
}

export async function loadTreatments(providerId: string): Promise<Treatment[]> {
  const { data } = await supabase
    .from('provider_treatments')
    .select('id, name, category')
    .eq('provider_id', providerId)
  return data && data.length > 0 ? (data as Treatment[]) : DEFAULT_TREATMENTS
}

// All upcoming slots, grouped by date. Past dates are intentionally excluded —
// they can't be edited and would clutter the list.
export async function loadUpcomingDays(providerId: string): Promise<DaySlots> {
  const today = dateKey(new Date())
  const { data, error } = await supabase
    .from('availability')
    .select('id, date, start_time, end_time, active_treatments')
    .eq('provider_id', providerId)
    .gte('date', today)
    .order('date')
    .order('start_time')
  if (error) throw error

  const out: DaySlots = {}
  for (const row of (data ?? []) as any[]) {
    const d = (row.date as string).substring(0, 10)
    if (!out[d]) out[d] = []
    out[d].push({
      id:           newSlotId(),
      dbId:         row.id as string,
      startTime:    hhmm(row.start_time as string),
      endTime:      hhmm(row.end_time as string),
      treatmentIds: (row.active_treatments as string[]) ?? [],
    })
  }
  return out
}

export async function loadDay(providerId: string, date: string): Promise<TimeSlot[]> {
  const { data, error } = await supabase
    .from('availability')
    .select('id, date, start_time, end_time, active_treatments')
    .eq('provider_id', providerId)
    .eq('date', date)
    .order('start_time')
  if (error) throw error
  return ((data ?? []) as any[]).map(row => ({
    id:           newSlotId(),
    dbId:         row.id as string,
    startTime:    hhmm(row.start_time as string),
    endTime:      hhmm(row.end_time as string),
    treatmentIds: (row.active_treatments as string[]) ?? [],
  }))
}

// ── Treatment id resolution ───────────────────────────────────────────────────

// Slot treatment ids are usually provider_treatments uuids, but can be slugs when
// the provider is still on DEFAULT_TREATMENTS. Resolve slugs against
// treatment_categories; anything unresolvable is dropped (and reported) rather
// than silently written as an empty list.
async function resolveTreatmentIds(slots: TimeSlot[]): Promise<{
  resolve: (id: string) => string | null
  unresolved: string[]
}> {
  const all = new Set<string>()
  for (const s of slots) for (const id of s.treatmentIds) all.add(id)

  const slugs = [...all].filter(id => !UUID_RE.test(id))
  const slugToUuid: Record<string, string> = {}
  if (slugs.length > 0) {
    const { data } = await supabase
      .from('treatment_categories')
      .select('id, slug')
      .in('slug', slugs)
    for (const cat of (data ?? []) as any[]) slugToUuid[cat.slug as string] = cat.id as string
  }

  const unresolved: string[] = []
  const resolve = (id: string): string | null => {
    if (UUID_RE.test(id)) return id
    const uuid = slugToUuid[id]
    if (!uuid) { unresolved.push(id); return null }
    return uuid
  }
  return { resolve, unresolved }
}

// `is_taken` is deliberately omitted from every payload: it defaults to false on
// insert and stays out of the ON CONFLICT update, so re-saving can never flip a
// BOOKED slot back to available.
function slotRow(providerId: string, date: string, s: TimeSlot, resolve: (id: string) => string | null) {
  return {
    provider_id:       providerId,
    date,
    start_time:        toHHMMSS(s.startTime),
    end_time:          toHHMMSS(s.endTime),
    active_treatments: s.treatmentIds.map(resolve).filter(Boolean) as string[],
  }
}

const ON_CONFLICT = 'provider_id,date,start_time,end_time'

// ── Writes ────────────────────────────────────────────────────────────────────

// ADD flow. Applies the same set of slots to every given date. Purely ADDITIVE:
// it never deletes, so a date that already has slots keeps them. A slot at an
// identical (date,start,end) has its treatments updated (real upsert).
export async function applySlotsToDates(
  providerId: string,
  dates: string[],
  slots: TimeSlot[],
): Promise<void> {
  if (dates.length === 0 || slots.length === 0) return
  const { resolve, unresolved } = await resolveTreatmentIds(slots)
  const rows = dates.flatMap(d => slots.map(s => slotRow(providerId, d, s, resolve)))
  if (unresolved.length > 0) {
    console.warn('availability: unresolved treatment ids dropped:', unresolved)
  }
  const { error } = await supabase
    .from('availability')
    .upsert(rows, { onConflict: ON_CONFLICT, ignoreDuplicates: false })
  if (error) throw error
}

// Which of these availability rows are referenced by a session? sessions.availability_id
// is an FK with NO ACTION, so deleting a referenced row throws 23503 — regardless of
// the session's status, since the FK only cares that a reference exists.
async function bookedAmong(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const { data, error } = await supabase
    .from('sessions')
    .select('availability_id')
    .in('availability_id', ids)
  if (error) throw error
  return new Set((data ?? []).map((r: any) => r.availability_id as string))
}

// EDIT flow. Saves ONE date: upserts the desired slots, then removes only that
// date's rows the provider actually deleted. Scoped to a single date so it can
// never touch another day. Returns how many booked slots were kept back.
export async function saveDay(
  providerId: string,
  date: string,
  slots: TimeSlot[],
): Promise<{ skippedBooked: number }> {
  const { resolve, unresolved } = await resolveTreatmentIds(slots)
  if (unresolved.length > 0) {
    console.warn('availability: unresolved treatment ids dropped:', unresolved)
  }

  // Upsert FIRST so a failure can never leave the day emptied.
  if (slots.length > 0) {
    const rows = slots.map(s => slotRow(providerId, date, s, resolve))
    const { error } = await supabase
      .from('availability')
      .upsert(rows, { onConflict: ON_CONFLICT, ignoreDuplicates: false })
    if (error) throw error
  }

  // Then delete only what's gone, comparing against what's actually in the DB.
  const { data: existing, error: fetchErr } = await supabase
    .from('availability')
    .select('id, start_time, end_time')
    .eq('provider_id', providerId)
    .eq('date', date)
  if (fetchErr) throw fetchErr

  const desired = new Set(slots.map(s => `${hhmm(s.startTime)}|${hhmm(s.endTime)}`))
  const toRemove = ((existing ?? []) as any[])
    .filter(r => !desired.has(`${hhmm(r.start_time)}|${hhmm(r.end_time)}`))
    .map(r => r.id as string)

  return await deleteSlots(toRemove)
}

// Deletes the given availability rows, skipping any that a session references.
export async function deleteSlots(ids: string[]): Promise<{ skippedBooked: number }> {
  if (ids.length === 0) return { skippedBooked: 0 }
  const booked    = await bookedAmong(ids)
  const deletable = ids.filter(id => !booked.has(id))
  if (deletable.length > 0) {
    const { error } = await supabase.from('availability').delete().in('id', deletable)
    if (error) throw error
  }
  return { skippedBooked: ids.length - deletable.length }
}

// Removes a whole day. Booked slots are kept (they can't be deleted while a
// session references them), so this is a partial delete when bookings exist.
export async function deleteDay(
  providerId: string,
  date: string,
): Promise<{ skippedBooked: number }> {
  const { data, error } = await supabase
    .from('availability')
    .select('id')
    .eq('provider_id', providerId)
    .eq('date', date)
  if (error) throw error
  return await deleteSlots(((data ?? []) as any[]).map(r => r.id as string))
}

// Tell models who favourited this stylist that new availability is up. Best-effort:
// never let a notification failure affect the save result.
export async function notifyFavourites(providerId: string): Promise<void> {
  try {
    const [{ data: prov }, { data: favs }] = await Promise.all([
      supabase.from('providers').select('name').eq('id', providerId).single(),
      supabase.from('favourites').select('user_id').eq('provider_id', providerId),
    ])
    if (!favs || (favs as any[]).length === 0) return
    const providerName = (prov as any)?.name ?? 'A stylist'
    // session_id is omitted (not tied to a session) so it can't violate
    // notifications_session_id_fkey. `data.provider_id` is what notificationRouting
    // uses to deep-link new_availability to the stylist's shop — don't drop it.
    // TODO(notifications): this best-effort insert can 23503 on some rows —
    // investigate when locking down the notifications table; must never affect save UX.
    const { error } = await supabase.from('notifications').insert(
      (favs as any[]).map(f => ({
        user_id: f.user_id,
        type:    'new_availability',
        title:   'New availability posted',
        body:    `${providerName} has new slots available — tap to view their shop`,
        data:    { provider_id: providerId },
      })),
    )
    if (error) console.warn('availability: favourite notify failed:', error.message)
  } catch (e) {
    console.warn('availability: favourite notify threw:', e)
  }
}
