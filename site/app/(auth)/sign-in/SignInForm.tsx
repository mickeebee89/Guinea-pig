'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { signIn, type SignInState } from './actions'

export function SignInForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<SignInState | null, FormData>(signIn, null)

  const field =
    'w-full rounded-md border border-hairline bg-input-bg px-4 py-3 text-warm-dark placeholder:text-muted/70 outline-none transition-colors focus-visible:border-rose focus-visible:ring-2 focus-visible:ring-rose/30'
  const label = 'block text-sm font-bold text-warm-dark'

  if (state?.needsConfirmation) {
    return (
      <div
        role="status"
        className="mt-8 rounded-lg border border-hairline bg-white p-6 shadow-[var(--shadow-card)]"
      >
        <p className="font-display text-xl text-warm-dark">Confirm your email first</p>
        <p className="mt-2 text-sm text-muted">
          Your account exists, but the email address hasn’t been confirmed yet. Open the link we
          sent when you signed up — check spam if it isn’t in your inbox.
        </p>
        <Link
          href="/sign-up"
          className="mt-4 inline-flex min-h-11 items-center rounded-[999px] bg-soft-pink px-5 text-sm font-bold text-rose"
        >
          Sign up again to resend it
        </Link>
      </div>
    )
  }

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <input type="hidden" name="next" value={next} />

      <div>
        <label className={label} htmlFor="email">Email</label>
        <input
          id="email" name="email" type="email" inputMode="email" required
          autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          className={`mt-1.5 ${field}`}
        />
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <label className={label} htmlFor="password">Password</label>
          <Link
            href="/forgot-password"
            className="text-sm text-rose underline decoration-rose/30 underline-offset-2"
          >
            Forgotten it?
          </Link>
        </div>
        <input
          id="password" name="password" type="password" required
          autoComplete="current-password" className={`mt-1.5 ${field}`}
        />
      </div>

      {state?.error && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm font-bold text-danger">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-[999px] bg-rose px-6 py-3.5 font-bold text-white shadow-[var(--shadow-card)] transition-colors hover:bg-rose-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="text-center text-sm text-muted">
        New to Cavy?{' '}
        <Link href="/sign-up" className="font-bold text-rose underline decoration-rose/30 underline-offset-2">
          Create an account
        </Link>
      </p>
    </form>
  )
}
