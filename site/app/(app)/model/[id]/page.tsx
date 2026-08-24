import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getModelProfile } from '@/lib/queries/model'
import { Avatar, EmptyState } from '@/components/ui'
import { SafetyMenu } from '@/components/SafetyMenu'

export const metadata = { title: 'Model' }

/**
 * A model's profile, for signed-in members.
 *
 * The route takes an AUTH USER ID — not a `providers.id`, which is what
 * `/stylist/[id]` takes. A model has no provider row, so the two profile routes
 * on this site will always take different kinds of id. That is exactly why
 * `SafetyMenu` receives a tagged `{ userId }` rather than a bare string.
 *
 * ── WHY THIS PAGE EXISTS ──────────────────────────────────────────────────
 * Report and block were only reachable from inside a chat. Moving them onto
 * profile screens closed that for models looking at stylists — and would have
 * left a stylist on the web with nowhere to report a model from, because the
 * web had no model profile at all. Closing three surfaces and leaving the
 * fourth would have relocated the gap rather than closed it.
 */
export default async function ModelPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const m = await getModelProfile(supabase, id, user.id)
  if (!m) notFound()

  const photosByCategory = m.categories
    .map(c => ({ category: c, photos: m.photos.filter(p => p.categoryId === c.id) }))
    .filter(g => g.photos.length > 0)
  const uncategorised = m.photos.filter(p => !p.categoryId || !m.categories.some(c => c.id === p.categoryId))

  return (
    <>
      <Link href="/messages" className="text-sm font-bold text-rose hover:underline">
        ← Messages
      </Link>

      <header className="mt-4 rounded-lg border border-hairline bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar src={m.avatarUrl} name={m.name} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl text-warm-dark">{m.name}</h1>
            {m.instagram && (
              <p className="mt-1 text-sm text-muted">@{m.instagram.replace(/^@/, '')}</p>
            )}
          </div>
          {/* Reporting must not depend on having a booking, and must not depend
              on the other account still being live. Hidden only on your own
              profile, where it would mean nothing. */}
          {!m.isSelf && (
            <SafetyMenu subject={{ userId: m.userId }} name={m.name} alreadyBlocked={m.isBlocked} />
          )}
        </div>

        {m.bio && <p className="mt-4 whitespace-pre-line text-sm text-warm-dark">{m.bio}</p>}
      </header>

      {m.isBlocked && (
        <p className="mt-4 rounded-lg border border-hairline bg-input-bg px-4 py-3 text-sm text-muted">
          You’ve blocked this person, or they’ve blocked you. You can’t message each other.
          If you blocked them, you can undo that in Settings.
        </p>
      )}

      {m.attributes.length > 0 && (
        <section className="mt-4 rounded-lg border border-hairline bg-white p-5 shadow-soft">
          <h2 className="font-display text-lg text-warm-dark">Details</h2>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {m.attributes.map(a => (
              <div key={a.label} className="flex justify-between gap-4 border-b border-hairline py-1.5">
                <dt className="text-sm text-muted">{a.label}</dt>
                <dd className="text-sm font-bold text-warm-dark">{a.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {m.photos.length > 0 ? (
        <section className="mt-4 rounded-lg border border-hairline bg-white p-5 shadow-soft">
          <h2 className="font-display text-lg text-warm-dark">Photos</h2>
          {photosByCategory.map(g => (
            <div key={g.category.id} className="mt-4">
              <h3 className="text-sm font-bold text-muted">{g.category.name}</h3>
              <PhotoGrid photos={g.photos} />
            </div>
          ))}
          {uncategorised.length > 0 && (
            <div className="mt-4">
              {photosByCategory.length > 0 && (
                <h3 className="text-sm font-bold text-muted">Other</h3>
              )}
              <PhotoGrid photos={uncategorised} />
            </div>
          )}
        </section>
      ) : (
        <div className="mt-4">
          <EmptyState title="No photos yet">
            This model hasn’t added any photos.
          </EmptyState>
        </div>
      )}
    </>
  )
}

function PhotoGrid({ photos }: { photos: { id: string; url: string; caption: string | null }[] }) {
  return (
    <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {photos.map(p => (
        <li key={p.id} className="overflow-hidden rounded-md border border-hairline">
          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage, unknown dimensions */}
          <img src={p.url} alt={p.caption ?? ''} className="h-40 w-full object-cover" />
          {p.caption && <p className="px-2 py-1 text-xs text-muted">{p.caption}</p>}
        </li>
      ))}
    </ul>
  )
}
