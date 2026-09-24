'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveMyPostcode } from '@/lib/queries/postcode-action'
import { attempt } from '@/lib/attempt'

/**
 * The postcode box. One component, both roles. Audit item 90.
 *
 * ── WHY IT SHOWS HER WHAT IT SAVED ────────────────────────────────────────
 * The lookup is the only thing between a typo and being placed somewhere she
 * is not, and "BR1 2AD" for "BR1 2AB" is a real postcode a mile away that no
 * validation can catch. Nothing in the database can check it either. So the
 * saved postcode is echoed back in the canonical form the lookup returned,
 * which is the only check that exists: she is it.
 *
 * ── AND WHY IT NEVER SHOWS A COORDINATE ───────────────────────────────────
 * A latitude is not information she can act on. Two numbers she cannot verify
 * would look like precision and add nothing — if the postcode is right the
 * coordinate is right, and if it is wrong the numbers would not tell her.
 */
export function PostcodeField({
  initial,
  /** What this postcode is FOR, in this context. The two roles use it differently. */
  hint,
  label = 'Postcode',
}: {
  initial: string | null
  hint: string
  label?: string
}) {
  const router = useRouter()
  const [value, setValue] = useState(initial ?? '')
  const [saved, setSaved] = useState<string | null>(initial)
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dirty = value.trim().toUpperCase() !== (saved ?? '').toUpperCase()

  const save = () => {
    setMsg(null); setError(null)
    start(async () => {
      const res = await attempt(() => saveMyPostcode(value), 'postcode:save')
      if (!res.ok) {
        // ⚠️ The box keeps what she typed. Clearing it on a failure would
        // make a service outage cost her the typing as well, and she would
        // have nothing on screen to compare against when she tried again.
        setError(res.error)
        return
      }
      setSaved(res.postcode)
      setValue(res.postcode ?? '')
      setMsg(res.postcode ? `Saved as ${res.postcode}.` : 'Removed.')
      // The dashboard feed changes the moment this lands.
      router.refresh()
    })
  }

  return (
    <div>
      <label htmlFor="postcode" className="block text-sm font-bold text-warm-dark">
        {label}
      </label>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          id="postcode"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="BR1 2AB"
          // A postcode is not a word: the keyboard should not capitalise it as
          // one or offer to correct it, and on a phone it wants the same
          // keyboard a postcode is typed on everywhere else.
          autoComplete="postal-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={8}
          disabled={pending}
          className="min-h-11 w-40 rounded-md border border-hairline bg-white px-3 text-sm uppercase text-warm-dark placeholder:normal-case placeholder:text-muted"
        />
        <button
          onClick={save}
          disabled={pending || !dirty}
          className="inline-flex min-h-11 items-center rounded-[999px] bg-rose px-5 text-sm font-bold text-white disabled:bg-border disabled:text-muted"
        >
          {pending ? 'Checking…' : 'Save'}
        </button>
        {/* Clearing is its own control rather than "save an empty box", which
            nobody would find. Location is optional and withdrawable, and a
            right you cannot see is not one. */}
        {saved && !pending && (
          <button
            onClick={() => { setValue(''); start(async () => {
              const res = await attempt(() => saveMyPostcode(''), 'postcode:clear')
              if (!res.ok) { setError(res.error ?? 'That didn’t save.'); return }
              setSaved(null); setMsg('Removed.'); router.refresh()
            }) }}
            className="inline-flex min-h-11 items-center px-2 text-sm font-bold text-muted hover:text-warm-dark hover:underline"
          >
            Remove
          </button>
        )}
      </div>

      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      {msg && !error && <p className="mt-2 text-sm text-muted">{msg}</p>}

      {!saved && !msg && !error && (
        <p className="mt-2 text-xs text-muted">
          Not set. Nothing is sorted by distance until you add one.
        </p>
      )}
    </div>
  )
}
