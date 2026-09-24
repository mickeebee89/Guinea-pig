'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { attempt } from '@/lib/attempt'
import { saveMyName } from './name-actions'

/**
 * Correcting your own name. Audit item 104.
 *
 * ── WHY IT IS IN SETTINGS AND NOT ON A PROFILE PAGE ───────────────────────
 * It belongs to the ACCOUNT, not to either role. A stylist's `/shop` name is
 * her shop's name — a different thing that can be a salon — and `/profile` is
 * the model's page. This is the one name that appears on her reviews, her
 * bookings and her chats whichever role she is in, so it sits with the other
 * account-level things.
 *
 * ── WHAT IT SHOWS HER, WHICH IS MORE THAN A BOX ───────────────────────────
 * The display form ("Sarah B.") is echoed, because the two fields do not look
 * like the thing they produce, and the surname is never shown in full — a
 * member typing her whole surname into the initial box has misunderstood what
 * the product does, and seeing "Sarah Bennett." makes that obvious.
 */
export function NameSection({
  firstName, lastInitial, changedAt,
}: {
  firstName: string
  lastInitial: string | null
  /** The last change, if any. Drives the cooldown note. */
  changedAt: string | null
}) {
  const router = useRouter()
  const [first, setFirst] = useState(firstName)
  const [initial, setInitial] = useState(lastInitial ?? '')
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dirty = first.trim() !== firstName || initial.trim().toUpperCase() !== (lastInitial ?? '')
  const preview = `${first.trim() || '—'}${initial.trim() ? ` ${initial.trim().toUpperCase()}.` : ''}`

  const save = () => {
    setMsg(null); setError(null)
    start(async () => {
      const res = await attempt(() => saveMyName(first, initial), 'settings:name')
      if (!res.ok) { setError(res.error ?? 'That didn’t save.'); return }
      setMsg('Saved.')
      router.refresh()
    })
  }

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        This is the name on your reviews, your bookings and your messages. Other people see your
        first name and the first letter of your surname — never your full surname.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="first-name" className="block text-sm font-bold text-warm-dark">
            First name
          </label>
          <input
            id="first-name"
            value={first}
            onChange={e => setFirst(e.target.value)}
            maxLength={40}
            autoComplete="given-name"
            className="mt-1 min-h-11 w-48 rounded-md border border-hairline bg-white px-3 text-sm text-warm-dark"
          />
        </div>
        <div>
          <label htmlFor="last-initial" className="block text-sm font-bold text-warm-dark">
            Surname initial
          </label>
          <input
            id="last-initial"
            value={initial}
            onChange={e => setInitial(e.target.value)}
            maxLength={1}
            autoCapitalize="characters"
            autoComplete="off"
            className="mt-1 min-h-11 w-16 rounded-md border border-hairline bg-white px-3 text-center text-sm uppercase text-warm-dark"
          />
        </div>
        <button
          onClick={save}
          disabled={pending || !dirty}
          className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white disabled:bg-border disabled:text-muted"
        >
          {pending ? 'Saving…' : 'Save name'}
        </button>
      </div>

      <p className="mt-2 text-sm text-muted">
        Others will see: <span className="font-bold text-warm-dark">{preview}</span>
      </p>

      {error && <p role="alert" className="mt-2 max-w-md text-sm text-danger">{error}</p>}
      {msg && !error && <p className="mt-2 text-sm text-muted">{msg}</p>}

      {/* ⚠️ SAID BEFORE SHE TRIES, not after the refusal. The rule is in the
          database (0056) and she cannot discover it any other way — being told
          "you can change it again on 24 October" only once you have already
          decided to change it is the shape of failure this audit keeps
          finding. Shown only when there IS a previous change. */}
      {changedAt && (
        <p className="mt-3 text-xs text-muted">
          You last changed this on{' '}
          {new Date(changedAt).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'long', year: 'numeric',
          })}
          . A name can be changed once every 30 days — if you need it changed sooner, get in touch.
        </p>
      )}
    </div>
  )
}
