'use client'

import { useState } from 'react'
import Link from 'next/link'
import { SUPPORT_EMAIL } from '@/lib/site'
import { cancelMembership } from './actions'

/**
 * The membership row in Settings.
 *
 * ── WHAT IS DISPLAY AND WHAT IS A DECISION ────────────────────────────────
 * `subscribed` comes from getGateState — the one rule that decides access.
 * `status` and `renewsOn` are the row's own words, shown so a person can see
 * what we hold. They are NOT recomputed into a second opinion about whether
 * someone is a member: audit item 48 is a catalogue of what happens when a
 * surface starts deciding that for itself.
 */
export interface MembershipView {
  subscribed: boolean
  waived: boolean
  /** subscriptions.status verbatim, or null when we hold no row. */
  status: string | null
  /** subscriptions.current_period_end verbatim. */
  renewsOn: string | null
}

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null

export function MembershipSection({ view }: { view: MembershipView }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const endsOn = fmt(view.renewsOn)
  const cancelling = view.status === 'cancelling'
  // A renewal payment has failed. The gate still grants access to the end of
  // the paid period (site/lib/verification.ts:98), which is right — but this
  // used to read "Active … renewing on {date}", telling someone whose card is
  // failing that all was well.
  const pastDue = view.status === 'past_due'

  async function doCancel() {
    setBusy(true)
    setResult(null)
    const r = await cancelMembership()
    setBusy(false)
    setConfirming(false)
    setResult(
      r.ok
        ? {
            tone: 'ok',
            text: r.cancelsAt
              ? `Done. Your membership runs until ${fmt(r.cancelsAt)} and will not renew.`
              : 'Done. Your membership will not renew.',
          }
        : { tone: 'error', text: r.error },
    )
  }

  if (!view.subscribed) {
    return (
      <p className="text-sm text-muted">
        No membership on this account. It’s £4.99 a month and it’s what lets you apply for
        sessions — <Link href="/subscribe" className="font-bold text-rose hover:underline">join here</Link>.
      </p>
    )
  }

  if (view.waived) {
    // A comp is an admin decision, not a Stripe subscription. There is nothing
    // to cancel and offering a button would be offering an action with no
    // effect — the shape audit item 32 recorded on the image queue.
    return (
      <p className="text-sm text-muted">
        Complimentary — an admin has given you free access, so there is nothing to pay and nothing
        to cancel.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {pastDue && (
        // ⚠️ NO CARD-UPDATE ROUTE EXISTS, so this does not offer one. Searched
        // 21 Sep across site, mobile, admin and both edge functions: no billing
        // portal, no SetupIntent, no payment-method change anywhere. The honest
        // instruction is the support address. If a way to change a card is ever
        // built, this is the sentence to change.
        <div role="status" className="rounded-lg border border-hairline bg-input-bg p-3 text-sm text-warm-dark">
          <p className="font-bold">Your last payment didn’t go through.</p>
          <p className="mt-1">
            {endsOn
              ? `You keep your membership until ${endsOn}.`
              : 'You keep your membership until the end of the period you’ve paid for.'}
            {' '}There’s no way to change your card on Cavy yet, so if your card has changed or
            expired, email us at{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-bold text-rose hover:underline">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </div>
      )}

      <p className="text-sm text-muted">
        {/* Not "paid up to": on a failed renewal Stripe has already moved the
            period on, so current_period_end is the end of the UNPAID period.
            The box above says the true thing — access runs to that date. */}
        {pastDue
          ? '£4.99 a month.'
          : cancelling
          ? endsOn
            ? `Ends on ${endsOn}. It will not renew, and you keep access until then.`
            : 'Ending — it will not renew, and you keep access until the end of the period you paid for.'
          : endsOn
            ? `Active. £4.99 a month, renewing on ${endsOn}.`
            : 'Active. £4.99 a month.'}
      </p>

      {result && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            result.tone === 'error' ? 'bg-red-50 text-red-800' : 'bg-input-bg text-warm-dark'
          }`}
        >
          {result.text}
        </div>
      )}

      {!cancelling && !result && (
        confirming ? (
          <div className="rounded-lg border border-hairline bg-input-bg p-3">
            <p className="text-sm text-warm-dark">
              {endsOn
                ? `You’ll keep everything until ${endsOn} — cancelling stops the renewal, it doesn’t cut you off today.`
                : 'You’ll keep access until the end of the period you’ve paid for. Cancelling stops the renewal.'}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={doCancel}
                disabled={busy}
                className="rounded-lg bg-rose px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? 'Cancelling…' : 'Yes, stop the renewal'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="rounded-lg bg-white px-3 py-1.5 text-sm text-muted"
              >
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="text-sm font-bold text-rose hover:underline"
          >
            Cancel membership
          </button>
        )
      )}
    </div>
  )
}
