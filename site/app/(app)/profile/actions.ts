'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { ATTRIBUTE_DEFS, BIO_MAX, type AttributeKey } from '@/lib/queries/my-profile'

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

/* ── photos ─────────────────────────────────────────────────────────────── */

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

/* ── the avatar ─────────────────────────────────────────────────────────── */

/** Supabase's default object cap. Above this the upload fails with a 413. */
const MAX_BYTES = 8 * 1024 * 1024

/**
 * Set her profile picture.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THE FIRST THING site/ HAS EVER WRITTEN TO profile_pic_url
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── WHERE IT GOES ─────────────────────────────────────────────────────────
 * The `profile-pics` bucket, under `<user id>/`, exactly as mobile does
 * (settings.tsx:346, onboarding/profile-pic.tsx:80). That bucket is PUBLIC
 * (storage-lockdown.sql:15), so the column holds a full public URL from
 * getPublicUrl rather than a path — which is why nothing has to sign it, and
 * why the admin queue can render it directly (item 98).
 *
 * The user-id prefix is what the bucket policy requires and what lets account
 * deletion sweep the folder. It comes from requireUser(), never the client.
 *
 * ── ⚠️ HOW IT IS MODERATED: IT IS NOT. SAID PLAINLY. ──────────────────────
 * Portfolio photos are moderation-gated — `portfolio_items.moderation_status`
 * must be 'approved' before anyone sees them. A profile picture is not, on
 * either client, and this does not change that: gating it would leave a
 * stylist with no avatar while her ID check compares a selfie against it, and
 * would put every new member behind a queue with one reviewer.
 *
 * What actually stands between a profile picture and a misuse of it, today:
 *
 *   1. **AUDIENCE.** A model's avatar reaches SIGNED-IN MEMBERS only —
 *      `public_profiles` lost its `anon` grant on 2026-08-07. A STYLIST's is
 *      different: `public_stylists` publishes it to the open web. The one
 *      added here is the model's.
 *   2. **REPORT AND BLOCK**, from her profile, reaching `moderation_actions`
 *      and the admin queue. That is after the fact, which is the honest
 *      description of it.
 *   3. **THE ID CHECK COMPARES A SELFIE AGAINST IT.** A photo that is not her
 *      fails verification — which is a real control, and since item 98 it is
 *      one a reviewer can actually apply.
 *   4. Admin suspension, via `admin_act_on_user`.
 *
 * **None of those is prevention.** A profile picture is live the moment it is
 * uploaded and a stranger may see it before anyone has looked at it. That is
 * true of mobile today and is not introduced here; it is written down here
 * because this is the second place it becomes true, and the first one never
 * said it.
 *
 * ── WHAT THE FILE ITSELF IS CHECKED FOR ───────────────────────────────────
 * Type, size, and that it decodes. The browser re-encodes it through a canvas
 * before it is sent, which also **strips EXIF — including GPS coordinates**,
 * since a phone photo of your own face routinely carries where it was taken.
 */
export async function uploadAvatar(form: FormData): Promise<
  { ok: true; url: string } | { ok: false; error: string }
> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const file = form.get('avatar')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'That photo didn’t come through. Try again.' }
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: 'That photo is too large. Try a smaller one.' }
  }
  if (!file.type.startsWith('image/')) {
    return { ok: false, error: 'That doesn’t look like a photo.' }
  }

  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const { data: up, error: upErr } = await supabase.storage
    .from('profile-pics')
    .upload(path, file, { contentType: file.type })
  if (upErr || !up) {
    console.error('[profile] avatar upload failed', upErr)
    return { ok: false, error: 'That didn’t upload. Check your connection and try again.' }
  }

  const { data: pub } = supabase.storage.from('profile-pics').getPublicUrl(up.path)
  const url = pub?.publicUrl
  if (!url) {
    console.error('[profile] getPublicUrl returned nothing', { path: up.path })
    return { ok: false, error: 'That uploaded but we couldn’t save it. Try again.' }
  }

  // ⚠️ profile_pic_url is NOT on 0040's denylist, so a member may write her
  // own — the same permission mobile has always used. If that guard is ever
  // replaced by a column-level GRANT, profile_pic_url is already named in the
  // set it grants back.
  const { error: rowErr } = await supabase
    .from('users').update({ profile_pic_url: url }).eq('id', user.id)
  if (rowErr) {
    console.error('[profile] avatar row update failed', { code: rowErr.code, message: rowErr.message })
    return { ok: false, error: 'That uploaded but we couldn’t save it to your profile.' }
  }

  revalidateBoth(user.id)
  return { ok: true, url }
}

function revalidateBoth(userId: string) {
  revalidatePath('/profile')
  // What a stylist sees of her, which is the whole point of the page.
  revalidatePath(`/model/${userId}`)
  revalidatePath('/dashboard')
  revalidatePath('/settings')
}
