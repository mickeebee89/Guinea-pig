'use client'

import { useState, useTransition } from 'react'
import { setEmailNotifications } from './actions'

/**
 * One switch for every notification email. Audit item 74.
 *
 * Deliberately not per-type: there are eight, and we have no evidence yet about
 * which ones annoy people. The stored shape leaves room for that later without
 * a migration (users.notification_preferences).
 *
 * The line about account emails matters: turning this off must not leave anyone
 * believing a password reset will stop arriving too.
 */
export function EmailNotificationsSection({ enabled }: { enabled: boolean }) {
  const [on, setOn] = useState(enabled)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const change = (next: boolean) => {
    setError(null)
    setOn(next)                       // optimistic: the switch answers immediately
    start(async () => {
      const res = await setEmailNotifications(next)
      if (!res.ok) { setOn(!next); setError(res.error) }
    })
  }

  return (
    <div>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={e => change(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-rose"
        />
        <span>
          <span className="block text-sm font-bold text-warm-dark">
            Email me when something happens on Cavy
          </span>
          <span className="mt-0.5 block text-sm text-muted">
            Applications, bookings accepted, declined or cancelled, new messages, your ID check,
            a failed payment, and anything official from us. At most one email an hour per
            conversation.
          </span>
        </span>
      </label>

      <p className="mt-3 text-xs text-muted">
        We’ll still email you about your account itself — confirming your address, or resetting
        your password.
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}
    </div>
  )
}
