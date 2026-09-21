'use client'

import { SUPPORT_EMAIL } from '@/lib/site'

import { useState } from 'react'
import { PayForm } from '@/components/PayForm'
import { startFeePayment, confirmFeePayment } from './actions'

/**
 * The £14.99 one-off fee, on the web.
 *
 * Deliberately the same shape as SubscribePanel: create the intent, mount
 * PayForm, let the confirm step go and check. One flow to understand rather
 * than two that drift — audit item 48 is a catalogue of what happens when a
 * second copy is made.
 *
 * ⚠️ CHANGED 18 Sep 2026. This used to create the intent ON MOUNT. It now
 * waits for the button, for the same reason as SubscribePanel: loading a page
 * must never create anything at Stripe that moves money (audit item 55). A
 * reload used to mint a fresh PaymentIntent every time.
 *
 * ⚠️ WHAT THIS DOES NOT FIX. create_verification_intent is unchanged: it
 * checks only for a verification_payments row. Someone who paid and presses
 * the button again before that row exists (the webhook or confirm has not
 * landed yet) is still issued a new intent and shown "Pay £14.99". The button
 * narrows that to a deliberate second press; it does not close it.
 *
 * ⚠️ CORRECTED 18 Sep 2026. This said a failed fee confirm "has no webhook
 * behind it, so its outcome is pending:false". It does now. Since 18 Sep
 * stripe-webhook records the fee from payment_intent.succeeded (audit item 53),
 * so a stylist who closes the tab after paying comes back to "Already paid"
 * below, once the webhook has landed, instead of a second "Pay £14.99".
 *
 * Still true: re-confirming the same paymentIntentId is idempotent (23505 is
 * benign), so nobody is charged twice by trying again. Not yet caught up:
 * confirmFeePayment still returns pending:false. See the fee section of
 * verify/actions.ts for what that means for the person, and why it is left.
 * Migration 0040:31-32 still carries the old "inserted only by" claim. It is
 * checksummed and cannot be edited, so it is recorded as stale, not removed.
 */
export function FeePanel() {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'paid' }
    | { kind: 'ready'; clientSecret: string; paymentIntentId: string }
    | { kind: 'error'; error: string }
  >({ kind: 'idle' })

  async function start() {
    setState({ kind: 'loading' })
    try {
      const r = await startFeePayment()
      if (!r.ok) return setState({ kind: 'error', error: r.error })
      if (r.alreadyPaid) return setState({ kind: 'paid' })
      setState({ kind: 'ready', clientSecret: r.clientSecret, paymentIntentId: r.paymentIntentId })
    } catch {
      setState({ kind: 'error', error: 'We could not start the payment. Nothing has been charged.' })
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
        {state.error} If it keeps happening, email {SUPPORT_EMAIL}.
      </div>
    )
  }

  if (state.kind === 'paid') {
    // create_verification_intent returns { alreadyPaid: true } when a
    // verification_payments row already exists. Unlike the subscription's
    // `alreadyActive`, this one IS the record of payment rather than a status
    // that can go stale — so saying it plainly is safe.
    return (
      <div className="rounded-xl border border-border bg-white p-4">
        <h3 className="font-display text-lg text-warm-dark">Already paid</h3>
        <p className="mt-1 text-sm text-muted">
          We have your £14.99 on record, so there is nothing to pay. Reload this page to carry on
          with the ID check — and email {SUPPORT_EMAIL} if it still asks.
        </p>
      </div>
    )
  }

  return (
    <PayForm
      clientSecret={state.clientSecret}
      onConfirm={() => confirmFeePayment(state.paymentIntentId)}
      submitLabel="Pay £14.99"
      successTitle="Paid — thank you"
      successBody="That is the fee settled, once and for all. Reload this page to take your ID check photo."
    />
  )
}
