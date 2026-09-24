'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { ATTRIBUTE_DEFS, BIO_MAX, type AttributeKey } from '@/lib/queries/my-profile'
import { parseInstagram } from '@/lib/instagram'

/**
 * Everything a model can change about her own profile. Audit item 99.
 *
 * ── ONE RULE RUNS THROUGH ALL OF IT ───────────────────────────────────────
 * `model_attributes` has one row per member and mobile creates it lazily, so
 * every write here is "update if the row exists, insert if it does not" —
 * mirroring mobile's own check-then-write (model-profile.tsx:592). An upsert
 * would be tidier and would depend on a unique constraint on `user_id` that
 * no file in this repo creates, so it is not used.
 *
 * RLS is what confines every one of these to her own rows. Nothing here takes
 * a user id from the caller.
 */

export type Result = { ok: true } | { ok: false; error: string }

const ALLOWED = new Map<AttributeKey, Set<string>>(
  ATTRIBUTE_DEFS.map(d => [d.key, new Set(d.options)]),
)

/** Narrows an arbitrary string from the form to one of the nine real columns. */
function isAttributeKey(k: string): k is AttributeKey {
  return ALLOWED.has(k as AttributeKey)
}

/** Only the nine, only ever null or one of their listed options. */
type AttributePatch = Partial<Record<AttributeKey, string | null>>

/** Does this row exist yet? Mobile asks the same question the same way. */
async function attributesRowExists(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('model_attributes').select('user_id').eq('user_id', userId).maybeSingle()
  return !!data
}

/**
 * Set or clear one attribute.
 *
 * ⚠️ THE VALUE IS CHECKED AGAINST THE OPTION LIST, not just trimmed. A server
 * action is callable directly, and these strings are what stylists filter and
 * search on — an unlisted value would be a row that no filter can ever match
 * and that no client knows how to show. Empty clears it.
 */
export async function saveAttribute(key: string, value: string): Promise<Result> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  if (!isAttributeKey(key)) return { ok: false, error: 'That isn’t something you can set here.' }
  const options = ALLOWED.get(key)!

  const next = value.trim()
  if (next !== '' && !options.has(next)) {
    return { ok: false, error: 'Pick one of the options in the list.' }
  }

  const patch: AttributePatch = { [key]: next === '' ? null : next }
  const exists = await attributesRowExists(supabase, user.id)
  const { error } = exists
    ? await supabase.from('model_attributes')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
    : await supabase.from('model_attributes').insert({ user_id: user.id, ...patch })

  if (error) {
    console.error('[profile] attribute save failed', { key, code: error.code, message: error.message })
    return { ok: false, error: 'That didn’t save. Nothing has changed.' }
  }
  revalidateBoth(user.id)
  return { ok: true }
}

export async function saveBio(bio: string): Promise<Result> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const text = bio.trim()
  if (text.length > BIO_MAX) {
    return { ok: false, error: `That’s too long — ${BIO_MAX} characters at most.` }
  }

  const exists = await attributesRowExists(supabase, user.id)
  const { error } = exists
    ? await supabase.from('model_attributes')
        .update({ bio: text || null, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
    : await supabase.from('model_attributes').insert({ user_id: user.id, bio: text || null })

  if (error) {
    console.error('[profile] bio save failed', { code: error.code, message: error.message })
    return { ok: false, error: 'That didn’t save. Your bio is unchanged.' }
  }
  revalidateBoth(user.id)
  return { ok: true }
}

/**
 * Her Instagram handle. Audit item 102.
 *
 * ⚠️ VALIDATED HERE, NOT ONLY ON THE INPUT. A server action is callable
 * directly, so an input-only check is a suggestion. This field had NO check
 * anywhere — not either client, not the database — and an email address was
 * found stored in it and rendered on a live profile.
 *
 * The rule and the parsing both live in lib/instagram.ts, because the RENDERER
 * uses the same rule: validating the write protects only values written after
 * today, and the column already holds whatever four months of unvalidated
 * writes put there.
 *
 * Clearing is first-class — an empty box removes it. That is the whole reason
 * this could not wait: a web-only model could neither add a handle nor get rid
 * of one, and the one that was there was her email address.
 */
export async function saveInstagram(input: string): Promise<Result> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const parsed = parseInstagram(input)
  if (!parsed.ok) return { ok: false, error: parsed.error }

  const { error } = await supabase
    .from('users').update({ instagram_handle: parsed.handle }).eq('id', user.id)

  if (error) {
    console.error('[profile] instagram save failed', { code: error.code, message: error.message })
    return { ok: false, error: 'That didn’t save. Nothing has changed.' }
  }
  revalidateBoth(user.id)
  return { ok: true }
}

/* ── photos ─ */

export async function savePhotoCaption(photoId: string, caption: string): Promise<Result> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const text = caption.trim().slice(0, 120)
  const { error } = await supabase
    .from('model_photos').update({ caption: text || null })
    .eq('id', photoId).eq('user_id', user.id)   // belt and braces over RLS

  if (error) {
    console.error('[profile] caption save failed', { code: error.code, message: error.message })
    return { ok: false, error: 'That didn’t save.' }
  }
  revalidateBoth(user.id)
  return { ok: true }
}

export async function setPhotoCategory(photoId: string, categoryId: string): Promise<Result> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('model_photos').update({ category_id: categoryId || null })
    .eq('id', photoId).eq('user_id', user.id)

  if (error) {
    console.error('[profile] category set failed', { code: error.code, message: error.message })
    return { ok: false, error: 'That didn’t save.' }
  }
  revalidateBoth(user.id)
  return { ok: true }
}

/**
 * Delete a photo.
 *
 * ⚠️ THE ROW GOES AND THE OBJECT STAYS, DELIBERATELY FOR NOW. Deleting the
 * storage object needs the stored path, and a failure between the two leaves
 * either an orphaned file or a row pointing at nothing — the second is what a
 * member would see as a broken gallery. The row is the thing she is asking to
 * remove, so the row goes first and alone.
 *
 * The object is still swept on account deletion: the delete-account function
 * clears the whole `model-photos/<user id>/` folder (index.ts:231), so nothing
 * survives her leaving. An orphan from a single delete is storage cost, not a
 * privacy hole — but it IS the same shape as the selfie-orphan problem, and
 * it is recorded rather than left to be discovered.
 */
export async function deletePhoto(photoId: string): Promise<Result> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('model_photos').delete().eq('id', photoId).eq('user_id', user.id)

  if (error) {
    console.error('[profile] photo delete failed', { code: error.code, message: error.message })
    return { ok: false, error: 'That didn’t delete. It’s still there.' }
  }
  revalidateBoth(user.id)
  return { ok: true }
}

export async function addPhotoCategory(name: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const text = name.trim().slice(0, 40)
  if (!text) return { ok: false, error: 'Give the group a name.' }

  const { data, error } = await supabase
    .from('model_photo_categories')
    .insert({ user_id: user.id, name: text })
    .select('id')
    .maybeSingle()

  if (error || !data) {
    console.error('[profile] category add failed', error)
    return { ok: false, error: 'That didn’t save.' }
  }
  revalidateBoth(user.id)
  return { ok: true, id: (data as { id: string }).id }
}

function revalidateBoth(userId: string) {
  revalidatePath('/profile')
  // What a stylist sees of her, which is the whole point of the page.
  revalidatePath(`/model/${userId}`)
  revalidatePath('/dashboard')
  revalidatePath('/settings')
}
