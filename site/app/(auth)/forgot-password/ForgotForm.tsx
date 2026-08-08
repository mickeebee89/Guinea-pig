'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { requestReset, type ForgotState } from './actions'

export function ForgotForm() {
  const [state, formAction, pending] = useActionState<ForgotState | null, FormData>(requestReset, null)

  if (state?.sent) {
    return (
      <div role="status" className="mt-8 rounded-lg border border-hairline bg-white p-6 shadow-[var(--shadow-card)]">
        <p className="font-display text-xl text-warm-dark">Check your email</p>
        <p className="mt-2 text-sm text-muted">
          If there’s a Cavy account with that address, a reset link is on its way. It works once
          and expires after a short time.
        </p>
        <Link href="/sign-in" className="mt-4 inline-flex min-h-11 items-center rounded-[999px] bg-soft-pink px-5 text-sm font-bold text-rose">
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <div>
        <label className="block text-sm font-bold text-warm-dark" htmlFor="email">Email</label>
        <input
          id="email" name="email" type="email" inputMode="email" required
          autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          className="mt-1.5 w-full rounded-md border border-hairline bg-input-bg px-4 py-3 text-warm-dark outline-none transition-colors focus-visible:border-rose focus-visible:ring-2 focus-visible:ring-rose/30"
        />
      </div>

      {state?.error && (
        <p role="alert" className="text-sm font-bold text-danger">{state.error}</p>
      )}

      <button
        type="submit" disabled={pending}
        className="w-full rounded-[999px] bg-rose px-6 py-3.5 font-bold text-white shadow-[var(--shadow-card)] transition-colors hover:bg-rose-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Send reset link'}
      </button>

      <p className="text-center text-sm text-muted">
        Remembered it?{' '}
        <Link href="/sign-in" className="font-bold text-rose underline decoration-rose/30 underline-offset-2">Sign in</Link>
      </p>
    </form>
  )
}
