'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { consentStillCurrent, type AcceptedConsent } from '@/lib/queries/consent'
import { getGateState } from '@/lib/verification'
import { getBlockedIds } from '@/lib/blocks'
import { BOOKINGS_PATH } from '@/lib/routes'
import type { Database } from '@/lib/database.types'

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

/**
 * ⚠️ EVERY REFUSAL CARRIES A CODE, AND IT IS NOT DECORATION.
 *
 * On 23 Sep a submit was reported as "refused, saying the terms weren't
 * ticked" — and that sentence could have come from three different places:
 * this action's missing-fields branch, its all-agreed branch, or the wizard's
 * own grey note when it holds no consent. They read almost identically to a
 * person, so the report could not be acted on.
 *
 * The code names the layer. `consentRelated` is what decides whether the
 * client may throw her ticks away, which it used to do on every refusal —
 * including a slot race, which has nothing to do with consent and made every
 * failure look like a consent failure.
 */
export type ApplyRefusalCode =
  | 'fields_missing'      // the form arrived incomplete
  | 'gate_membership'     // 0049's rule, checked here for a legible message
  | 'gate_idcheck'
  | 'consent_missing'     // no consent fields in the form at all
  | 'consent_unreadable'  // the payload would not parse
  | 'consent_malformed'   // it parsed, but it is not a consent record
  | 'consent_moved'       // the document changed under the reader
  | 'consent_unticked'    // an acknowledgement came back not agreed
  | 'blocked'             // the two have blocked each other, either direction
  | 'slot_taken'
  | 'gate_database'       // CV003: the database refused, not us
  | 'rpc_failed'

export type ApplyResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: string; code: ApplyRefusalCode; refresh?: boolean }

/**
 * create_session_with_consent, with the ONE argument the generated types get
 * wrong. Audit item 84.
 *
 * -- WHY A WRAPPER AND NOT A CAST AT THE CALL SITE -------------------------
 * `p_note` is `text` and accepts NULL. Mobile has sent null since the function
 * was written, and a booking with no note stores NULL — not an empty string.
 *
 * **The generator cannot express that.** `supabase gen types` marks every
 * argument without a SQL default as required AND non-nullable; parameter
 * nullability is not something it reads out of pg_proc. So `p_note: string` is
 * the generator's limit, not the function's, and it is the only argument of
 * the sixteen affected.
 *
 * Declaring it here, once, keeps the call site below fully checked on its
 * other fifteen arguments against the live signature — which is the whole
 * point of turning the types on. Making the types happy by sending `''`
 * instead would have been a one-character change and would have silently
 * altered what is stored in every note-less booking.
 *
 * Used by exactly one call site. If a second appears, that is the moment to
 * ask whether the generator has learned to do this properly.
 */
type CreateSessionArgs =
  Omit<Database['public']['Functions']['create_session_with_consent']['Args'], 'p_note'>
  & { p_note: string | null }

function createSessionWithConsent(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  args: CreateSessionArgs,
) {
  // The single place the generator's limit is overridden, and the only
  // assertion in this file. It widens nothing: `args` has already been checked
  // against CreateSessionArgs above, which is the true signature.
  return supabase.rpc('create_session_with_consent', args as CreateSessionArgs & { p_note: string })
}

type Acknowledgement = AcceptedConsent['acknowledgements'][number]

/**
 * The acknowledgements, CHECKED rather than trusted. Audit item 84.
 *
 * WARNING: THIS IS EVIDENCE, AND IT ARRIVES FROM A BROWSER.
 *
 * What goes in here is denormalised into `session_consents` and kept for six
 * years (0006). It is the copy anyone reading the record sees first — the
 * hash pins the document, but nobody reads a hash. Until this function
 * existed, the whole array was `unknown[]` and the only check on it was that
 * every element had `agreed === true`. A caller could post acknowledgements
 * with rewritten `text`, or extra fields of their own, and they would be
 * stored verbatim as what she agreed to.
 *
 * So: every element must have the three fields, of the right types, non-empty.
 * The returned objects are REBUILT from those three fields, so anything else
 * that was sent is dropped rather than recorded.
 *
 * WARNING: WHAT THIS STILL DOES NOT DO. It checks the SHAPE, not the CONTENT:
 * it cannot tell that `text` is the document's own wording, because it never
 * reads the document. Closing that means rebuilding the array server-side from
 * the consent document and taking only the ticked KEYS from the browser, which
 * is a change to what the flow sends and is not made here unasked.
 */
