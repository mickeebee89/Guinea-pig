'use server'

import { headers } from 'next/headers'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { isRateLimited } from '@/lib/authErrors'
import { lookupPostcode, postcodeMessage } from '@/lib/postcode'
import { cleanCampaign } from '@/lib/attribution'
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
  /**
   * ⚠️⚠️ RE-SANITISED HERE, AND THE CLIENT'S CLEAN IS NOT A SUBSTITUTE. This
   * is a hidden input, so its value is whatever was POSTed — this action is a
   * public endpoint and anyone can call it with `campaign` set to anything of
   * any length. `cleanCampaign` reduces each part to `[a-z0-9_-]` and caps it,
   * so what reaches auth metadata cannot carry a payload, a separator it should
   * not have, or an unbounded string.
   *
   * ⚠️ null, NEVER 'direct'. Most arrivals carry nothing, and an invented
   * default would make "we have no idea" indistinguishable from "she typed the
   * address in". `cleanCampaign` returns null for an empty or junk value, and
   * `buildSignupMetadata` then omits the key entirely rather than writing an
   * empty string.
   */
  const campaign = cleanCampaign(String(formData.get('campaign') ?? ''))
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
    dateOfBirth, ageConfirmed, termsAccepted, postcode: postcodeRaw,
  })
  if (Object.keys(errors).length > 0) return { errors }

  const supabase = await createSupabaseServerClient()

  // Absolute, and derived from the request rather than hardcoded, so localhost
  // confirms to localhost and production to production. Never relies on the
  // project Site URL fallback.
  const h = await headers()
  const origin = h.get('origin') ?? `https://${h.get('host') ?? 'cavybeauty.com'}`

  // ═══ THE POSTCODE LOOKUP — BEFORE signUp, AND IT CAN NOW STOP IT ═════════
  //
  // ⚠️⚠️ TWO FAILURES, TWO ANSWERS, AND COLLAPSING THEM WOULD HAND
  // postcodes.io A VETO OVER OUR OWN SIGNUPS.
  //
  //   unavailable                 → THEIR outage, OUR problem. The account is
  //                                 created and the RAW text she typed travels
  //                                 in the metadata, because /auth/confirm
  //                                 re-looks it up when she confirms — minutes
  //                                 to hours later, usually after the service
  //                                 is back. That route already returns quietly
  //                                 on a failed lookup, so this needed nothing
  //                                 new to work.
  //   malformed|not_found|
  //   not_located                 → HER typo. Refused, with the box still on
  //                                 screen so she can fix it. That is the whole
  //                                 difference from the old post-signup notice,
  //                                 which told her about a field that had
  //                                 already gone.
  //
  // ⚠️ A postcode is REQUIRED as of 26 Oct 2026, but "required to enter" is not
  // "must resolve before you may have an account". The first is a rule about
  // her; the second would be a rule about somebody else's uptime.
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

  // validateSignup has already refused an empty one, so this is always set.
  const found = await lookupPostcode(postcodeRaw)
  if (found.ok) {
    signupPostcode = found.place.postcode
  } else if (found.reason === 'unavailable') {
    // ⚠️⚠️ THE ACCOUNT IS STILL CREATED, AND THE RAW TEXT GOES WITH IT.
    //
    // /auth/confirm's storeSignupPostcode reads signup_postcode, re-looks it
    // up and writes through set_my_postcode — and it already returns quietly
    // when a lookup fails, for ANY reason including the service being down.
    // So carrying the raw value is the entire fix: confirmation happens later,
    // the outage is usually over, and it resolves then.
    //
    // ⚠️ IT MAY NOT BE CANONICAL, AND THAT IS FINE. Nothing stores this value;
    // confirm uses it only as the INPUT to a lookup and writes
    // found.place.postcode. If it never resolves she has an account with no
    // postcode, which is exactly where a refusal would have left her, minus
    // the refusal.
    signupPostcode = postcodeRaw
    // ⚠️ OURS, NOT HERS. A service outage must never read as "your postcode is
    // wrong" — the same distinction postcodeMessage() makes.
    postcodeNotice = 'We couldn’t check your postcode just now. Your account is made, and we’ll save it when you confirm your email.'
  } else {
    // ⚠️⚠️ malformed | not_found | not_located — REFUSED, NOT NOTICED, and
    // this is the point of the change. The box is still on screen, so she can
    // fix a typo in the place she made it. The old behaviour created the
    // account and then told her about a field that had already gone, which is
    // advice nobody can act on.
    //
    // ⚠️⚠️ postcodeMessage, NOT A LITERAL, AND THE THREE ARE NOT THE SAME
    // SENTENCE. A hardcoded "we couldn't find that postcode" tells somebody
    // who typed "e164qwrk" that we LOOKED and failed, when the truth is it
    // never looked like a postcode and no lookup happened. The distinctions
    // already exist one file away:
    //
    //   malformed     "That doesn't look like a UK postcode..."
    //   not_found     "We couldn't find that postcode. Check it and try again."
    //   not_located   "That postcode exists, but we don't have a location..."
    //
    // The third is the one a literal destroys: being told to check a postcode
    // she has typed correctly, when the real answer is to try a neighbouring
    // street, is advice that cannot work.
    //
    // ⚠️ 'unavailable' MUST NOT REACH HERE, and it cannot: its message says
    // "nothing has changed", which is FALSE at signup because the account IS
    // created. The `else if` above narrows `found.reason` to the three
    // refusing cases, so TypeScript refuses to pass it rather than a comment
    // promising nobody will.
    return { errors: { postcode: postcodeMessage(found.reason) } }
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
        campaign,
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
