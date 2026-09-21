'use client'

import { useEffect, useState, useTransition } from 'react'
import { resendConfirmation, type ResendOutcome } from './resend'

/**
 * "Send the confirmation link again" — on the sign-up success panel and on
 * sign-in's "confirm your email first" panel. Audit item 62.
 *
 * The button is disabled while the request runs, and counts down 60 seconds
 * after any answer, so a double click cannot send twice.
 *
 * ── WHEN THE FIRST MINUTE STARTS, PER PANEL ─────────────────────────────
 * Supabase allows one auth email per user per 60 seconds, and its clock
 * starts at the LAST email sent — not at our button.
 *
 *   Sign-up panel: `startCoolingDown`. The panel appears the moment signUp()
 *   has sent the first email, so the button counts that minute down instead
 *   of inviting a press Supabase will refuse. Our count starts a fraction
 *   after theirs, so it ends on the safe side.
 *
 *   Sign-in panel: no initial countdown. It appears after a sign-in attempt,
 *   not after a send, so there is usually no recent email to wait for. The
 *   exception: if an email went out within the last minute (a sign-up moments
 *   earlier, in another tab), the first press is refused and shows the
 *   rate-limit copy, which is true — and then the countdown runs.
 *
 * Until 22 Sep this said the cooldown meant "someone using the page normally
 * never runs into the rate limit at all". That was wrong: pressing resend
 * straight after signing up hit it every time (item 62).
 */
const COOLDOWN_SECONDS = 60

const COPY: Record<ResendOutcome, string> = {
  sent:
    'If that address has an account waiting to be confirmed, we’ve sent a new link. It can take a few minutes to arrive — check spam too.',
  rate_limited:
    'We’ve only just sent one. Give it a minute, then try again if it still hasn’t arrived.',
}

export function ResendConfirmation({
  email,
  startCoolingDown = false,
}: {
  email: string
  /** True where the panel appears straight after an email was sent. */
  startCoolingDown?: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [outcome, setOutcome] = useState<ResendOutcome | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(startCoolingDown ? COOLDOWN_SECONDS : 0)

  // One tick per second. A background tab may slow the ticks, which only
  // lengthens the wait — the safe direction.
  useEffect(() => {
    if (secondsLeft <= 0) return
    const t = setTimeout(() => setSecondsLeft(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [secondsLeft])

  const coolingDown = secondsLeft > 0

  function send() {
    setOutcome(null)
    setSecondsLeft(COOLDOWN_SECONDS)
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
            ? outcome === 'rate_limited'
              ? `Try again in ${secondsLeft}s`
              : outcome === 'sent'
                ? `Sent — you can send another in ${secondsLeft}s`
                : `You can send it again in ${secondsLeft}s`
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
