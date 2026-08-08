'use server'

import { headers } from 'next/headers'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { AUTH_REDIRECTS } from '@/lib/signup'

export interface ForgotState { error?: string; sent?: boolean }

/**
 * Send a password-reset email.
 *
 * ALWAYS REPORTS SUCCESS, even for an address with no account. Telling someone
 * "no account with that email" turns this form into a way to test whether any
 * given address is registered — and on a platform where members meet strangers
 * in person, confirming somebody has an account here is not neutral. Same
 * reasoning as the single sign-in error message, and as the waitlist returning
 * ok on a duplicate.
 */
export async function requestReset(_prev: ForgotState | null, formData: FormData): Promise<ForgotState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Enter a valid email address.' }
  }

  const h = await headers()
  const origin = h.get('origin') ?? `https://${h.get('host') ?? 'cavybeauty.com'}`

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: new URL(AUTH_REDIRECTS.reset, origin).toString(),
  })

  // Logged, never surfaced — a real failure here (rate limit, SMTP down) must
  // not become a way to distinguish a known address from an unknown one.
  if (error) console.error('[forgot-password] resetPasswordForEmail failed:', error.message)

  return { sent: true }
}
