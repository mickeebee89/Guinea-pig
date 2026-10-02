import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getSalonFloor } from '@/lib/queries/salonFloor'
import { isStylist as isStylistRole } from '@/lib/roles'
import { Avatar, EmptyState } from '@/components/ui'
import { formatMiles } from '@/lib/distance'
import { Composer } from './Composer'
import { PostActions } from './PostActions'

export const metadata = { title: 'Salon Floor' }

/** The chips, matching browse so the two read as one idea. */
const RADII = [
  { key: '5',   label: '5 miles',      miles: 5 },
  { key: '10',  label: '10 miles',     miles: 10 },
  { key: '20',  label: '20 miles',     miles: 20 },
  { key: 'any', label: 'Any distance', miles: null },
] as const

/**
 * The Salon Floor. Audit item 141.
 *
 * One wall, both roles, and the page says so where somebody is about to type.
 * A stylist posts "two spaces free Thursday"; a model posts "after a cut this
 * week". Nobody is listed here because they exist — only because they posted.
 */
export default async function SalonFloorPage({
  searchParams,
}: {
  searchParams: Promise<{ within?: string }>
}) {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()
  const sp = await searchParams

  const chosen = RADII.find(r => r.key === (sp.within ?? '20')) ?? RADII[2]
  // Same source and same default as the layout: a failed role read falls back
  // to the MODEL shape, because showing a model a stylist's control is worse
  // than the reverse — the invite button would refuse her anyway.
  const [feed, { data: me }] = await Promise.all([
    getSalonFloor(supabase, user.id, chosen.miles),
    supabase.from('users').select('role').eq('id', user.id).maybeSingle(),
  ])
  const isProvider = isStylistRole((me as { role: string } | null)?.role ?? '')

  const qs = (within: string) => `/salon-floor?within=${within}`

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col">
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
        <h1 className="font-display text-3xl text-warm-dark">‘Salon Floor’</h1>
        <p className="mt-1 text-sm text-muted">
          Who’s free and who’s after something, near you. Posts go after 48 hours.
        </p>

        <nav aria-label="Distance" className="mt-4">
          <ul className="flex flex-wrap gap-2">
            {RADII.map(r => {
              const on = r.key === chosen.key
              return (
                <li key={r.key}>
                  <Link
                    href={qs(r.key)}
                    aria-current={on ? 'true' : undefined}
                    className={`inline-flex min-h-11 items-center rounded-[999px] px-4 text-sm font-bold ${
                      on ? 'bg-rose text-white' : 'bg-input-bg text-muted hover:text-warm-dark'}`}
                  >
                    {r.label}
                  </Link>
                </li>
              )
            })}
          </ul>
          {/* ⚠️ SAYS WHAT IS TRUE OF THE COUNT, WHICH IS NOT WHAT THE OLD COPY
              SAID. unplaceableHidden counts everyone the RADIUS removed — most
              of whom have a location and are simply further away. The wording
              here used to assert they had not shared one, which is a claim
              about somebody else's behaviour and was false for nearly all of
              them. Item 130's neighbour, fixed 2 Oct 2026. */}
          {feed.viewerHasLocation && feed.unplaceableHidden > 0 && (
            <p className="mt-2 text-xs text-muted">
              {feed.unplaceableHidden === 1
                ? 'One post isn’t shown at this distance.'
                : `${feed.unplaceableHidden} posts aren’t shown at this distance.`}{' '}
              Choose <span className="font-bold">Any distance</span> to include them.
            </p>
          )}
          {!feed.viewerHasLocation && (
            <p className="mt-2 text-xs text-muted">
              Add a postcode in{' '}
              <Link href="/settings" className="font-bold text-rose hover:underline">Settings</Link>{' '}
              and we can sort this by how near people are.
            </p>
          )}
        </nav>

        {feed.posts.length === 0 ? (
          <div className="mt-6">
            <EmptyState title="Nothing on the floor yet">
              Be the first — say what you’re free for, or what you’re after.
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {feed.posts.map(p => (
              <li key={p.id} className="rounded-lg border border-hairline bg-white p-4 shadow-soft">
                <div className="flex items-start gap-3">
                  <Avatar src={p.authorAvatar} name={p.authorName} size={40} />
                  <div className="min-w-0 flex-1">
                    {/* Avatar and name only. A post is a thing somebody said,
                        not a profile card — nothing else about them belongs
                        on the wall itself. */}
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-bold text-warm-dark">{p.authorName}</span>
                      {p.distanceMiles != null && (
                        <span className="text-xs text-muted">{formatMiles(p.distanceMiles)}</span>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm text-warm-dark">{p.body}</p>
                    <PostActions
                      postId={p.id}
                      authorUserId={p.authorUserId}
                      authorName={p.authorName}
                      providerId={p.providerId}
                      isMine={p.isMine}
                      viewerIsProvider={isProvider}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Composer isProvider={isProvider} />
    </div>
  )
}
