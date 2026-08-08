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
    // GoTrue wraps ANY failure while creating the user as this generic string —
    // migration 0002's role and age rejections, but also anything else that can
    // go wrong inside handle_new_auth_user, such as a constraint on the rows it
    // writes. The wrapper discards the underlying RAISE, so the only place the
    // real exception exists is the Supabase Auth logs.
    if (/database error saving new user/i.test(error.message)) {
      // Log the WHOLE error, not just the inputs. An earlier version recorded
      // the payload and dropped error.message, which meant a real failure was
      // diagnosable only by guessing at which rule fired.
      console.error('[sign-up] account creation failed inside the auth trigger', {
        inputs: { role, dobRaw, email },
        supabaseError: { message: error.message, status: error.status, code: error.code },
        hint: 'The underlying RAISE is in Supabase → Logs → Auth. GoTrue does not forward it.',
      })
      return {
        errors: {
          // Deliberately names NO field. The app cannot know which rule fired —
          // GoTrue gives it one opaque string — so pointing at the date of
          // birth was a guess presented to the user as a diagnosis. If their
          // date was fine, that message sends them to correct something that
          // was never wrong.
          form: 'We couldn’t create your account. This is a problem at our end, not something you’ve done — please try again, or contact support if it keeps happening.',
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
