'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { declineInvite } from '../models/actions'

/**
 * Decline one invite.
 *
 * ⚠️ NOT A CONFIRMATION DIALOG. Declining is reversible in the only sense
 * that matters — the shop is still there, still has Apply on it, and she can
 * still book. Asking "are you sure?" would make saying no feel heavier than
 * saying yes, which is backwards for the party who did not start the
 * conversation.
 */
export function DeclineButton({ inviteId }: { inviteId: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null)
          start(async () => {
            const res = await declineInvite(inviteId)
            if (!res.ok) { setError(res.error); return }
            router.refresh()
          })
        }}
        className="inline-flex min-h-11 items-center rounded-[999px] bg-input-bg px-4 text-sm font-bold text-warm-dark hover:bg-soft-pink disabled:opacity-50"
      >
        {pending ? 'Declining…' : 'Decline'}
      </button>
      {error && <p role="alert" className="text-sm font-bold text-danger">{error}</p>}
    </>
  )
}
