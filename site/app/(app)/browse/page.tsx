import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getBrowseStylists, getCategories, type BrowseResult } from '@/lib/queries/browse'
import { RADII, radiusFromParam, formatMiles } from '@/lib/distance'
import { getDashboardUser } from '@/lib/queries/dashboard'
import { isModel as isModelRole } from '@/lib/roles'
import { Avatar, EmptyState, LoadError } from '@/components/ui'

export const metadata = { title: 'Browse stylists' }

/**
 * Browse. Deliberately NOT distance-sorted yet.
 *
 * A web-only account has no coordinates, and that is the normal state for
 * anyone who never installs the app — so this has to be useful with none.
 * Filtering is by treatment and by the stylist's own words for where they are.
 * Distance lands later as an enhancement, and the place box stays.
 *
 * Filters live in the URL: a search is linkable, the back button works, and
 * the server renders results rather than flashing an empty list.
 */
export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; place?: string; within?: string }>
}) {
  const { category, place, within } = await searchParams
  const radius = radiusFromParam(within)
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  // Mirrors /availability, which tells a model the same thing in reverse.
  //
  // AppNav already hides this link from stylists, but a hidden link is not a
  // gate: the page loaded and worked for anyone signed in, so a stylist who
  // typed the URL got a list of stylists to book — including themselves. Saying
  // whose page this is beats relying on nobody finding it.
  const me = await getDashboardUser(supabase, user.id)
  // isModel rather than `role !== 'provider'`: identical today, and it stays
  // correct if a fourth role ever appears. A 'both' account browses (item 116).
  if (!isModelRole(me.role)) {
    return (
      <>
        <h1 className="mb-6 font-display text-3xl text-warm-dark">Browse stylists</h1>
        <EmptyState title="This is for model accounts">
          Browsing is how models find a stylist to apply to. Your account is a stylist — this is
          the page models will find <em>you</em> on once your shop is live.
          {' '}Finding models to invite is in the Cavy app for now.
        </EmptyState>
      </>
    )
  }

  let result: BrowseResult | null = null
  let categories: string[] = []
  try {
    ;[result, categories] = await Promise.all([
      getBrowseStylists(supabase, user.id, { category, place, within: radius.miles }),
      getCategories(supabase).catch(() => []),
    ])
  } catch (e) {
    console.error('[browse] load failed', e)
  }

  const qs = (next: {
    category?: string | undefined
    place?: string | undefined
    within?: string | undefined
  }) => {
    const p = new URLSearchParams()
    const c = 'category' in next ? next.category : category
    const pl = 'place' in next ? next.place : place
    // The radius is carried through every other control, so choosing a
    // treatment does not silently throw away a distance she picked.
    const w = 'within' in next ? next.within : within
    if (c) p.set('category', c)
    if (pl) p.set('place', pl)
    if (w) p.set('within', w)
    const s = p.toString()
    return s ? `/browse?${s}` : '/browse'
  }

  const stylists = result?.items ?? null

  return (
    <>
      <h1 className="mb-2 font-display text-3xl text-warm-dark">Browse stylists</h1>
      <p className="mb-6 text-sm text-muted">
        Everyone here is looking for models. Open a stylist to see their times and apply.
      </p>

      {/* A plain GET form: no JavaScript needed, and the result is a real URL
          that can be shared or bookmarked. */}
      <form action="/browse" className="mb-4 flex flex-wrap gap-2">
        {category && <input type="hidden" name="category" value={category} />}
        {/* A plain GET form replaces the whole query string, so anything not
            named here is lost on submit. That is how a chosen distance
            silently resets the moment she searches for a town. */}
        {within && <input type="hidden" name="within" value={within} />}
        <label htmlFor="place" className="sr-only">Town, city or area</label>
        <input
          id="place"
          name="place"
          defaultValue={place ?? ''}
          placeholder="Town, city or area — e.g. Bromley"
          className="min-h-11 flex-1 rounded-md border border-hairline bg-white px-3 text-sm text-warm-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
        />
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white hover:bg-rose-dark"
        >
          Search
        </button>
        {place && (
          <Link
            href={qs({ place: undefined })}
            className="inline-flex min-h-11 items-center rounded-[999px] bg-input-bg px-4 text-sm font-bold text-muted"
          >
            Clear
          </Link>
        )}
      </form>

      {categories.length > 0 && (
        <nav aria-label="Treatment" className="mb-6">
          <ul className="flex flex-wrap gap-1.5">
            <li>
              <Link
                href={qs({ category: undefined })}
                aria-current={!category ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center rounded-[999px] px-3 text-sm font-bold ${
                  !category ? 'bg-rose text-white' : 'bg-input-bg text-muted hover:bg-soft-pink'
                }`}
              >
                All
              </Link>
            </li>
            {categories.map(c => (
              <li key={c}>
                <Link
                  href={qs({ category: c })}
                  aria-current={c === category ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center rounded-[999px] px-3 text-sm font-bold ${
                    c === category ? 'bg-rose text-white' : 'bg-input-bg text-muted hover:bg-soft-pink'
                  }`}
                >
                  {c}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/* ⚠️ DISABLED, NOT HIDDEN, WHEN WE CANNOT PLACE HER.
          Hiding it would mean a model who has set a postcode and one who has
          not see different pages with no explanation of why. Disabled plus the
          sentence underneath says what is missing and how to fix it — and a
          control that looks live and does nothing is the exact failure the
          updates feed shipped with (item 90). */}
      {result && (
        <nav aria-label="Distance" className="mb-4">
          <ul className="flex flex-wrap items-center gap-1.5">
            {RADII.map(r => (
              <li key={r.key}>
                {result.viewerHasLocation ? (
                  <Link
                    href={qs({ within: r.key === 'any' ? undefined : r.key })}
                    aria-current={r.key === radius.key ? 'page' : undefined}
                    className={`inline-flex min-h-11 items-center rounded-[999px] px-3 text-sm font-bold ${
                      r.key === radius.key ? 'bg-rose text-white' : 'bg-input-bg text-muted hover:bg-soft-pink'
                    }`}
                  >
                    {r.label}
                  </Link>
                ) : (
                  <span
                    aria-disabled="true"
                    className="inline-flex min-h-11 cursor-not-allowed items-center rounded-[999px] bg-input-bg px-3 text-sm font-bold text-border"
                  >
                    {r.label}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {!result.viewerHasLocation && (
            <p className="mt-2 text-xs text-muted">
              We don’t know where you are, so these aren’t sorted by distance.{' '}
              <Link href="/settings" className="font-bold text-rose hover:underline">
                Add your postcode
              </Link>{' '}
              and they will be. Searching by town works either way.
            </p>
          )}

          {/* Said out loud. A list shortened in silence and a list with nothing
              in it look identical, and only one is worth widening for. */}
          {result.viewerHasLocation && result.unplaceableHidden > 0 && (
            <p className="mt-2 text-xs text-muted">
              {result.unplaceableHidden === 1
                ? 'One stylist hasn’t told us where they are, so they’re not shown at this distance.'
                : `${result.unplaceableHidden} stylists haven’t told us where they are, so they’re not shown at this distance.`}{' '}
              Choose <span className="font-bold">Any distance</span> to include them.
            </p>
          )}
        </nav>
      )}

      {stylists === null ? (
        <LoadError what="stylists" />
      ) : stylists.length === 0 ? (
        <EmptyState title="No stylists to show">
          {/* radiusApplied, not radius.miles. They differ exactly when we
              cannot place her, and telling someone her search was limited to
              20 miles when it never was sends her to fix the wrong thing. */}
          {result?.radiusApplied
            ? `Nothing matches within ${result.radiusApplied} miles. Try a wider distance, or clear the other filters — Cavy is new, so there aren’t many stylists on it so far.`
            : place || category
              ? 'Nothing matches that yet. Try clearing the filters — Cavy is new, so there aren’t many stylists on it so far.'
              : 'No stylists have published a shop yet. Cavy is new — this fills up as stylists join.'}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {stylists.map(s => (
            <li key={s.id}>
              <Link
                href={`/stylist/${s.id}`}
                className="flex items-start gap-4 rounded-lg border border-hairline bg-white p-4 shadow-soft transition-colors hover:border-rose/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
              >
                <Avatar src={s.avatarUrl} name={s.name} size={56} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-warm-dark">{s.name}</span>
                    {s.isVerified && (
                      <span className="rounded-[999px] bg-soft-pink px-2 py-0.5 text-xs font-bold text-rose">
                        Verified
                      </span>
                    )}
                    {s.hasOpenSlots && (
                      <span className="rounded-[999px] bg-rose px-2 py-0.5 text-xs font-bold text-white">
                        Slots open
                      </span>
                    )}
                  </div>
                  {/* Her own words for the area, then how far that is. The
                      area is what she wrote; the distance is what we worked
                      out, and it only appears when we actually know it. */}
                  {(s.location || s.distanceMiles != null) && (
                    <p className="mt-0.5 text-sm text-muted">
                      {s.location}
                      {s.location && s.distanceMiles != null && ' · '}
                      {s.distanceMiles != null && (
                        <span className="font-bold text-warm-dark">{formatMiles(s.distanceMiles)}</span>
                      )}
                    </p>
                  )}
                  {/* Only claim a rating when reviews sit behind it — a 0 reads
                      as a bad stylist rather than a new one. */}
                  {s.reviewCount > 0 && s.rating != null && (
                    <p className="mt-0.5 text-sm text-warm-dark">
                      <span className="font-bold">{s.rating.toFixed(1)}</span>
                      <span className="text-muted"> · {s.reviewCount} review{s.reviewCount === 1 ? '' : 's'}</span>
                    </p>
                  )}
                  {s.bio && <p className="mt-1 line-clamp-2 text-sm text-muted">{s.bio}</p>}
                  {s.categories.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {s.categories.map(c => (
                        <li key={c} className="rounded-[999px] bg-input-bg px-2 py-0.5 text-xs font-bold text-muted">
                          {c}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
