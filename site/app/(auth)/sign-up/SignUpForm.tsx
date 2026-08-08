'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { signUp, type SignUpState } from './actions'
import type { SignupRole } from '@/lib/signup'

const ROLES: { value: SignupRole; label: string; blurb: string }[] = [
  { value: 'provider', label: 'I’m a stylist', blurb: 'I offer treatments and want to build my portfolio' },
  { value: 'model',    label: 'I’m a model',   blurb: 'I’d love treatments and don’t mind being a practice client' },
]

/** 18 years ago today, ISO. Sets `max` on the date field so the native picker
 *  will not offer an under-18 date. Not enforcement — the action validates and
 *  migration 0002 backstops it — but it stops the mistake being made. */
function eighteenYearsAgo(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 18)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function SignUpForm({
  initialRole,
  source,
}: {
  initialRole: SignupRole | null
  source: string | null
}) {
  const [role, setRole] = useState<SignupRole | null>(initialRole)
  const [state, formAction, pending] = useActionState<SignUpState | null, FormData>(signUp, null)

  const field =
    'w-full rounded-md border border-hairline bg-input-bg px-4 py-3 text-warm-dark placeholder:text-muted/70 outline-none transition-colors focus-visible:border-rose focus-visible:ring-2 focus-visible:ring-rose/30'
  const label = 'block text-sm font-bold text-warm-dark'
  const err = (k: string) =>
    state?.errors?.[k] ? <p className="mt-1 text-sm font-bold text-danger">{state.errors[k]}</p> : null

  if (state?.sentTo) {
    return (
      <div
        role="status"
        className="rounded-lg border border-hairline bg-white p-6 text-center shadow-[var(--shadow-card)] sm:p-8"
      >
        <p className="font-display text-2xl text-warm-dark">Check your email</p>
        <p className="mt-2 text-muted">
          We’ve sent a confirmation link to <strong className="text-warm-dark">{state.sentTo}</strong>.
          Open it and your account is ready.
        </p>
        <p className="mt-4 text-sm text-muted">
          Nothing arrived? Check spam, or{' '}
          <Link href="/sign-up" className="text-rose underline decoration-rose/30 underline-offset-2">
            try again
          </Link>
          .
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-5">
      {/* Role is submitted as a hidden field so the typed action always receives
          it. Choosing is a real decision, so it is never defaulted — the
          database rejects a missing role, but nobody should reach that. */}
      <input type="hidden" name="role" value={role ?? ''} />
      {source && <input type="hidden" name="source" value={source} />}

      <fieldset>
        <legend className={label}>I’m signing up as</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {ROLES.map((r) => {
            const active = role === r.value
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => setRole(r.value)}
                aria-pressed={active}
                className={[
                  'rounded-lg border p-4 text-left transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose',
                  active
                    ? 'border-rose bg-rose text-white'
                    : 'border-hairline bg-white text-warm-dark hover:border-rose/40',
                ].join(' ')}
              >
                <span className="block font-display text-lg">{r.label}</span>
                <span className={['mt-1 block text-sm', active ? 'text-white/85' : 'text-muted'].join(' ')}>
                  {r.blurb}
                </span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="firstName">First name</label>
          <input id="firstName" name="firstName" required maxLength={80}
                 autoComplete="given-name" autoCapitalize="words" className={`mt-1.5 ${field}`} />
          {err('firstName')}
        </div>
        <div>
          <label className={label} htmlFor="lastName">Last name</label>
          <input id="lastName" name="lastName" required maxLength={80}
                 autoComplete="family-name" autoCapitalize="words" className={`mt-1.5 ${field}`} />
          {err('lastName')}
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted">
        Others only ever see your first name and last initial — “Sarah B.”
      </p>

      <div>
        <label className={label} htmlFor="email">Email</label>
        <input id="email" name="email" type="email" inputMode="email" required maxLength={200}
               autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
               className={`mt-1.5 ${field}`} />
        {err('email')}
      </div>

      <div>
        <label className={label} htmlFor="dateOfBirth">Date of birth</label>
        <input id="dateOfBirth" name="dateOfBirth" type="date" required
               max={eighteenYearsAgo()} className={`mt-1.5 ${field}`} />
        <p className="mt-1 text-xs text-muted">
          Cavy is for over-18s. We use this to check your age — it’s never shown to anyone.
        </p>
        {err('dob')}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required minLength={8}
                 autoComplete="new-password" className={`mt-1.5 ${field}`} />
          <p className="mt-1 text-xs text-muted">At least 8 characters.</p>
          {err('password')}
        </div>
        <div>
          <label className={label} htmlFor="confirmPassword">Confirm password</label>
          <input id="confirmPassword" name="confirmPassword" type="password" required minLength={8}
                 autoComplete="new-password" className={`mt-1.5 ${field}`} />
          {err('confirmPassword')}
        </div>
      </div>

      {/* Two separate ticks, never pre-ticked — the same pair the mobile signup
          records, and what terms_accepted_at is written from. */}
      <div className="space-y-1">
        <label className="-mx-2 flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 text-sm text-warm-dark/80 active:bg-input-bg">
          <input name="ageConfirmed" type="checkbox" required
                 className="mt-0.5 size-5 shrink-0 accent-rose" />
          <span>I confirm I am 18 or over</span>
        </label>
        {err('age')}

        <label className="-mx-2 flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 text-sm text-warm-dark/80 active:bg-input-bg">
          <input name="termsAccepted" type="checkbox" required
                 className="mt-0.5 size-5 shrink-0 accent-rose" />
          <span>
            I agree to the{' '}
            <Link href="/terms" className="text-rose underline decoration-rose/30 underline-offset-2">Terms of Service</Link>
            {' '}and{' '}
            <Link href="/privacy" className="text-rose underline decoration-rose/30 underline-offset-2">Privacy Policy</Link>
          </span>
        </label>
        {err('terms')}
      </div>

      {state?.errors?.form && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm font-bold text-danger">
          {state.errors.form}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !role}
        className="w-full rounded-[999px] bg-rose px-6 py-3.5 font-bold text-white shadow-[var(--shadow-card)] transition-colors hover:bg-rose-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose disabled:opacity-60"
      >
        {pending ? 'Creating your account…' : 'Create account'}
      </button>

      {!role && (
        <p className="text-center text-sm text-muted">Choose stylist or model to continue.</p>
      )}

      <p className="text-center text-sm text-muted">
        Already have an account?{' '}
        <Link href="/sign-in" className="font-bold text-rose underline decoration-rose/30 underline-offset-2">
          Sign in
        </Link>
      </p>
    </form>
  )
}
