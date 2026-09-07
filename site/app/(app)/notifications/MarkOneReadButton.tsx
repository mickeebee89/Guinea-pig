'use client'

import { useState, useTransition } from 'react'
import { markOneRead } from './notification-actions'

/**
 * One row's read control. Sits OUTSIDE the row's link — an anchor inside an
 * anchor is invalid, and a button inside one steals the click.
 *
 * Styled as a bordered button rather than pink text with a dot. The text
 * version read as a status label, which is the wrong thing for a control, and
 * its dot repeated the unread marker already sitting beside the title — two
 * marks for one fact.
 */
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
        className="my-1 inline-flex min-h-9 items-center rounded-[999px] border border-hairline bg-white px-3 text-xs font-bold text-muted transition-colors hover:border-rose/50 hover:text-rose disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose"
      >
        {pending ? 'Marking…' : 'Mark as read'}
      </button>
      {failed && (
        <span role="alert" className="ml-3 self-center text-xs text-danger">
          That didn’t save — still unread.
        </span>
      )}
    </>
  )
}
