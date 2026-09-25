import type { SupabaseClient } from '@supabase/supabase-js'
import { getBlockedIds } from '@/lib/blocks'
import { indexById, displayName, type ProviderRef, type ProfileRef, type TreatmentRef } from './util'

/**
 * The signed-in user's bookings, in BOTH roles.
 *
 * ── WHERE THIS DEPARTS FROM MOBILE, AND WHY ────────────────────────────────
 * mobile/src/app/(app)/sessions.tsx is provider-only: it looks up the user's
 * providers row and returns early if there isn't one (line 110), so a model
 * opening it sees nothing. Models reach their bookings by other routes there.
 *
 * On web a single /sessions page that is blank for every model would read as
 * broken, so this returns both roles. That is a gap being filled rather than a
 * divergence being created — there is no mobile behaviour here to disagree
 * with. If a model-side sessions screen is ever built on mobile, the two should
 * be reconciled.
 *
 * Read-only. Accept and decline are slice 4 (provider side).
 */

/** Signed for the life of one render. Same bucket and TTL as queries/model.ts. */
const PHOTO_BUCKET = 'model-photos'
const PUBLIC_MARKER = `/object/public/${PHOTO_BUCKET}/`
const SIGN_TTL_SECONDS = 3600

/** Port of mobile's toObjectPath — tolerates a bare path or a legacy public URL. */
function toObjectPath(stored: string): string {
  if (!stored) return ''
  const i = stored.indexOf(PUBLIC_MARKER)
  const raw = i >= 0 ? stored.slice(i + PUBLIC_MARKER.length) : stored
  return raw.replace(/^\/+/, '').split('?')[0]
}

export interface SessionRow {
  id: string
  role: 'model' | 'provider'
  date: string
  startTime: string | null
  endTime: string | null
  status: string
  note: string | null
  /**
   * The photos the model attached to her application, signed.
   *
   * ⚠️ THE WEB DID NOT SELECT THESE AT ALL until 23 Sep 2026 (item 96). She
   * chose them in the wizard, was told they were shared, and a stylist reading
   * the application on the website saw a booking with no photos — while the
   * same application on the app showed them. For a treatment chosen partly on
   * what someone's hair currently looks like, that is most of the decision.
   */
  photoUrls: string[]
  /**
   * When the application arrived, which is NOT the appointment date.
   *
   * Mobile sorts pending applications by this, newest first
   * (sessions.tsx:180). The web ordered everything by `date` alone, so a
   * stylist with three applications for the same slot had no idea who asked
   * first — and the order silently changed meaning between her two screens.
   */
  createdAt: string
  /**
   * Who cancelled it, from the viewer's side. Audit item 87.
   *
   * ⚠️ `null` IS NOT "UNKNOWN". It means THE PLATFORM cancelled, and it is
   * recorded that way on purpose in three different places:
   *
   *   * a suspension or a deleted stylist (`_withdraw_stylist`, 0044:330 —
   *     "cancelled_by stays NULL, as in a block cascade: the platform
   *     cancelled, not a person");
   *   * a block cascade (0029:280 — "recording the blocker here would put
   *     'who blocked whom' in the record").
   *
   * So the neutral wording is not only for a withdrawn stylist. One of the
   * cases it covers would disclose a member's safety decision if it named an
   * actor, which is why this must never fall back to "cancelled by them".
   */
  cancelledBy: 'you' | 'them' | 'platform' | null
  /** ISO. Null unless cancelled. */
  cancelledAt: string | null
  /**
   * What they said, if anything. Only ever present when a PERSON cancelled.
   *
   * Not a new disclosure: `cancel_booking` already passes this into the
   * notification the other party receives (0030:54), so it has always been
   * shown to them — just only once, in a notice they can delete.
   */
  cancellationReason: string | null
  treatmentName: string | null
  treatmentCategory: string | null
  /**
   * ⚠️ THE BOOKING'S OWN SNAPSHOT, NEVER THE SLOT'S CURRENT PRICE.
   *
   * 0052 takes it with a BEFORE INSERT trigger for exactly this reason: a
   * stylist can edit `availability.price_pence` afterwards, and reading that
   * here would let an edit rewrite what was agreed for a treatment that has
   * already happened.
   *
   * Written since 0052 and read by nothing until 25 Sep (audit item 97), which
   * meant Terms §8's record was kept and neither party could see it — and
   * pointing at the same number is the only mechanism either of them has, since
   * Cavy takes no payment and runs no disputes.
   *
   * null for bookings made before 0052, and for slots the stylist never priced.
   */
  pricePence: number | null
  otherPartyName: string
  otherPartyPic: string | null
  /**
   * providers.id when the other party is a stylist, null when they are a model
   * — there is no model profile route yet. NOT an auth user id.
   */
  otherPartyId: string | null
  otherPartyKind: 'stylist' | 'model'
  /** A completed booking this user has already reviewed. Drives "Leave a review". */
  reviewedByMe: boolean
}

