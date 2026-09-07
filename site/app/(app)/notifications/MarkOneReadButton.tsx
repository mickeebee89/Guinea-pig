'use client'

import { useState, useTransition } from 'react'
import { markOneRead } from './notification-actions'

/** One row's read control. Sits OUTSIDE the row's link — an anchor inside an
 *  anchor is invalid, and a button inside one steals the click. */
export function MarkOneReadButton({ id }: { id: string }) {
  const [failed, setFailed] = useState(false)
  const [pending, startTransition] = useTransition()

  return (
    <>
      <button
        onClick={() => {
          setFailed(false)
          startTransition(async () => {
            const res = await markOneRead(id)
            if (!res.ok) setFailed(true)
          })
        }}
        disabled={pending}
        className="inline-flex min-h-11 items-center gap-2 text-xs font-bold text-muted transition-colors hover:text-rose disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
      >
        <span className="h-2 w-2 rounded-[999px] bg-rose" aria-hidden="true" />
        {pending ? 'Marking…' : 'Mark as read'}
      </button>
      {failed && (
        <span role="alert" className="ml-3 text-xs text-danger">
          That didn’t save — still unread.
        </span>
      )}
    </>
  )
}
