'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import {
  COMMENT_MAX, MODEL_SUB_RATINGS, MODEL_TAGS, STYLIST_SUB_RATINGS, STYLIST_TAGS,
  getReviewContext, type SubRatingKey,
} from '@/lib/queries/review'
import { BOOKINGS_PATH } from '@/lib/routes'

export type ReviewResult = { ok: true } | { ok: false; error: string }

export interface ReviewInput {
  overall: number
  subRatings: Partial<Record<SubRatingKey, number>>
  tags: string[]
  comment: string
}

const star = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 5

/**
 * Save a review. Audit item 70.
 *
 * The same write as mobile (leave-review.tsx:298-312): an insert into
 * `reviews` with the member's own session, so the same RLS applies —
 * "write own review for own session" (the booking must be COMPLETED and the
 * writer a participant; review-integrity.sql) and the RESTRICTIVE
 * reviews_not_suspended. The unique index on (session_id, reviewer_id) makes a
 * second review impossible.
 *
 * What the browser cannot decide: WHO is reviewed. The reviewee comes from
 * getReviewContext, which reads the booking, not from anything sent here. The
 * database doesn't check that yet — see migration 0046 — so this is, for now,
 * the only thing stopping a web review from landing on someone else.
 *
 * Ratings, tags and the comment are validated here as well as bounded by the
 * form, because a server action is callable directly.
 */
export async function leaveReview(sessionId: string, input: ReviewInput): Promise<ReviewResult> {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const ctx = await getReviewContext(supabase, sessionId, user.id)
  if (!ctx) return { ok: false, error: 'This booking isn’t one you can review.' }
  if (ctx.status !== 'completed') {
    return { ok: false, error: 'You can review a booking once the stylist has marked it complete.' }
  }
  if (ctx.alreadyReviewed) return { ok: false, error: 'You’ve already reviewed this booking.' }

  if (!star(input.overall)) return { ok: false, error: 'Choose an overall rating from one to five stars.' }

  const allowedSubs = (ctx.as === 'model' ? STYLIST_SUB_RATINGS : MODEL_SUB_RATINGS).map(s => s.key)
  const allowedTags: readonly string[] = ctx.as === 'model' ? STYLIST_TAGS : MODEL_TAGS
  const tags = [...new Set(input.tags)].filter(t => allowedTags.includes(t))
  const comment = input.comment.trim()
  if (comment.length > COMMENT_MAX) {
    return { ok: false, error: `Your comment is too long (${COMMENT_MAX} characters at most).` }
  }

  const row: Record<string, unknown> = {
    session_id: sessionId,
    reviewer_id: user.id,
    reviewee_id: ctx.revieweeUserId,
    overall_rating: input.overall,
    tags,
    comment: comment || null,
  }
  for (const key of allowedSubs) {
    const v = input.subRatings[key]
    if (v !== undefined && star(v)) row[`${key}_rating`] = v
  }

  const { error } = await supabase.from('reviews').insert(row)
  if (error) {
    console.error('[review] insert failed', { code: error.code, message: error.message })
    if (error.code === '23505') return { ok: false, error: 'You’ve already reviewed this booking.' }
    // 0046's guard: the reviewee isn't the other party. Can't happen from this
    // form, since the reviewee comes from the booking; said plainly if it does.
    if (error.code === '23514') return { ok: false, error: 'This review doesn’t match the booking, so it wasn’t posted.' }
    // RLS refusing: not completed, not a participant, or suspended.
    if (error.code === '42501') {
      return { ok: false, error: 'This review couldn’t be saved from your account. If you think that’s wrong, get in touch.' }
    }
    return { ok: false, error: 'That didn’t save. Your review hasn’t been posted — try again in a moment.' }
  }

  revalidatePath('/dashboard')
  revalidatePath(BOOKINGS_PATH)
  revalidatePath(`${BOOKINGS_PATH}/${sessionId}/review`)
  // A stylist's rating and review count change with this (the
  // recompute_provider_rating trigger), and they show on their profile, on
  // browse, and on the public cards.
  if (ctx.revieweeProviderId) {
    revalidatePath(`/stylist/${ctx.revieweeProviderId}`)
    revalidatePath('/browse')
    revalidatePath('/')
    revalidatePath('/(public)/[treatment]', 'page')
  }
  return { ok: true }
}
