import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getDashboardUser } from '@/lib/queries/dashboard'
import { getInvitableModels } from '@/lib/queries/invites'
import { isStylist } from '@/lib/roles'
import { RADII, inviteRadiusFromParam } from '@/lib/distance'
import { EmptyState, LoadError } from '@/components/ui'
import { InviteCard } from './InviteCard'

export const metadata = { title: 'Models' }

/**
 * Who a stylist can invite.
 *
 * ── ⚠️ THIS PAGE CANNOT DECIDE WHO SEES IT, AND DOES NOT TRY ─────────────
 * `invitable_models` returns NOTHING unless the caller owns a provider row
 * that is published and passes provider_shop_is_publishable. So the empty
 * state below is the honest rendering of "your shop is not published", and a
 * stylist who unpublishes mid-session sees it change without this file
 * knowing anything about publication.
 *
 * The role check here is for the NAV and the heading, not for the data — and
 * it is `isStylist` from lib/roles, which is true for 'provider' AND 'both'.
 * The dashboard's `role === 'provider'` would hide this page from a 'both'
 * account that has a published shop, which is a member with a shop being told
 * she has no shop.
 *
 * ── WHAT IS SHOWN, AND WHAT IS NOT ───────────────────────────────────────
 * First name, last initial, photo, approximate distance, the look attributes
 * and her own bio. No email address, no postcode, no coordinate, no surname.
 * The distance is computed in the database and the point never leaves it.
 */
export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<{ within?: string }>
}) {
  const { within } = await searchParams
  const radius = inviteRadiusFromParam(within)

  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const me = await getDashboardUser(supabase, user.id)
  const stylist = isStylist(me.role)

  // Not a stylist at all: nothing to explain about shops, so say the plain
  // thing rather than showing her an empty list with stylist advice under it.
  if (!stylist) {
    return (
      <>
        <h1 className="mb-6 font-display text-3xl text-warm-dark">Models</h1>
        <EmptyState title="This page is for stylists">
          It’s where a stylist finds models to invite. Your side is{' '}
          <Link href="/browse" className="font-bold text-rose hover:underline">Browse</Link>.
        </EmptyState>
      </>
    )
  }

  const result = await getInvitableModels(supabase, user.id, radius.miles)

  const qs = (key: string) => (key === radius.key ? '/models' : `/models?within=${key}`)

  return (
    <>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-3xl text-warm-dark">Models</h1>
      </div>
      <p className="mb-5 max-w-2xl text-sm text-muted">
        People who have signed up looking for treatments. You can send each of them{' '}
        <span className="font-bold text-warm-dark">one invite</span>, ever — so it’s worth saying
        what you’re offering.
      </p>

      {/* ⚠️ THE FILTER IS DISABLED, NOT HIDDEN, WHEN WE CANNOT PLACE HER.
          A radius around an unknown point returns nothing by the function's
          own rule, so offering a control that silently empties the page would
          be worse than showing it greyed with a reason underneath. Same
          treatment as /browse, which hit this first. */}
      <nav aria-label="Distance" className="mb-4">
        <ul className="flex flex-wrap items-center gap-1.5">
          {RADII.map(r => (
            <li key={r.key}>
              {result?.viewerPlaced ? (
                <Link
                  href={qs(r.key)}
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
      </nav>

      {result === null ? (
        <LoadError what="models" />
      ) : !result.viewerPlaced ? (
        /* ⚠️ A SEPARATE STATE FROM "nobody found", because it has a different
           fix and a different cause. She is not seeing an empty area; we do
           not know where she is, so no distance could be worked out for
           anybody and the filter above is off. */
        <EmptyState title="We don’t know where your shop is">
          Add your postcode in{' '}
          <Link href="/settings" className="font-bold text-rose hover:underline">Settings</Link>{' '}
          and this page will show models near you, nearest first.
        </EmptyState>
      ) : result.models.length === 0 ? (
        /* ⚠️ THIS IS ALSO WHAT AN UNPUBLISHED SHOP LOOKS LIKE, and the copy
           has to carry both without claiming either. invitable_models returns
           zero rows for "your shop is not published" and for "nobody within
           15 miles", and this page genuinely cannot tell them apart — the
           gate is inside the function, which is where it belongs. So the
           empty state names both possibilities and links to the one she can
           act on. SimpliciTee sees this at every radius below 30 miles. */
        <EmptyState title="Nobody to invite just yet">
          Either there’s nobody signed up within {radius.label.toLowerCase()} of you — try widening
          it above — or your shop isn’t published yet, which is what lets you invite anyone. Your{' '}
          <Link href="/shop" className="font-bold text-rose hover:underline">shop page</Link>{' '}
          says which.
        </EmptyState>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            {/* A count of what is ON THIS PAGE, which is a fact about the
                list and not a claim about the platform. */}
            {result.models.length === 1
              ? '1 model'
              : `${result.models.length} models`}
            {radius.miles != null && ` within ${radius.label.toLowerCase()}`}, nearest first.
          </p>
          <ul className="space-y-3">
            {result.models.map(m => (
              <li key={m.id}>
                <InviteCard model={m} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
