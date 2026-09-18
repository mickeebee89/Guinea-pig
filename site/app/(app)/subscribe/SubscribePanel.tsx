'use client'

import { useState } from 'react'
import Link from 'next/link'
import { PayForm } from '@/components/PayForm'
import { startSubscription, confirmSubscription } from './actions'

/**
 * Client half of /subscribe.
 *
 * ── ⚠️ CHANGED 18 Sep 2026: NOTHING HAPPENS AT STRIPE UNTIL THE PERSON ASKS ─
 * This used to say: "The intent is created on mount rather than behind a
 * button: create_subscription is idempotent (it reuses an existing Stripe
 * customer and short-circuits on an active row), and a card form that appears
 * only after a click is a second state to get wrong for no gain."
 *
 * It was not idempotent. It cancelled any stored subscription not marked
 * 'active' in our table, and the webhook marks a brand-new one 'expired'. So
 * merely reloading this page after paying could cancel the subscription just
 * paid for (audit item 55). The rule now is that loading a page never creates
 * or cancels anything that moves money. The button starts it, and
 * create_subscription asks Stripe before it replaces anything.
 */
export function SubscribePanel() {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'already'; finishing: boolean }
    | { kind: 'ready'; clientSecret: string; subscriptionId: string }
    | { kind: 'error'; error: string }
  >({ kind: 'idle' })

  async function start() {
    setState({ kind: 'loading' })
    try {
      const r = await startSubscription()
      if (!r.ok) return setState({ kind: 'error', error: r.error })
      if (r.alreadyActive) return setState({ kind: 'already', finishing: r.finishing })
      setState({ kind: 'ready', clientSecret: r.clientSecret, subscriptionId: r.subscriptionId })
    } catch {
      setState({ kind: 'error', error: 'We could not start the membership. Nothing has been charged.' })
    }
  }

  if (state.kind === 'idle') {
    return (
      <div>
        <button
          onClick={start}
          className="rounded-lg bg-rose px-4 py-2 text-sm font-medium text-white"
        >
          Continue to payment
        </button>
        <p className="mt-2 text-xs text-muted">
          You’ll enter your card on the next step. Nothing is charged until you press Pay.
        </p>
      </div>
    )
  }

  if (state.kind === 'loading') {
    return <p className="text-sm text-muted">Setting up the payment form…</p>
  }

  if (state.kind === 'error') {
    return (
      <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        {state.error} If it keeps happening, email support@guineapigapp.co.uk.
      </div>
    )
  }

  if (state.kind === 'already') {
    if (state.finishing) {
      // Stripe, not our row, said there is a live or paid subscription. Our
      // record has not caught up yet, which is why the page offered this at
      // all. Say that, and do not claim the membership is set up here.
      return (
        <div className="rounded-xl border border-border bg-white p-4">
          <h3 className="font-display text-lg text-warm-dark">Stripe already has your membership</h3>
          <p className="mt-1 text-sm text-muted">
            Stripe shows a membership on this account that is paid or being paid, and our records are
            still catching up. Do not pay again. Refresh this page in a minute or two — and email
            support@guineapigapp.co.uk if it still asks you to pay.
          </p>
        </div>
      )
    }
    // ⚠️ This is create_subscription's `alreadyActive` from OUR row, which is
    // `subscriptions.status === 'active'` and nothing more — no date check.
    // So it is NOT proof of access, and this deliberately does not say "you're
    // subscribed". It says what the server reported and sends them to the
    // screen whose gate applies the real rule. Audit item 48.
    return (
      <div className="rounded-xl border border-border bg-white p-4">
        <h3 className="font-display text-lg text-warm-dark">You already have a membership</h3>
        <p className="mt-1 text-sm text-muted">
          Our records show a membership on this account, so there is nothing to pay. Open your
          dashboard — if it still asks you to subscribe, email support@guineapigapp.co.uk rather
          than paying twice.
        </p>
        <Link href="/dashboard" className="mt-3 inline-block text-sm font-medium text-rose underline">
          Go to your dashboard
        </Link>
      </div>
    )
  }

  return (
    <PayForm
      clientSecret={state.clientSecret}
      onConfirm={() => confirmSubscription(state.subscriptionId)}
      submitLabel="Pay £4.99 and join"
      successTitle="You’re a member"
      successBody="Your membership is active. You can apply for sessions as soon as your ID check is done."
    />
  )
}
