'use client'

import { useState, useTransition } from 'react'
import { markAllRead } from './notification-actions'

/**
 * Says what happened rather than assuming it worked. The write can fail under
 * RLS or a dropped connection, and a button that clears the list optimistically
 * would show zero unread against a database that still says otherwise.
 */
export function MarkAllReadButton({ unread }: { unread: number }) {
  const [failed, setFailed] = useState(false)
  const [pending, startTransition] = useTransition()

  if (unread === 0) return null

  return (
    <div className="text-right">
      <button
        onClick={() => {
          setFailed(false)
          startTransition(async () => {
            const res = await markAllRead()
            if (!res.ok) setFailed(true)
          })
        }}
        disabled={pending}
        className="inline-flex min-h-11 items-center rounded-[999px] px-3 text-sm font-bold text-muted transition-colors hover:bg-soft-pink hover:text-rose disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
      >
        {pending ? 'Marking…' : `Mark all read (${unread})`}
      </button>
      {failed && (
        <p role="alert" className="text-sm text-danger">
          That didn’t save. They’re still marked unread.
        </p>
      )}
    </div>
  )
}
