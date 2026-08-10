'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { unblockUser } from './actions'
import { Avatar } from '@/components/ui'

export interface BlockedPerson {
  userId: string
  name: string
  picUrl: string | null
  blockedAt: string
}

/**
 * People you have blocked, and the way to undo it.
 *
 * ── WHY THIS EXISTS AS ITS OWN PIECE OF WORK ──────────────────────────────
 * Blocking shipped on the web in slice 2. Unblocking did not, and the copy
 * sent people to the app for it. That made a safety control a one-way door for
 * anyone using the web only: they could stop someone contacting them and then
 * could not change their mind without installing an app.
 *
 * A control you cannot reverse is one people hesitate to use. The point of
 * blocking being easy is that someone uneasy about a stranger acts on it
 * immediately rather than talking themselves out of it.
 */
export function BlockedList({ people }: { people: BlockedPerson[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const unblock = (person: BlockedPerson) => {
    if (!confirm(`Unblock ${person.name}? They'll be able to message you again if you share a booking.`)) return
    setError(null)
    setBusyId(person.userId)
    start(async () => {
      const res = await unblockUser(person.userId)
      setBusyId(null)
      if (!res.ok) { setError(res.error); return }
      router.refresh()
    })
  }

  if (people.length === 0) {
    return (
      <p className="text-sm text-muted">
        You haven’t blocked anyone. If someone makes you uncomfortable, you can block them from
        any conversation — it stops them messaging you and cancels any booking between you.
      </p>
    )
  }

  return (
    <>
      <ul className="space-y-2">
        {people.map(p => (
          <li
            key={p.userId}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-white p-4"
          >
            <Avatar src={p.picUrl} name={p.name} size={40} />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-warm-dark">{p.name}</p>
              <p className="text-xs text-muted">
                Blocked {new Date(p.blockedAt).toLocaleDateString('en-GB', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })}
              </p>
            </div>
            <button
              onClick={() => unblock(p)}
              disabled={pending}
              className="inline-flex min-h-11 items-center rounded-[999px] bg-input-bg px-4 text-sm font-bold text-warm-dark hover:bg-soft-pink disabled:opacity-50"
            >
              {busyId === p.userId ? 'Unblocking…' : 'Unblock'}
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </>
  )
}
