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
}

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
