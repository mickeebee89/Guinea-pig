/**
 * The signup metadata payload. ONE definition, imported by every web signup
 * path. Never reproduced per form.
 *
 * WHY THIS EXISTS
 *   handle_new_auth_user reads role, first_name, last_name, last_initial,
 *   region, date_of_birth and terms_accepted out of raw_user_meta_data.
 *   Migration 0002 rejects a signup whose role is missing or unrecognised, and
 *   whose date_of_birth is missing or under 18.
 *
 *   That backstop exists because a permissive default — coalesce(role, 'model')
 *   — silently created stylists as models with no providers row, and the
 *   failure only surfaced much later. The backstop is the last line, not the
 *   design. Making the payload a single typed object means role cannot be
 *   omitted by a form that forgot it: TypeScript refuses before the database
 *   ever sees it.
 *
 * ⚠️ DUPLICATION, KNOWN AND UNAVOIDABLE
 *   mobile/src/screens/auth/SignupScreen.tsx:154 builds the same shape by hand.
 *   mobile/ and site/ are separate packages with no workspace linkage, so this
 *   module cannot be imported there. The two are kept in agreement by the
 *   DATABASE, not by discipline: 0002 rejects anything that does not satisfy
 *   both rules, from either client.
 *
 *   If you change this shape, change SignupScreen.tsx too — and if you add a
 *   REQUIRED field, add it to handle_new_auth_user in a migration first, so the
 *   older client is rejected loudly rather than writing a half-formed account.
 */

export type SignupRole = 'model' | 'provider'

export interface SignupInput {
  role: SignupRole
  firstName: string
  lastName: string
  dateOfBirth: Date
  /** Where this signup came from — a cohort link, a campaign. Optional. */
  source?: string | null
  /** Optional. Absent, or the canonical postcode a successful lookup returned. */
  signupPostcode?: string | null
}

/** Shape written to auth.users.raw_user_meta_data. Mirrors what 0002 reads. */
export interface SignupMetadata {
  role: SignupRole
  first_name: string
  last_name: string
  last_initial: string
  region: string
  date_of_birth: string
  age_confirmed: true
  terms_accepted: true
  signup_source?: string
  /**
   * The postcode she typed at signup, in the canonical form OUR lookup
   * returned. Optional, and absent unless the lookup succeeded.
   *
   * ⚠⚠ IT IS A CARRIER, NOT A STORE. Nothing reads it except
   * `/auth/confirm`, which RE-LOOKS-IT-UP and writes through
   * `set_my_postcode`. It is never trusted as a location.
   *
   * ⚠⚠ AND THE COORDINATE IS DELIBERATELY NOT HERE. Auth metadata is
   * client-settable — anyone can call signUp directly with the anon key and
   * put what they like in `options.data` — so a latitude carried here would be
   * a coordinate from the browser, which
   * `site/lib/queries/postcode-action.ts` exists to refuse: "being placed
   * somewhere you are not is the exact failure this feature exists to remove."
   * A forged POSTCODE only places someone at a real postcode they could have
   * typed into the box anyway; a forged coordinate places them anywhere.
   */
  signup_postcode?: string
}

/**
 * The longest a canonical UK postcode can be: 7 characters plus the one space,
 * e.g. "AA9A 9AA". Used as the cap on `signup_postcode` in both directions.
 *
 * ⚠⚠ WHAT THE CAP DOES AND DOES NOT BUY. It bounds what WE write. It cannot
 * bound what a crafted client writes — `raw_user_meta_data` is whatever was
 * sent to GoTrue, and nothing on our side sees that call. What it guarantees is
 * that the READ side never processes an unbounded string: `/auth/confirm`
 * slices to this length before it looks at the value at all, so the worst case
 * is 8 junk characters handed to a lookup that refuses them.
 */
export const POSTCODE_MAX = 8

/** Full years, matching ageOn() in SignupScreen.tsx AND the trigger's
 *  extract(year from age(...)). All three must agree on a birthday boundary. */
export function ageOn(dob: Date, today = new Date()): number {
  let age = today.getFullYear() - dob.getFullYear()
  const m = today.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--
  return age
}

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Build the metadata. Every required field is a required property of
 * SignupInput, so omitting one is a type error rather than a runtime surprise.
 *
 * `age_confirmed` and `terms_accepted` are literal `true` on purpose: they are
 * not evidence, they are a record that the boxes were ticked. The evidence is
 * `date_of_birth`, which the database verifies. The form must still refuse to
 * submit without both ticks — see validateSignup.
 */
export function buildSignupMetadata(input: SignupInput): SignupMetadata {
  const lastName = input.lastName.trim()
  const meta: SignupMetadata = {
    role:           input.role,
    first_name:     input.firstName.trim(),
    last_name:      lastName,
    last_initial:   lastName.charAt(0).toUpperCase(),
    region:         'UK',
    date_of_birth:  toIsoDate(input.dateOfBirth),
    age_confirmed:  true,
    terms_accepted: true,
  }
  const source = input.source?.trim()
  if (source) meta.signup_source = source.slice(0, 120)
  // ⚠️ Only ever set from a SUCCESSFUL lookup in the signup action, so this is
  // already canonical; the cap is belt and braces on our own write.
  const postcode = input.signupPostcode?.trim()
  if (postcode) meta.signup_postcode = postcode.slice(0, POSTCODE_MAX)
  return meta
}

/**
 * Client-side validation. Mirrors SignupScreen.tsx so both front ends reject
 * the same inputs with the same messages.
 *
 * ⚠️ This is the USER-FACING gate and it is not optional just because 0002
 * validates server-side. GoTrue wraps any trigger exception as the generic
 * "Database error saving new user" — no field named, nothing actionable. These
 * messages are what make a rejection fixable by the person reading it.
 */
export function validateSignup(input: {
  firstName: string
  lastName: string
  email: string
  password: string
  confirmPassword: string
  dateOfBirth: Date | null
  ageConfirmed: boolean
  termsAccepted: boolean
}): Record<string, string> {
  const e: Record<string, string> = {}

  if (!input.firstName.trim()) e.firstName = 'Enter your first name'
  if (!input.lastName.trim())  e.lastName  = 'Enter your last name'
  if (!input.email.trim())     e.email     = 'Enter your email'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) e.email = 'Enter a valid email'
  if (input.password.length < 8) e.password = 'At least 8 characters'
  if (input.password !== input.confirmPassword) e.confirmPassword = 'Passwords do not match'

  if (!input.dateOfBirth) {
    e.dob = 'Enter your date of birth'
  } else if (input.dateOfBirth > new Date()) {
    e.dob = 'Date of birth cannot be in the future'
  } else if (ageOn(input.dateOfBirth) > 120) {
    e.dob = 'Enter a valid date of birth'
  } else if (ageOn(input.dateOfBirth) < 18) {
    e.dob = 'You must be 18 or over to use Cavy'
  }

  if (!input.ageConfirmed)  e.age   = 'You must confirm you are 18 or over'
  if (!input.termsAccepted) e.terms = 'Please agree to the Terms and Privacy Policy'

  return e
}

/** Where auth emails come back to. Explicit everywhere — never relying on the
 *  project's Site URL fallback, so these keep working whatever it is set to. */
export const AUTH_REDIRECTS = {
  confirm: '/auth/confirm',
  reset:   '/auth/reset',
} as const

export function absoluteAuthUrl(path: string, origin: string): string {
  return new URL(path, origin).toString()
}