function parseAcknowledgements(value: unknown): Acknowledgement[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const out: Acknowledgement[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
    const { key, text, agreed } = item as Record<string, unknown>
    if (typeof key !== 'string' || key.trim() === '') return null
    if (typeof text !== 'string' || text.trim() === '') return null
    if (typeof agreed !== 'boolean') return null
    out.push({ key, text, agreed })
  }
  return out
}

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
    return { ok: false, error: 'Something was missing from your application. Start again from the slot.', code: 'fields_missing', refresh: true }
  }

  // ── The gates, in the order the product states them ──────────────────────
  const gate = await getGateState(supabase, user.id)
  if (!gate.subscribed) {
    return { ok: false, error: 'Your membership isn’t active, so this can’t be sent yet.', code: 'gate_membership', refresh: true }
  }
  if (!gate.verified) {
    return { ok: false, error: 'Your ID check isn’t done yet, so this can’t be sent.', code: 'gate_idcheck', refresh: true }
  }

  // ── Blocked, either direction ────────────────────────────────────────────
  //
  // ⚠️ ASKED, NOT INFERRED FROM AN ERROR. `sessions_insert_not_blocked` is a
  // RESTRICTIVE policy, and a RESTRICTIVE failure arrives as 42501 — the same
  // code as every other row-security refusal, including 0049's apply gate. So
  // reading "blocked" out of the error would be a guess, and would put those
  // words in front of someone whose membership had simply lapsed.
  //
  // getBlockedIds returns the pair in BOTH directions, which is the product's
  // definition of a block (CLAUDE.md: mutual block = either direction), and it
  // is the same helper the lists use.
  const { data: provUser } = await supabase
    .from('providers').select('user_id').eq('id', providerId).maybeSingle()
  const stylistUserId = (provUser as { user_id: string | null } | null)?.user_id
  if (stylistUserId) {
    const blocked = await getBlockedIds(supabase, user.id).catch(() => new Set<string>())
    if (blocked.has(stylistUserId)) {
      // ⚠️ IT MUST NOT SAY WHO BLOCKED WHOM. Telling her they blocked her hands
      // one member a fact about another's safety decision, and "you blocked
      // them" would be wrong half the time. The site already words this exactly
      // once, on the stylist profile, and this matches it deliberately.
      return {
        ok: false,
        error: 'You can’t apply to this stylist. You’ve blocked them, or they’ve blocked you — either way you can’t book with each other. You can undo a block you made in Settings.',
        code: 'blocked',
      }
    }
  }

  // ── The consent, checked against the document itself ─────────────────────
  const consentId = String(form.get('consent_document_id') ?? '')
  const consentHash = String(form.get('consent_hash') ?? '')
  const rawPayload = String(form.get('consent_payload') ?? '')
  if (!consentId || !consentHash || !rawPayload) {
    console.error('[apply] consent fields missing from the form', {
      hasId: !!consentId, hasHash: !!consentHash, hasPayload: !!rawPayload,
    })
    return { ok: false, error: 'We didn’t receive your agreement to the terms. Please tick them again.', code: 'consent_missing', refresh: true }
  }

  let payload: { consent_version?: unknown; acknowledgements?: unknown }
  try {
    payload = JSON.parse(rawPayload)
  } catch {
    return { ok: false, error: 'We couldn’t read your agreement to the terms. Please tick them again.', code: 'consent_unreadable', refresh: true }
  }

  // WARNING: THE VERSION IS REQUIRED, AND USED TO BE ALLOWED TO BE NULL.
  //
  // The call sent `payload.consent_version ?? null`, so a payload arriving
  // without one would have written a consent row recording no version at all.
  // That is the weakest possible evidence of an agreement — it says she
  // agreed to something, and cannot say to what edition of it — and it would
  // have been created silently, at the moment the record was supposed to be
  // made. Refusing is the only honest answer, and the types are what found it.
  const consentVersion = payload.consent_version
  if (typeof consentVersion !== 'number' || !Number.isInteger(consentVersion) || consentVersion < 1) {
    console.error('[apply] consent payload has no usable version', { got: typeof consentVersion })
    return {
      ok: false,
      error: 'We couldn’t record which version of the terms you agreed to, so your application wasn’t sent. Nothing has been saved — please read them again and tick the boxes.',
      code: 'consent_malformed',
      refresh: true,
    }
  }

  if (!(await consentStillCurrent(supabase, consentId, consentHash))) {
    // Not an error on her part: the wording changed while she was reading it.
    return {
      ok: false,
      error: 'The terms were updated while you were reading them. We’ve loaded the new version — please read it and tick again.',
      code: 'consent_moved',
      refresh: true,
    }
  }

  const acks = parseAcknowledgements(payload.acknowledgements)
  if (!acks) {
    // Deliberately NOT the generic 'that didn’t work'. A refusal here means
    // her consent was not recorded, and a message that does not say so leaves
    // her believing it was.
    console.error('[apply] acknowledgements did not match the expected shape')
    return {
      ok: false,
      error: 'Your agreement to the terms didn’t reach us in a form we could record, so your application wasn’t sent. Nothing has been saved — please read them again and tick the boxes.',
      code: 'consent_malformed',
      refresh: true,
    }
  }

  const allAgreed = acks.every(a => a.agreed === true)
  if (!allAgreed) {
    // ⚠️ Logged with the KEYS, not just a count. "6 of 9 agreed" does not say
    // which, and the difference between "she missed one" and "we sent one
    // wrong" is the whole diagnosis. Keys and booleans only — the wording is
    // in the document, and this is a server log.
    console.error('[apply] acknowledgements not all agreed', {
      count: acks.length,
      state: acks.map(a => `${a.key}=${a.agreed ? 'y' : 'n'}`),
    })
    return {
      ok: false,
      error: 'Please tick every box before sending your application.',
      code: 'consent_unticked',
    }
  }

  // ── The booking ──────────────────────────────────────────────────────────
  // scheduled_at and duration_minutes are NOT NULL with no default, and are
  // derived here rather than trusted from the form: they must agree with the
  // date and times the slot actually holds.
  const scheduledAt = new Date(`${date}T${startTime}:00`).toISOString()
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  const durationMinutes = Math.max(15, (eh * 60 + em) - (sh * 60 + sm))

  const { data, error } = await createSessionWithConsent(supabase, {
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
    p_consent_version: consentVersion,
    p_content_hash: consentHash,
    p_acknowledgements: acks,
    // ⚠️ FIFTEEN ARGUMENTS, MATCHING MOBILE EXACTLY. Do not add to this list
    // without reading the live signature first.
    //
    // This call originally also sent p_category_id and p_device_info, because
    // migration 0009's baseline records them as defaulted parameters. Every
    // application from the web failed with PostgREST's PGRST202 — "could not
    // find the function … in the schema cache" — which is what PostgREST says
    // when NO overload matches the named arguments it was given. It lists what
    // was SENT, not what exists, so it names no culprit; it only proves the
    // set was wrong.
    //
    // ⚠️ THE LIVE SIGNATURE WAS THEN READ, AND IT SETTLES IT (23 Sep 2026,
    // one overload, security invoker):
    //
    //   …, p_acknowledgements jsonb, p_category_id uuid DEFAULT NULL
    //
    // SIXTEEN arguments. p_category_id exists and defaults, so omitting it is
    // fine. **p_device_info DOES NOT EXIST**: migration 0010 dropped it, and
    // the column behind it, on 9 Aug 2026 — deliberately, with five reasons
    // recorded in that file.
    //
    // ⚠️ The seventeen-argument version lives in migration 0009, which is
    // marked SUPERSEDED BY 0010 on its first line and says, in its header,
    // DO NOT RUN THIS FILE — IT WAS NEVER APPLIED. This call was written from
    // that file's middle, past the header. The signature it records is the
    // function as it was BEFORE 0010, kept only so 0010's reasoning has
    // something to refer to.
    //
    // These fifteen are every argument this function takes bar one optional.
  })

  if (error) {
    console.error('[apply] create_session_with_consent failed', { code: error.code, message: error.message })
    // CV003 is 0049's apply gate, and its message is written for the member.
    if (error.code === 'CV003') return { ok: false, error: error.message, code: 'gate_database', refresh: true }
    // 23505 is the booking guard: somebody took this slot first.
    if (error.code === '23505') {
      return { ok: false, error: 'That slot has just been taken. Pick another time.', code: 'slot_taken', refresh: true }
    }
    return {
      ok: false,
      // The database's own message is not shown: it can name columns and
      // constraints. The log above has it in full.
      error: 'We couldn’t send your application. Please try again.',
      code: 'rpc_failed',
      refresh: true,
    }
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
