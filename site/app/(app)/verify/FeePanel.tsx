'use client'

import { useEffect, useState } from 'react'
import { PayForm } from '@/components/PayForm'
import { startFeePayment, confirmFeePayment } from './actions'

/**
 * The £14.99 one-off fee, on the web.
 *
 * Deliberately the same shape as SubscribePanel: create the intent on mount,
 * mount PayForm, let the confirm step go and check. One flow to understand
 * rather than two that drift — audit item 48 is a catalogue of what happens
 * when a second copy is made.
 *
 * The difference that matters is inside confirmFeePayment, not here: a failed
 * fee confirm has no webhook behind it, so its outcome is pending:false and the
 * retry re-confirms the same paymentIntentId, which the edge function treats as
 * idempotent. Nobody is charged twice by trying again.
 */
export function FeePanel() {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'paid' }
    | { kind: 'ready'; clientSecret: string; paymentIntentId: string }
    | { kind: 'error'; error: string }
  >({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    startFeePayment()
      .then(r => {
        if (cancelled) return
        if (!r.ok) return setState({ kind: 'error', error: r.error })
        if (r.alreadyPaid) return setState({ kind: 'paid' })
        setState({ kind: 'ready', clientSecret: r.clientSecret, paymentIntentId: r.paymentIntentId })
      })
      .catch(() => {
        if (!cancelled) {
          setState({ kind: 'error', error: 'We could not start the payment. Nothing has been charged.' })
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
          with the ID check — and email support@guineapigapp.co.uk if it still asks.
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
