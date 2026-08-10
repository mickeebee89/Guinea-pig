'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'

/**
 * Writes for the stylist's own shop.
 *
 * The provider id is resolved from the SESSION in every action here, never
 * taken from the client. RLS would refuse a forged one, but the server should
 * not be asking the question in the first place — see availability/actions.ts.
 */

const LIMITS = { name: 80, bio: 500, location: 120 } as const

type Result = { ok: true } | { ok: false; error: string }

async function ownProviderId(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, userId: string) {
  const { data } = await supabase
    .from('providers').select('id').eq('user_id', userId).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

/* ── shop details ──────────────────────────────────────────────────────── */

export async function saveShopDetails(input: {
  name: string; bio: string; locationText: string
}): Promise<Result> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const providerId = await ownProviderId(supabase, user.id)
  if (!providerId) return { ok: false, error: 'Only a stylist account has a shop to edit.' }

  const name = input.name.trim()
  const bio = input.bio.trim()
  const locationText = input.locationText.trim()

  if (!name) return { ok: false, error: 'Models need a name to find you by.' }
  if (!locationText) return { ok: false, error: 'Add the area you work in — it’s how models find you.' }
  if (name.length > LIMITS.name) return { ok: false, error: `Your name is too long (max ${LIMITS.name} characters).` }
  if (locationText.length > LIMITS.location) return { ok: false, error: `That area is too long (max ${LIMITS.location} characters).` }
  if (bio.length > LIMITS.bio) return { ok: false, error: `Your bio is too long (max ${LIMITS.bio} characters).` }

  // location_text only. `location` is the dead legacy column — browse still
  // READS it so nobody who filled it in years ago becomes unfindable, but
  // writing both would keep it alive forever and guarantee they disagree.
  const { error } = await supabase
    .from('providers')
    .update({ name, bio, location_text: locationText })
    .eq('id', providerId)

  if (error) {
    console.error('[shop] details save failed', error)
    return { ok: false, error: 'That didn’t save. Your shop is unchanged.' }
  }

  revalidatePath('/shop')
  revalidatePath('/dashboard')
  return { ok: true }
}

/* ── treatments ────────────────────────────────────────────────────────── */

export type TreatmentsResult =
  | { ok: true; added: number; removed: number; blocked: string[] }
  | { ok: false; error: string }

/**
 * Set which treatments this shop offers.
 *
 * ── A DIFF, NOT A REPLACE. THIS IS THE WHOLE POINT. ───────────────────────
 * mobile/src/app/(app)/edit-shop.tsx:115 deletes every provider_treatments row
 * and re-inserts the selection, which mints new uuids each save. Those uuids
 * are not private to this table: `availability.active_treatments` is a uuid[]
 * of them and `sessions.treatment_id` points at one. So on mobile, re-saving
 * Edit Shop silently detaches every slot's treatment list and leaves existing
 * bookings pointing at rows that no longer exist — the stylist changed nothing
 * and their week emptied out.
 *
 * Here, a category that is still selected keeps its row and therefore its id.
 * Only genuine additions are inserted and only genuine removals are deleted.
 *
 * Removals go one at a time so a refusal can name the treatment. A row that a
 * booking still references may be undeletable, and "couldn't save" would leave
 * the stylist retrying forever without knowing which chip is the problem.
 *
 * A genuine removal still leaves that id sitting in any slot that referenced
 * it. Stripping it is NOT done here on purpose — three writers can delete these
 * rows (this action, mobile Edit Shop, an admin) and a rule copied into three
 * clients is one client away from being wrong again. It belongs to the data:
 * supabase/migrations/0012 does it in an `after delete` trigger. Until that is
 * applied, removals here leave dangling ids the same way mobile does — just far
 * fewer of them. `node scripts/migration-status.mjs` reports it PENDING.
 */
export async function saveTreatments(categories: string[]): Promise<TreatmentsResult> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const providerId = await ownProviderId(supabase, user.id)
  if (!providerId) return { ok: false, error: 'Only a stylist account has a shop to edit.' }

  const wanted = [...new Set(categories.map(c => c.trim()).filter(Boolean))]
  if (wanted.length === 0) {
    return { ok: false, error: 'Pick at least one treatment. Models need to know what you offer.' }
  }

  // Validate against the real category list rather than trusting the form. A
  // free-typed category would end up in browse's filter list and in the public
  // views, where nothing else would ever produce it.
  const { data: catRows, error: catErr } = await supabase
    .from('treatment_categories').select('name').eq('is_active', true)
  if (catErr) {
    console.error('[shop] category list failed', catErr)
    return { ok: false, error: 'We couldn’t check the treatment list just now. Nothing has changed.' }
  }
  const valid = new Set(((catRows ?? []) as { name: string }[]).map(c => c.name))
  const unknown = wanted.filter(c => !valid.has(c))
  if (unknown.length > 0) {
    return { ok: false, error: `We don’t offer ${unknown[0]} as a category. Reload the page and try again.` }
  }

  const { data: existingRows, error: readErr } = await supabase
    .from('provider_treatments').select('id, category').eq('provider_id', providerId)
  if (readErr) {
    console.error('[shop] treatments read failed', readErr)
    return { ok: false, error: 'We couldn’t read your current treatments. Nothing has changed.' }
  }
  const existing = (existingRows ?? []) as { id: string; category: string | null }[]

  const have = new Set(existing.map(r => r.category).filter((c): c is string => !!c))
  const toAdd = wanted.filter(c => !have.has(c))
  const toRemove = existing.filter(r => !r.category || !wanted.includes(r.category))

  if (toAdd.length > 0) {
    // name and category both carry the label, matching what mobile writes and
    // what browse/dashboard read back (`name ?? category`).
    const { error } = await supabase.from('provider_treatments').insert(
      toAdd.map(cat => ({ provider_id: providerId, name: cat, category: cat })),
    )
    if (error) {
      console.error('[shop] treatments insert failed', error)
      return { ok: false, error: 'We couldn’t add those treatments. Nothing has changed.' }
    }
  }

  const blocked: string[] = []
  let removed = 0
  for (const row of toRemove) {
    const { error } = await supabase
      .from('provider_treatments').delete().eq('id', row.id).eq('provider_id', providerId)
    if (error) {
      console.error('[shop] treatment delete failed', row.id, error)
      blocked.push(row.category ?? 'a treatment')
    } else {
      removed++
    }
  }

  revalidatePath('/shop')
  revalidatePath('/dashboard')
  revalidatePath('/availability')
  return { ok: true, added: toAdd.length, removed, blocked }
}
