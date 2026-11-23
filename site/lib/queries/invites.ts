import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The invite message cap, in characters.
 *
 * ⚠️ IT LIVES HERE, NOT IN models/actions.ts, BECAUSE THAT FILE IS
 * `'use server'` — Next only permits async function exports from one, so a
 * plain const there is a build error rather than a style question. The
 * client component needs the number to draw a counter and the action needs
 * it to refuse, so it has to sit somewhere both may import.
 *
 * ⚠️ THE DATABASE HOLDS THE SAME NUMBER (invites_message_len, 0113) and
 * that one is the rule. This is the friendly half — same arrangement as
 * lib/price.ts and availability_price_pence_range.
 */
export const MAX_INVITE_MESSAGE = 500

/**
 * What a stylist is told when `invite_model` refuses.
 *
 * ⚠⚠ ONE SET OF SENTENCES, TWO SURFACES. /models and the Salon Floor call
 * the same function and get the same SQLSTATEs, so a second set of wordings
 * is a second thing to keep in step — and the Salon Floor is how we found
 * out: it mapped two codes out of six, written before 0113 added four more
 * and changed what one of them means.
 *
 * ⚠️ MAPPED ON CODE, NEVER ON MESSAGE TEXT. The codes are chosen in 0113 to
 * be distinguishable; the message strings are not promised to anyone and a
 * later migration may reword them.
 *
 * ⚠⚠ 42501 COVERS THREE REFUSALS AND MUST NOT BE SPLIT:
 *     - the caller is not a stylist
 *     - the caller's shop is not published
 *     - that member cannot be invited
 * and the third is ITSELF four causes the function deliberately collapses —
 * not a model, not discoverable, blocked, suspended — so that a stylist
 * cannot probe which. Telling them apart in the app would hand back exactly
 * the signal the database went out of its way to withhold: an opt-out that
 * can be confirmed is not an opt-out, and a block that can be detected is a
 * worse position than no block.
 *
 * So the sentence names the two things a STYLIST can act on, and says
 * nothing about the member. "Your shop page shows whether you're published"
 * is what lets her tell her own half apart, without us telling her the
 * other.
 */
export function inviteErrorMessage(code: string | undefined): string {
  switch (code) {
    case '42501':
      return 'Either your shop isn’t published — that’s what lets you invite anyone — or this '
        + 'member can’t be invited. Your shop page shows whether you’re published.'
    case '22023':
      return 'That’s your own account.'
    case '23505':
      return 'You’ve already invited them. One invite each, so they don’t get chased.'
    case '23514':
      return 'That message can’t be sent. Please reword it and try again.'
    case '55000':
      // ⚠️ NOT HER FAULT, AND IT MUST NOT READ AS IF IT WERE. The word screen
      // could not read its list, so nothing was sent — the same distinction
      // lib/postcode.ts draws for 'unavailable'.
      return 'We couldn’t check that message just now, so nothing was sent. Try again in a moment.'
    case '22001':
      return `That message is a bit long — ${MAX_INVITE_MESSAGE} characters or fewer.`
    default:
      return 'That didn’t send. Nothing has changed.'
  }
}


/**
 * Stylist-to-model invites.
 *
 * ── ⚠️ THE GATE IS IN THE DATABASE, AND THIS FILE CANNOT OPEN IT ──────────
 * `invitable_models` is SECURITY DEFINER and refuses, inside the function, to
 * return anything at all unless `auth.uid()` owns a provider row that is
 * `is_published` AND passes `provider_shop_is_publishable`. So an empty list
 * here is not a bug to work around in the component — it is the answer.
 *
 * That split is deliberate and is the whole difference from `nearby_models`,
 * which 0097 revoked because it was the same query with the gate in the app.
 * A gate in a React component is a gate on one caller.
 *
 * ── WHAT IS NEVER RETURNED ────────────────────────────────────────────────
 * No email address, ever, at any point. No postcode, no coordinate — a
 * DISTANCE is computed in the database and the point never leaves it. The
 * migration's verify block fails if a column whose name looks like contact or
 * location is ever added to the function's signature.
 */

/** One model a stylist may invite. */
export interface InvitableModel {
  id: string
  firstName: string | null
  lastInitial: string | null
  avatarUrl: string | null
  /** Miles to her, or null when either party has no coordinate. */
  distanceMiles: number | null
  bio: string | null
  /** The look attributes, in the order the profile shows them. */
  attributes: { label: string; value: string }[]
}

const ATTRIBUTE_LABELS: [keyof RawModel, string][] = [
  ['hair_colour', 'Hair colour'],
  ['hair_type', 'Hair type'],
  ['hair_length', 'Hair length'],
  ['hair_condition', 'Hair condition'],
  ['skin_tone', 'Skin tone'],
  ['skin_type', 'Skin type'],
  ['eye_colour', 'Eye colour'],
  ['eye_shape', 'Eye shape'],
  ['nail_condition', 'Nails'],
]

