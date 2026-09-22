import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Leaving a review on the web. Both sides of a COMPLETED booking can review
 * each other, as on mobile (mobile/src/app/(app)/leave-review.tsx): a model
 * reviews the stylist, and the stylist reviews the model.
 *
 * ── THE SAME FIELDS AS MOBILE, AND WHY SOME OF MOBILE'S AREN'T HERE ─────────
 * `reviews` has four sub-rating columns: quality, friendliness, comfort and
 * punctuality. Reviewing a STYLIST uses all four, as mobile does. Reviewing a
 * MODEL, mobile shows four (punctuality, communication, suitability,
 * receptiveness) but can only store punctuality: there are no columns for the
 * other three, so mobile silently drops them. The web shows only what is
 * actually saved.
 *
 * ⚠️ The tag lists are a SECOND COPY of mobile's (leave-review.tsx:28-44).
 * Change them together, or the two clients offer different words for the
 * same review.
 */
export const STYLIST_TAGS = [
  'So friendly',
  'Great results',
  'Lovely space',
  'Patient with me',
  'Pro-level work',
  'Made me feel welcome',
] as const

export const MODEL_TAGS = [
  'On time',
  'Easy to communicate with',
  'Well-prepared',
  'Receptive to direction',
  'Professional attitude',
  'Great to work with',
] as const

export type SubRatingKey = 'quality' | 'friendliness' | 'comfort' | 'punctuality'

export const STYLIST_SUB_RATINGS: { key: SubRatingKey; label: string }[] = [
  { key: 'quality', label: 'Quality' },
  { key: 'friendliness', label: 'Friendliness' },
  { key: 'comfort', label: 'Comfort' },
  { key: 'punctuality', label: 'Punctuality' },
]

export const MODEL_SUB_RATINGS: { key: SubRatingKey; label: string }[] = [
  { key: 'punctuality', label: 'Punctuality' },
]

/** Mobile's words for each star (leave-review.tsx:60-67), without the "!". */
export const RATING_LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'] as const

/** Comments are free text shown to other members. Mobile sets no limit. */
export const COMMENT_MAX = 1000

export interface ReviewContext {
  sessionId: string
  status: string
  /** Who is writing: the booking's model, or its stylist. */
  as: 'model' | 'stylist'
  /** The auth user id being reviewed — derived from the booking, never supplied. */
  revieweeUserId: string
  revieweeName: string
  revieweePic: string | null
  /** providers.id when the reviewee is a stylist, for a link to their profile. */
  revieweeProviderId: string | null
  date: string
  startTime: string | null
  treatment: string | null
  alreadyReviewed: boolean
}

/**
 * Everything the review page needs, or null when this booking isn't the
 * caller's (or doesn't exist). The caller 404s on null either way, so it can't
 * be used to probe for bookings.
 *
 * The reviewee is worked out HERE, from the booking, and the server action uses
 * this same function. Nothing the browser sends decides who is reviewed.
 */
export async function getReviewContext(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
): Promise<ReviewContext | null> {
  const { data: s } = await supabase
    .from('sessions')
    .select('id, provider_id, model_user_id, date, start_time, treatment_id, status')
    .eq('id', sessionId)
    .maybeSingle()
  const session = s as {
    id: string; provider_id: string; model_user_id: string
    date: string; start_time: string | null; treatment_id: string | null; status: string
  } | null
  if (!session) return null

  const { data: p } = await supabase
    .from('providers').select('id, user_id, name, profile_pic_url').eq('id', session.provider_id).maybeSingle()
  const prov = p as { id: string; user_id: string | null; name: string | null; profile_pic_url: string | null } | null

  const isModel = session.model_user_id === userId
  const isStylist = !!prov?.user_id && prov.user_id === userId
  if (!isModel && !isStylist) return null

  const [treatRes, modelRes, existingRes] = await Promise.all([
    session.treatment_id
      ? supabase.from('provider_treatments').select('name, category').eq('id', session.treatment_id).maybeSingle()
      : Promise.resolve({ data: null }),
    isModel
      ? Promise.resolve({ data: null })
      : supabase.from('public_profiles').select('first_name, last_initial, profile_pic_url').eq('id', session.model_user_id).maybeSingle(),
    supabase.from('reviews').select('id').eq('session_id', sessionId).eq('reviewer_id', userId).maybeSingle(),
  ])

  const treat = treatRes.data as { name: string | null; category: string | null } | null
  const model = modelRes.data as { first_name: string | null; last_initial: string | null; profile_pic_url: string | null } | null

  if (isModel && !prov?.user_id) return null   // a stylist with no account behind it: nobody to review

  return {
    sessionId,
    status: session.status,
    as: isModel ? 'model' : 'stylist',
    revieweeUserId: isModel ? prov!.user_id! : session.model_user_id,
    revieweeName: isModel
      ? (prov?.name?.trim() || 'Your stylist')
      : `${model?.first_name ?? 'Your model'}${model?.last_initial ? ` ${model.last_initial}.` : ''}`,
    revieweePic: isModel ? (prov?.profile_pic_url ?? null) : (model?.profile_pic_url ?? null),
    revieweeProviderId: isModel ? (prov?.id ?? null) : null,
    date: session.date,
    startTime: session.start_time,
    treatment: treat?.name?.trim() || treat?.category || null,
    alreadyReviewed: !!existingRes.data,
  }
}
