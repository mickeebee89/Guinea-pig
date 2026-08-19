'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'

export type VerifyResult = { ok: true } | { ok: false; error: string }

/** Matches mobile: resized to 1080 wide, JPEG. A phone photo is 3–5MB raw. */
const MAX_BYTES = 3 * 1024 * 1024

/**
 * Submit an ID-check selfie.
 *
 * ── WHY THIS IS A SERVER ACTION AND NOT A BROWSER UPLOAD ──────────────────
 * ChatThread is the only place the browser client is used, and that claim is
 * checkable precisely because it has one exception rather than several. The
 * file arrives as FormData and is uploaded by the request-scoped server client,
 * which carries the user's own session — so storage sees the real auth.uid()
 * and migration 0019's owner-scoped policy applies exactly as it would to a
 * direct upload. Nothing is gained by going around it.
 *
 * ── THE PATH IS THE POINT ─────────────────────────────────────────────────
 * `${userId}/selfie-${Date.now()}.jpg`, the same shape mobile writes, because
 * 0019 requires (storage.foldername(name))[1] = auth.uid()::text. The userId
 * comes from requireUser(), never from the client — a caller-supplied path is
 * exactly what that migration exists to refuse.
 *
 * ── AND SO IS THE ORDER ───────────────────────────────────────────────────
 * Upload first, then write the row. A row pointing at an object that failed to
 * upload sends a reviewer to a broken image and looks like a rejected applicant.
 * An orphaned object with no row is invisible and gets swept by the purge cron.
 * Only one of those wastes a person's time.
 */
export async function submitSelfie(form: FormData): Promise<VerifyResult> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const file = form.get('selfie')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'No photo came through. Try taking it again.' }
  }
  if (file.size > MAX_BYTES) {
    // The client resizes before sending, so this only fires if that was
    // bypassed. Say the useful thing rather than naming a byte count.
    return { ok: false, error: 'That photo is too large. Try taking it again.' }
  }
  if (!file.type.startsWith('image/')) {
    return { ok: false, error: 'That doesn’t look like a photo. Try again.' }
  }

  // Only providers, and only once the fee is settled. Mirrors mobile — and
  // "settled" means paid OR Founding Provider OR waived, never just paid.
  // Getting that wrong is what had founding stylists staring at a £14.99 wall.
  const [{ data: provRow }, { data: userRow }, { data: payRow }] = await Promise.all([
    supabase.from('providers').select('id').eq('user_id', user.id).maybeSingle(),
    supabase.from('users')
      .select('is_verified, is_founding_provider, provider_fee_waived')
      .eq('id', user.id).maybeSingle(),
    supabase.from('verification_payments').select('id').eq('user_id', user.id).limit(1).maybeSingle(),
  ])

  if (!provRow) {
    return { ok: false, error: 'Only a stylist account can do the ID check here.' }
  }

  const u = (userRow ?? {}) as {
    is_verified?: boolean; is_founding_provider?: boolean; provider_fee_waived?: boolean
  }
  if (u.is_verified) {
    return { ok: false, error: 'You’re already verified — there’s nothing to submit.' }
  }
  if (!payRow && !u.is_founding_provider && !u.provider_fee_waived) {
    return { ok: false, error: 'The one-off fee needs settling before the ID check.' }
  }

  const path = `${user.id}/selfie-${Date.now()}.jpg`
  const { data: up, error: upErr } = await supabase.storage
    .from('verification-selfies')
    .upload(path, file, { contentType: 'image/jpeg' })

  if (upErr || !up) {
    console.error('[verify] selfie upload failed', upErr)
    return { ok: false, error: 'That didn’t upload. Check your connection and try again.' }
  }

  // Clear any previous request first. Mobile does the same: a rejected row would
  // otherwise keep the screen showing the old rejection while a fresh selfie sits
  // unreviewed. The upload has already succeeded, so this cannot strand a row.
  await supabase.from('verification_requests').delete().eq('user_id', user.id)

  // up.path, NOT a public URL. The bucket is private and the admin signs at
  // render time — storage-lockdown.sql moved this column to paths, and 0019 now
  // requires the value to start with this user's own id.
  const { error: insErr } = await supabase.from('verification_requests').insert({
    user_id: user.id,
    selfie_url: up.path,
    status: 'pending',
  })

  if (insErr) {
    console.error('[verify] request insert failed', insErr)
    return {
      ok: false,
      error: 'Your photo uploaded but we couldn’t log it for review. Try submitting again.',
    }
  }

  revalidatePath('/verify')
  revalidatePath('/shop')
  revalidatePath('/dashboard')
  return { ok: true }
}
