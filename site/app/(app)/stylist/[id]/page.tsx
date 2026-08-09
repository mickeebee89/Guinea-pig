import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient, getUser } from '@/lib/supabase-server'
import { getStylistProfile } from '@/lib/queries/stylist'
import { Avatar, EmptyState } from '@/components/ui'

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
  const user = await getUser()
  const supabase = await createSupabaseServerClient()

  const p = await getStylistProfile(supabase, id, user!.id)
  // Not found and not visible to you both land here, on purpose.
  if (!p) notFound()

  return (
    <>
      <Link href="/messages" className="text-sm font-bold text-rose hover:underline">
        ← Messages
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
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted">Offers</h2>
          <ul className="flex flex-wrap gap-2">
            {p.categories.map(c => (
              <li key={c} className="rounded-[999px] bg-soft-pink px-3 py-1 text-sm font-bold text-rose">
                {c}
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.portfolio.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted">Work</h2>
          {/* Fixed aspect ratio so an image and a video tile occupy identical
              space — no layout shift if video is ever enabled. */}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {p.portfolio.map(item => (
              <li key={item.id} className="overflow-hidden rounded-md border border-hairline bg-white">
                <div className="aspect-square">
                  {item.mediaType === 'video' ? (
                    <video src={item.mediaUrl} preload="none" playsInline controls className="h-full w-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- see above
                    <img src={item.mediaUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                  )}
                </div>
              </li>
            ))}
          </ul>
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
