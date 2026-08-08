'use server'

import { headers } from 'next/headers'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  buildSignupMetadata,
  validateSignup,
  AUTH_REDIRECTS,
  type SignupRole,
} from '@/lib/signup'

export interface SignUpState {
  errors?: Record<string, string>
  /** Set when the account was created and a confirmation email is on its way. */
  sentTo?: string
}

/**
 * Create an account.
 *
 * Server Action rather than a browser client, so SUPABASE_ANON_KEY stays
 * unprefixed and unreachable from Client Components — see
 * (auth)/auth/new-password/actions.ts for why that matters.
 *
 * The metadata comes from buildSignupMetadata() and is never assembled here.
 * `role` is a required property of its typed input, so a form that forgot it
 * fails to compile. Migration 0002 rejects a missing role at the database, but
 * that is the backstop; this is the design.
 */
export async function signUp(_prev: SignUpState | null, formData: FormData): Promise<SignUpState> {
  const role = String(formData.get('role') ?? '') as SignupRole
  const firstName = String(formData.get('firstName') ?? '')
  const lastName = String(formData.get('lastName') ?? '')
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const confirmPassword = String(formData.get('confirmPassword') ?? '')
  const dobRaw = String(formData.get('dateOfBirth') ?? '')
  const ageConfirmed = formData.get('ageConfirmed') === 'on'
  const termsAccepted = formData.get('termsAccepted') === 'on'
  const source = String(formData.get('source') ?? '') || null

  if (role !== 'model' && role !== 'provider') {
    return { errors: { form: 'Choose whether you are signing up as a stylist or a model.' } }
  }

  // Parse before validating so an unparseable date is "enter a valid date"
  // rather than a crash.
  let dateOfBirth: Date | null = null
  if (dobRaw) {
    const d = new Date(`${dobRaw}T00:00:00`)
    if (!Number.isNaN(d.getTime())) dateOfBirth = d
  }

  const errors = validateSignup({
    firstName, lastName, email, password, confirmPassword,
    dateOfBirth, ageConfirmed, termsAccepted,
  })
  if (Object.keys(errors).length > 0) return { errors }

  const supabase = await createSupabaseServerClient()

  // Absolute, and derived from the request rather than hardcoded, so localhost
  // confirms to localhost and production to production. Never relies on the
  // project Site URL fallback.
  const h = await headers()
  const origin = h.get('origin') ?? `https://${h.get('host') ?? 'cavybeauty.com'}`

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: new URL(AUTH_REDIRECTS.confirm, origin).toString(),
      data: buildSignupMetadata({
        role,
        firstName,
        lastName,
        dateOfBirth: dateOfBirth!,
        source,
      }),
    },
  })

  if (error) {
    // GoTrue wraps ANY exception from handle_new_auth_user as this generic
    // string — including migration 0002's age and role rejections. The client
    // checks above should make it unreachable, so if it appears something is
    // genuinely wrong rather than merely invalid. Say so, rather than showing
    // a database error to someone trying to sign up.
    if (/database error saving new user/i.test(error.message)) {
      console.error('[sign-up] trigger rejected the signup', { role, dobRaw, email })
      return {
        errors: {
          form: 'We couldn’t create your account. Please check your date of birth and try again, or contact support if it keeps happening.',
        },
      }
    }
    if (/already registered|already been registered/i.test(error.message)) {
      return { errors: { email: 'There is already an account with this email. Try signing in instead.' } }
    }
    return { errors: { form: error.message } }
  }

  return { sentTo: email }
}
