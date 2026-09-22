import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import {
  MODEL_SUB_RATINGS, MODEL_TAGS, STYLIST_SUB_RATINGS, STYLIST_TAGS, getReviewContext,
} from '@/lib/queries/review'
import { BOOKINGS_PATH } from '@/lib/routes'
import { Avatar } from '@/components/ui'
import { ReviewForm } from './ReviewForm'

export const metadata = { title: 'Leave a review', robots: { index: false, follow: false } }

/**
 * Leave a review for a completed booking. Audit item 70.
 *
 * Reached from the dashboard's "Leave a review" panel and from a completed
 * booking on the bookings page. 404 for a booking that isn't yours, the same as
 * the message thread, so the address can't be used to find out whether a
 * booking exists.
 */
export default async function ReviewPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const ctx = await getReviewContext(supabase, sessionId, user.id)
  if (!ctx) notFound()

  const when = new Date(ctx.date + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
  const reviewingStylist = ctx.as === 'model'

  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-4">
        <Link href={BOOKINGS_PATH} className="text-sm font-bold text-rose hover:underline">← Bookings</Link>
      </p>
      <h1 className="mb-6 font-display text-3xl text-warm-dark">Leave a review</h1>

      <section className="mb-6 flex items-center gap-4 rounded-lg border border-hairline bg-white p-5 shadow-soft">
        <Avatar src={ctx.revieweePic} name={ctx.revieweeName} size={56} />
        <div className="min-w-0">
          <p className="font-display text-xl text-warm-dark">
            {ctx.revieweeProviderId ? (
              <Link href={`/stylist/${ctx.revieweeProviderId}`} className="hover:text-rose">{ctx.revieweeName}</Link>
            ) : ctx.revieweeName}
          </p>
          <p className="text-sm text-muted">
            {when}
            {ctx.startTime && ` · ${ctx.startTime.slice(0, 5)}`}
            {ctx.treatment && ` · ${ctx.treatment}`}
          </p>
        </div>
      </section>

      {ctx.alreadyReviewed ? (
        <section className="rounded-lg border border-hairline bg-white p-5 shadow-soft">
          <h2 className="font-display text-xl text-warm-dark">Already reviewed</h2>
          <p className="mt-1 text-sm text-muted">You’ve already left a review for this booking.</p>
        </section>
      ) : ctx.status !== 'completed' ? (
        <section className="rounded-lg border border-hairline bg-white p-5 shadow-soft">
          <h2 className="font-display text-xl text-warm-dark">Not yet</h2>
          <p className="mt-1 text-sm text-muted">
            You can review a booking once {reviewingStylist ? 'the stylist has' : 'you’ve'} marked it
            complete.
          </p>
        </section>
      ) : (
        <ReviewForm
          sessionId={ctx.sessionId}
          revieweeName={ctx.revieweeName}
          reviewingStylist={reviewingStylist}
          subRatings={reviewingStylist ? STYLIST_SUB_RATINGS : MODEL_SUB_RATINGS}
          tags={[...(reviewingStylist ? STYLIST_TAGS : MODEL_TAGS)]}
        />
      )}
    </div>
  )
}
