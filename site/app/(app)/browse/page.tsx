import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getBrowseStylists, getCategories, type BrowseStylist } from '@/lib/queries/browse'
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
  searchParams: Promise<{ category?: string; place?: string }>
}) {
  const { category, place } = await searchParams
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  let stylists: BrowseStylist[] | null = null
  let categories: string[] = []
  try {
    ;[stylists, categories] = await Promise.all([
      getBrowseStylists(supabase, user.id, { category, place }),
      getCategories(supabase).catch(() => []),
    ])
  } catch (e) {
    console.error('[browse] load failed', e)
  }

  const qs = (next: { category?: string | undefined; place?: string | undefined }) => {
    const p = new URLSearchParams()
    const c = 'category' in next ? next.category : category
    const pl = 'place' in next ? next.place : place
    if (c) p.set('category', c)
    if (pl) p.set('place', pl)
    const s = p.toString()
    return s ? `/browse?${s}` : '/browse'
  }

  return (
    <>
      <h1 className="mb-2 font-display text-3xl text-warm-dark">Browse stylists</h1>
      <p className="mb-6 text-sm text-muted">
        Everyone here is looking for models. Applying happens in the Cavy app for now.
      </p>

      {/* A plain GET form: no JavaScript needed, and the result is a real URL
          that can be shared or bookmarked. */}
      <form action="/browse" className="mb-4 flex flex-wrap gap-2">
        {category && <input type="hidden" name="category" value={category} />}
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

      {stylists === null ? (
        <LoadError what="stylists" />
      ) : stylists.length === 0 ? (
        <EmptyState title="No stylists to show">
          {place || category
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
                  {s.location && <p className="mt-0.5 text-sm text-muted">{s.location}</p>}
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
