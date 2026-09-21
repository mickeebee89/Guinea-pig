'use client'

import { useEffect, useState, useTransition } from 'react'
import { resendConfirmation, type ResendOutcome } from './resend'

/**
 * "Send the confirmation link again" — on the sign-up success panel and on
 * sign-in's "confirm your email first" panel. Audit item 62.
 *
 * The button is disabled while the request runs, and for a minute after any
 * answer. That stops a double click from sending twice, and it matches
 * Supabase's own one-email-per-minute interval, so someone using the page
 * normally never runs into the rate limit at all.
 */
const COOLDOWN_MS = 60_000

const COPY: Record<ResendOutcome, string> = {
  sent:
    'If that address has an account waiting to be confirmed, we’ve sent a new link. It can take a few minutes to arrive — check spam too.',
  rate_limited:
    'We’ve only just sent one. Give it a minute, then try again if it still hasn’t arrived.',
}

export function ResendConfirmation({ email }: { email: string }) {
  const [pending, startTransition] = useTransition()
  const [outcome, setOutcome] = useState<ResendOutcome | null>(null)
  const [coolingDown, setCoolingDown] = useState(false)

  useEffect(() => {
    if (!coolingDown) return
    const t = setTimeout(() => setCoolingDown(false), COOLDOWN_MS)
    return () => clearTimeout(t)
  }, [coolingDown])

  function send() {
    setOutcome(null)
    setCoolingDown(true)
    startTransition(async () => {
      try {
        setOutcome(await resendConfirmation(email))
      } catch {
        // A thrown action (network, server) says nothing about the account
        // either, so it gets the same neutral answer.
        setOutcome('sent')
      }
    })
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={send}
        disabled={pending || coolingDown}
        className="inline-flex min-h-11 items-center rounded-[999px] bg-soft-pink px-5 text-sm font-bold text-rose disabled:opacity-60"
      >
        {pending
          ? 'Sending…'
          : coolingDown
            ? outcome === 'rate_limited' ? 'Try again in a minute' : 'Sent — you can send another in a minute'
            : 'Send the link again'}
      </button>
      {outcome && (
        <p role="status" className="mt-3 text-sm text-muted">
          {COPY[outcome]}
        </p>
      )}
    </div>
  )
}
