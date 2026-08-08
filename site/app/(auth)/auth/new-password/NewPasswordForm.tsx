'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { updatePassword } from './actions'

/**
 * The password fields. A Client Component only for the pending state and the
 * redirect — the update itself runs in a Server Action, so the Supabase key
 * stays out of the browser bundle. See actions.ts.
 */
export function NewPasswordForm() {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(updatePassword, null)

  useEffect(() => {
    if (state?.ok) {
      router.replace('/dashboard')
      router.refresh()
    }
  }, [state?.ok, router])

  const field =
    'w-full rounded-md border border-hairline bg-input-bg px-4 py-3 text-warm-dark outline-none transition-colors focus-visible:border-rose focus-visible:ring-2 focus-visible:ring-rose/30'

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <div>
        <label className="block text-sm font-bold text-warm-dark" htmlFor="password">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className={`mt-1.5 ${field}`}
        />
      </div>

      <div>
        <label className="block text-sm font-bold text-warm-dark" htmlFor="confirm">
          Confirm new password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className={`mt-1.5 ${field}`}
        />
      </div>

      {state?.error && (
        <p role="alert" className="text-sm font-bold text-danger">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-[999px] bg-rose px-6 py-3.5 font-bold text-white shadow-[var(--shadow-card)] transition-colors hover:bg-rose-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Save new password'}
      </button>
    </form>
  )
}
