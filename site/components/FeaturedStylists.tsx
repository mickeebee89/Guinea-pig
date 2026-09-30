import Image from 'next/image'
import { supabase, type PublicStylist } from '@/lib/supabase-public'
import { BuildQueryError, onQueryFailure } from '@/lib/query-failure'

/**
 * Renders nothing at all when there is nothing to show.
 *
 * That is the normal state right now, not an edge case: the public_* views may
 * not exist yet, and the content bar in public_stylists (published, real bio,
 * at least one category, not seed data) means the result is legitimately empty
 * pre-launch. The homepage has to ship either way, so every failure mode —
 * missing view, RLS refusal, network error, empty result — collapses to the
 * same silent null rather than an error boundary.
 *
 * Deliberately NOT the `if (data)` pattern this codebase got bitten by before
 * (see scripts/check-queries.mjs): the error is logged, so a broken query is
 * visible in the server log instead of silently rendering as "no stylists".
 *
 * ⚠️ "VISIBLE IN THE SERVER LOG" WAS NOT ENOUGH. This component used to hold
 * its OWN copy of that rule, beside lib/stylists.ts's `safeList`, which held a
 * longer comment describing the same risk. Two copies of a rule is two places
 * to fix and one place to forget — and when item 131 revoked a grant the whole
 * public view depended on, the homepage's strip went silently empty alongside
 * the six treatment pages. Both now call the one helper, which throws during a
 * build rather than prerender a homepage claiming nobody has joined.
 */
export async function FeaturedStylists() {
  let stylists: PublicStylist[] = []

  try {
    const { data, error } = await supabase
      .from('public_stylists')
      .select('id, slug, name, location, categories, rating, review_count, is_verified, profile_pic_url')
      .order('review_count', { ascending: false })
      .limit(6)

    if (error) {
      onQueryFailure('FeaturedStylists', error.message)
      return null
    }
    stylists = (data ?? []) as PublicStylist[]
  } catch (err) {
    // Ours goes up; a network failure still renders nothing. See safeList.
    if (err instanceof BuildQueryError) throw err
    onQueryFailure('FeaturedStylists', String(err))
    return null
  }

  if (stylists.length === 0) return null

  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="font-display text-3xl text-warm-dark">Stylists already on Cavy</h2>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stylists.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-4 rounded-lg border border-hairline bg-white p-4 shadow-[var(--shadow-soft)]"
          >
            {s.profile_pic_url ? (
              <Image
                src={s.profile_pic_url}
                alt=""
                width={56}
                height={56}
                className="size-14 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="grid size-14 shrink-0 place-items-center rounded-full bg-soft-pink font-display text-xl text-rose">
                {s.name.charAt(0)}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate font-display text-lg text-warm-dark">{s.name}</p>
              {s.location && <p className="truncate text-sm text-muted">{s.location}</p>}
              {s.categories.length > 0 && (
                <p className="mt-1 truncate text-xs text-rose">{s.categories.join(' · ')}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
