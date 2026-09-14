'use client'

import { useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'

/**
 * ── ONE FORM, BOTH PURCHASES ──────────────────────────────────────────────
 *
 * The £4.99/mo model subscription and the £14.99 one-off stylist fee differ
 * only in which edge action creates the intent and which one confirms it.
 * Everything a card needs — mounting Elements, confirming, and the three
 * things that can happen afterwards — is identical.
 *
 * Two copies of this would be a fossil in waiting: audit item 48 is about
 * exactly that, and all three instances it records were a correct idea copied
 * and then left behind when the original moved on.
 *
 * ── THE PUBLISHABLE KEY IS GUARDED, NOT ASSERTED ──────────────────────────
 *
 * `loadStripe(key!)` with an unset key fails inside Stripe.js, which in a
 * client component means a blank panel and a console message nobody reads. A
 * missing key is a configuration fact, so it renders as one.
 *
 * It also keeps `next build` green without the key — which is deliberate: CI
 * compiles this path without a live payment key sitting in a public repo's
 * Actions config. The consequence, stated rather than left implicit: a green
 * CI run proves this COMPILES and never that it WORKS. Only a real card on a
 * deployed build proves the second thing.
 */
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
const stripePromise = publishableKey ? loadStripe(publishableKey) : null

/** What the caller's confirm step reports back. */
export type ConfirmOutcome =
  /** We took the money AND recorded it. The only state that may claim success. */
  | { ok: true }
  /**
   * Charged, but our own record is not in place yet or at all.
   * `pending` means something else is expected to finish the job (the Stripe
   * webhook); `pending: false` means it will not finish on its own.
   */
  | { ok: false; pending: boolean; error: string }

export interface PayFormProps {
  /** From create_subscription / create_verification_intent. */
  clientSecret: string
  /** Runs AFTER Stripe confirms. Must go and check, never assume. */
  onConfirm: () => Promise<ConfirmOutcome>
  submitLabel: string
  /** Shown once everything succeeded. */
  successTitle: string
  successBody: string
}

type Msg = { tone: 'error' | 'warn' | 'ok'; title?: string; text: string }

function Inner({ onConfirm, submitLabel, successTitle, successBody }: Omit<PayFormProps, 'clientSecret'>) {
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements || busy) return
    setBusy(true)
    setMsg(null)

    // ── `redirect: 'if_required'` IS THE WHOLE SHAPE OF THIS FLOW ──────────
    //
    // Without it Stripe navigates away to a return_url and the "did we record
    // it?" question gets answered on the far side of a round trip through a
    // page we do not control, which can be closed, refreshed or lost.
    //
    // Mobile's subscribe flow works because it never leaves the app while the
    // answer is uncertain. This is the web equivalent of that property, and it
    // is the reason Elements was chosen over Stripe Checkout.
    //
    // A 3-D Secure challenge still opens — in an iframe from hooks.stripe.com,
    // which next.config.ts's frame-src allows — and returns here. Most UK cards
    // trigger SCA, so that path is the normal one, not the exception.
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    })

    if (error) {
      // A declined card, a failed 3-D Secure, or an invalid field. Stripe's
      // messages are written for cardholders, so they are shown as-is.
      setMsg({ tone: 'error', text: error.message ?? 'That payment could not be completed.' })
      setBusy(false)
      return
    }

    if (paymentIntent?.status !== 'succeeded') {
      // 'processing' is real for some payment methods. Never claim success.
      setMsg({
        tone: 'warn',
        title: 'Still processing',
        text: 'Your payment has not finished yet. Do not pay again — check back in a few minutes, '
          + 'and email support@guineapigapp.co.uk if it has not completed.',
      })
      setBusy(false)
      return
    }

    // ── STRIPE HAS THE MONEY. WHETHER WE HAVE THE RECORD IS A SEPARATE
    //    QUESTION, AND THE ONLY HONEST MOVE IS TO GO AND ASK ────────────────
    //
    // This is the lesson mobile's subscribe.tsx learned the expensive way: it
    // used to treat the absence of an error as success, and on that path Stripe
    // billed £4.99 a month while our own table held nothing at all.
    const outcome = await onConfirm()

    if (outcome.ok) {
      setDone(true)
      setBusy(false)
      return
    }

    setMsg(
      outcome.pending
        ? {
            tone: 'warn',
            title: 'Payment taken, still finishing',
            text: 'Your card was charged and that part worked. We are finishing the last step at our '
              + 'end. Do not pay again — reload this page in a minute or two, and email '
              + 'support@guineapigapp.co.uk if it still looks wrong.',
          }
        : {
            tone: 'error',
            title: 'Payment taken, not set up',
            text: `Your card was charged but we could not complete this at our end: ${outcome.error}. `
              + 'Do not pay again — email support@guineapigapp.co.uk and we will either finish it or '
              + 'refund you.',
          },
    )
    setBusy(false)
  }

  if (done) {
    return (
      <div className="rounded-xl border border-border bg-white p-4">
        <h3 className="font-display text-lg text-warm-dark">{successTitle}</h3>
        <p className="mt-1 text-sm text-muted">{successBody}</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />

      {msg && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            msg.tone === 'error'
              ? 'bg-red-50 text-red-800'
              : msg.tone === 'warn'
                ? 'bg-amber-50 text-amber-900'
                : 'bg-input-bg text-warm-dark'
          }`}
        >
          {msg.title && <span className="block font-medium">{msg.title}</span>}
          {msg.text}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || busy}
        className="w-full rounded-lg bg-rose px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Working…' : submitLabel}
      </button>
    </form>
  )
}

export function PayForm({ clientSecret, ...rest }: PayFormProps) {
  if (!stripePromise) {
    // Not an error state — a configuration one, said plainly. This is what
    // renders if NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is missing from the
    // environment, which is exactly what a CI build looks like.
    return (
      <div className="rounded-xl border border-border bg-white p-4">
        <h3 className="font-display text-lg text-warm-dark">Card payments aren’t set up here</h3>
        <p className="mt-1 text-sm text-muted">
          This build has no Stripe publishable key, so the card form cannot load. Nothing is wrong
          with your account. Paying in the Cavy app still works.
        </p>
      </div>
    )
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: 'flat',
          variables: {
            colorPrimary: '#DB4B86',
            colorText: '#2B2531',
            colorDanger: '#b91c1c',
            fontFamily: 'Quicksand, ui-sans-serif, system-ui, sans-serif',
            borderRadius: '10px',
          },
        },
      }}
    >
      <Inner {...rest} />
    </Elements>
  )
}
