'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export interface SignInState {
  error?: string
  /** Set when the account exists but the email was never confirmed. */
  needsConfirmation?: boolean
}

/**
 * Sign in with email and password.
 *
 * Server Action, so SUPABASE_ANON_KEY stays out of the browser bundle and the
 * session cookie is written server-side by @supabase/ssr.
 */
export async function signIn(_prev: SignInState | null, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const next = String(formData.get('next') ?? '/dashboard')

  if (!email || !password) {
    return { error: 'Enter your email and password.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // "Email not confirmed" is a different problem from a wrong password and
    // has a different fix, so it gets its own path rather than the generic
    // message. Everything else is deliberately indistinguishable — see below.
    if (/email not confirmed|not confirmed/i.test(error.message)) {
      return { needsConfirmation: true }
    }

    // ONE message for wrong password AND unknown account, on purpose. Saying
    // "no account with that email" tells anyone who asks which addresses are
    // registered here — and on a platform where members meet strangers in
    // person, confirming somebody has an account is not a neutral disclosure.
    return { error: 'That email and password don’t match. Please try again.' }
  }

  // Only reachable with a session. redirect() throws, so it must sit outside
  // any try/catch — Next uses the throw to perform the navigation.
  redirect(next.startsWith('/') ? next : '/dashboard')
}
