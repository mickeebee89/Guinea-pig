'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { inviteFromFloor, removeFromFloor } from './actions'

/**
 * What you can do with somebody else's post, which is deliberately very little.
 *
 * A stylist's post links to her shop — that journey already existed from the
 * dashboard's updates and is reused rather than rebuilt, so post → shop → apply
 * is the same path it has always been.
 *
 * A model's post offers a stylist one thing: invite. There is no profile link,
 * because the wall is not a directory — she is here because she posted, and
 * the invite is the whole of what a stylist can do about it.
 */
export function PostActions({
  postId, authorUserId, authorName, providerId, isMine, viewerIsProvider,
}: {
  postId: string
  authorUserId: string
  authorName: string
  providerId: string | null
  isMine: boolean
  viewerIsProvider: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (isMine) {
    return (
      <div className="mt-2">
        <button
          onClick={() => startTransition(async () => {
            const res = await removeFromFloor(postId)
            if (!res.ok) setError(res.error)
          })}
          disabled={pending}
          className="min-h-11 text-sm font-bold text-muted hover:text-warm-dark disabled:opacity-50"
        >
          {pending ? 'Taking it down…' : 'Take it down'}
        </button>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    )
  }

  // A stylist's post: straight to the shop, where Apply lives.
  if (providerId) {
    return (
      <p className="mt-2">
        <Link
          href={`/stylist/${providerId}`}
          className="min-h-11 text-sm font-bold text-rose hover:underline"
        >
          See their shop →
        </Link>
      </p>
    )
  }

  // A model's post, seen by a stylist.
  if (viewerIsProvider) {
    return (
      <div className="mt-2">
        {done ? (
          <p className="text-sm text-muted">{done}</p>
        ) : (
          <button
            onClick={() => startTransition(async () => {
              const res = await inviteFromFloor(authorUserId)
              if (res.ok) setDone(`Invited — ${authorName} has been told.`)
              else setError(res.error)
            })}
            disabled={pending}
            className="inline-flex min-h-11 items-center rounded-[999px] bg-soft-pink px-4 text-sm font-bold text-rose hover:bg-rose hover:text-white disabled:opacity-50"
          >
            {pending ? 'Inviting…' : 'Invite them'}
          </button>
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    )
  }

  // A model looking at another model's post. Nothing to do, and that is fine.
  return null
}
