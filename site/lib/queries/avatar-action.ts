'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'

/**
 * Set your profile picture. Both roles. Audit item 101.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THE FIRST THING site/ EVER WROTE TO profile_pic_url — AND THE FIRST
 *  VERSION OF IT, SHIPPED AN HOUR EARLIER, WAS WRONG IN TWO WAYS
 * ══════════════════════════════════════════════════════════════════════════
 * Item 99 put this in the model's profile page and wrote `users` only, with a
 * random filename per upload. Reading mobile's own version (settings.tsx:346)
 * afterwards showed both halves of that to be mistakes it had already made and
 * fixed:
 *
 *   1. ⚠️ **IT MUST WRITE BOTH ROWS.** `users.profile_pic_url` is what the
 *      admin verification queue compares a selfie against (item 98) and what
 *      `public_profiles` shows. **`providers.profile_pic_url` is a SEPARATE
 *      column**, and it is the one every stylist-facing surface reads —
 *      `/stylist/[id]`, browse, and `public_stylists` on the open web. Writing
 *      one leaves the other showing an old picture for ever. Mobile's comment
 *      says exactly this and it was not read before writing item 99's version.
 *
 *   2. ⚠️ **FIXED FILENAME, upsert, AND A CACHE-BUSTER.** Mobile uploads to
 *      `<user id>/profile.jpg` with `upsert: true`, so a new picture REPLACES
 *      the old object. Item 99 used a random name each time, which leaves
 *      every previous avatar sitting in a public bucket for ever — nothing
 *      references them, nothing sweeps them until the account is deleted, and
 *      they stay publicly readable by URL. That is the selfie-orphan shape
 *      again, in a bucket that is public.
 *
 *      A fixed filename means an identical public URL every time, so caches
 *      would serve the OLD picture. The `?t=` stamp is applied ONCE here, to
 *      the stored value, and every reader renders the string as-is.
 *
 * ── HOW IT IS MODERATED: IT IS NOT, AND THAT IS ITEM 100 ──────────────────
 * Portfolio photos are gated on `moderation_status`; a profile picture is not,
 * on either client. Gating it would leave a stylist with no avatar while her
 * ID check compares a selfie AGAINST it. What stands between it and a misuse:
 * audience (a model's reaches signed-in members only; a stylist's is published
 * to the open web by `public_stylists`), report and block, the ID-check
 * comparison itself, and suspension. None of those is prevention.
 *
 * ── AND THE EXIF ──────────────────────────────────────────────────────────
 * The browser re-encodes through a canvas before sending, which strips EXIF
 * including the GPS a phone writes in. A photo of your own face is usually
 * taken at home. See components/AvatarUpload.
 */

/** Supabase's default object cap. Above this the upload fails with a 413. */
const MAX_BYTES = 8 * 1024 * 1024

export type AvatarResult = { ok: true; url: string } | { ok: false; error: string }

export async function uploadAvatar(form: FormData): Promise<AvatarResult> {
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

  // The user-id prefix is what the bucket policy requires and what lets
  // account deletion sweep the folder. It comes from requireUser(), never the
  // client. The filename is fixed so a new picture replaces the old object.
  const { data: up, error: upErr } = await supabase.storage
    .from('profile-pics')
    .upload(`${user.id}/profile.jpg`, file, { contentType: 'image/jpeg', upsert: true })
  if (upErr || !up) {
    console.error('[avatar] upload failed', upErr)
    return { ok: false, error: 'That didn’t upload. Check your connection and try again.' }
  }

  const { data: pub } = supabase.storage.from('profile-pics').getPublicUrl(up.path)
  if (!pub?.publicUrl) {
    console.error('[avatar] getPublicUrl returned nothing', { path: up.path })
    return { ok: false, error: 'That uploaded but we couldn’t save it. Try again.' }
  }
  const url = `${pub.publicUrl}?t=${Date.now()}`

  // ⚠️ BOTH ROWS, IN PARALLEL, AND BOTH ERRORS CHECKED. A model matches zero
  // provider rows, which is not an error — `.update()` with no match succeeds.
  //
  // profile_pic_url is not on 0040's denylist, so a member may write her own:
  // the same permission mobile has always used. It is already named in the
  // column-level GRANT that guard's comment proposes replacing itself with.
  const [usersRes, provRes] = await Promise.all([
    supabase.from('users').update({ profile_pic_url: url }).eq('id', user.id),
    supabase.from('providers').update({ profile_pic_url: url }).eq('user_id', user.id),
  ])

  if (usersRes.error || provRes.error) {
    console.error('[avatar] row update failed', {
      users: usersRes.error?.message, providers: provRes.error?.message,
    })
    // The file is up and at least one row may have moved. Saying "it didn't
    // save" would be wrong half the time; saying what to do is not.
    return {
      ok: false,
      error: 'That uploaded but we couldn’t finish saving it. Reload and check your photo before trying again.',
    }
  }

  revalidatePath('/profile')
  revalidatePath('/shop')
  revalidatePath('/settings')
  revalidatePath('/verify')
  revalidatePath('/dashboard')
  revalidatePath(`/model/${user.id}`)
  return { ok: true, url }
}
