'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { sendInvite } from './actions'
import { MAX_INVITE_MESSAGE, type InvitableModel } from '@/lib/queries/invites'
import { formatMiles } from '@/lib/distance'
import { Avatar } from '@/components/ui'

/**
 * One model, and the one invite she can be sent.
 *
 * ⚠️ THE MESSAGE BOX IS OPEN BY A CLICK, NOT ALWAYS SHOWN. A page of ten
 * cards each with a textarea invites ten identical messages, and an identical
 * message is the thing that makes an invite feel like a mailshot. Opening one
 * is a small deliberate act, which is most of the friction left now that the
 * limit is one a day per person rather than one ever (0114).
 */
export function InviteCard({ model }: { model: InvitableModel }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const name = [model.firstName, model.lastInitial ? `${model.lastInitial}.` : null]
    .filter(Boolean).join(' ') || 'A model'

  const over = message.trim().length > MAX_INVITE_MESSAGE

  const submit = () => {
    setError(null)
    start(async () => {
      const res = await sendInvite(model.id, message)
      if (!res.ok) { setError(res.error); return }
      setSent(true)
      setOpen(false)
      // The card disappears on refresh — invitable_models excludes anyone
      // already invited — so the confirmation below is what she sees until
      // the list reloads.
      router.refresh()
    })
  }

  return (
    <section className="rounded-lg border border-hairline bg-white p-4 shadow-soft">
      <div className="flex items-start gap-3">
        <Avatar src={model.avatarUrl} name={name} size={48} />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-warm-dark">{name}</p>
          {/* ⚠️ null IS "we cannot work it out", NOT "zero miles". The page
              only reaches this card when the viewer is placed, so a null here
              means the MODEL has no coordinate — and saying nothing is better
              than printing a blank where a number belongs. */}
          {model.distanceMiles != null && (
            <p className="text-sm text-muted">{formatMiles(model.distanceMiles)} away</p>
          )}
          {model.bio && (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted">{model.bio}</p>
          )}
          {model.attributes.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {model.attributes.map(a => (
                <li
                  key={a.label}
                  className="rounded-[999px] bg-input-bg px-2.5 py-0.5 text-xs text-muted"
                >
                  <span className="font-bold text-warm-dark">{a.label}:</span> {a.value}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {sent ? (
        <p role="status" className="mt-3 text-sm font-bold text-rose">
          Invite sent. They’ll get it in the app and by email, and you can send another
          tomorrow if you need to.
        </p>
      ) : open ? (
        <div className="mt-3">
          <label htmlFor={`msg-${model.id}`} className="text-xs text-muted">
            Your message — what you’re offering, and when
          </label>
          <textarea
            id={`msg-${model.id}`}
            rows={3}
            value={message}
            onChange={e => setMessage(e.target.value)}
            maxLength={MAX_INVITE_MESSAGE + 50}
            aria-invalid={over ? true : undefined}
            placeholder="I’m practising balayage and have Tuesday afternoons free — it’d be free for you."
            className="mt-1 w-full rounded-md border border-hairline p-2 text-sm"
          />
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <span className={`text-xs ${over ? 'text-danger' : 'text-muted'}`}>
              {message.trim().length}/{MAX_INVITE_MESSAGE}
              {/* Optional, and said so — a required message would turn one
                  invite into a writing task and most would go unsent. */}
              {message.trim() === '' && ' · optional, but it helps'}
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => { setOpen(false); setError(null) }}
                className="inline-flex min-h-11 items-center rounded-[999px] bg-input-bg px-4 text-sm font-bold text-warm-dark"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending || over}
                className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white hover:bg-rose-dark disabled:opacity-50"
              >
                {pending ? 'Sending…' : 'Send invite'}
              </button>
            </span>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white hover:bg-rose-dark"
        >
          Invite {model.firstName ?? 'them'}
        </button>
      )}

      {error && <p role="alert" className="mt-2 text-sm font-bold text-danger">{error}</p>}
    </section>
  )
}
