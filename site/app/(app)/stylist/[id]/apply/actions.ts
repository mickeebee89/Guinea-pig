'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { consentStillCurrent, CONSENT_DEVICE_INFO } from '@/lib/queries/consent'
import { getGateState } from '@/lib/verification'
import { BOOKINGS_PATH } from '@/lib/routes'

/**
 * Sending an application, from the web. Audit item 83.
 *
 * ── ONE TRANSACTION, AND IT IS NOT OURS ───────────────────────────────────
 * create_session_with_consent writes the booking and its consent row together
 * or writes neither (0001/0009). Nothing here may split that: no "create the
 * booking then record consent", ever.
 *
 * ── WHAT THIS SERVER ACTION DOES NOT TRUST ────────────────────────────────
 * Everything in the form came from a browser, so:
 *   * the CONSENT is re-read by id and its hash compared with the one the page
 *     says it showed. A mismatch means the text moved under the reader, and
 *     the application is refused rather than recorded against wording she
 *     never saw;
 *   * the PRICE is not accepted from the form at all. The booking's price is
 *     snapshotted from the slot by a database trigger (0052);
 *   * the MEMBERSHIP and ID CHECK are re-checked here, and again by the
 *     database (0049). This layer exists to give a sentence instead of a
 *     row-security error;
 *   * the SLOT and TREATMENT are ids; the database decides whether they are
 *     real, belong together, and are still free.
 */

export type ApplyResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: string; refresh?: boolean }

export async function submitApplication(form: FormData): Promise<ApplyResult> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const providerId = String(form.get('provider_id') ?? '')
  const availabilityId = String(form.get('availability_id') ?? '')
  const treatmentId = String(form.get('treatment_id') ?? '')
  const date = String(form.get('date') ?? '')
  const startTime = String(form.get('start_time') ?? '')
  const endTime = String(form.get('end_time') ?? '')
  const note = String(form.get('note') ?? '').trim().slice(0, 300)
  const photoPaths = String(form.get('photo_paths') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)

  if (!providerId || !availabilityId || !treatmentId || !date || !startTime || !endTime) {
    return { ok: false, error: 'Something was missing from your application. Start again from the slot.', refresh: true }
  }

  // ── The gates, in the order the product states them ──────────────────────
  const gate = await getGateState(supabase, user.id)
  if (!gate.subscribed) {
    return { ok: false, error: 'Your membership isn’t active, so this can’t be sent yet.', refresh: true }
  }
  if (!gate.verified) {
    return { ok: false, error: 'Your ID check isn’t done yet, so this can’t be sent.', refresh: true }
  }

  // ── The consent, checked against the document itself ─────────────────────
  const consentId = String(form.get('consent_document_id') ?? '')
  const consentHash = String(form.get('consent_hash') ?? '')
  const rawPayload = String(form.get('consent_payload') ?? '')
  if (!consentId || !consentHash || !rawPayload) {
    return { ok: false, error: 'We didn’t receive your agreement to the terms. Please tick them again.', refresh: true }
  }

  let payload: { consent_version?: number; acknowledgements?: unknown[] }
  try {
    payload = JSON.parse(rawPayload)
  } catch {
    return { ok: false, error: 'We couldn’t read your agreement to the terms. Please tick them again.', refresh: true }
  }

  if (!(await consentStillCurrent(supabase, consentId, consentHash))) {
    // Not an error on her part: the wording changed while she was reading it.
    return {
      ok: false,
      error: 'The terms were updated while you were reading them. We’ve loaded the new version — please read it and tick again.',
      refresh: true,
    }
  }

  const acks = Array.isArray(payload.acknowledgements) ? payload.acknowledgements : []
  const allAgreed = acks.every(a => (a as { agreed?: boolean })?.agreed === true)
  if (acks.length === 0 || !allAgreed) {
    return { ok: false, error: 'Please tick every box before sending your application.' }
  }

  // ── The booking ──────────────────────────────────────────────────────────
  // scheduled_at and duration_minutes are NOT NULL with no default, and are
  // derived here rather than trusted from the form: they must agree with the
  // date and times the slot actually holds.
  const scheduledAt = new Date(`${date}T${startTime}:00`).toISOString()
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  const durationMinutes = Math.max(15, (eh * 60 + em) - (sh * 60 + sm))

  const { data, error } = await supabase.rpc('create_session_with_consent', {
    p_provider_id: providerId,
    p_availability_id: availabilityId,
    p_date: date,
    p_start_time: startTime,
    p_end_time: endTime,
    p_scheduled_at: scheduledAt,
    p_duration_minutes: durationMinutes,
    p_treatment_id: treatmentId,
    p_location_type: 'provider',
    p_note: note || null,
    p_photo_urls: photoPaths,
    p_consent_document_id: consentId,
    p_consent_version: payload.consent_version ?? null,
    p_content_hash: consentHash,
    p_acknowledgements: acks,
    p_category_id: null,
    // ⚠️ Platform only. Mobile records device details; Privacy publishes that
    // we record none, and that claim holds today.
    p_device_info: CONSENT_DEVICE_INFO,
  })

  if (error) {
    console.error('[apply] create_session_with_consent failed', { code: error.code, message: error.message })
    // CV003 is 0049's apply gate, and its message is written for the member.
    if (error.code === 'CV003') return { ok: false, error: error.message, refresh: true }
    // 23505 is the booking guard: somebody took this slot first.
    if (error.code === '23505') {
      return { ok: false, error: 'That slot has just been taken. Pick another time.', refresh: true }
    }
    return { ok: false, error: 'We couldn’t send your application. Please try again.', refresh: true }
  }

  const sessionId = String(data)

  // ── Tell the stylist ─────────────────────────────────────────────────────
  // Separate from the booking on purpose: a failed notification must not undo
  // a confirmed application. Since 0047 this insert is also what sends them
  // an email, so a silent failure here is a stylist who never hears.
  const { data: provRow } = await supabase
    .from('providers').select('user_id').eq('id', providerId).maybeSingle()
  const providerUserId = (provRow as { user_id: string | null } | null)?.user_id
  if (providerUserId) {
    const { data: treatRow } = await supabase
      .from('provider_treatments').select('name, category').eq('id', treatmentId).maybeSingle()
    const treat = treatRow as { name: string | null; category: string | null } | null
    const when = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    })
    const { error: notifErr } = await supabase.from('notifications').insert({
      user_id: providerUserId,
      type: 'session_applied',
      title: 'New treatment application',
      body: `A model has applied for ${treat?.name?.trim() || treat?.category || 'a treatment'} on ${when} at ${startTime}`,
      session_id: sessionId,
    })
    if (notifErr) console.error('[apply] stylist notification failed', notifErr)
  } else {
    console.error('[apply] no provider user_id — the stylist will not be told', { providerId })
  }

  revalidatePath(BOOKINGS_PATH)
  revalidatePath('/dashboard')
  return { ok: true, sessionId }
}

