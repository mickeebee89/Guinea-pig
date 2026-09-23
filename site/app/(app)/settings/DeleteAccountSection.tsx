'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { deleteMyAccount } from './actions'

/**
 * Delete your own account, from the web. Audit item 85.
 *
 * ── WHY IT EXISTS ─────────────────────────────────────────────────────────
 * The deletion page said "In the app: Settings → Delete account. Or email us",
 * and there is no app in any store. So the only self-serve route to an erasure
 * right was an email to support — for a member who signed up on the website,
 * used the website, and never had an app to go to.
 *
 * ── THE CONFIRMATION IS TYPE-TO-CONFIRM, NOT TWO CLICKS ───────────────────
 * Two gates that are different KINDS of act: reading the panel, then typing a
 * word. A mis-tap cannot produce the word, and the box cannot be armed by
 * muscle memory the way a second dialog can.
 *
 * Not her email address: it is pasteable, shoulder-surfable and sitting in the
 * browser's autofill. Not her password either — the session is already the
 * authorisation, and putting a password field on a destructive form teaches
 * exactly the habit phishing relies on.
 */

const CONFIRM_WORD = 'DELETE'

export function DeleteAccountSection() {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  /** Set only for the one failure where her data is gone and the login is not. */
  const [retryable, setRetryable] = useState(false)

  const armed = typed.trim().toUpperCase() === CONFIRM_WORD

  const run = () => {
    if (!armed) return
    setError(null)
    start(async () => {
      const res = await deleteMyAccount()
      // On success the action redirects, so nothing after this runs.
      if (!res.ok) {
        setError(res.error)
        setRetryable(!!res.retryable)
      }
    })
  }

  return (
    <div>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-sm font-bold text-danger hover:underline"
        >
          Delete my account
        </button>
      ) : (
        <div className="rounded-lg border border-danger/30 bg-white p-4">
          <h3 className="font-display text-lg text-warm-dark">Delete your account</h3>

          <p className="mt-2 text-sm text-warm-dark">
            <span className="font-bold">Deleting your account removes</span> your profile, your
            photos, your messages and your bookings, straight away. Anything left in our systems is
            gone within 30 days.
          </p>

          {/* The survivals, in the same terms as the deletion page — she should
              not find out afterwards, and she should not have to read a legal
              document to find out now. */}
          <p className="mt-3 text-sm text-muted">
            <span className="font-bold text-warm-dark">Some things stay.</span> A record that you
            agreed to a treatment, any moderation action taken on your account, and any report
            involving you — including reports you made about someone else. These keep your first
            name and a scrambled version of your email address that we can’t read back, and nothing
            else: no photos, no messages, no contact details. We keep them for up to 6 years and
            then delete them. A report is a record of something that happened between two people,
            so it isn’t only yours to remove.
          </p>

          <p className="mt-3 text-sm text-muted">
            <span className="font-bold text-warm-dark">
              If you have a membership, it’s cancelled now
            </span>{' '}
            — not at the end of the month — and you won’t be charged again.
          </p>

          <p className="mt-3 text-xs text-muted">
            The full detail is on our{' '}
            <Link href="/delete-account" className="font-bold text-rose hover:underline">
              account deletion page
            </Link>
            .
          </p>

          <label htmlFor="confirm-delete" className="mt-5 block text-sm font-bold text-warm-dark">
            Type {CONFIRM_WORD} to confirm
          </label>
          <input
            id="confirm-delete"
            type="text"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="mt-1 min-h-11 w-40 rounded-md border border-hairline px-3 text-sm"
          />

          {error && (
            <div role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              <p>{error}</p>
              {retryable && (
                <p className="mt-1 text-xs">
                  Pressing the button again is safe — it picks up where it stopped.
                </p>
              )}
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={run}
              disabled={!armed || pending}
              className="inline-flex min-h-11 items-center rounded-[999px] bg-danger px-6 text-sm font-bold text-white disabled:bg-border disabled:text-muted"
            >
              {pending ? 'Deleting…' : retryable ? 'Try again' : 'Delete my account permanently'}
            </button>
            <button
              onClick={() => { setOpen(false); setTyped(''); setError(null) }}
              disabled={pending}
              className="inline-flex min-h-11 items-center rounded-[999px] bg-input-bg px-6 text-sm font-bold text-rose"
            >
              Keep my account
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
