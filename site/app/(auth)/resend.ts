'use server'

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { isRateLimited } from '@/lib/authErrors'

export type ResendOutcome = 'sent' | 'rate_limited'

/**
 * Send the sign-up confirmation email again. Audit item 62: both "try again"
 * links used to navigate to /sign-up, so nothing was ever re-sent.
 *
 * ── IT NEVER SAYS WHETHER AN ACCOUNT EXISTS ─────────────────────────────
 * Success and every error other than a rate limit come back as 'sent', and the
 * copy for 'sent' is conditional: "if that address has an account waiting to
 * be confirmed". An unknown address, an already-confirmed one and a real send
 * are indistinguishable to the person asking — the same rule as sign-in's
 * single error message and forgot-password's unconditional success.
 *
 * ⚠️ THE RATE-LIMIT ANSWER IS THE ONE EXCEPTION, AND IT IS A SMALL ONE.
 * GoTrue's 60-second interval is per user, so a 429 only happens for an address
 * that has an account. Someone calling this twice in a row could tell the
 * difference. The button keeps it rare rather than impossible: on the sign-up
 * panel it counts down the minute after the sign-up email, and after every
 * resend it counts down again. It can still happen on the sign-in panel if an
 * email went out within the last minute — and then the person seeing it is the
 * one who triggered that email, so it tells them nothing. (Until 22 Sep this
 * said nobody using the page "ever sees it", which was wrong: resending
 * straight after signing up hit it every time, item 62.) And the sign-up form
 * already says "There is already an account with this email"
 * (sign-up/actions.ts), so this discloses nothing new.
 * Kept because telling a real person to wait is worth more than hiding it.
 *
 * ── NO emailRedirectTo ──────────────────────────────────────────────────
 * The confirmation link is built by the "Confirm signup" template from
 * {{ .TokenHash }}, hardcoded to cavybeauty.com/auth/confirm (item 62). A resend
 * of type 'signup' sends that same template, so there is no redirect to set,
 * and one would be ignored.
 */
export async function resendConfirmation(email: string): Promise<ResendOutcome> {
  const clean = String(email ?? '').trim().toLowerCase()
  // Malformed input can only come from someone calling this directly; the panel
  // passes an address that already passed validation. Answer neutrally.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return 'sent'

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.resend({ type: 'signup', email: clean })

  if (error) {
    // Code and status only. The address is not logged.
    console.error('[resend] resend failed', { status: error.status, code: error.code })
    if (isRateLimited(error)) return 'rate_limited'
  }
  return 'sent'
}
