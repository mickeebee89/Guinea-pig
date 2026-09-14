'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PayForm } from '@/components/PayForm'
import { startSubscription, confirmSubscription } from './actions'

/**
 * Client half of /subscribe.
 *
 * The intent is created on mount rather than behind a button: create_subscription
 * is idempotent (it reuses an existing Stripe customer and short-circuits on an
 * active row), and a card form that appears only after a click is a second state
 * to get wrong for no gain.
 */
export function SubscribePanel() {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'already' }
    | { kind: 'ready'; clientSecret: string; subscriptionId: string }
    | { kind: 'error'; error: string }
  >({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    startSubscription()
      .then(r => {
        if (cancelled) return
        if (!r.ok) return setState({ kind: 'error', error: r.error })
        if (r.alreadyActive) return setState({ kind: 'already' })
        setState({ kind: 'ready', clientSecret: r.clientSecret, subscriptionId: r.subscriptionId })
      })
      .catch(() => {
        if (!cancelled) {
          setState({ kind: 'error', error: 'We could not start the membership. Nothing has been charged.' })
        }
      })
    return () => { cancelled = true }
  }, [])

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
    // ⚠️ This is create_subscription's `alreadyActive`, which is
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