export async function getSessions(
  supabase: SupabaseClient,
  userId: string,
): Promise<SessionRow[]> {
  const { data: provRow } = await supabase
    .from('providers').select('id').eq('user_id', userId).maybeSingle()
  const myProviderId = (provRow as { id?: string } | null)?.id

  const orClause = myProviderId
    ? `model_user_id.eq.${userId},provider_id.eq.${myProviderId}`
    : `model_user_id.eq.${userId}`

  const { data: raw, error } = await supabase
    .from('sessions')
    .select('id, provider_id, model_user_id, date, start_time, end_time, treatment_id, note, photo_urls, created_at, status, cancelled_by, cancelled_at, cancellation_reason, price_pence')
    .or(orClause)
    // ⚠️ 'cancelled' JOINED THIS LIST ON 24 Sep 2026 (item 87). Before that a
    // cancelled booking simply disappeared from both clients, and the only
    // trace was a notification — which is deletable (0008), so a member could
    // be left with no record that a booking had ever existed.
    .in('status', ['pending', 'accepted', 'completed', 'cancelled'])
    .order('date', { ascending: false })
  if (error) throw error

  const rows = (raw ?? []) as {
    id: string; provider_id: string; model_user_id: string
    date: string; start_time: string | null; end_time: string | null
    treatment_id: string | null; note: string | null; status: string
    photo_urls: string[] | null; created_at: string
    cancelled_by: string | null; cancelled_at: string | null
    cancellation_reason: string | null
    price_pence: number | null
  }[]
  if (rows.length === 0) return []

  const providerIds = [...new Set(rows.map(r => r.provider_id))]
  const modelIds    = [...new Set(rows.map(r => r.model_user_id))]
  const treatIds    = [...new Set(rows.map(r => r.treatment_id).filter(Boolean) as string[])]

  const completedIds = rows.filter(r => r.status === 'completed').map(r => r.id)

  const [provRes, modelRes, treatRes, blocked, reviewedRes] = await Promise.all([
    supabase.from('providers').select('id, user_id, name, profile_pic_url').in('id', providerIds),
    supabase.from('public_profiles').select('id, first_name, last_initial, profile_pic_url').in('id', modelIds),
    treatIds.length > 0
      ? supabase.from('provider_treatments').select('id, name, category').in('id', treatIds)
      : Promise.resolve({ data: [], error: null }),
    getBlockedIds(supabase, userId).catch(() => new Set<string>()),
    completedIds.length > 0
      ? supabase.from('reviews').select('session_id').eq('reviewer_id', userId).in('session_id', completedIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  const reviewed = new Set(((reviewedRes.data ?? []) as { session_id: string }[]).map(r => r.session_id))

  // The attached photos live in a PRIVATE bucket, so the stored paths have to
  // be swapped for signed URLs or they render blank. One batched call for every
  // booking on the page, as mobile does.
  //
  // A signing failure falls back to the stored value per file rather than
  // dropping the gallery — a broken image is a visible fault, and an empty
  // space reads as "she attached nothing", which is the false statement this
  // whole change exists to stop making.
  const allPaths = [...new Set(
    rows.flatMap(r => (r.photo_urls ?? []).map(toObjectPath)).filter(Boolean),
  )]
  const signedByPath = new Map<string, string>()
  if (allPaths.length > 0) {
    const { data: signed, error: signErr } = await supabase
      .storage.from(PHOTO_BUCKET).createSignedUrls(allPaths, SIGN_TTL_SECONDS)
    if (signErr) console.warn('[sessions] createSignedUrls failed:', signErr.message)
    for (const s of signed ?? []) {
      if (s.signedUrl && s.path) signedByPath.set(s.path, s.signedUrl)
    }
  }

  const provMap  = indexById<ProviderRef>(provRes.data)
  const modelMap = indexById<ProfileRef>(modelRes.data)
  const treatMap = indexById<TreatmentRef>(treatRes.data)

  return rows
    .filter(r => {
      const otherUserId = r.model_user_id === userId
        ? provMap[r.provider_id]?.user_id
        : r.model_user_id
      return !(otherUserId && blocked.has(otherUserId))
    })
    .map((r): SessionRow => {
      const isModel = r.model_user_id === userId
      const prov  = provMap[r.provider_id]
      const model = modelMap[r.model_user_id]
      const treat = r.treatment_id ? treatMap[r.treatment_id] : null
      return {
        id: r.id,
        role: isModel ? 'model' : 'provider',
        date: r.date,
        startTime: r.start_time,
        endTime: r.end_time,
        status: r.status,
        note: r.note,
        photoUrls: (r.photo_urls ?? [])
          .map(p => signedByPath.get(toObjectPath(p)) ?? p)
          .filter(Boolean),
        createdAt: r.created_at,
        // Resolved against the viewer here rather than in the page, so no
        // renderer has to hold a user id or decide what null means.
        cancelledBy: r.status !== 'cancelled'
          ? null
          : r.cancelled_by === null
            ? 'platform'
            : r.cancelled_by === userId
              ? 'you'
              : 'them',
        cancelledAt: r.cancelled_at,
        // Withheld unless a PERSON cancelled. A platform cancellation has no
        // reason recorded, and inventing one would be the opposite of neutral.
        cancellationReason: r.cancelled_by === null ? null : r.cancellation_reason,
        treatmentName: treat?.name ?? null,
        treatmentCategory: treat?.category ?? null,
        pricePence: r.price_pence ?? null,
        otherPartyName: isModel ? (prov?.name ?? 'Stylist') : displayName(model),
        otherPartyPic: isModel ? (prov?.profile_pic_url ?? null) : (model?.profile_pic_url ?? null),
        // ── WHY THIS WAS `null`, AND WHY IT NO LONGER IS ────────────────
        // It returned null for a stylist deliberately, and the reason was
        // correct when it was written (commit 2e39ca1, 9 Aug 2026):
        //
        //   "Only stylists link through: the other-party id for a model is an
        //    auth user id and there is no page for it."
        //
        // True at the time. It stopped being true on 24 Aug when /model/[id]
        // shipped, and nothing connected the two, so for nine days a stylist
        // saw every model's name here as dead text with a profile sitting one
        // route away.
        //
        // The reason was recorded in the right place for a REVIEWER and the
        // wrong place for a MAINTAINER: a commit message is read once, this
        // line is read every time. Hence the reason now lives here.
        //
        // Not a privacy decision. Both ids are already exposed to this viewer
        // — they are party to the session — and `otherPartyKind` below has
        // always told the caller which kind it is holding.
        otherPartyId: isModel ? r.provider_id : r.model_user_id,
        otherPartyKind: isModel ? 'stylist' : 'model',
        reviewedByMe: reviewed.has(r.id),
      }
    })
}
