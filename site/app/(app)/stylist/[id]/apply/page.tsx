import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { applyReturnTo } from '@/lib/return-to'
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
 * ── THE GATES COME FIRST, AND THEY SAY WHICH ONE ──────────────────────
 * The only question here is whether she finds out now or after filling in
 * seven screens. It is now.
 *
 * ── ⚠️ THE ORDER REVERSED ON 6 Nov 2026. MEMBERSHIP IS LAST NOW. ────────
 * It was membership, then the ID check, then the booking — and the ID check
 * appeared HERE and nowhere else, because standalone "get verified" entries
 * had produced accounts that were verified but not subscribed.
 *
 * That was a real problem when it was written. It is not the problem now. The
 * ID check lives on /verify for both roles and can be done from signup, so a
 * verified-but-unsubscribed account is the warmest lead on the platform rather
 * than a dead end. £4.99 is now the last thing asked, of someone who has
 * already done everything else, instead of the first thing asked of a stranger.
 *
 * ⚠️ THIS REMOVES AN OBSTACLE BEFORE ANYONE REACHES IT. IT DOES NOT RECOVER
 * LOST CONVERSIONS AND MUST NOT BE DESCRIBED AS DOING SO. Thirty days to
 * 6 Nov 2026: 1,180 homepage visitors, 279 reached /sign-up, 107 reached a
 * dashboard, 43 browsed, 32 opened a stylist, 1 reached the apply flow — with
 * 7 pageviews against that 1 visitor, which is testing. /subscribe has had 2
 * visitors ever. All 55 real model accounts are unverified and unsubscribed
 * because none of them has been asked, not because any refused. The gain is
 * that a new model has something to do on day one.
 *
 * ⚠️ NO GATE IS REMOVED OR WEAKENED — ONLY THE ORDER CHANGES. All three still
 * apply, actions.ts re-checks all three in the SAME order, and the database
 * refuses anything else either way: tg_session_apply_gate (0049) wants both
 * halves and does not care which came first, so this needed no migration.
 *
 * ⚠️ "No open slots" sits ABOVE the membership wall on purpose. Membership is
 * the last GATE, not literally the last screen — asking £4.99 of someone whose
 * chosen stylist has nothing bookable is the wrong order whichever way the
 * gates run.
 */
export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  /**
   * ⚠️ READ ONLY TO BUILD THE RETURN PATH. The wizard itself takes its state from
   * the URL on the CLIENT (`useSearchParams`); this server component never
   * interprets step/date/slot, it just carries them so a member who hits the
   * membership wall comes back to the slot she chose rather than to step 1.
   */
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()

  /**
   * The wizard's own query string, rebuilt from what arrived. Array values take
   * their first entry — a repeated `?slot=` is not a shape this app produces, and
   * picking one beats carrying both into a link.
   */
  const qs = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      v === undefined ? [] : [[k, Array.isArray(v) ? (v[0] ?? '') : v]] as [string, string][],
    ),
  ).toString()

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

  // Before the gates, because it is not a thing she can fix by paying.
  if (ctx.isBlocked) {
    return (
      <>
        {back}
        <h1 className="mb-6 mt-4 font-display text-3xl text-warm-dark">Apply</h1>
        <EmptyState title="You can’t book with each other">
          You’ve blocked this stylist, or they’ve blocked you. You can undo a block you made in
          Settings.
        </EmptyState>
      </>
    )
  }

  // ⚠️ FIRST GATE SINCE 6 Nov 2026, and she will usually have cleared it on
  // /verify long before reaching this page. It stays here because a gate is a
  // gate wherever she arrives from.
  if (!ctx.verified) {
    return (
      <>
        {back}
        <h1 className="mb-6 mt-4 font-display text-3xl text-warm-dark">Apply</h1>
        {/* surface="apply" says "come back to your application"; the same
            component on /verify says "come back here". */}
        <IdCheckStep
          check={ctx.idCheck}
          hasProfilePic={ctx.hasProfilePic}
          surface="apply"
          photoHref="/profile"
        />
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

  // ⚠️ LAST GATE SINCE 6 Nov 2026, AND THAT IS THE WHOLE CHANGE. Someone who
  // arrives verified, consented, and with a slot available to take sees this
  // and nothing else.
  if (!ctx.subscribed) {
    return (
      <>
        {back}
        <h1 className="mb-6 mt-4 font-display text-3xl text-warm-dark">Apply</h1>
        <section className="rounded-lg border border-hairline bg-white p-5">
          <h2 className="font-display text-xl text-warm-dark">One last thing: membership</h2>
          <p className="mt-2 text-sm text-muted">
            Applying for sessions needs an active Cavy membership — £4.99 a month, cancel any
            time. Browsing and searching stay free either way.
          </p>
          {/*
            ⚠⚠ THE RETURN PATH. Without it she pays, lands on a success panel, and
            has to find her way back to a slot she chose minutes ago — and 186's
            whole point is that she chose it BEFORE paying.

            The wall RENDERS rather than redirecting, so this page's own URL
            already holds step/date/slot; `applyReturnTo` just carries it across
            to /subscribe. ⚠️ It is validated THERE, not here: a value this page
            builds is trustworthy, and a value arriving at /subscribe is not.
          */}
          <Link
            href={`/subscribe?next=${encodeURIComponent(applyReturnTo(id, qs))}`}
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
