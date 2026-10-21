'use server'

import { headers } from 'next/headers'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { isRateLimited } from '@/lib/authErrors'
import { lookupPostcode } from '@/lib/postcode'
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
  /**
   * Shown on the "check your email" screen when the postcode could not be
   * used. ⚠⚠ IT IS NOT IN `errors` AND THAT IS THE WHOLE POINT: the account
   * WAS created. Putting it in `errors` would render it as a form failure next
   * to fields she can no longer edit, and she would reasonably conclude the
   * signup had failed.
   */
  postcodeNotice?: string
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
  const postcodeRaw = String(formData.get('postcode') ?? '').trim()

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

  // ═══ THE POSTCODE LOOKUP — BEFORE signUp, AND IT CANNOT STOP IT ══════════
  //
  // ⚠⚠ OPTIONAL MEANS A FAILED LOOKUP STILL CREATES THE ACCOUNT. Every outcome
  // below falls through to signUp; none of them returns early. The notice is
  // carried on `postcodeNotice`, not `errors`.
  //
  // ⚠⚠ AND IT HAPPENS HERE RATHER THAN INSIDE THE SIGNUP TRANSACTION. The
  // alternative was to write the postcode in handle_new_auth_user from the
  // metadata — but anything that can raise in there reaches the user as
  // "Database error saving new user", which names nothing and which this file
  // already has forty lines of apology for. A ::double precision cast on
  // crafted metadata would do exactly that. So the lookup runs out here, and
  // the trigger never learns a postcode exists.
  //
  // ⚠️ ONLY THE POSTCODE GOES INTO THE METADATA — never the coordinate. See
  // SignupMetadata.signup_postcode for why, and /auth/confirm for the write.
  let signupPostcode: string | null = null
  let postcodeNotice: string | undefined
  if (postcodeRaw) {
    const found = await lookupPostcode(postcodeRaw)
    if (found.ok) {
      signupPostcode = found.place.postcode
    } else if (found.reason === 'unavailable') {
      // ⚠️ OURS, NOT HERS. A service outage must never read as "your postcode
      // is wrong" — the same distinction postcodeMessage() makes, reworded for
      // a screen she cannot retype on.
      postcodeNotice = 'We couldn’t check your postcode just now, so we haven’t saved it. You can add it in Settings once you’re signed in.'
    } else {
      // malformed | not_found | not_located — ONE WORDING FOR ALL THREE,
      // deliberately. On the settings page "Check it and try again" is right
      // because the box is still there; here the form is gone and the account
      // is made, so there is nothing to retry and telling her to retry would
      // send her looking for a box that no longer exists.
      postcodeNotice = 'We couldn’t use that postcode, so we haven’t saved it. You can add it in Settings once you’re signed in.'
    }
  }

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
        signupPostcode,
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
    // Everything else used to be `{ form: error.message }` — Supabase's own
    // developer-facing wording shown to the person (item 62). Now it is decided
    // by code and status, and the raw message goes only to the log.
    console.error('[sign-up] signUp failed', {
      status: error.status, code: error.code, message: error.message,
    })
    if (isRateLimited(error)) {
      return { errors: { form: 'Too many attempts just now. Please wait a minute, then try again.' } }
    }
    if (error.code === 'weak_password') {
      return { errors: { password: 'Choose a stronger password — that one is too easy to guess.' } }
    }
    if (error.code === 'email_address_invalid') {
      return { errors: { email: 'That email address doesn’t look right.' } }
    }
    return {
      errors: {
        form: 'We couldn’t create your account just now. Please try again in a moment, or contact support if it keeps happening.',
      },
    }
  }

  return { sentTo: email, postcodeNotice }
}
