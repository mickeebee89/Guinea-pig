import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getStylistProfile } from '@/lib/queries/stylist'
import { Avatar, EmptyState } from '@/components/ui'
import { MonthCalendar, type CalendarMark } from '@/components/MonthCalendar'
import { PortfolioGallery } from '@/components/PortfolioGallery'

export const metadata = { title: 'Stylist' }

/**
 * A stylist's profile, for signed-in members.
 *
 * Read-only. Applying for a session is slice 3; favouriting is not slice 2.
 * The route takes a providers.id — the same id the conversation list carries as
 * otherPartyId for a stylist, and NOT an auth user id.
 */
export default async function StylistPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const p = await getStylistProfile(supabase, id, user.id)
  // Not found and not visible to you both land here, on purpose.
  if (!p) notFound()

  return (
    <>
      {/* A stylist reaching their own shop came from the dashboard, not from a
          conversation with themselves. */}
      <Link
        href={p.isOwner ? '/dashboard' : '/messages'}
        className="text-sm font-bold text-rose hover:underline"
      >
        ← {p.isOwner ? 'Dashboard' : 'Messages'}
      </Link>

      <header className="mt-4 overflow-hidden rounded-lg border border-hairline bg-white shadow-soft">
        {p.bannerUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage, unknown dimensions
          <img src={p.bannerUrl} alt="" className="h-32 w-full object-cover sm:h-44" />
        )}
        <div className="flex flex-wrap items-start gap-4 p-5">
          <Avatar src={p.avatarUrl} name={p.name} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl text-warm-dark">{p.name}</h1>
              {p.isVerified && (
                <span className="inline-flex items-center rounded-[999px] bg-soft-pink px-2.5 py-0.5 text-xs font-bold text-rose">
                  Verified
                </span>
              )}
              {p.level && (
                <span className="inline-flex items-center rounded-[999px] bg-input-bg px-2.5 py-0.5 text-xs font-bold text-muted">
                  {p.level}
                </span>
              )}
            </div>
            {p.location && <p className="mt-1 text-sm text-muted">{p.location}</p>}
            {/* Only claim a rating when there is one behind it. A 0 shown as a
                score reads as a bad stylist rather than a new one. */}
            {p.reviewCount > 0 && p.rating != null && (
              <p className="mt-1 text-sm text-warm-dark">
                <span className="font-bold">{p.rating.toFixed(1)}</span>
                <span className="text-muted"> · {p.reviewCount} review{p.reviewCount === 1 ? '' : 's'}</span>
              </p>
            )}
          </div>
        </div>
      </header>

      {p.isBlocked && (
        <p className="mt-4 rounded-lg border border-hairline bg-input-bg px-4 py-3 text-sm text-muted">
          You’ve blocked this person, or they’ve blocked you. You can’t message each other.
          Unblocking is in settings in the app.
        </p>
      )}

      {p.bio && (
        <section className="mt-6">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted">About</h2>
          <p className="whitespace-pre-wrap rounded-lg border border-hairline bg-white p-4 text-sm text-warm-dark">
            {p.bio}
          </p>
        </section>
      )}

      {p.categories.length > 0 && (
        <section className="mt-6">
          {/* Written from the stylist's side, so it has to change person when
              someone else is reading it — "Treatments I do" on a stranger's
              profile would read as the viewer's own. */}
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted">
            {p.isOwner ? 'Treatments I do' : 'Treatments they do'}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {p.categories.map(c => (
              <li key={c} className="rounded-[999px] bg-soft-pink px-3 py-1 text-sm font-bold text-rose">
                {c}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted">Availability</h2>
        {p.openDates.length === 0 ? (
          <EmptyState title="No open slots">
            {p.name} hasn’t posted availability for the next couple of months.
          </EmptyState>
        ) : (
          <div className="max-w-sm">
            <MonthCalendar
              marks={p.openDates.map((d): CalendarMark => ({ date: d, kind: 'open', label: 'Slots open' }))}
              caption="Days with slots open. Picking one and applying is in the Cavy app for now."
            />
          </div>
        )}
      </section>

      {(p.portfolio.length > 0 || p.pendingPortfolio.length > 0) && (
        <section className="mt-6">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted">Work</h2>
            {p.isOwner && (
              <Link href="/portfolio" className="text-sm font-bold text-rose hover:underline">
                Manage portfolio
              </Link>
            )}
          </div>
          {/* Fixed aspect ratio so an image and a video tile occupy identical
              space — no layout shift if video is ever enabled. */}
          {p.portfolio.length > 0 && <PortfolioGallery items={p.portfolio} stylistName={p.name} />}

          {p.pendingPortfolio.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs text-muted">
                Waiting to be reviewed — only you can see these. They appear on your profile once
                approved.
              </p>
              <div className="opacity-60">
                <PortfolioGallery items={p.pendingPortfolio} stylistName={p.name} />
              </div>
            </div>
          )}
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted">Reviews</h2>
        {p.reviews.length === 0 ? (
          <EmptyState title="No reviews yet">
            Reviews appear here once a treatment has been completed.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {p.reviews.map(r => (
              <li key={r.id} className="rounded-lg border border-hairline bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-warm-dark">{r.reviewerName}</span>
                  {r.rating != null && (
                    <span className="text-sm text-muted" aria-label={`${r.rating} out of 5`}>
                      {'★'.repeat(r.rating)}{'☆'.repeat(Math.max(0, 5 - r.rating))}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted">
                    {new Date(r.createdAt).toLocaleDateString('en-GB', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                  </span>
                </div>
                {r.comment && <p className="mt-2 text-sm text-warm-dark/90">{r.comment}</p>}
                {r.tags && r.tags.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {r.tags.map(t => (
                      <li key={t} className="rounded-[999px] bg-input-bg px-2 py-0.5 text-xs text-muted">{t}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
