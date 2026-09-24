import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getStylistProfile } from '@/lib/queries/stylist'
import { Avatar, EmptyState } from '@/components/ui'
import { MonthCalendar, type CalendarMark } from '@/components/MonthCalendar'
import { PortfolioGallery } from '@/components/PortfolioGallery'
import { SafetyMenu } from '@/components/SafetyMenu'
import { FavouriteButton } from './FavouriteButton'

export const metadata = { title: 'Stylist' }

/**
 * A stylist's profile, for signed-in members.
 *
 * Read-only apart from the safety controls. Applying for a session is slice 3;
 * favouriting is not slice 2.
 *
 * The route takes a providers.id — the same id the conversation list carries as
 * otherPartyId for a stylist, and NOT an auth user id. That is why SafetyMenu is
 * handed `{ providerId: id }`: reports key on an auth user id, and passing this
 * one straight through would fail on a NOT NULL email-hash violation rather than
 * on anything legible. lib/report.ts does the resolving, in one place.
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
              {/* The `level` chip stood here until 24 Sep 2026. See
                  lib/queries/stylist.ts for why it is gone (item 105). */}
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
          {/* ⚠️ SAVE IS HIDDEN FOR A BLOCKED PAIR, AND THE SAFETY MENU IS NOT.
              Asking to be told when someone posts new times is meaningless
              when neither of you can book with the other — and offering it
              beside the sentence explaining the block would read as if the
              block were not real. Report and unblock stay, because those are
              the two things she might actually want here. */}
          {!p.isOwner && (
            <div className="flex items-start gap-2">
              {!p.isBlocked && (
                <FavouriteButton
                  providerId={p.id}
                  stylistName={p.name}
                  initial={p.isFavourite}
                />
              )}
              <SafetyMenu
                subject={{ providerId: id }}
                name={p.name}
                alreadyBlocked={p.isBlocked}
              />
            </div>
          )}
        </div>
      </header>

      {/* ── A SHOP THAT IS NOT LIVE ────────────────────────────────────────
          Before 0048 this page could only ever be showing a published shop —
          anything else 404'd, including for the model who had a booking with
          them (audit item 76). Now she gets the page, so it has to say why it
          looks quiet.

          It says what is true for the reader — no new bookings — and NOT why.
          "Hidden" is the stylist's business decision and "suspended" is a
          moderation outcome; publishing either to another member would be us
          disclosing something about them that they did not. The sentence is
          the same whichever it is, which is the point. */}
      {!p.isPublished && !p.isOwner && (
        <p className="mt-4 rounded-lg border border-hairline bg-input-bg px-4 py-3 text-sm text-muted">
          <span className="font-bold text-warm-dark">
            {p.name} isn’t taking new bookings at the moment.
          </span>{' '}
          You can still message them about a booking you’ve already made, and leave a review once
          it’s finished.
        </p>
      )}

      {p.isBlocked && (
        <p className="mt-4 rounded-lg border border-hairline bg-input-bg px-4 py-3 text-sm text-muted">
          You’ve blocked this person, or they’ve blocked you. You can’t message each other.
          If you blocked them, you can undo that in Settings.
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

      {/* No calendar on a shop that is not taking bookings: offering days to
          pick from, and then refusing the application, would be worse than
          not offering them. The owner still sees their own. */}
      {(p.isPublished || p.isOwner) && (
      <section className="mt-6">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted">Availability</h2>
          {/* The way in. Before 23 Sep this said applying was in the app —
              which was true, and was the whole of item 77: the web sent a
              model to an app that is in no store. */}
          {!p.isOwner && p.openDates.length > 0 && (
            <Link
              href={`/stylist/${id}/apply`}
              className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white"
            >
              Apply for a session
            </Link>
          )}
        </div>
        {p.openDates.length === 0 ? (
          <EmptyState title="No open slots">
            {p.name} hasn’t posted availability for the next couple of months.
          </EmptyState>
        ) : (
          <div className="max-w-sm">
            <MonthCalendar
              marks={p.openDates.map((d): CalendarMark => ({ date: d, kind: 'open', label: 'Slots open' }))}
              caption="Days with slots open. Pick a time on the next screen."
            />
          </div>
        )}
      </section>
      )}

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