/**
 * One photo, uploaded the moment it is chosen.
 *
 * ⚠️ THIS IS WHAT MAKES A REFRESH SURVIVABLE. Holding files in browser memory
 * until the end means a reload at step 6 loses them, and a model who has
 * photographed her own hair three times does not do it a fourth. Uploading on
 * pick puts them in her photo library (model_photos), where the wizard reads
 * them back — the same library mobile uses, so a photo added on either shows
 * up on both.
 */
export async function uploadApplicationPhoto(form: FormData): Promise<
  { ok: true; id: string; path: string; url: string } | { ok: false; error: string }
> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const file = form.get('photo')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'That photo didn’t come through. Try again.' }
  }
  if (file.size > 8 * 1024 * 1024) {
    return { ok: false, error: 'That photo is too large. Try a smaller one.' }
  }
  if (!file.type.startsWith('image/')) {
    return { ok: false, error: 'That doesn’t look like a photo.' }
  }

  // The path starts with the user's own id, which is what the bucket policy
  // requires — and it comes from requireUser(), never from the client.
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const { data: up, error: upErr } = await supabase.storage
    .from('model-photos')
    .upload(path, file, { contentType: file.type })
  if (upErr || !up) {
    console.error('[apply] photo upload failed', upErr)
    return { ok: false, error: 'That didn’t upload. Check your connection and try again.' }
  }

  const { data: row, error: rowErr } = await supabase
    .from('model_photos')
    .insert({ user_id: user.id, photo_url: up.path })
    .select('id')
    .maybeSingle()
  if (rowErr || !row) {
    console.error('[apply] model_photos insert failed', rowErr)
    return { ok: false, error: 'The photo uploaded but we couldn’t save it to your library.' }
  }

  const { data: signed } = await supabase.storage
    .from('model-photos').createSignedUrl(up.path, 60 * 30)

  return {
    ok: true,
    id: (row as { id: string }).id,
    path: up.path,
    url: signed?.signedUrl ?? '',
  }
}
