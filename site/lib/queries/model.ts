import type { SupabaseClient } from '@supabase/supabase-js'
import { getBlockedIds } from '@/lib/blocks'
import { indexById, displayName, type ProfileRef } from './util'

/**
 * A model's profile, for signed-in members on the web.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * It did not, and `ChatThread.tsx` said so in a comment: "a model's id here is
 * an auth user id and there is no page for it yet." A stylist on the web could
 * open a model's chat and nothing else — so when report and block moved onto
 * profile screens, a stylist on the web would still have had nowhere to report
 * a model FROM. The gap would have moved rather than closed, on the side of the
 * marketplace being actively recruited.
 *
 * ── THE ID IS AN AUTH USER ID ─────────────────────────────────────────────
 * Unlike `/stylist/[id]`, which takes a `providers.id`. The two profile routes
 * on this site take different kinds of id and always will, because a model has
 * no provider row. That asymmetry is the reason `lib/report.ts` takes a tagged
 * subject rather than a string.
 *
 * Reads identity through `public_profiles` rather than `users`, matching mobile
 * — a first name plus initial is what a stranger is allowed to see.
 */

const BUCKET = 'model-photos'
const PUBLIC_MARKER = `/object/public/${BUCKET}/`
const SIGN_TTL_SECONDS = 3600

export type ModelPhoto = {
  id: string
  url: string
  caption: string | null
  categoryId: string | null
}

export type ModelProfile = {
  userId: string
  name: string
  avatarUrl: string | null
  instagram: string | null
  bio: string | null
  attributes: { label: string; value: string }[]
  photos: ModelPhoto[]
  categories: { id: string; name: string }[]
  /**
   * Reviews OF this model, newest first.
   *
   * ⚠️ THE WEB DID NOT READ THESE (item 96). Mobile's model screen has shown
   * them with an average since it was built (model/[id].tsx:580), so a stylist
   * deciding whether to accept an application had strictly less to go on when
   * she happened to be on the website — on the half of a two-sided marketplace
   * where the decision is whether to give a stranger an hour of her time.
   */
  reviews: {
    id: string
    rating: number | null
    comment: string | null
    tags: string[] | null
    createdAt: string
    reviewerName: string
  }[]
  /** The mean of the ratings that have one. Null when there are none. */
  averageRating: number | null
  /**
   * Her identity check has passed.
   *
   * Read from `users.is_verified`, the same source mobile's isIdentityVerified
   * uses. NOT on public_profiles, so it needs its own read.
   */
  isVerified: boolean
  isSelf: boolean
  isBlocked: boolean
}

/** Port of mobile's toObjectPath — tolerates a bare path or a legacy public URL. */
function toObjectPath(stored: string): string {
  if (!stored) return ''
  const i = stored.indexOf(PUBLIC_MARKER)
  const raw = i >= 0 ? stored.slice(i + PUBLIC_MARKER.length) : stored
  return raw.replace(/^\/+/, '').split('?')[0]
}

/** Attribute rows, in the order a person reads them. Empty values are dropped. */
const ATTRIBUTE_FIELDS: [keyof ModelAttrRow, string][] = [
  ['hair_colour',     'Hair colour'],
  ['hair_type',       'Hair type'],
  ['hair_length',     'Hair length'],
  ['hair_condition',  'Hair condition'],
  ['skin_tone',       'Skin tone'],
  ['skin_type',       'Skin type'],
  ['eye_colour',      'Eye colour'],
  ['eye_shape',       'Eye shape'],
  ['nail_condition',  'Nails'],
]

