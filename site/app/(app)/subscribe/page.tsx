import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getGateState } from '@/lib/verification'
import { SUPPORT_EMAIL } from '@/lib/site'
import { safeReturnTo } from '@/lib/return-to'
import { SubscribePanel } from './SubscribePanel'

export const metadata = { title: 'Membership' }

/**
 * The £4.99/mo model membership, on the web.
 *
 * ── THE GATE IS READ HERE, NOT INFERRED FROM THE PAYMENT ACTION ───────────
 * create_subscription has its own idea of "already subscribed" —
 * `subscriptions.status === 'active'`, no date check, no waiver — which is the
 * fourth definition of that phrase in this codebase (audit item 48). This page
 * asks getGateState instead, because that is the rule the apply gate actually
 * applies.
 *
 * getGateState's `subscribed` already folds in the admin waiver:
 * hasActiveSubscription returns { active: true, waived: true } for a comped
 * account before it reads the subscriptions row at all. So `subscribed` means
 * paid OR comped, and there is nothing to compose here. That is NOT the shape
 * /verify uses for the stylist fee, where feeSettled now comes from
 * provider_fee_settled rather than being assembled at the call site (0102) —
 * reading that one as "paid" is what showed founding stylists a fee wall until
 * 19 Aug, and it is no longer possible to read it wrong here. Two gates that look alike
 * and are built differently.
 */
function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <>
      <h1 className="mb-6 font-display text-3xl text-warm-dark">Membership</h1>
      <section className="rounded-lg border border-hairline bg-white p-5 shadow-card">{children}</section>
      <p className="mt-4 text-sm">
        <Link href="/dashboard" className="font-bold text-rose hover:underline">← Back to your dashboard</Link>
      </p>
    </>
  )
}

export default async function SubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()
  const gate = await getGateState(supabase, user.id)

  /*
   * ── ⚠️⚠️ FIRST, AND IT HAS TO BE FIRST ───────────────────────
   *
   * `gate.subscribed` is TRUE for everybody while `subscription_enabled` is
   * false — that is what makes the apply flow let her straight through. So
   * without this branch above it, every visitor would fall into the
   * "You’re already a member — your membership is active" panel below, which
   * is a statement about a payment that was never taken. The most confusing
   * possible wrong answer: it tells her she is paying for something.
   *
   * ⚠️ IT DOES NOT redirect. A member who followed a bookmark, an old email
   * or the apply flow’s return path deserves a sentence saying why there is
   * nothing here, not a silent bounce to a page she did not ask for.
   *
   * ⚠️ THE COMP IS STILL NAMED. A waived account is a deliberate admin
   * decision that survives the flag, and that one member should not read
   * "nothing to pay" and wonder whether her comp went away.
   */
  if (!gate.subscriptionRequired) {
    return (
      <Wrap>
        <h2 className="font-display text-xl text-warm-dark">You don’t need a membership</h2>
        <p className="mt-1 text-sm text-muted">
          Cavy isn’t charging models at the moment, so there’s nothing to pay and nothing to
          set up. You can apply for any session you like.
          {gate.waived && ' Your account also has complimentary access on it, which stays as it is.'}
        </p>
        <p className="mt-3 text-xs text-muted">
          If anything on Cavy asks you for money, don’t pay it — email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="font-bold text-rose hover:underline">
            {SUPPORT_EMAIL}
          </a>{' '}
          and tell us where you saw it.
        </p>
      </Wrap>
    )
  }

  /**
   * ⚠⚠ VALIDATED HERE, WHERE IT ARRIVES FROM OUTSIDE. `?next=` is part of a URL
   * anyone can construct and send to a member. `safeReturnTo` is an ALLOWLIST
   * matching the one route this is for; everything else, including things it has
   * never heard of, comes back null and she simply sees the ordinary dashboard
   * link. An open redirect here would be performed on somebody who has just
   * entered card details. site/lib/return-to.ts has the cases,
   * scripts/check-return-to.mjs asserts them.
   */
  const next = safeReturnTo((await searchParams).next)
  const backToApplication = next ? (
    <Link
      href={next}
      className="mt-4 inline-flex min-h-11 items-center rounded-[999px] bg-rose px-6 text-sm font-bold text-white"
    >
      Back to your application
    </Link>
  ) : null

  if (gate.subscribed) {
    return (
      <Wrap>
        <h2 className="font-display text-xl text-warm-dark">
          {gate.waived ? 'Your membership is complimentary' : 'You’re already a member'}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {gate.waived
            ? 'An admin has given you free access, so there is nothing to pay.'
            : 'Your membership is active. There is nothing to pay here.'}
          {' '}
          {gate.verified
            ? 'You can apply for sessions now.'
            : 'Your ID check is the other half of applying, and it is still outstanding.'}
        </p>
        {/*
          ⚠️ THIS BRANCH NEEDS THE RETURN TOO, and it is easy to miss. A COMPED
          member who presses "See membership" from the wall lands here, not on
          the card form — and so does anyone who refreshes after paying. Without
          this she is told there is nothing to pay and left to find her own way
          back to a slot she chose minutes ago.
        */}
        {backToApplication}
      </Wrap>
    )
  }

  return (
    <Wrap>
      <h2 className="font-display text-xl text-warm-dark">£4.99 a month</h2>
      <p className="mt-1 text-sm text-muted">
        Membership is what lets you apply for sessions. Cancel any time in{' '}
        <Link href="/settings" className="font-bold text-rose hover:underline">Settings</Link>
        {' '}— you keep access until the end of the month you’ve paid for.
      </p>
      <ul className="mt-3 space-y-1 text-sm text-muted">
        <li>· Apply for as many sessions as you like</li>
        <li>· Message stylists directly once a booking is confirmed</li>
        <li>· Browsing and searching stay free, with or without a membership</li>
      </ul>

      <div className="mt-5">
        <SubscribePanel backToApplication={backToApplication} />
      </div>

      <p className="mt-4 text-xs text-muted">
        Payments are handled by Stripe. Your card details are entered on Stripe’s own form and never
        reach Cavy’s servers.
      </p>
    </Wrap>
  )
}
