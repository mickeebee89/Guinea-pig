import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getApplyContext } from '@/lib/queries/apply'
import { EmptyState } from '@/components/ui'
import { IdCheckStep } from '@/components/IdCheckStep'
import { ApplyWizard } from './ApplyWizard'

export const metadata = { title: 'Apply' }

/**
 * Applying for a session, on the web. Audit item 83.
 *
 * ⚠️ DYNAMIC, NEVER CACHED. It renders a consent document, and a cached one
 * would outlive its own deactivation — rule 5 in lib/queries/consent.ts.
 */
export const dynamic = 'force-dynamic'

/**
 * ── THE GATES COME FIRST, AND THEY SAY WHICH ONE ──────────────────────────
 * Membership, then the ID check, then the booking. The database refuses
 * anything else (0049), so the only question here is whether she finds out
 * now or after filling in seven screens. It is now.
 *
 * The ID check appears HERE, inside the flow, and nowhere else: /verify still
 * refuses model accounts, because standalone "get verified" entries are what
 * produced accounts that were verified but not subscribed.
 */
export default async function ApplyPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  const ctx = await getApplyContext(supabase, id, user.id)
  if (!ctx) notFound()

  const back = (
    <Link href={`/stylist/${id}`} className="text-sm font-bold text-rose hover:underline">
      ← {ctx.provider.name}
    </Link>
  )

  // A shop that is not taking bookings. She may still be able to READ the
  // profile (0048, if she has a booking with them) — that does not mean she
  // can make a new one.
  if (!ctx.provider.isPublished) {
    return (
      <>
        {back}
        <h1 className="mb-6 mt-4 font-display text-3xl text-warm-dark">Apply</h1>
        <EmptyState title={`${ctx.provider.name} isn’t taking new bookings`}>
          You can’t apply for a session at the moment. If you already have a booking with them,
          it’s unaffected and you can still message about it.
        </EmptyState>
      </>
    )
  }

  if (!ctx.subscribed) {
    return (
      <>
        {back}
        <h1 className="mb-6 mt-4 font-display text-3xl text-warm-dark">Apply</h1>
        <section className="rounded-lg border border-hairline bg-white p-5">
          <h2 className="font-display text-xl text-warm-dark">Membership comes first</h2>
          <p className="mt-2 text-sm text-muted">
            Applying for sessions needs an active Cavy membership — £4.99 a month, cancel any
            time. Browsing and searching stay free either way.
          </p>
          <Link
            href="/subscribe"
            className="mt-5 inline-flex min-h-11 items-center rounded-[999px] bg-rose px-6 text-sm font-bold text-white"
          >
            See membership
          </Link>
          <p className="mt-4 text-xs text-muted">
            Your place isn’t held while you do this — slots are first come, first served.
          </p>
        </section>
      </>
    )
  }

  if (!ctx.verified) {
    return (
      <>
        {back}
        <h1 className="mb-6 mt-4 font-display text-3xl text-warm-dark">Apply</h1>
        <IdCheckStep check={ctx.idCheck} />
      </>
    )
  }

  if (!ctx.consent) {
    // Fails closed, and says so without blaming her.
    return (
      <>
        {back}
        <h1 className="mb-6 mt-4 font-display text-3xl text-warm-dark">Apply</h1>
        <EmptyState title="Applications are paused">{ctx.consentProblem}</EmptyState>
      </>
    )
  }

  const open = ctx.slots.filter(s => !s.isTaken)
  if (open.length === 0) {
    return (
      <>
        {back}
        <h1 className="mb-6 mt-4 font-display text-3xl text-warm-dark">Apply</h1>
        <EmptyState title="No open slots">
          {ctx.provider.name} hasn’t posted any free times for the next couple of months. Their
          profile updates as soon as they do.
        </EmptyState>
      </>
    )
  }

  return (
    <>
      {back}
      <h1 className="mb-6 mt-4 font-display text-3xl text-warm-dark">
        Apply to {ctx.provider.name}
      </h1>
      <ApplyWizard ctx={ctx} />
    </>
  )
}
