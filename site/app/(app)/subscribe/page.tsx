import Link from 'next/link'
import { createSupabaseServerClient, requireUser } from '@/lib/supabase-server'
import { getGateState } from '@/lib/verification'
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
 * /verify uses for the £14.99 fee, where feeSettled is assembled at the call
 * site from paid-or-founding-or-waived — reading that one as "paid" is what
 * showed founding stylists a fee wall until 19 Aug. Two gates that look alike
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

export default async function SubscribePage() {
  const user = await requireUser()
  const supabase = await createSupabaseServerClient()
  const gate = await getGateState(supabase, user.id)

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
            : 'The ID check is the other half of applying — you do it in the flow, when you apply.'}
        </p>
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
        <SubscribePanel />
      </div>

      <p className="mt-4 text-xs text-muted">
        Payments are handled by Stripe. Your card details are entered on Stripe’s own form and never
        reach Cavy’s servers.
      </p>
    </Wrap>
  )
}