type ModelAttrRow = {
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

export async function getModelProfile(
  supabase: SupabaseClient,
  modelUserId: string,
  viewerId: string,
): Promise<ModelProfile | null> {
  const { data: prof } = await supabase
    .from('public_profiles')
    .select('id, first_name, last_initial, profile_pic_url, instagram_handle')
    .eq('id', modelUserId)
    .maybeSingle()

  // Not found and not visible to you both land here, on purpose — same as
  // /stylist/[id]. Note this is the PROFILE being absent, which is different
  // from the account being absent: a deleted account has no public_profiles row
  // either, and reporting one is handled by lib/report.ts, not here.
  if (!prof) return null

  const p = prof as {
    id: string; first_name: string | null; last_initial: string | null
    profile_pic_url: string | null; instagram_handle: string | null
  }

  const [
    { data: attrData }, { data: photoData }, { data: catData }, blocked,
    { data: revData }, { data: verifiedData },
  ] = await Promise.all([
    supabase.from('model_attributes')
      .select('hair_colour, hair_type, hair_length, hair_condition, skin_tone, skin_type, ' +
              'eye_colour, eye_shape, nail_condition, bio')
      .eq('user_id', modelUserId).maybeSingle(),
    supabase.from('model_photos')
      .select('id, photo_url, caption, category_id')
      .eq('user_id', modelUserId).order('created_at', { ascending: true }),
    supabase.from('model_photo_categories')
      .select('id, name, sort_order')
      .eq('user_id', modelUserId).order('sort_order'),
    getBlockedIds(supabase, viewerId).catch(() => new Set<string>()),
    // Same shape as the stylist page's review read, and the same limit.
    supabase.from('reviews')
      .select('id, overall_rating, comment, tags, created_at, reviewer_id')
      .eq('reviewee_id', modelUserId)
      .order('created_at', { ascending: false })
      .limit(20),
    // is_verified is not on public_profiles. users RLS permits reading this
    // row only where a policy allows it; a refusal yields null, which reads as
    // "not verified" — the safe direction, since the badge is a claim.
    supabase.from('users').select('is_verified').eq('id', modelUserId).maybeSingle(),
  ])

  const attrs = (attrData ?? null) as ModelAttrRow | null
  const attributes = attrs
    ? ATTRIBUTE_FIELDS
        .map(([key, label]) => ({ label, value: (attrs[key] ?? '') as string }))
        .filter(a => a.value.trim().length > 0)
    : []

  // Booking photos live in a PRIVATE bucket. The row stores the object path, so
  // a signed URL is minted per render. Signing failures fall back to the stored
  // value per file rather than dropping the whole gallery.
  const rows = ((photoData ?? []) as {
    id: string; photo_url: string; caption: string | null; category_id: string | null
  }[])
  const signedByPath = new Map<string, string>()
  if (rows.length > 0) {
    const paths = [...new Set(rows.map(r => toObjectPath(r.photo_url)).filter(Boolean))]
    const { data: signed, error: signErr } = await supabase
      .storage.from(BUCKET).createSignedUrls(paths, SIGN_TTL_SECONDS)
    if (signErr) console.warn('[model] createSignedUrls failed:', signErr.message)
    for (const s of signed ?? []) {
      if (s.signedUrl && s.path) signedByPath.set(s.path, s.signedUrl)
    }
  }

  const reviewRows = (revData ?? []) as {
    id: string; overall_rating: number | null; comment: string | null
    tags: string[] | null; created_at: string; reviewer_id: string | null
  }[]

  // Reviewer names come from public_profiles — users RLS blocks reading other
  // people's rows directly, and a review with no attribution reads as fake.
  const reviewerIds = [...new Set(reviewRows.map(r => r.reviewer_id).filter(Boolean) as string[])]
  const namesRes = reviewerIds.length > 0
    ? await supabase.from('public_profiles')
        .select('id, first_name, last_initial, profile_pic_url').in('id', reviewerIds)
    : { data: [] }
  const nameMap = indexById<ProfileRef>(namesRes.data)

  const rated = reviewRows.map(r => r.overall_rating).filter((n): n is number => n != null)

  return {
    userId: p.id,
    name: `${p.first_name ?? ''}${p.last_initial ? ' ' + p.last_initial + '.' : ''}`.trim() || 'Model',
    avatarUrl: p.profile_pic_url,
    instagram: p.instagram_handle,
    bio: attrs?.bio ?? null,
    attributes,
    photos: rows.map(r => ({
      id: r.id,
      url: signedByPath.get(toObjectPath(r.photo_url)) ?? r.photo_url,
      caption: r.caption,
      categoryId: r.category_id,
    })),
    categories: ((catData ?? []) as { id: string; name: string }[])
      .map(c => ({ id: c.id, name: c.name })),
    reviews: reviewRows.map(r => ({
      id: r.id,
      rating: r.overall_rating,
      comment: r.comment,
      tags: r.tags,
      createdAt: r.created_at,
      reviewerName: displayName(r.reviewer_id ? nameMap[r.reviewer_id] : undefined, 'A member'),
    })),
    // Averaged over the ones that HAVE a rating, not over all of them — a
    // null counted as zero would drag an honest score down.
    averageRating: rated.length > 0 ? rated.reduce((a, b) => a + b, 0) / rated.length : null,
    isVerified: !!(verifiedData as { is_verified?: boolean } | null)?.is_verified,
    isSelf: p.id === viewerId,
    isBlocked: blocked.has(p.id),
  }
}