interface RawModel {
  id: string
  first_name: string | null
  last_initial: string | null
  profile_pic_url: string | null
  distance_mi: number | null
  hair_colour: string | null
  hair_type: string | null
  hair_length: string | null
  hair_condition: string | null
  skin_tone: string | null
  skin_type: string | null
  eye_colour: string | null
  eye_shape: string | null
  nail_condition: string | null
  bio: string | null
}

export interface InvitableResult {
  models: InvitableModel[]
  /**
   * False when the viewer has no coordinate of her own. Every distance is then
   * null, and a radius filter would return nothing at all — so the surface has
   * to say so rather than render an empty list.
   */
  viewerPlaced: boolean
}

/**
 * ⚠️ RETURNS NULL ON FAILURE, AND THE CALLER MUST SAY SO RATHER THAN RENDER
 * AN EMPTY LIST. "Nobody to invite" and "we could not ask" are different
 * sentences, and only one of them is about the member. Same rule as
 * lib/queries/demand.ts, reached from the other side.
 */
export async function getInvitableModels(
  supabase: SupabaseClient,
  userId: string,
  radiusMiles: number | null,
): Promise<InvitableResult | null> {
  const { data: meRow } = await supabase
    .from('users')
    .select('latitude, longitude')
    .eq('id', userId)
    .maybeSingle()

  const lat = (meRow?.latitude as number | null) ?? null
  const lng = (meRow?.longitude as number | null) ?? null

  // ⚠️ A RADIUS AROUND NOWHERE RETURNS NOTHING, by the function's own rule —
  // the same one nearby_models uses. Asking for "within 15 miles" of an
  // unknown point cannot be answered, so rather than show her a confidently
  // empty list we drop the filter and let the surface explain. The alternative
  // (send the radius anyway) is a screen that says "no models near you" to
  // someone whose postcode we simply never asked for.
  const viewerPlaced = lat != null && lng != null
  const effectiveRadius = viewerPlaced ? radiusMiles : null

  const { data, error } = await supabase.rpc('invitable_models', {
    p_lat: lat,
    p_lng: lng,
    p_radius_mi: effectiveRadius,
  })

  if (error) {
    console.warn('[invites] invitable_models →', error.message)
    return null
  }

  const rows = (Array.isArray(data) ? data : []) as RawModel[]

  return {
    viewerPlaced,
    models: rows.map(r => ({
      id: r.id,
      firstName: r.first_name,
      lastInitial: r.last_initial,
      avatarUrl: r.profile_pic_url,
      distanceMiles: r.distance_mi,
      bio: r.bio,
      attributes: ATTRIBUTE_LABELS
        .map(([key, label]) => ({ label, value: (r[key] as string | null) ?? '' }))
        .filter(a => a.value.trim() !== ''),
    })),
  }
}

/** An invite as the model who received it sees it. */
export interface ReceivedInvite {
  id: string
  providerId: string
  shopName: string | null
  shopAvatarUrl: string | null
  message: string | null
  status: 'sent' | 'declined'
  createdAt: string
}

/**
 * The invites sent to this model.
 *
 * ⚠️ THE STYLIST'S MESSAGE IS HER OWN WORDS AND IS RENDERED AS SUCH. It is
 * stored on the invite rather than folded into the notification body for
 * exactly that reason: Cavy's sentence and a stranger's sentence must not
 * arrive looking like one voice.
 */
export async function getReceivedInvites(
  supabase: SupabaseClient,
  userId: string,
): Promise<ReceivedInvite[] | null> {
  const { data, error } = await supabase
    .from('invites')
    .select('id, provider_id, message, status, created_at')
    .eq('model_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    console.warn('[invites] received →', error.message)
    return null
  }

  const rows = (data ?? []) as Record<string, unknown>[]
  if (rows.length === 0) return []

  // ⚠️ TWO QUERIES, NOT A POSTGREST EMBED, AND FOR TWO REASONS.
  //
  //   1. The demo engine implements `table!fk(cols)` and THROWS on anything
  //      else. A plain `providers(...)` embed is the shape that broke browse
  //      and every stylist page after 0087 — check-demo-rpc-coverage catches
  //      it now, and caught this.
  //   2. A many-to-one embed comes back as a single OBJECT at runtime while
  //      the generated types call it an ARRAY, so reading the wrong shape
  //      yields undefined: falsy, plausible and silent. That was item 176.
  //      A keyed lookup has neither problem.
  const ids = [...new Set(rows.map(r => String(r.provider_id)))]
  const { data: provData } = await supabase
    .from('providers')
    .select('id, name, profile_pic_url')
    .in('id', ids)

  const shops = new Map(
    ((provData ?? []) as { id: string; name: string | null; profile_pic_url: string | null }[])
      .map(p => [p.id, p]),
  )

  return rows.map(r => {
    const prov = shops.get(String(r.provider_id)) ?? null
    return {
      id: String(r.id),
      providerId: String(r.provider_id),
      shopName: prov?.name ?? null,
      shopAvatarUrl: prov?.profile_pic_url ?? null,
      message: (r.message as string | null) ?? null,
      status: (r.status as 'sent' | 'declined') ?? 'sent',
      createdAt: String(r.created_at),
    }
  })
}
